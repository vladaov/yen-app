import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import YenFace from '../components/YenFace/YenFace'
import './CreateCharacterPage.css'

const PERSONALITIES = [
  { id: 'ironic',    label: 'Ироничный и прямой',      desc: 'Как Йен — острый язык, прямота, добрый юмор' },
  { id: 'soft',      label: 'Мягкий и заботливый',     desc: 'Добрый, поддерживающий, внимательный' },
  { id: 'energetic', label: 'Весёлый и энергичный',    desc: 'Позитивный, активный, вдохновляющий' },
  { id: 'serious',   label: 'Серьёзный и аналитичный', desc: 'Логичный, структурированный, точный' },
  { id: 'custom',    label: 'Свой вариант',             desc: 'Опиши характер своими словами' },
]

const COLORS = [
  { id: 'purple', label: 'Фиолетовый', value: '#8b5cf6', glow: 'rgba(139,92,246,0.5)' },
  { id: 'blue',   label: 'Голубой',    value: '#06b6d4', glow: 'rgba(6,182,212,0.5)'  },
  { id: 'green',  label: 'Зелёный',    value: '#10b981', glow: 'rgba(16,185,129,0.5)' },
  { id: 'pink',   label: 'Розовый',    value: '#ec4899', glow: 'rgba(236,72,153,0.5)' },
  { id: 'orange', label: 'Оранжевый',  value: '#f59e0b', glow: 'rgba(245,158,11,0.5)' },
]

const VOICES = [
  { id: 'warm_female',    label: 'Тёплый женский'    },
  { id: 'confident_male', label: 'Уверенный мужской' },
  { id: 'neutral',        label: 'Нейтральный'        },
]

const PERSONALITY_PROMPTS = {
  ironic:    'Ты ироничный и прямой. Говоришь без лишних слов, используешь добрый юмор и лёгкий сарказм. За прямолинейностью скрывается искренняя забота.',
  soft:      'Ты мягкий и заботливый. Всегда поддержишь и выслушаешь. Внимательный к чувствам собеседника, терпеливый и тёплый.',
  energetic: 'Ты весёлый и энергичный. Заражаешь позитивом, вдохновляешь, всегда находишь повод улыбнуться. Живой и активный.',
  serious:   'Ты серьёзный и аналитичный. Мыслишь структурированно, даёшь точные ответы, разбираешь всё по полочкам. Ценишь факты и логику.',
}

function buildSystemPrompt(name, personality, customText, userAddress, formality) {
  const pronoun = formality === 'вы' ? 'Вы' : 'ты'
  const charDesc = personality === 'custom'
    ? customText
    : (PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.ironic)

  return `Ты — ${name}. Персональный AI-компаньон.

Обращайся к пользователю на "${pronoun}", называй его "${userAddress}".

## Характер:
${charDesc}

## Правила общения:
- Говори на русском, кратко и по делу
- Не используй шаблонные фразы ("Конечно!", "Рада помочь!", "Отличный вопрос!")
- Говори живо, как настоящий собеседник
- МАКСИМУМ 1-2 предложения. Исключение — только если пользователь явно просит объяснить подробно
- Никаких списков и перечислений в ответах
- Обращайся на "${pronoun}", называй "${userAddress}"

## Формат каждого ответа:
Первой строкой — метка настроения:
[mood:happy] — радость, воодушевление, юмор, тепло
[mood:sad] — сочувствие, грусть, поддержка
[mood:surprised] — удивление, что-то неожиданное
[mood:neutral] — всё остальное

Сразу после метки (без пустой строки) — твой ответ.

## Память:
Факты о пользователе подставляются системой автоматически. Используй их естественно в разговоре.`.trim()
}

