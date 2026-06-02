import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import './SettingsDrawer.css'

// ── Bond level ────────────────────────────────────────────────
const BOND_CATS = [
  { key: 'личное',       icon: '👤', label: 'Личное' },
  { key: 'работа',       icon: '💼', label: 'Работа' },
  { key: 'цели',         icon: '🎯', label: 'Цели' },
  { key: 'люди',         icon: '👥', label: 'Люди' },
  { key: 'предпочтения', icon: '💜', label: 'Предпочтения' },
]
const BOND_LABELS = [
  [80, 'Близкие друзья'],
  [60, 'Друзья'],
  [40, 'Приятели'],
  [20, 'Знакомые'],
  [0,  'Незнакомцы'],
]
function bondLabel(pct) {
  return BOND_LABELS.find(([min]) => pct >= min)[1]
}
function catPct(facts, key) {
  const cat = facts?.[key]
  if (!cat || typeof cat !== 'object') return 0
  return Math.min(100, Math.round((Object.keys(cat).length / 3) * 100))
}

const RING_R = 30
const RING_CX = 40
const RING_CY = 40
const CIRC = 2 * Math.PI * RING_R // ≈ 188.5

function BondLevel({ facts }) {
  const catPcts = BOND_CATS.map((c) => ({ ...c, pct: catPct(facts, c.key) }))
  const overall = Math.round(catPcts.reduce((s, c) => s + c.pct, 0) / BOND_CATS.length)
  const dashOffset = CIRC * (1 - overall / 100)

  return (
    <div className="sd-bond">
      <div className="sd-bond-ring-wrap">
        <svg className="sd-bond-ring" viewBox="0 0 80 80" aria-hidden="true">
          <defs>
            <linearGradient id="bondGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <circle
            className="sd-bond-ring-track"
            cx={RING_CX} cy={RING_CY} r={RING_R}
            fill="none" strokeWidth="7"
          />
          <circle
            className="sd-bond-ring-fill"
            cx={RING_CX} cy={RING_CY} r={RING_R}
            fill="none" strokeWidth="7"
            strokeDasharray={CIRC}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_CX} ${RING_CY})`}
          />
        </svg>
        <div className="sd-bond-ring-center">
          <span className="sd-bond-pct">{overall}%</span>
          <span className="sd-bond-lbl">{bondLabel(overall)}</span>
        </div>
      </div>

      <div className="sd-bond-cats">
        {catPcts.map((c) => (
          <div key={c.key} className="sd-bond-cat">
            <span className="sd-bond-cat-icon">{c.icon}</span>
            <div className="sd-bond-bar-wrap">
              <div className="sd-bond-bar-fill" style={{ width: `${c.pct}%` }} />
            </div>
            <span className="sd-bond-cat-pct">{c.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

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
  const [memoryFacts, setMemoryFacts] = useState(null)

  const savedTimerRef  = useRef(null)
  const touchStartXRef = useRef(null)

  const character = localStorage.getItem(CHAR_KEY)
  const characterName = character === 'yen'
    ? 'Йен'
    : character?.startsWith('custom:')
      ? (localStorage.getItem('yen-character-name') || 'Свой компаньон')
      : null
  const email     = user?.email ?? ''
  const initials  = (displayName || email).slice(0, 2).toUpperCase()

  // Fetch memory facts when drawer opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function fetchFacts() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}
        const res = await fetch('/api/memory', { headers })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setMemoryFacts(data.facts ?? {})
      } catch { /* ignore */ }
    }
    fetchFacts()
    return () => { cancelled = true }
  }, [open])

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

  async function handleDeleteAll() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        await fetch('/api/memory', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      }
    } catch { /* ignore */ }
    localStorage.removeItem(CHAR_KEY)
    localStorage.removeItem('yen-character-name')
    localStorage.removeItem('yen-character-color')
    localStorage.removeItem('yen-chat-history')
    localStorage.removeItem('yen-memory')
    setShowDeleteDialog(false)
    onClose()
    navigate('/select-character')
  }

  function handleDeleteKeepMemory() {
    localStorage.removeItem(CHAR_KEY)
    localStorage.removeItem('yen-character-name')
    localStorage.removeItem('yen-character-color')
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

          {/* Bond level */}
          {memoryFacts !== null && <BondLevel facts={memoryFacts} />}

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
                <span className="sd-companion-name">{characterName ?? 'Не выбран'}</span>
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
