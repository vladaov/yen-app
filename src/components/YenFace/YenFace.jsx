import { useEffect, useRef, useState } from 'react'
import './YenFace.css'

// Состояния лица, синхронизированные с логикой чата.
const MOODS = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sad', 'surprised']
// Эмоции, которые можно наложить поверх speaking-анимации.
const EMOTIONS = ['happy', 'sad', 'surprised', 'neutral']

// Компонент «лицо» Йен: глаза, рот, эмоции по макету.
// mood — состояние (idle/listening/thinking/speaking/happy/sad/surprised)
// emotion — эмоция из последнего ответа (happy/sad/surprised/neutral), применяется к бровям/глазам во время speaking
function YenFace({ mood, emotion = 'neutral' }) {
  const safeMood = MOODS.includes(mood) ? mood : 'idle'
  const safeEmotion = EMOTIONS.includes(emotion) ? emotion : 'neutral'
  const [blink, setBlink] = useState(false)
  const blinkTimeoutRef = useRef(null)

  // Функция редкого моргания. При смене safeMood сбрасывает blink и отменяет
  // висящий setTimeout, чтобы класс yen-face--blink не оставался на лице.
  useEffect(() => {
    if (blinkTimeoutRef.current) {
      clearTimeout(blinkTimeoutRef.current)
      blinkTimeoutRef.current = null
    }
    setBlink(false)

    if (safeMood === 'listening' || safeMood === 'thinking' || safeMood === 'speaking') {
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

  // Модификатор эмоции накладывается только во время speaking (рот занят анимацией).
  const emotionClass =
    safeMood === 'speaking' && safeEmotion !== 'neutral'
      ? `yen-face--emotion-${safeEmotion}`
      : ''

  return (
    <div
      className={`yen-face yen-face--${safeMood} ${emotionClass} ${blink ? 'yen-face--blink' : ''}`.trim()}
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
