const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Файл реализует серверный менеджер памяти.
// Локальный JSON — резервное хранилище (быстрое, синхронное).
// Supabase — основное облачное хранилище per-user (таблица memory_facts).
// AES-256-GCM шифрование с per-install salt и версионированием.

// ── Криптография ──────────────────────────────────────────────────────────────

const LEGACY_SALT   = 'yen-memory-aes256gcm-v1'
const SUPABASE_SALT = 'yen-supabase-values-v1'
const SCHEMA_VERSION = 1

// Разделитель key|||value внутри поля fact в Supabase.
const FACT_SEP = '|||'

const _keyCache = new Map()

function deriveKey(salt) {
  if (_keyCache.has(salt)) return _keyCache.get(salt)
  const raw = process.env.ENCRYPTION_KEY
  if (!raw || raw.length < 32) {
    _keyCache.set(salt, null)
    return null
  }
  const key = crypto.scryptSync(raw, salt, 32)
  _keyCache.set(salt, key)
  return key
}

function encryptWith(plaintext, salt) {
  const key = deriveKey(salt)
  if (!key) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

function decryptWith(text, salt) {
  const key = deriveKey(salt)
  if (!key || typeof text !== 'string') return text
  const parts = text.split(':')
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return text
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'))
    decipher.setAuthTag(Buffer.from(parts[1], 'hex'))
    const dec = Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()])
    return dec.toString('utf8')
  } catch {
    console.error('[memory] Ошибка расшифровки — факт отброшен')
    return null
  }
}

// ── MemoryManager ─────────────────────────────────────────────────────────────

class MemoryManager {
  constructor(filePath = path.join(__dirname, 'memory.json'), supabase = null) {
    this.filePath = filePath
    this.saltFilePath = filePath + '.salt'
    this.supabase = supabase
    this.categories = ['личное', 'работа', 'здоровье', 'цели', 'предпочтения', 'люди', 'проекты']
    this._installSalt = this.#loadOrCreateSalt()
    this.#ensureMemoryFile()
  }

  // ── Локальные операции ───────────────────────────────────────────────────────

  addFact(category, key, value) {
    if (!this.categories.includes(category) || !key || !value) return
    const memory = this.#readMemory()
    memory[category][key] = value
    this.#writeMemory(memory)
  }

  getAllFacts() {
    return this.#readMemory()
  }

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

  deleteFact(category, key) {
    if (!this.categories.includes(category) || !key) return
    const memory = this.#readMemory()
    delete memory[category][key]
    this.#writeMemory(memory)
  }

  // ── Supabase: облачная память per-user ───────────────────────────────────────

  // Загружает все факты пользователя из memory_facts.
  // Возвращает объект формата { категория: { key: value } }.
  // userSupabase — клиент аутентифицированный токеном пользователя.
  async loadUserFacts(userSupabase, userId) {
    const empty = this.categories.reduce((acc, cat) => { acc[cat] = {}; return acc }, {})
    if (!userSupabase || !userId) return empty

    try {
      const { data, error } = await userSupabase
        .from('memory_facts')
        .select('category, fact')
        .eq('user_id', userId)

      if (error) throw error
      if (!data?.length) return empty

      const memory = { ...empty }
      for (const row of data) {
        if (!this.categories.includes(row.category)) continue
        const sepIdx = row.fact.indexOf(FACT_SEP)
        if (sepIdx === -1) continue
        const key = row.fact.slice(0, sepIdx)
        const rawValue = row.fact.slice(sepIdx + FACT_SEP.length)
        const value = decryptWith(rawValue, SUPABASE_SALT)
        if (value !== null && key) {
          memory[row.category][key] = value
        }
      }

      console.log(`[memory] Загружено из Supabase для ${userId}: ${data.length} фактов`)
      return memory
    } catch (err) {
      console.error('[memory] Ошибка загрузки из Supabase:', err?.message)
      return empty
    }
  }

