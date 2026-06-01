import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import './SettingsDrawer.css'

const VOICE_KEY     = 'yen-voice-enabled'
const SHOW_CHAT_KEY = 'yen-show-chat'
const THEME_KEY     = 'agent-theme'
const CHAR_KEY      = 'yen-character'
const VOICE_EVENT   = 'yen-voice-enabled-change'

function readBool(key, def = true) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return def
    return v !== 'false'
  } catch { return def }
}

// ── Toggle ───────────────────────────────────────────────────
function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      className={`sd-tog${on ? ' sd-tog--on' : ''}`}
      onClick={onChange}
      aria-pressed={on}
      aria-label={label}
    />
  )
}

// ── Accordion section ────────────────────────────────────────
function Section({ id, open, onToggle, icon, title, children }) {
  return (
    <div className={`sd-section${open ? ' sd-section--open' : ''}`}>
      <button type="button" className="sd-section-hd" onClick={() => onToggle(id)}>
        <span className="sd-section-icon">{icon}</span>
        <span className="sd-section-title">{title}</span>
        <span className="sd-section-arrow">{open ? '▾' : '›'}</span>
      </button>
      {open && <div className="sd-section-body">{children}</div>}
    </div>
  )
}

// ── Delete dialog ────────────────────────────────────────────
function DeleteDialog({ onClose, onDeleteAll, onDeleteKeepMemory }) {
  const [step, setStep] = useState('choose')

  return (
    <div className="sd-dialog-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sd-dialog">
        <h3 className="sd-dialog-title">Удалить компаньона?</h3>

        {step === 'choose' && (
          <>
            <p className="sd-dialog-desc">Выбери вариант удаления:</p>
            <div className="sd-dialog-actions">
              <button className="sd-dialog-btn sd-dialog-btn--danger" onClick={() => setStep('all')}>
                Удалить всё
              </button>
              <button className="sd-dialog-btn sd-dialog-btn--danger-soft" onClick={() => setStep('memory')}>
                Удалить, сохранив память обо мне
              </button>
              <button className="sd-dialog-btn sd-dialog-btn--cancel" onClick={onClose}>
                Отмена
              </button>
            </div>
          </>
        )}

        {(step === 'all' || step === 'memory') && (
          <>
            <p className="sd-dialog-desc sd-dialog-desc--warn">
              {step === 'all'
                ? 'Это удалит компаньона и всю историю. Действие необратимо.'
                : 'Компаньон будет удалён, но факты о тебе останутся для нового.'}
            </p>
            <div className="sd-dialog-actions">
              <button
                className="sd-dialog-btn sd-dialog-btn--danger"
                onClick={step === 'all' ? onDeleteAll : onDeleteKeepMemory}
              >
                Подтвердить удаление
              </button>
              <button className="sd-dialog-btn sd-dialog-btn--cancel" onClick={onClose}>
                Отмена
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Drawer ───────────────────────────────────────────────────
export default function SettingsDrawer({ open, onClose }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [openSection, setOpenSection] = useState(null)
  const [voice, setVoice]             = useState(() => readBool(VOICE_KEY, true))
  const [showChat, setShowChat]       = useState(() => localStorage.getItem(SHOW_CHAT_KEY) === 'true')
  const [theme, setTheme]             = useState(() => localStorage.getItem(THEME_KEY) ?? 'dark')
  const [displayName, setDisplayName] = useState(() => user?.user_metadata?.full_name ?? '')
  const [nameSaving, setNameSaving]   = useState(false)
  const [nameSaved, setNameSaved]     = useState(false)
  const [nameError, setNameError]     = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const savedTimerRef  = useRef(null)
  const touchStartXRef = useRef(null)

  const character = localStorage.getItem(CHAR_KEY)
  const email     = user?.email ?? ''
  const initials  = (displayName || email).slice(0, 2).toUpperCase()

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Apply theme immediately
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Swipe right to close
  function handleTouchStart(e) {
    touchStartXRef.current = e.touches[0].clientX
  }
  function handleTouchEnd(e) {
    if (touchStartXRef.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartXRef.current
    if (delta > 80) onClose()
    touchStartXRef.current = null
  }

  function toggleSection(id) {
    setOpenSection((prev) => (prev === id ? null : id))
  }

  function toggleVoice() {
    const next = !voice
    setVoice(next)
    localStorage.setItem(VOICE_KEY, next ? 'true' : 'false')
    window.dispatchEvent(new Event(VOICE_EVENT))
  }

  function toggleShowChat() {
    const next = !showChat
    setShowChat(next)
    localStorage.setItem(SHOW_CHAT_KEY, next ? 'true' : 'false')
  }

  async function saveName() {
    if (!displayName.trim()) return
    setNameSaving(true)
    setNameError('')
    try {
      await supabase.auth.updateUser({ data: { full_name: displayName.trim() } })
      setNameSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setNameSaved(false), 2000)
    } catch (e) {
      setNameError(e.message)
    } finally {
      setNameSaving(false)
    }
  }

  function handleDeleteAll() {
    localStorage.removeItem(CHAR_KEY)
    localStorage.removeItem('yen-chat-history')
    localStorage.removeItem('yen-memory')
    setShowDeleteDialog(false)
    onClose()
    navigate('/select-character')
  }

  function handleDeleteKeepMemory() {
    localStorage.removeItem(CHAR_KEY)
    localStorage.removeItem('yen-chat-history')
    setShowDeleteDialog(false)
    onClose()
    navigate('/select-character')
  }

  async function handleSignOut() {
    onClose()
    await signOut()
    navigate('/login')
  }

  const drawer = (
    <>
      {/* Backdrop */}
      <div
        className={`sd-backdrop${open ? ' sd-backdrop--open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`sd-panel${open ? ' sd-panel--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {showDeleteDialog && (
          <DeleteDialog
            onClose={() => setShowDeleteDialog(false)}
            onDeleteAll={handleDeleteAll}
            onDeleteKeepMemory={handleDeleteKeepMemory}
          />
        )}

        {/* Header */}
        <div className="sd-header">
          <span className="sd-header-title">Настройки</span>
          <button type="button" className="sd-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="sd-body">
          {/* Mini-profile */}
          <div className="sd-profile-card">
            <div className="sd-avatar">{initials}</div>
            <div className="sd-profile-info">
              <span className="sd-profile-name">{displayName || 'Без имени'}</span>
              <span className="sd-profile-email">{email}</span>
            </div>
          </div>

          {/* Accordion sections */}
          <div className="sd-sections">
            <Section id="profile" open={openSection === 'profile'} onToggle={toggleSection} icon="👤" title="Профиль">
              <div className="sd-field">
                <label className="sd-label">Имя</label>
                <div className="sd-input-row">
                  <input
                    className="sd-input"
                    type="text"
                    value={displayName}
                    onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false) }}
                    placeholder="Твоё имя"
                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  />
                  <button className="sd-save-btn" onClick={saveName} disabled={nameSaving}>
                    {nameSaved ? '✓' : nameSaving ? '…' : 'Сохранить'}
                  </button>
                </div>
                {nameError && <span className="sd-field-error">{nameError}</span>}
              </div>
              <div className="sd-field">
                <label className="sd-label">Email</label>
                <input className="sd-input sd-input--readonly" type="email" value={email} readOnly />
              </div>
            </Section>

            <Section id="companion" open={openSection === 'companion'} onToggle={toggleSection} icon="✦" title="Компаньон">
              <div className="sd-companion-info">
                <span className="sd-companion-name">{character === 'yen' ? 'Йен' : character ?? 'Не выбран'}</span>
                {character === 'yen' && <span className="sd-companion-desc">Ироничная, прямая, заботливая</span>}
              </div>
              <div className="sd-companion-actions">
                <button className="sd-action-btn" onClick={() => { onClose(); navigate('/select-character') }}>
                  Сменить
                </button>
                <button className="sd-action-btn sd-action-btn--danger" onClick={() => setShowDeleteDialog(true)}>
                  Удалить
                </button>
              </div>
            </Section>

            <Section id="comms" open={openSection === 'comms'} onToggle={toggleSection} icon="🎙" title="Общение">
              <div className="sd-row">
                <span className="sd-row-label">Голос Йен</span>
                <Toggle on={voice} onChange={toggleVoice} label="Голос Йен" />
              </div>
              <div className="sd-row">
                <span className="sd-row-label">Показывать чат</span>
                <Toggle on={showChat} onChange={toggleShowChat} label="Показывать чат" />
              </div>
            </Section>

            <Section id="appearance" open={openSection === 'appearance'} onToggle={toggleSection} icon="🎨" title="Оформление">
              <div className="sd-row">
                <span className="sd-row-label">Тема</span>
                <div className="sd-theme-btns">
                  <button
                    className={`sd-theme-btn${theme === 'dark' ? ' sd-theme-btn--active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >🌙 Тёмная</button>
                  <button
                    className={`sd-theme-btn${theme === 'light' ? ' sd-theme-btn--active' : ''}`}
                    onClick={() => setTheme('light')}
                  >☀️ Светлая</button>
                </div>
              </div>
            </Section>
          </div>

          <button type="button" className="sd-signout-btn" onClick={handleSignOut}>
            Выйти
          </button>
        </div>
      </div>
    </>
  )

  return createPortal(drawer, document.body)
}
