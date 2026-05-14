const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Файл реализует серверный менеджер памяти.
// Локальный JSON — первичное хранилище (быстрое, синхронное).
// Supabase — облачный бэкап (асинхронный, fire-and-forget).
// Все данные шифруются AES-256-GCM перед записью (локально и в Supabase).
// Если ENCRYPTION_KEY не задан — работает без шифрования.

// ── Шифрование AES-256-GCM ───────────────────────────────────────────────────

// Ключ кэшируется после первого вызова (scrypt — дорогая операция).
let _derivedKey = undefined

// Функция возвращает 32-байтовый ключ шифрования, производный от ENCRYPTION_KEY.
// Возвращает null если ключ не задан или короче 32 символов.
function getEncryptionKey() {
  if (_derivedKey !== undefined) return _derivedKey

  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    _derivedKey = null
    return null
  }
  if (raw.length < 32) {
    console.warn('[memory] ENCRYPTION_KEY должен быть минимум 32 символа — шифрование отключено')
    _derivedKey = null
    return null
  }

  // scrypt: PBKDF поверх произвольной строки → стабильный 32-байтовый ключ.
  _derivedKey = crypto.scryptSync(raw, 'yen-memory-aes256gcm-v1', 32)
  console.log('[memory] Шифрование AES-256-GCM активно')
  return _derivedKey
}

// Формат зашифрованной строки: <iv:24hex>:<tag:32hex>:<ciphertext:hex>
// IV — 12 байт (96 бит), Auth Tag — 16 байт, всё в hex.

// Функция шифрует строку. Если ключ не задан — возвращает исходную строку.
function encrypt(plaintext) {
  const key = getEncryptionKey()
  if (!key) return plaintext

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag() // 16 байт

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

// Функция расшифровывает строку. Если ключ не задан или формат не совпадает —
// возвращает строку как есть (совместимость с незашифрованными данными).
function decrypt(text) {
  const key = getEncryptionKey()
  if (!key || typeof text !== 'string') return text

  const parts = text.split(':')
  // iv=24hex, tag=32hex, data=любой hex
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) {
    return text // не зашифровано — возвращаем как есть (миграция)
  }

  try {
    const iv = Buffer.from(parts[0], 'hex')
    const tag = Buffer.from(parts[1], 'hex')
    const data = Buffer.from(parts[2], 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)

    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    // Неверный ключ, повреждённые или подменённые данные (GCM auth tag не совпал).
    // Возвращаем null — вызывающий код должен отбросить этот факт, не передавать мусор в Claude.
    console.error('[memory] Ошибка расшифровки (неверный ключ или повреждены данные) — факт отброшен')
    return null
  }
}

// ── MemoryManager ─────────────────────────────────────────────────────────────

class MemoryManager {
  // supabase — клиент @supabase/supabase-js или null если не настроен.
  constructor(filePath = path.join(__dirname, 'memory.json'), supabase = null) {
    this.filePath = filePath
    this.supabase = supabase
    this.categories = ['личное', 'работа', 'здоровье', 'цели', 'предпочтения', 'люди', 'проекты']
    this.#ensureMemoryFile()
  }

  // Функция добавляет или обновляет факт по ключу в категории.
  addFact(category, key, value) {
    if (!this.categories.includes(category) || !key || !value) return

    const memory = this.#readMemory()
    memory[category][key] = value
    this.#writeMemory(memory)

    void this.#upsertToSupabase(category, key, value)
  }

  // Функция возвращает факты одной категории.
  getFacts(category) {
    const memory = this.#readMemory()
    return memory[category] ?? {}
  }

  // Функция возвращает все факты по всем категориям.
  getAllFacts() {
    return this.#readMemory()
  }

  // Функция ищет совпадения по ключу или значению факта.
  search(query) {
    const normalizedQuery = String(query ?? '').trim().toLowerCase()
    if (!normalizedQuery) return []

    const memory = this.#readMemory()
    const results = []

    Object.entries(memory).forEach(([category, facts]) => {
      Object.entries(facts).forEach(([key, value]) => {
        if (String(key).toLowerCase().includes(normalizedQuery) ||
            String(value).toLowerCase().includes(normalizedQuery)) {
          results.push({ category, key, value })
        }
      })
    })

    return results
  }

  // Функция подбирает релевантные факты по словам из сообщения пользователя.
  getRelevantFacts(message) {
    const normalizedMessage = String(message ?? '').toLowerCase()
    const words = normalizedMessage
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => w.trim())
      .filter((w) => w.length > 2)

