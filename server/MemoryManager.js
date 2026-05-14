const fs = require('fs')
const path = require('path')

// Файл реализует серверный менеджер памяти.
// Локальный JSON — первичное хранилище (быстрое, синхронное).
// Supabase — облачный бэкап (асинхронный, fire-and-forget).
// Если Supabase недоступен или не настроен — работает только локально.

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

    // Асинхронная запись в Supabase (не блокирует ответ Йен).
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

  // Функция экспортирует всю память в JSON-строку.
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

  // Функция при старте сервера тянет все факты из Supabase и записывает в локальный файл.
  // Вызывать один раз после создания экземпляра.
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
          memory[row.category][row.key] = row.value
          count++
        }
      }

      this.#writeMemory(memory)
      console.log(`[memory] Supabase → локально: ${count} фактов`)
    } catch (err) {
      console.error('[memory] Ошибка синхронизации из Supabase (используется локальный файл):', err?.message)
    }
  }

  // ── Приватные методы ──────────────────────────────────────────────────────

  // Функция создаёт файл памяти при первом запуске.
  #ensureMemoryFile() {
    if (!fs.existsSync(this.filePath)) {
      const initial = this.categories.reduce((acc, cat) => {
        acc[cat] = {}
        return acc
      }, {})
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf-8')
    }
  }

  // Функция читает память из файла и возвращает нормализованную структуру.
  #readMemory() {
    this.#ensureMemoryFile()
    const raw = fs.readFileSync(this.filePath, 'utf-8')
    const parsed = JSON.parse(raw)

    return this.categories.reduce((acc, cat) => {
      acc[cat] = parsed?.[cat] && typeof parsed[cat] === 'object' ? parsed[cat] : {}
      return acc
    }, {})
  }

  // Функция записывает память в JSON-файл.
  #writeMemory(memory) {
    fs.writeFileSync(this.filePath, JSON.stringify(memory, null, 2), 'utf-8')
  }

  // Функция делает upsert факта в Supabase (обновляет если category+key уже есть).
  async #upsertToSupabase(category, key, value) {
    if (!this.supabase) return
    try {
      const { error } = await this.supabase
        .from('facts')
        .upsert(
          { category, key, value, tags: [category] },
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
