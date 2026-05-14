const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Файл реализует серверный менеджер памяти.
// Локальный JSON — первичное хранилище (быстрое, синхронное).
// Supabase — облачный бэкап (асинхронный, fire-and-forget).
// AES-256-GCM шифрование с per-install salt (P3) и версионированием (P2).

// ── Криптография ──────────────────────────────────────────────────────────────

// Salt для старого формата (до per-install salt). Нужен для чтения старых данных.
const LEGACY_SALT = 'yen-memory-aes256gcm-v1'
// Salt для шифрования отдельных значений в Supabase (изолирован от файлового salt).
const SUPABASE_SALT = 'yen-supabase-values-v1'
// Версия формата. Позволяет корректно читать старые данные при миграции.
const SCHEMA_VERSION = 1

// Кэш производных ключей: salt → Buffer(32). scrypt вызывается один раз на salt.
const _keyCache = new Map()

// Функция производит 32-байтовый ключ из ENCRYPTION_KEY + salt через scrypt.
// Возвращает null если ключ не задан или короче 32 символов.
function deriveKey(salt) {
  if (_keyCache.has(salt)) return _keyCache.get(salt)

  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    _keyCache.set(salt, null)
    return null
  }
  if (raw.length < 32) {
    console.warn('[memory] ENCRYPTION_KEY < 32 символов — шифрование отключено')
    _keyCache.set(salt, null)
    return null
  }

  const key = crypto.scryptSync(raw, salt, 32)
  if (_keyCache.size === 0) {
    console.log('[memory] Шифрование AES-256-GCM активно')
  }
  _keyCache.set(salt, key)
  return key
}

// Функция шифрует строку с заданным salt (AES-256-GCM, random IV).
// Формат: <iv:24hex>:<tag:32hex>:<ciphertext:hex>
// Если ключ не задан — возвращает plaintext.
function encryptWith(plaintext, salt) {
  const key = deriveKey(salt)
  if (!key) return plaintext

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

// Функция расшифровывает строку с заданным salt.
// Возвращает null при ошибке (неверный ключ, повреждены данные, GCM tag не совпал).
// Возвращает текст как есть если он не в зашифрованном формате (миграция).
function decryptWith(text, salt) {
  const key = deriveKey(salt)
  if (!key || typeof text !== 'string') return text

  const parts = text.split(':')
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) {
    return text // не зашифровано — возвращаем как есть
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'))
    decipher.setAuthTag(Buffer.from(parts[1], 'hex'))
    const dec = Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()])
    return dec.toString('utf8')
  } catch {
    console.error('[memory] Ошибка расшифровки (неверный ключ или повреждены данные) — факт отброшен')
    return null
  }
}

// ── MemoryManager ─────────────────────────────────────────────────────────────

class MemoryManager {
  // supabase — клиент @supabase/supabase-js или null если не настроен.
  constructor(filePath = path.join(__dirname, 'memory.json'), supabase = null) {
    this.filePath = filePath
    // P3: per-install salt хранится в отдельном файле рядом с memory.json.
    this.saltFilePath = filePath + '.salt'
    this.supabase = supabase
    this.categories = ['личное', 'работа', 'здоровье', 'цели', 'предпочтения', 'люди', 'проекты']
    // _installSalt: null означает legacy-режим (старые данные, соль читается из LEGACY_SALT).
    this._installSalt = this.#loadOrCreateSalt()
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
          const decrypted = decryptWith(row.value, SUPABASE_SALT)
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

  // P3: Функция загружает per-install salt из файла или создаёт новый.
  // Возвращает null если обнаружены старые данные без salt (legacy-режим).
  // В legacy-режиме данные будут мигрированы на новый salt при следующей записи.
  #loadOrCreateSalt() {
    if (fs.existsSync(this.saltFilePath)) {
      const salt = fs.readFileSync(this.saltFilePath, 'utf-8').trim()
      return salt || null
    }

    // Проверяем: есть ли существующие зашифрованные данные в старом формате (без _v)?
    const hasLegacyEncrypted = fs.existsSync(this.filePath) && (() => {
      try {
        const outer = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        return Boolean(outer._enc && !outer._v)
      } catch {
        return false
      }
    })()

    if (hasLegacyEncrypted) {
      // Legacy-режим: данные будут мигрированы при следующей записи.
      return null
    }

    // Новая установка: генерируем и сохраняем fresh salt.
    const salt = crypto.randomBytes(16).toString('hex')
    fs.writeFileSync(this.saltFilePath, salt, 'utf-8')
    console.log('[memory] Per-install salt создан')
    return salt
  }

