const fs = require('fs')
const path = require('path')

// Файл реализует серверный менеджер памяти с хранением в JSON-файле.
class MemoryManager {
  // Конструктор задаёт путь к файлу памяти и инициализирует структуру категорий.
  constructor(filePath = path.join(__dirname, 'memory.json')) {
    this.filePath = filePath
    this.categories = ['личное', 'работа', 'здоровье', 'цели', 'предпочтения', 'люди', 'проекты']
    this.#ensureMemoryFile()
  }

  // Функция добавляет или обновляет факт по ключу в категории.
  addFact(category, key, value) {
    if (!this.categories.includes(category) || !key || !value) {
      return
    }

    const memory = this.#readMemory()
    memory[category][key] = value
    this.#writeMemory(memory)
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
    if (!normalizedQuery) {
      return []
    }

    const memory = this.#readMemory()
    const results = []

    Object.entries(memory).forEach(([category, facts]) => {
      Object.entries(facts).forEach(([key, value]) => {
        const keyText = String(key).toLowerCase()
        const valueText = String(value).toLowerCase()
        if (keyText.includes(normalizedQuery) || valueText.includes(normalizedQuery)) {
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
      .map((word) => word.trim())
      .filter((word) => word.length > 2)

    if (words.length === 0) {
      return []
    }

    const memory = this.#readMemory()
    const found = []

    Object.entries(memory).forEach(([category, facts]) => {
      Object.entries(facts).forEach(([key, value]) => {
        const haystack = `${key} ${value}`.toLowerCase()
        const isMatch = words.some((word) => haystack.includes(word))
        if (isMatch) {
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

  // Функция удаляет факт по ключу из заданной категории.
  deleteFact(category, key) {
    if (!this.categories.includes(category) || !key) {
      return
    }

    const memory = this.#readMemory()
    delete memory[category][key]
    this.#writeMemory(memory)
  }

  // Функция создаёт файл памяти при первом запуске.
  #ensureMemoryFile() {
    if (!fs.existsSync(this.filePath)) {
      const initial = this.categories.reduce((acc, category) => {
        acc[category] = {}
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

    return this.categories.reduce((acc, category) => {
      acc[category] = parsed?.[category] && typeof parsed[category] === 'object' ? parsed[category] : {}
      return acc
    }, {})
  }

  // Функция записывает память в JSON-файл.
  #writeMemory(memory) {
    fs.writeFileSync(this.filePath, JSON.stringify(memory, null, 2), 'utf-8')
  }
}

module.exports = { MemoryManager }
