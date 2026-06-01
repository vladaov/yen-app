import { useCallback, useRef, useState } from 'react'

// URL серверного эндпоинта синтеза речи.
const TTS_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/tts`

// Хук воспроизводит ответ Йен через серверный TTS (ElevenLabs).
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef(null)
  const objectUrlRef = useRef(null)

  // Функция останавливает воспроизведение и освобождает blob-URL.
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setIsPlaying(false)
  }, [])

  // Функция запрашивает аудио по тексту и воспроизводит его в браузере.
  // options.beforePlay — вызывается синхронно сразу перед audio.play() (после загрузки blob),
  // чтобы текст сообщения и звук появлялись в один момент.
  const playAudio = useCallback(
    async (text, options = {}) => {
      const trimmed = String(text ?? '').trim()
      if (!trimmed) {
        return
      }

      const { beforePlay } = options

      stopAudio()

      try {
        const response = await fetch(TTS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: trimmed }),
        })

        if (!response.ok) {
          let message = 'Не удалось получить аудио'
          try {
            const data = await response.json()
            if (data?.error) {
              message = String(data.error)
            }
          } catch {
            // оставляем общее сообщение
          }
          throw new Error(message)
        }

        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl

        const audio = new Audio(objectUrl)
        audioRef.current = audio

        audio.addEventListener('ended', () => {
          setIsPlaying(false)
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = null
          }
          audioRef.current = null
        })

        audio.addEventListener('error', () => {
          setIsPlaying(false)
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = null
          }
          audioRef.current = null
        })

        if (typeof beforePlay === 'function') {
          beforePlay()
        }
        setIsPlaying(true)
        await audio.play()
      } catch {
        setIsPlaying(false)
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current)
          objectUrlRef.current = null
        }
        audioRef.current = null
        throw new Error('playAudio failed')
      }
    },
    [stopAudio],
  )

  return {
    isPlaying,
    playAudio,
    stopAudio,
  }
}
