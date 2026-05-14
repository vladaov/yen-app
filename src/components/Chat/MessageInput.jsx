import { useEffect, useRef, useState } from 'react'
import './MessageInput.css'

const VOICE_WAVE_BARS = 7
const UPLOAD_URL = 'http://localhost:3001/api/upload'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_FILE_SIZE = 10 * 1024 * 1024

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="1" width="6" height="14" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function IconPen() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function IconPaperclip() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

// Поле ввода: голос (живой текст + автоотправка после паузы/стопа) и текст по макету.
function MessageInput({
  mode,
  onModeVoice,
  onModeText,
  showChat,
  onToggleShowChat,
  onSend,
  isListening,
  transcript,
  onStartListening,
  onStopListening,
  resetTranscript,
  speechError,
}) {
  const [value, setValue] = useState('')
  const [waveVisible, setWaveVisible] = useState(false)
  const [attachedFile, setAttachedFile] = useState(null) // { name, fileId }
  const [fileUploading, setFileUploading] = useState(false)
  const [fileError, setFileError] = useState('')
  const fileInputRef = useRef(null)
  const transcriptRef = useRef('')
  const hadListeningSessionRef = useRef(false)
  const onSendRef = useRef(onSend)
  const resetTranscriptRef = useRef(resetTranscript)

  transcriptRef.current = transcript
  onSendRef.current = onSend
  resetTranscriptRef.current = resetTranscript

  // Пока слушаем — подставляем голос в поле текстового режима.
  useEffect(() => {
    if (isListening) {
      setValue(transcript)
    }
  }, [isListening, transcript])

  // После остановки записи: отправка и очистка поля. Зависимость только от isListening.
  // Важно: нельзя в конце эффекта писать в ref «текущий isListening» — при Strict Mode cleanup
  // сбросит таймер, второй проход увидит ref === false и не запланирует отправку, а поле
  // останется с текстом из live-транскрипта.
  useEffect(() => {
    if (isListening) {
      hadListeningSessionRef.current = true
      return undefined
    }

    if (!hadListeningSessionRef.current) {
      return undefined
    }

    hadListeningSessionRef.current = false

    const timerId = window.setTimeout(() => {
      const text = transcriptRef.current.trim()
      setValue('')
      transcriptRef.current = ''
      if (text) {
        resetTranscriptRef.current()
        onSendRef.current(text)
      } else {
        resetTranscriptRef.current()
      }
    }, 40)

    return () => {
      window.clearTimeout(timerId)
      // Повторный проход Strict Mode снова увидит переход «был слух → стоп».
      hadListeningSessionRef.current = true
    }
  }, [isListening])

  useEffect(() => {
    if (isListening) {
      setWaveVisible(true)
      return undefined
    }
    const timer = window.setTimeout(() => setWaveVisible(false), 380)
    return () => window.clearTimeout(timer)
  }, [isListening])

  const handleFileSelect = async (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return

    setFileError('')
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Недопустимый тип. Разрешены: jpg, png, webp, pdf, txt, docx')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('Файл больше 10 МБ')
      return
    }

    setFileUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(UPLOAD_URL, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Ошибка загрузки')
      setAttachedFile({ name: data.name, fileId: data.fileId })
    } catch (err) {
      setFileError(err.message)
    } finally {
      setFileUploading(false)
    }
  }

  const submitMessage = () => {
    const trimmedValue = value.trim()
    if (!trimmedValue && !attachedFile) return

    const text = attachedFile
      ? `${trimmedValue} [file:${attachedFile.fileId}]`.trim()
      : trimmedValue

    onSend(text)
    setValue('')
    setAttachedFile(null)
    setFileError('')
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitMessage()
    }
  }

  const handleMicrophoneClick = () => {
    if (isListening) {
      onStopListening()
      return
    }
    onStartListening()
  }

  const showVoicePreview = mode === 'voice' && (isListening || Boolean(transcript.trim()))

  return (
    <div className="yen-input-root">
      {speechError ? <p className="yen-input-error">{speechError}</p> : null}

      <div className={`yen-vi ${waveVisible && isListening ? 'yen-vi--vis' : ''}`} aria-hidden="true">
        {Array.from({ length: VOICE_WAVE_BARS }, (_, index) => (
          <span key={index} className="yen-vb" />
        ))}
      </div>

      {showVoicePreview ? (
        <div className="yen-voice-live" aria-live="polite">
          <p className="yen-voice-live__text">{transcript.trim() || '…'}</p>
        </div>
      ) : null}

      <div className={`yen-vm ${mode === 'voice' ? 'yen-vm--vis' : ''}`}>
        <button
          type="button"
          className="yen-btn-round yen-btn-sm"
          onClick={onToggleShowChat}
          aria-pressed={showChat}
          aria-label={showChat ? 'Скрыть чат' : 'Показать чат'}
        >
          <IconChat />
        </button>
        <button
          type="button"
          className={`yen-btn-round yen-mic-big ${isListening ? 'yen-mic-big--rec' : ''}`}
          onClick={handleMicrophoneClick}
          aria-label={isListening ? 'Остановить и отправить' : 'Голосовой ввод'}
        >
          <IconMic />
        </button>
        <button type="button" className="yen-btn-round yen-btn-sm" onClick={onModeText} aria-label="Писать текстом">
          <IconPen />
        </button>
      </div>

      <div className={`yen-tm ${mode === 'text' ? 'yen-tm--vis' : ''}`}>
        <div className="yen-tm-row">
          <button type="button" className="yen-btn-round yen-btn-close" onClick={onModeVoice} aria-label="Закрыть ввод">
            <IconClose />
          </button>
          <textarea
            placeholder="Напиши что-нибудь..."
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            type="button"
            className="yen-btn-round yen-btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileUploading}
            aria-label="Прикрепить файл"
          >
            <IconPaperclip />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button type="button" className="yen-btn-round yen-btn-send" onClick={submitMessage} aria-label="Отправить">
            <IconSend />
          </button>
          <button
            type="button"
            className="yen-btn-round yen-btn-mic-s"
            onClick={handleMicrophoneClick}
            aria-label="Микрофон"
          >
            <IconMic />
          </button>
        </div>
        {fileError && <p className="yen-input-error">{fileError}</p>}
        {(fileUploading || attachedFile) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px', fontSize: '0.78rem', opacity: 0.75 }}>
            {fileUploading
              ? <span>Загружаю файл...</span>
              : (
                <>
                  <span>📎 {attachedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => { setAttachedFile(null); setFileError('') }}
                    aria-label="Убрать файл"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 2px', fontSize: '1rem', lineHeight: 1 }}
                  >×</button>
                </>
              )}
          </div>
        )}
      </div>
    </div>
  )
}

export default MessageInput