    if (!words.length) return []

    const memory = this.#readMemory()
    const found = []

    Object.entries(memory).forEach(([category, facts]) => {
      Object.entries(facts).forEach(([key, value]) => {
        const haystack = `${key} ${value}`.toLowerCase()
        if (words.some((w) => haystack.includes(w))) {
          found.push({ category, key, value })
        }
      })
    })

    return found
  }

  // Функция экспортирует всю память (расшифрованную) в JSON-строку.
  exportMemory() {
    return JSON.stringify(this.#readMemory(), null, 2)
  }

  // Функция удаляет факт по ключу из категории.
  deleteFact(category, key) {
    if (!this.categories.includes(category) || !key) return

    const memory = this.#readMemory()
    delete memory[category][key]
    this.#writeMemory(memory)

    void this.#deleteFromSupabase(category, key)
  }

  // Функция при старте сервера тянет факты из Supabase, расшифровывает и пишет локально.
  async syncFromSupabase() {
    if (!this.supabase) return

    try {
      const { data, error } = await this.supabase
        .from('facts')
        .select('category, key, value')

      if (error) throw error
      if (!data?.length) return

      const memory = this.#readMemory()
      let count = 0

      for (const row of data) {
        if (this.categories.includes(row.category) && row.key && row.value) {
          const decrypted = decrypt(row.value)
          if (decrypted !== null) {
            memory[row.category][row.key] = decrypted
            count++
          }
        }
      }

      this.#writeMemory(memory)
      console.log(`[memory] Supabase → локально: ${count} фактов`)
    } catch (err) {
      console.error('[memory] Ошибка синхронизации из Supabase (используется локальный файл):', err?.message)
    }
  }

  // ── Приватные методы ────────────────────────────────────────────────────────

  // Функция создаёт файл памяти при первом запуске (незашифрованная заглушка).
  #ensureMemoryFile() {
    if (!fs.existsSync(this.filePath)) {
      const initial = this.categories.reduce((acc, cat) => {
        acc[cat] = {}
        return acc
      }, {})
      // Первичный файл пишем как есть; при первом addFact он перезапишется зашифрованным.
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf-8')
    }
  }

  // Функция читает и расшифровывает память из файла.
  // Формат файла: { "_enc": "<encrypted>" } если шифрование включено,
  // иначе обычный JSON { "личное": {...}, ... } (обратная совместимость).
  #readMemory() {
    this.#ensureMemoryFile()
    const raw = fs.readFileSync(this.filePath, 'utf-8')
    const outer = JSON.parse(raw)

    let parsed
    if (outer._enc) {
      // Зашифрованный формат.
      const decrypted = decrypt(outer._enc)
      if (decrypted === null) {
        console.error('[memory] Не удалось расшифровать memory.json — возвращаем пустую память')
        return this.categories.reduce((acc, cat) => { acc[cat] = {}; return acc }, {})
      }
      parsed = JSON.parse(decrypted)
    } else {
      // Незашифрованный (миграция со старого формата или шифрование отключено).
      parsed = outer
    }

    return this.categories.reduce((acc, cat) => {
      acc[cat] = parsed?.[cat] && typeof parsed[cat] === 'object' ? parsed[cat] : {}
      return acc
    }, {})
  }

  // Функция шифрует и записывает память в файл.
  #writeMemory(memory) {
    const key = getEncryptionKey()
    const content = key
      ? JSON.stringify({ _enc: encrypt(JSON.stringify(memory)) })
      : JSON.stringify(memory, null, 2)
    fs.writeFileSync(this.filePath, content, 'utf-8')
  }

  // Функция делает upsert зашифрованного факта в Supabase.
  async #upsertToSupabase(category, key, value) {
    if (!this.supabase) return
    try {
      const { error } = await this.supabase
        .from('facts')
        .upsert(
          { category, key, value: encrypt(value), tags: [category] },
          { onConflict: 'category,key' },
        )
      if (error) throw error
    } catch (err) {
      console.error('[memory] Ошибка upsert в Supabase:', err?.message)
    }
  }

  // Функция удаляет факт из Supabase.
  async #deleteFromSupabase(category, key) {
    if (!this.supabase) return
    try {
      const { error } = await this.supabase
        .from('facts')
        .delete()
        .match({ category, key })
      if (error) throw error
    } catch (err) {
      console.error('[memory] Ошибка удаления из Supabase:', err?.message)
    }
  }
}

module.exports = { MemoryManager }
