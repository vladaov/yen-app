import { useEffect, useRef, useState } from 'react'
import './MessageInput.css'

const UPLOAD_URL = '/api/upload'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_FILE_SIZE = 10 * 1024 * 1024

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

function IconPen() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

const VOICE_WAVE_BARS = 7

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
  const [attachedFile, setAttachedFile] = useState(null)
  const [fileUploading, setFileUploading] = useState(false)
  const [fileError, setFileError] = useState('')

  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const transcriptRef = useRef('')
  const hadListeningSessionRef = useRef(false)
  const onSendRef = useRef(onSend)
  const resetTranscriptRef = useRef(resetTranscript)

  transcriptRef.current = transcript
  onSendRef.current = onSend
  resetTranscriptRef.current = resetTranscript

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])

  // Autofocus when switching to text mode
  useEffect(() => {
    if (mode === 'text') {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [mode])

  // Fill textarea with voice transcript while listening
  useEffect(() => {
    if (isListening) setValue(transcript)
  }, [isListening, transcript])

  // After stop: send transcript, clear field
  useEffect(() => {
    if (isListening) {
      hadListeningSessionRef.current = true
      return undefined
    }
    if (!hadListeningSessionRef.current) return undefined
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
      hadListeningSessionRef.current = true
    }
  }, [isListening])

  // Wave visibility
  useEffect(() => {
    if (isListening) { setWaveVisible(true); return undefined }
    const t = window.setTimeout(() => setWaveVisible(false), 380)
    return () => window.clearTimeout(t)
  }, [isListening])

  const handleFileSelect = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setFileError('')
    if (!ALLOWED_TYPES.includes(file.type)) { setFileError('Недопустимый тип. Разрешены: jpg, png, webp, pdf, txt, docx'); return }
    if (file.size > MAX_FILE_SIZE) { setFileError('Файл больше 10 МБ'); return }
    setFileUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(UPLOAD_URL, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      setAttachedFile({ name: data.name, fileId: data.fileId })
    } catch (err) {
      setFileError(err.message)
    } finally {
      setFileUploading(false)
    }
  }

  const submitMessage = () => {
    const trimmed = value.trim()
    if (!trimmed && !attachedFile) return
    const text = attachedFile ? `${trimmed} [file:${attachedFile.fileId}]`.trim() : trimmed
    onSend(text)
    setValue('')
    setAttachedFile(null)
    setFileError('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitMessage() }
  }

  const handleMic = () => {
    if (isListening) { onStopListening() } else { onStartListening() }
  }

  const hasContent = value.trim() || attachedFile

  // ── VOICE MODE ──────────────────────────────────────────────
  if (mode === 'voice') {
    return (
      <div className="mi-root mi-root--voice">
        {speechError && <p className="mi-error">{speechError}</p>}

        {waveVisible && (
          <div className="mi-wave" aria-hidden="true">
            {Array.from({ length: VOICE_WAVE_BARS }, (_, i) => <span key={i} className="mi-wb" />)}
          </div>
        )}

        {(isListening || transcript.trim()) && (
          <div className="mi-voice-preview">
            <p className="mi-voice-text">{transcript.trim() || '…'}</p>
          </div>
        )}

        <div className="mi-voice-controls">
          <button
            type="button"
            className="mi-btn mi-btn--round"
            onClick={onToggleShowChat}
            aria-pressed={showChat}
            aria-label={showChat ? 'Скрыть чат' : 'Показать чат'}
          >
            <IconChat />
          </button>

          <button
            type="button"
            className={`mi-btn mi-btn--mic-big${isListening ? ' mi-btn--rec' : ''}`}
            onClick={handleMic}
            aria-label={isListening ? 'Остановить' : 'Голосовой ввод'}
          >
            <IconMic />
          </button>

          <button
            type="button"
            className="mi-btn mi-btn--round"
            onClick={onModeText}
            aria-label="Писать текстом"
          >
            <IconPen />
          </button>
        </div>
      </div>
    )
  }

  // ── TEXT MODE ────────────────────────────────────────────────
  return (
    <div className="mi-root mi-root--text">
      {speechError && <p className="mi-error">{speechError}</p>}

      <div className="mi-box">
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="mi-textarea"
          placeholder="Напиши что-нибудь..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Сообщение"
        />

        {/* Attachment preview */}
        {(fileUploading || attachedFile) && (
          <div className="mi-file-preview">
            {fileUploading
              ? <span>Загружаю...</span>
              : (
                <>
                  <span>📎 {attachedFile.name}</span>
                  <button
                    type="button"
                    className="mi-file-remove"
                    onClick={() => { setAttachedFile(null); setFileError('') }}
                    aria-label="Убрать файл"
                  >×</button>
                </>
              )}
          </div>
        )}

        {fileError && <p className="mi-error mi-error--inline">{fileError}</p>}

        {/* Bottom action bar */}
        <div className="mi-actions">
          <div className="mi-actions-left">
            <button
              type="button"
              className="mi-btn mi-btn--icon"
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
          </div>

          <div className="mi-actions-right">
            <button
              type="button"
              className={`mi-btn mi-btn--icon${isListening ? ' mi-btn--rec' : ''}`}
              onClick={handleMic}
              aria-label={isListening ? 'Остановить запись' : 'Голосовой ввод'}
            >
              <IconMic />
            </button>
            {hasContent && (
              <button
                type="button"
                className="mi-btn mi-btn--send"
                onClick={submitMessage}
                aria-label="Отправить"
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Close text mode */}
      <button
        type="button"
        className="mi-close"
        onClick={onModeVoice}
        aria-label="Закрыть ввод"
      >
        ✕
      </button>
    </div>
  )
}

export default MessageInput
