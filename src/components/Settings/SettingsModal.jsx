import './SettingsModal.css'

// Модальное окно настроек (шестерёнка) по макету: тема, голос, показ чата.
function SettingsModal({
  open,
  onOpen,
  onClose,
  theme,
  onToggleTheme,
  voiceEnabled,
  onToggleVoice,
  showChat,
  onToggleShowChat,
}) {
  return (
    <>
      <button
        type="button"
        className="yen-gear"
        onClick={onOpen}
        aria-label="Открыть настройки"
      >
        ⚙
      </button>

      <div
        className={`yen-s-overlay ${open ? 'yen-s-overlay--open' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose()
          }
        }}
        role="presentation"
      >
        <div className="yen-s-card" role="dialog" aria-modal="true" aria-labelledby="yen-settings-title">
          <div className="yen-s-head">
            <div className="yen-s-title" id="yen-settings-title">
              Настройки
            </div>
            <button type="button" className="yen-s-close" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
          <div className="yen-s-row">
            <span className="yen-s-label">Тёмная тема</span>
            <button
              type="button"
              className={`yen-tog ${theme === 'dark' ? 'yen-tog--on' : ''}`}
              onClick={onToggleTheme}
              aria-pressed={theme === 'dark'}
              aria-label="Тёмная тема"
            />
          </div>
          <div className="yen-s-row">
            <span className="yen-s-label">Голос Йен</span>
            <button
              type="button"
              className={`yen-tog ${voiceEnabled ? 'yen-tog--on' : ''}`}
              onClick={onToggleVoice}
              aria-pressed={voiceEnabled}
              aria-label="Голос Йен"
            />
          </div>
          <div className="yen-s-row">
            <span className="yen-s-label">Показывать чат</span>
            <button
              type="button"
              className={`yen-tog ${showChat ? 'yen-tog--on' : ''}`}
              onClick={onToggleShowChat}
              aria-pressed={showChat}
              aria-label="Показывать чат"
            />
          </div>
        </div>
      </div>
    </>
  )
}

export default SettingsModal
