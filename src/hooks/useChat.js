import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAudioPlayer } from './useAudioPlayer'

// Ключ localStorage для истории чата с Йен.
const CHAT_HISTORY_KEY = 'yen-chat-history'

// Возвращает Authorization-заголовок с токеном текущей сессии или пустой объект.
async function getAuthHeaders() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` }
    }
  } catch { /* игнорируем */ }
  return {}
}
// Максимум сообщений в хранилище.
const MAX_STORED_MESSAGES = 50
// Ключ и событие для синхронизации включения голоса между компонентами без пропсов из App.
const VOICE_STORAGE_KEY = 'yen-voice-enabled'
const VOICE_CHANGE_EVENT = 'yen-voice-enabled-change'

// Файл инкапсулирует логику чата: сообщения, восстановление истории, память сервера и запросы к API.

// Функция читает флаг «голос включён» из localStorage (по умолчанию true).
function readVoiceEnabledFromStorage() {
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

// Функция читает и валидирует историю из localStorage (последние MAX_STORED_MESSAGES).
function loadChatHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          (item.role === 'user' || item.role === 'bot') &&
          typeof item.text === 'string',
      )
      .slice(-MAX_STORED_MESSAGES)
  } catch {
    return []
  }
}

// Функция сохраняет историю в localStorage (не больше MAX_STORED_MESSAGES).
function saveChatHistoryToStorage(messages) {
  try {
    const toStore = messages.slice(-MAX_STORED_MESSAGES)
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(toStore))
  } catch {
    // Игнорируем ошибки квоты/доступа к storage.
  }
}

// Функция проверяет, есть ли хотя бы один сохранённый факт в структуре памяти сервера.
function hasAnyFacts(facts) {
  if (!facts || typeof facts !== 'object') {
    return false
  }
  return Object.values(facts).some(
    (category) => category && typeof category === 'object' && Object.keys(category).length > 0,
  )
}

// Функция извлекает имя пользователя из категории «личное», если оно было запомнено.
function extractUserName(facts) {
  const personal = facts?.личное
  if (!personal || typeof personal !== 'object') {
    return ''
  }
  const direct =
    personal.имя ??
    personal.Имя ??
    personal.name ??
    personal.Name
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim()
  }
  return ''
}

// Функция строит текст приветствия бота по данным памяти с сервера.
function buildGreetingFromMemory(facts) {
  if (!hasAnyFacts(facts)) {
    return 'Привет! Я Йен. Расскажи о себе.'
  }
  const name = extractUserName(facts)
  if (name) {
    return `С возвращением, ${name} 💜`
  }
  return 'С возвращением 💜'
}

export function useChat() {
  const { isPlaying, playAudio, stopAudio } = useAudioPlayer()

  // Состояние хранит полный список сообщений для отрисовки чата (восстанавливается из localStorage).
  const [messages, setMessages] = useState(() => loadChatHistoryFromStorage())
  // Голос Йен включён по умолчанию; можно отключить из интерфейса.
  const [voiceEnabled, setVoiceEnabledState] = useState(() => readVoiceEnabledFromStorage())
  // Пока ждём ответ модели и (при голосе) синтез — имитация «человек набирает», а не пустой экран.
  const [isYenTyping, setIsYenTyping] = useState(false)
  // Эмоциональный тон последнего ответа Йен.
  const [mood, setMood] = useState('neutral')

  const isMountedRef = useRef(true)
  const moodTimerRef = useRef(null)

  // Функция помечает размонтирование компонента для безопасного обновления состояния.
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (moodTimerRef.current) clearTimeout(moodTimerRef.current)
    }
  }, [])

  // Функция синхронизирует флаг голоса с другими частями UI (вкладки, MessageInput без пропсов).
  useEffect(() => {
    const syncVoice = () => {
      setVoiceEnabledState(readVoiceEnabledFromStorage())
    }
    window.addEventListener('storage', syncVoice)
    window.addEventListener(VOICE_CHANGE_EVENT, syncVoice)
    return () => {
      window.removeEventListener('storage', syncVoice)
      window.removeEventListener(VOICE_CHANGE_EVENT, syncVoice)
    }
  }, [])

  // Функция при первой загрузке без сохранённой истории запрашивает память сервера и задаёт приветствие.
  useEffect(() => {
    const saved = loadChatHistoryFromStorage()
    if (saved.length > 0) {
      return undefined
    }

    let cancelled = false

    async function fetchInitialGreeting() {
      try {
        const authHeaders = await getAuthHeaders()
        const response = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/memory`, { headers: authHeaders })
        if (!response.ok || cancelled || !isMountedRef.current) {
          throw new Error('memory fetch failed')
        }
        const data = await response.json()
        const facts = data.facts ?? {}
        const text = buildGreetingFromMemory(facts)
        if (!cancelled && isMountedRef.current) {
          setMessages([
            {
              id: crypto.randomUUID(),
              role: 'bot',
              text,
            },
          ])
        }
      } catch {
        if (!cancelled && isMountedRef.current) {
          setMessages([
            {
              id: crypto.randomUUID(),
              role: 'bot',
              text: 'Привет! Я Йен. Расскажи о себе.',
            },
          ])
        }
      }
    }

    fetchInitialGreeting()
    return () => {
      cancelled = true
    }
  }, [])

  // Функция сбрасывает эмоцию в neutral через 4 секунды после того, как Йен перестала
  // говорить и печатать — таймер стартует только когда аудио реально закончилось.
  useEffect(() => {
    if (isPlaying || isYenTyping || mood === 'neutral') {
      return undefined
    }
    if (moodTimerRef.current) clearTimeout(moodTimerRef.current)
    moodTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) setMood('neutral')
    }, 4000)
    return () => {
      if (moodTimerRef.current) {
        clearTimeout(moodTimerRef.current)
        moodTimerRef.current = null
      }
    }
  }, [isPlaying, isYenTyping, mood])

  // Функция синхронизирует историю с localStorage (не более MAX_STORED_MESSAGES записей).
  useEffect(() => {
    saveChatHistoryToStorage(messages)
  }, [messages])

  // Функция обновляет настройку голоса и сохраняет её в localStorage.
  const setVoiceEnabled = useCallback(
    (value) => {
      setVoiceEnabledState((prev) => {
        const nextBool = Boolean(typeof value === 'function' ? value(prev) : value)
        if (!nextBool) {
          stopAudio()
        }
        try {
          localStorage.setItem(VOICE_STORAGE_KEY, nextBool ? 'true' : 'false')
        } catch {
          // игнорируем
        }
        window.dispatchEvent(new Event(VOICE_CHANGE_EVENT))
        return nextBool
      })
    },
    [stopAudio],
  )

  // Функция отправляет сообщение пользователя и запрашивает ответ у backend-сервера.
  const sendMessage = useCallback(
    async (rawText) => {
      const trimmedText = rawText.trim()
      if (!trimmedText) {
        return
      }

      stopAudio()

      // Сбрасываем таймер сброса эмоции — новое сообщение начинает новый цикл.
      if (moodTimerRef.current) {
        clearTimeout(moodTimerRef.current)
        moodTimerRef.current = null
      }

      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text: trimmedText,
      }

      setMessages((prev) => [...prev, userMessage])
      setIsYenTyping(true)

      const historyForApi = messages
        .slice(-20)
        .map((message) => ({
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.text,
        }))

      try {
        const authHeaders = await getAuthHeaders()
        const response = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            message: trimmedText,
            history: historyForApi,
          }),
        })

        if (!response.ok) {
          throw new Error('Сервер вернул ошибку')
        }

        const data = await response.json()
        const replyText = typeof data.reply === 'string' ? data.reply : ''
        const responseMood = typeof data.mood === 'string' ? data.mood : 'neutral'
        setMood(responseMood)

        if (!replyText.trim()) {
          throw new Error('Пустой ответ от сервера')
        }

        const botMessage = {
          id: crypto.randomUUID(),
          role: 'bot',
          text: replyText,
        }

        const shouldPlayVoice = isMountedRef.current && readVoiceEnabledFromStorage()
        if (shouldPlayVoice) {
          // Сначала ждём аудио от TTS, затем в beforePlay добавляем сообщение и сразу play() —
          // текст и голос совпадают по времени (раньше текст появлялся до готовности ElevenLabs).
          let messageShownWithVoice = false
          try {
            await playAudio(replyText, {
              beforePlay: () => {
                if (isMountedRef.current) {
                  setMessages((prev) => [...prev, botMessage])
                  messageShownWithVoice = true
                }
              },
            })
          } catch {
            if (isMountedRef.current && !messageShownWithVoice) {
              setMessages((prev) => [...prev, botMessage])
            }
          }
        } else if (isMountedRef.current) {
          setMessages((prev) => [...prev, botMessage])
        }
      } catch {
        if (isMountedRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'bot',
              text: 'Йен недоступна. Проверь сервер.',
            },
          ])
        }
      } finally {
        if (isMountedRef.current) {
          setIsYenTyping(false)
        }
      }
    },
    [messages, playAudio, stopAudio],
  )

  return {
    messages,
    isSpeaking: isPlaying,
    isYenTyping,
    mood,
    sendMessage,
    voiceEnabled,
    setVoiceEnabled,
  }
}
