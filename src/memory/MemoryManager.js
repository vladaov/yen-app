// Файл содержит класс менеджера памяти Йен с хранением данных в localStorage.
export class MemoryManager {
  // Конструктор инициализирует ключ хранилища и базовые категории памяти.
  constructor(storageKey = 'yen-memory') {
    this.storageKey = storageKey
    this.defaultCategories = [
      'личное',
      'работа',
      'здоровье',
      'цели',
      'предпочтения',
      'люди',
      'проекты',
    ]
    this.memory = this.#loadMemory()
  }

  // Функция добавляет или обновляет факт в указанной категории.
  addFact(category, key, value) {
    if (!category || !key) {
      return
    }

    if (!this.memory[category]) {
      this.memory[category] = {}
    }

    this.memory[category][key] = value
    this.#saveMemory()
  }

  // Функция возвращает все факты указанной категории.
  getFacts(category) {
    return { ...(this.memory[category] ?? {}) }
  }

  // Функция ищет совпадения по ключевому слову в категориях, ключах и значениях.
  search(query) {
    const normalizedQuery = String(query ?? '').trim().toLowerCase()
    if (!normalizedQuery) {
      return []
    }

    const results = []
    Object.entries(this.memory).forEach(([category, facts]) => {
      Object.entries(facts).forEach(([factKey, factValue]) => {
        const searchableText = `${category} ${factKey} ${factValue}`.toLowerCase()
        if (searchableText.includes(normalizedQuery)) {
          results.push({ category, key: factKey, value: factValue })
        }
      })
    })

    return results
  }

  // Функция возвращает список всех категорий памяти.
  getAllCategories() {
    return Object.keys(this.memory)
  }

  // Функция экспортирует память в JSON-строку для резервного копирования.
  exportMemory() {
    return JSON.stringify(this.memory)
  }

  // Функция импортирует память из JSON и сохраняет её в localStorage.
  importMemory(json) {
    try {
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.memory = { ...this.#createDefaultMemory(), ...parsed }
        this.#saveMemory()
      }
    } catch {
      // Функция игнорирует некорректный JSON, чтобы не ломать приложение.
    }
  }

  // Функция формирует память с пустыми объектами для всех базовых категорий.
  #createDefaultMemory() {
    return this.defaultCategories.reduce((acc, category) => {
      acc[category] = {}
      return acc
    }, {})
  }

  // Функция загружает память из localStorage или создаёт структуру по умолчанию.
  #loadMemory() {
    try {
      const raw = localStorage.getItem(this.storageKey)
      if (!raw) {
        return this.#createDefaultMemory()
      }
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...this.#createDefaultMemory(), ...parsed }
      }
      return this.#createDefaultMemory()
    } catch {
      return this.#createDefaultMemory()
    }
  }

  // Функция сохраняет текущее состояние памяти в localStorage.
  #saveMemory() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.memory))
  }
}