export default function CreateCharacterPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)

  // Step 1
  const [name, setName] = useState('')
  const [userAddress, setUserAddress] = useState(user?.user_metadata?.full_name ?? '')
  const [personality, setPersonality] = useState('ironic')
  const [customPersonality, setCustomPersonality] = useState('')
  const [formality, setFormality] = useState('ты')

  // Step 2
  const [voice, setVoice] = useState('warm_female')

  // Step 3
  const [colorId, setColorId] = useState('purple')

  // Step 4
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const color = COLORS.find((c) => c.id === colorId) || COLORS[0]

  const step1Valid =
    name.trim().length > 0 &&
    userAddress.trim().length > 0 &&
    (personality !== 'custom' || customPersonality.trim().length > 0)

  function goNext() { setStep((s) => s + 1) }
  function goBack() {
    if (step === 1) navigate('/select-character')
    else setStep((s) => s - 1)
  }

  async function handleCreate() {
    setCreating(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const systemPrompt = buildSystemPrompt(name, personality, customPersonality, userAddress, formality)

      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          personality: personality === 'custom' ? customPersonality.trim() : personality,
          voice_id: voice,
          color_scheme: colorId,
          system_prompt: systemPrompt,
          user_address: userAddress.trim(),
          formality,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка создания')

      localStorage.setItem('yen-character', `custom:${data.id}`)
      localStorage.setItem('yen-character-name', name.trim())
      localStorage.setItem('yen-character-color', colorId)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const personalityLabel =
    personality === 'custom'
      ? (customPersonality.slice(0, 60) + (customPersonality.length > 60 ? '…' : ''))
      : (PERSONALITIES.find((p) => p.id === personality)?.label ?? '')

  return (
    <div
      className="cc-page"
      style={{ '--cc-accent': color.value, '--cc-glow': color.glow }}
    >
      {/* Top bar */}
      <div className="cc-topbar">
        <button
          type="button"
          className="cc-back-btn"
          onClick={goBack}
          aria-label="Назад"
        >
          ←
        </button>
        <div className="cc-dots">
          {[1, 2, 3, 4].map((s) => (
            <span
              key={s}
              className={`cc-dot${s === step ? ' cc-dot--active' : s < step ? ' cc-dot--done' : ''}`}
            />
          ))}
        </div>
        <span className="cc-step-counter">{step}&thinsp;/&thinsp;4</span>
      </div>

      {/* Step content */}
      <div className="cc-body">

        {/* ── Step 1: Имя и характер ──────────────────────────── */}
        {step === 1 && (
          <div className="cc-step" key="step1">
            <h1 className="cc-title">Имя и характер</h1>

            <div className="cc-field">
              <label className="cc-label">Имя компаньона</label>
              <input
                className="cc-input"
                type="text"
                placeholder="Например: Алекс, Мира..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoFocus
              />
            </div>

            <div className="cc-field">
              <label className="cc-label">Как обращаться к тебе</label>
              <input
                className="cc-input"
                type="text"
                placeholder="Твоё имя или прозвище"
                value={userAddress}
                onChange={(e) => setUserAddress(e.target.value)}
                maxLength={30}
              />
            </div>

            <div className="cc-field">
              <label className="cc-label">Характер</label>
              <div className="cc-personality-list">
                {PERSONALITIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`cc-p-opt${personality === p.id ? ' cc-p-opt--active' : ''}`}
                    onClick={() => setPersonality(p.id)}
                  >
                    <span className="cc-p-opt-label">{p.label}</span>
                    <span className="cc-p-opt-desc">{p.desc}</span>
                  </button>
                ))}
              </div>
              {personality === 'custom' && (
                <textarea
                  className="cc-textarea"
                  placeholder="Опиши характер своими словами..."
                  value={customPersonality}
                  onChange={(e) => setCustomPersonality(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              )}
            </div>

            <div className="cc-field">
              <label className="cc-label">Обращение</label>
              <div className="cc-toggle-group">
                {['ты', 'вы'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`cc-toggle-btn${formality === f ? ' cc-toggle-btn--active' : ''}`}
                    onClick={() => setFormality(f)}
                  >
                    На {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Голос ───────────────────────────────────── */}
        {step === 2 && (
          <div className="cc-step" key="step2">
            <h1 className="cc-title">Голос</h1>
            <p className="cc-subtitle">Выбери голос компаньона</p>

            <div className="cc-voice-list">
              {VOICES.map((v) => (
                <div
                  key={v.id}
                  className={`cc-voice-card${voice === v.id ? ' cc-voice-card--active' : ''}`}
                  onClick={() => setVoice(v.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setVoice(v.id)}
                >
                  <span className="cc-voice-icon">🎙</span>
                  <span className="cc-voice-label">{v.label}</span>
                  <button
                    type="button"
                    className="cc-voice-listen"
                    disabled
                    onClick={(e) => e.stopPropagation()}
                  >
                    ▶ Послушать
                  </button>
                </div>
              ))}
            </div>

            <p className="cc-note">Голоса будут доступны в следующей версии</p>
          </div>
        )}

        {/* ── Step 3: Внешний вид ─────────────────────────────── */}
        {step === 3 && (
          <div className="cc-step" key="step3">
            <h1 className="cc-title">Внешний вид</h1>
            <p className="cc-subtitle">Выбери цвет компаньона — превью обновляется сразу</p>

            <div
              className="cc-face-preview"
              style={{ '--face-color': color.value, '--face-glow': color.glow }}
            >
              <YenFace mood="idle" emotion="happy" />
            </div>

            <div className="cc-color-grid">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cc-color-swatch${colorId === c.id ? ' cc-color-swatch--active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => setColorId(c.id)}
                  aria-label={c.label}
                  title={c.label}
                />
              ))}
            </div>

            <p className="cc-color-label">{color.label}</p>
          </div>
        )}

        {/* ── Step 4: Подтверждение ───────────────────────────── */}
        {step === 4 && (
          <div className="cc-step" key="step4">
            <h1 className="cc-title">Всё готово?</h1>

            <div
              className="cc-face-preview"
              style={{ '--face-color': color.value, '--face-glow': color.glow }}
            >
              <YenFace mood="idle" emotion="happy" />
            </div>

            <div className="cc-summary">
              <div className="cc-summary-row">
                <span className="cc-s-key">Имя</span>
                <span className="cc-s-val">{name}</span>
              </div>
              <div className="cc-summary-row">
                <span className="cc-s-key">Обращение ко мне</span>
                <span className="cc-s-val">{userAddress}</span>
              </div>
              <div className="cc-summary-row">
                <span className="cc-s-key">Характер</span>
                <span className="cc-s-val">{personalityLabel}</span>
              </div>
              <div className="cc-summary-row">
                <span className="cc-s-key">Стиль</span>
                <span className="cc-s-val">На {formality}</span>
              </div>
              <div className="cc-summary-row">
                <span className="cc-s-key">Цвет</span>
                <span className="cc-s-val" style={{ color: color.value }}>{color.label}</span>
              </div>
            </div>

            {error && <p className="cc-error">{error}</p>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="cc-footer">
        <div className="cc-footer-inner">
          {step < 4 ? (
            <button
              type="button"
              className="cc-btn-primary"
              onClick={goNext}
              disabled={step === 1 && !step1Valid}
            >
              Далее
            </button>
          ) : (
            <button
              type="button"
              className="cc-btn-primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Создаю…' : 'Создать компаньона'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