  // P2: Функция создаёт файл памяти при первом запуске.
  // В отличие от старой версии — сразу пишет зашифрованную структуру если ключ задан.
  #ensureMemoryFile() {
    if (fs.existsSync(this.filePath)) return

    const initial = this.categories.reduce((acc, cat) => {
      acc[cat] = {}
      return acc
    }, {})

    const salt = this._installSalt || LEGACY_SALT
    const key = deriveKey(salt)
    const content = key
      ? JSON.stringify({ _enc: encryptWith(JSON.stringify(initial), salt), _v: SCHEMA_VERSION })
      : JSON.stringify(initial, null, 2)

    fs.writeFileSync(this.filePath, content, 'utf-8')
  }

  // Функция читает и расшифровывает память из файла.
  // Формат v1: { "_enc": "...", "_v": 1 } — использует install salt.
  // Формат legacy: { "_enc": "..." } — использует LEGACY_SALT, данные мигрируют при записи.
  // Незашифрованный: { "личное": {...}, ... } — обратная совместимость.
  #readMemory() {
    this.#ensureMemoryFile()
    const raw = fs.readFileSync(this.filePath, 'utf-8')
    const outer = JSON.parse(raw)

    let parsed
    if (outer._enc) {
      // P2: версия определяет какой salt использовать.
      const salt = outer._v ? (this._installSalt || LEGACY_SALT) : LEGACY_SALT
      const decrypted = decryptWith(outer._enc, salt)

      if (decrypted === null) {
        console.error('[memory] Не удалось расшифровать memory.json — возвращаем пустую память')
        return this.categories.reduce((acc, cat) => { acc[cat] = {}; return acc }, {})
      }

      parsed = JSON.parse(decrypted)
    } else {
      parsed = outer
    }

    return this.categories.reduce((acc, cat) => {
      acc[cat] = parsed?.[cat] && typeof parsed[cat] === 'object' ? parsed[cat] : {}
      return acc
    }, {})
  }

  // Функция шифрует и записывает память в файл.
  // P2: всегда пишет с _v для версионирования.
  // P3: если был legacy-режим — мигрирует на новый per-install salt.
  #writeMemory(memory) {
    // Миграция с legacy salt на per-install salt при первой записи.
    if (!this._installSalt && deriveKey(LEGACY_SALT)) {
      this._installSalt = crypto.randomBytes(16).toString('hex')
      fs.writeFileSync(this.saltFilePath, this._installSalt, 'utf-8')
      console.log('[memory] Мигрировано на per-install salt')
    }

    const salt = this._installSalt || LEGACY_SALT
    const key = deriveKey(salt)
    const content = key
      ? JSON.stringify({ _enc: encryptWith(JSON.stringify(memory), salt), _v: SCHEMA_VERSION })
      : JSON.stringify(memory, null, 2)

    fs.writeFileSync(this.filePath, content, 'utf-8')
  }

  // Функция делает upsert зашифрованного факта в Supabase.
  // Значения шифруются с изолированным SUPABASE_SALT (не зависит от install salt).
  async #upsertToSupabase(category, key, value) {
    if (!this.supabase) return
    try {
      const { error } = await this.supabase
        .from('facts')
        .upsert(
          { category, key, value: encryptWith(value, SUPABASE_SALT), tags: [category] },
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