  // Upsert факта в memory_facts для конкретного пользователя.
  // Сначала удаляет старую запись с тем же ключом, затем вставляет новую.
  async upsertUserFact(userSupabase, userId, category, key, value) {
    if (!userSupabase || !userId || !this.categories.includes(category) || !key || !value) return

    const encryptedValue = encryptWith(value, SUPABASE_SALT)
    const factStr = `${key}${FACT_SEP}${encryptedValue}`

    try {
      // Удаляем существующий факт с тем же ключом
      await userSupabase
        .from('memory_facts')
        .delete()
        .eq('user_id', userId)
        .eq('category', category)
        .like('fact', `${key}${FACT_SEP}%`)

      // Вставляем новый
      const { error } = await userSupabase
        .from('memory_facts')
        .insert({ user_id: userId, category, fact: factStr })

      if (error) throw error
    } catch (err) {
      console.error('[memory] Ошибка upsert факта:', err?.message)
    }
  }

  // Извлекает релевантные факты из объекта памяти по словам сообщения.
  getRelevantFromMemoryObject(memory, message) {
    const normalizedMessage = String(message ?? '').toLowerCase()
    const words = normalizedMessage
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => w.trim())
      .filter((w) => w.length > 2)

    const found = []
    Object.entries(memory).forEach(([category, facts]) => {
      Object.entries(facts).forEach(([key, value]) => {
        const haystack = `${key} ${value}`.toLowerCase()
        if (!words.length || words.some((w) => haystack.includes(w))) {
          found.push({ category, key, value })
        }
      })
    })
    return found
  }

  // ── Устаревший метод sync (без userId) для обратной совместимости ─────────────
  async syncFromSupabase() {
    if (!this.supabase) return
    try {
      const { data, error } = await this.supabase
        .from('memory_facts')
        .select('category, fact')
        .is('user_id', null)

      if (error) throw error
      if (!data?.length) return

      const memory = this.#readMemory()
      let count = 0

      for (const row of data) {
        if (!this.categories.includes(row.category)) continue
        const sepIdx = row.fact.indexOf(FACT_SEP)
        if (sepIdx === -1) continue
        const key = row.fact.slice(0, sepIdx)
        const rawValue = row.fact.slice(sepIdx + FACT_SEP.length)
        const value = decryptWith(rawValue, SUPABASE_SALT)
        if (value !== null && key) {
          memory[row.category][key] = value
          count++
        }
      }

      this.#writeMemory(memory)
      console.log(`[memory] Локальный sync: ${count} фактов`)
    } catch (err) {
      console.error('[memory] Ошибка syncFromSupabase (используется memory.json):', err?.message)
    }
  }

  // ── Приватные методы ─────────────────────────────────────────────────────────

  #loadOrCreateSalt() {
    if (fs.existsSync(this.saltFilePath)) {
      const salt = fs.readFileSync(this.saltFilePath, 'utf-8').trim()
      return salt || null
    }
    const hasLegacyEncrypted = fs.existsSync(this.filePath) && (() => {
      try {
        const outer = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        return Boolean(outer._enc && !outer._v)
      } catch { return false }
    })()
    if (hasLegacyEncrypted) return null
    const salt = crypto.randomBytes(16).toString('hex')
    fs.writeFileSync(this.saltFilePath, salt, 'utf-8')
    console.log('[memory] Per-install salt создан')
    return salt
  }

  #ensureMemoryFile() {
    if (fs.existsSync(this.filePath)) return
    const initial = this.categories.reduce((acc, cat) => { acc[cat] = {}; return acc }, {})
    const salt = this._installSalt || LEGACY_SALT
    const key = deriveKey(salt)
    const content = key
      ? JSON.stringify({ _enc: encryptWith(JSON.stringify(initial), salt), _v: SCHEMA_VERSION })
      : JSON.stringify(initial, null, 2)
    fs.writeFileSync(this.filePath, content, 'utf-8')
  }

  #readMemory() {
    this.#ensureMemoryFile()
    const raw = fs.readFileSync(this.filePath, 'utf-8')
    const outer = JSON.parse(raw)
    let parsed
    if (outer._enc) {
      const salt = outer._v ? (this._installSalt || LEGACY_SALT) : LEGACY_SALT
      const decrypted = decryptWith(outer._enc, salt)
      if (decrypted === null) {
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

  #writeMemory(memory) {
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
}

module.exports = { MemoryManager }
