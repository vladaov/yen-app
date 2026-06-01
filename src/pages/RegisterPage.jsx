import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import './auth.css'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Пароль должен содержать не менее 6 символов')
      return
    }
    setLoading(true)
    try {
      await signUp(email, password, name)
      // If email confirmation is disabled, Supabase returns a session immediately
      // Otherwise show a success message
      setSuccess(true)
      setTimeout(() => navigate('/select-character'), 1500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-circle">✦</div>
          <h1 className="auth-title">Создать аккаунт</h1>
          <p className="auth-subtitle">Познакомьтесь с Йен</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          {success && (
            <div className="auth-error" style={{ color: 'var(--accent)', background: 'rgba(139,92,246,0.08)', borderColor: 'rgba(139,92,246,0.2)' }}>
              Аккаунт создан! Перенаправляем...
            </div>
          )}

          <div className="auth-field">
            <label className="auth-label" htmlFor="name">Имя</label>
            <input
              id="name"
              className="auth-input"
              type="text"
              placeholder="Как вас зовут?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Пароль</label>
            <input
              id="password"
              className="auth-input"
              type="password"
              placeholder="Минимум 6 символов"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <button className="auth-btn" type="submit" disabled={loading || success}>
            {loading ? 'Создаём...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="auth-footer">
          Уже есть аккаунт?{' '}
          <Link className="auth-link" to="/login">Войти</Link>
        </p>
      </div>
    </div>
  )
}
