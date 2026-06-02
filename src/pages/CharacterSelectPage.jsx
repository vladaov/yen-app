import { useNavigate } from 'react-router-dom'
import YenFace from '../components/YenFace/YenFace'
import './CharacterSelectPage.css'

const YEN_CHARACTER = {
  id: 'yen',
  name: 'Йен',
  description: 'Ироничная, прямая, заботливая. Вдохновлена Йенифер из Ведьмака',
}

export default function CharacterSelectPage() {
  const navigate = useNavigate()
  const hasCharacter = Boolean(localStorage.getItem('yen-character'))

  function handleSelectYen() {
    localStorage.setItem('yen-character', YEN_CHARACTER.id)
    navigate('/')
  }

  function handleCreateOwn() {
    navigate('/create-character')
  }

  return (
    <div className="cs-page">
      <div className="cs-content">
        <h1 className="cs-title">Выбери компаньона</h1>
        <p className="cs-subtitle">С кем ты хочешь поговорить?</p>

        <div className="cs-grid">
          {/* Йен — доступна */}
          <div className="cs-card">
            <div className="cs-face-wrap">
              <YenFace mood="idle" emotion="neutral" />
            </div>
            <div className="cs-card-body">
              <h2 className="cs-card-name">{YEN_CHARACTER.name}</h2>
              <p className="cs-card-desc">{YEN_CHARACTER.description}</p>
            </div>
            <button className="cs-btn cs-btn--primary" onClick={handleSelectYen}>
              Выбрать
            </button>
          </div>

          {/* Создать своего */}
          <div className={`cs-card${hasCharacter ? ' cs-card--locked' : ''}`}>
            <div className="cs-face-wrap cs-face-wrap--placeholder">
              <span className="cs-placeholder-icon">＋</span>
            </div>
            <div className="cs-card-body">
              <h2 className="cs-card-name">Создать своего</h2>
              <p className="cs-card-desc">Настрой персонажа под себя: имя, характер, голос</p>
            </div>
            {hasCharacter ? (
              <button className="cs-btn cs-btn--disabled" disabled title="У тебя уже есть компаньон">
                Уже есть
              </button>
            ) : (
              <button className="cs-btn cs-btn--primary" onClick={handleCreateOwn}>
                Создать
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
