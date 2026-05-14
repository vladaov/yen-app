import { useEffect, useRef, useState } from 'react'
import './YenFace.css'

// Состояния лица: что делает Йен прямо сейчас.
const MOODS = ['idle', 'listening', 'thinking', 'speaking']
// Эмоции: что чувствует Йен (управляют глазами, бровями и ртом в idle).
const EMOTIONS = ['neutral', 'happy', 'sad', 'surprised', 'tender', 'laughing', 'angry', 'shy', 'bored']

// Компонент «лицо» Йен: два независимых слоя — состояние (рот) и эмоция (глаза/брови/рот в idle).
// mood — состояние: idle/listening/thinking/speaking
// emotion — эмоция: neutral/happy/sad/surprised/tender/laughing/angry/shy/bored
function YenFace({ mood, emotion = 'neutral' }) {
  const safeMood = MOODS.includes(mood) ? mood : 'idle'
  const safeEmotion = EMOTIONS.includes(emotion) ? emotion : 'neutral'
  const [blink, setBlink] = useState(false)
  const blinkTimeoutRef = useRef(null)
  // Отслеживаем предыдущий safeMood: на первом рендере после смены настроения
  // подавляем blink-класс, чтобы React не успел нарисовать кадр с yen-face--blink
  // поверх нового эмоционального состояния (иначе height: 4-8px из blink-правила
  // побеждает в каскаде и глаза схлопываются в линии).
  const prevMoodRef = useRef(safeMood)
  const moodJustChanged = prevMoodRef.current !== safeMood
  prevMoodRef.current = safeMood

  // Функция редкого моргания. При смене safeMood сбрасывает blink и отменяет
  // висящий setTimeout, чтобы класс yen-face--blink не оставался на лице.
  useEffect(() => {
    if (blinkTimeoutRef.current) {
      clearTimeout(blinkTimeoutRef.current)
      blinkTimeoutRef.current = null
    }
    setBlink(false)

    // Моргание только в idle.
    if (safeMood !== 'idle') {
      return undefined
    }

    const id = window.setInterval(() => {
      setBlink(true)
      blinkTimeoutRef.current = window.setTimeout(() => {
        setBlink(false)
        blinkTimeoutRef.current = null
      }, 150)
    }, 3500)

    return () => {
      window.clearInterval(id)
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current)
        blinkTimeoutRef.current = null
      }
      setBlink(false)
    }
  }, [safeMood])

  // Emotion класс применяется всегда — управляет глазами/бровями и ртом в idle.
  const className = `yen-face yen-face--${safeMood} yen-face--emotion-${safeEmotion}${blink && !moodJustChanged ? ' yen-face--blink' : ''}`

  return (
    <div
      className={className}
      aria-hidden="true"
    >
      <div className="yen-face__eyes">
        <div className="yen-face__eye">
          <div className="yen-face__hl" />
          <div className="yen-face__brow" />
          <div className="yen-face__tear yen-face__tear--l" />
        </div>
        <div className="yen-face__eye">
          <div className="yen-face__hl" />
          <div className="yen-face__brow" />
          <div className="yen-face__tear yen-face__tear--r" />
        </div>
      </div>
      <div className="yen-face__mouth" />
    </div>
  )
}

export default YenFace
