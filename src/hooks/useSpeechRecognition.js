import { useCallback, useEffect, useRef, useState } from 'react'

// Пауза без новых результатов распознавания (мс), после которой запись останавливается.
const SILENCE_MS = 1200

// Ошибки API, которые не показываем пользователю (штатное завершение или отмена).
const SILENT_SPEECH_ERRORS = new Set(['aborted', 'no-speech'])

// Файл реализует хук голосового ввода на основе Web Speech API.
export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const recognitionRef = useRef(null)
  const finalTextRef = useRef('')
  const silenceTimerRef = useRef(null)
  const intentionalStopRef = useRef(false)

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer()
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null
      intentionalStopRef.current = true
      try {
        recognitionRef.current?.stop()
      } catch {
        // Игнорируем повторный stop.
      }
    }, SILENCE_MS)
  }, [clearSilenceTimer])

  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  useEffect(() => {
    if (!isSupported) {
      setError('Ваш браузер не поддерживает распознавание речи.')
      return undefined
    }

    const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognitionApi()
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      armSilenceTimer()

      let interimText = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) {
          finalTextRef.current += `${result[0].transcript} `
        } else {
          interimText += result[0].transcript
        }
      }

      setTranscript(`${finalTextRef.current}${interimText}`.trim())
    }

    recognition.onend = () => {
      clearSilenceTimer()
      setIsListening(false)
      intentionalStopRef.current = false
    }

    recognition.onerror = (event) => {
      clearSilenceTimer()
      if (SILENT_SPEECH_ERRORS.has(event.error)) {
        setIsListening(false)
        intentionalStopRef.current = false
        return
      }
      if (event.error === 'not-allowed') {
        setError('Нет доступа к микрофону. Разрешите доступ в браузере.')
      } else {
        setError(`Ошибка распознавания речи: ${event.error}`)
      }
      setIsListening(false)
      intentionalStopRef.current = false
    }

    recognitionRef.current = recognition

    return () => {
      clearSilenceTimer()
      intentionalStopRef.current = true
      try {
        recognition.abort()
      } catch {
        try {
          recognition.stop()
        } catch {
          // игнорируем
        }
      }
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
      }
    }
  }, [isSupported, armSilenceTimer, clearSilenceTimer])

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      return
    }
    finalTextRef.current = ''
    setTranscript('')
    setError('')
    intentionalStopRef.current = false

    try {
      recognitionRef.current.start()
      setIsListening(true)
      armSilenceTimer()
    } catch (startError) {
      clearSilenceTimer()
      if (startError?.name === 'InvalidStateError') {
        intentionalStopRef.current = true
        try {
          recognitionRef.current.stop()
        } catch {
          // игнорируем
        }
        window.setTimeout(() => {
          try {
            if (!recognitionRef.current) {
              return
            }
            finalTextRef.current = ''
            setTranscript('')
            intentionalStopRef.current = false
            recognitionRef.current.start()
            setIsListening(true)
            armSilenceTimer()
          } catch {
            setIsListening(false)
            setError('Не удалось запустить распознавание. Попробуй ещё раз.')
          }
        }, 120)
        return
      }
      setIsListening(false)
    }
  }, [armSilenceTimer, clearSilenceTimer])

  const stopListening = useCallback(() => {
    clearSilenceTimer()
    intentionalStopRef.current = true
    try {
      recognitionRef.current?.stop()
    } catch {
      // игнорируем
    }
  }, [clearSilenceTimer])

  // Функция очищает накопленный текст после отправки сообщения.
  const resetTranscript = useCallback(() => {
    finalTextRef.current = ''
    setTranscript('')
  }, [])

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    error,
  }
}
