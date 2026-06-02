import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import ChatArea from './components/Chat/ChatArea'
import MessageInput from './components/Chat/MessageInput'
import SettingsDrawer from './components/SettingsDrawer/SettingsDrawer'
import YenFace from './components/YenFace/YenFace'
import { useAuth } from './hooks/useAuth'
import { useChat } from './hooks/useChat'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import CharacterSelectPage from './pages/CharacterSelectPage'
import CreateCharacterPage from './pages/CreateCharacterPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

const SHOW_CHAT_KEY = 'yen-show-chat'
const CHARACTER_KEY = 'yen-character'

function readShowChatFromStorage() {
  try { return localStorage.getItem(SHOW_CHAT_KEY) === 'true' }
  catch { return false }
}

function YenApp() {
  const [showSettings, setShowSettings] = useState(false)
  const [showChat, setShowChat]         = useState(readShowChatFromStorage)
  const [chatExpanded, setChatExpanded] = useState(false)
  const [inputMode, setInputMode]       = useState('voice')
  const navigate = useNavigate()

  const { messages, isSpeaking, isYenTyping, mood, sendMessage } = useChat()
  const speech = useSpeechRecognition()

  const handleSendMessage = useCallback((text) => sendMessage(text), [sendMessage])

  // Sync showChat from localStorage when drawer closes (user may have toggled it)
  const handleDrawerClose = useCallback(() => {
    setShowSettings(false)
    setShowChat(readShowChatFromStorage())
  }, [])

  useEffect(() => {
    try { localStorage.setItem(SHOW_CHAT_KEY, showChat ? 'true' : 'false') }
    catch { /* ignore */ }
  }, [showChat])

  const faceMood = speech.isListening
    ? 'listening'
    : isSpeaking
      ? 'speaking'
      : isYenTyping
        ? 'thinking'
        : 'idle'

  return (
    <>
      <SettingsDrawer open={showSettings} onClose={handleDrawerClose} />

      {!showSettings && (
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          aria-label="Настройки"
          style={{ position: 'fixed', top: 'max(env(safe-area-inset-top, 12px), 12px)', right: 16, left: 'auto', width: 44, height: 44, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', opacity: 0.3, zIndex: 9999, color: 'white', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          ⚙
        </button>
      )}

      <div className={`yen-app${chatExpanded ? ' yen-app--chat-mode' : ''}`}>

      {!chatExpanded && (
        <div className="yen-face-area">
          <YenFace mood={faceMood} emotion={mood} />
        </div>
      )}

      <div className="yen-controls">
        <ChatArea
          messages={messages}
          isYenTyping={isYenTyping}
          visible={showChat}
          expanded={chatExpanded}
          onExpand={() => setChatExpanded((prev) => !prev)}
        />
        <MessageInput
          mode={inputMode}
          onModeVoice={() => { setInputMode('voice'); setShowChat(false); setChatExpanded(false) }}
          onModeText={() => { setInputMode('text'); setShowChat(true) }}
          showChat={showChat}
          onToggleShowChat={() => setShowChat((prev) => !prev)}
          onSend={handleSendMessage}
          isListening={speech.isListening}
          transcript={speech.transcript}
          onStartListening={speech.startListening}
          onStopListening={speech.stopListening}
          resetTranscript={speech.resetTranscript}
          speechError={speech.error}
        />
      </div>
    </div>
  </>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthSpinner />
  return user ? children : <Navigate to="/login" replace />
}

function RequireCharacter({ children }) {
  const character = localStorage.getItem(CHARACTER_KEY)
  return character ? children : <Navigate to="/select-character" replace />
}

function RedirectIfAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthSpinner />
  return user ? <Navigate to="/select-character" replace /> : children
}

function AuthSpinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )
}

function App() {
  useEffect(() => {
    const theme = localStorage.getItem('agent-theme') ?? 'dark'
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return (
    <Routes>
      <Route path="/login"    element={<RedirectIfAuth><LoginPage /></RedirectIfAuth>} />
      <Route path="/register" element={<RedirectIfAuth><RegisterPage /></RedirectIfAuth>} />
      <Route path="/select-character" element={<RequireAuth><CharacterSelectPage /></RequireAuth>} />
      <Route path="/create-character" element={<RequireAuth><CreateCharacterPage /></RequireAuth>} />
      <Route path="/" element={
        <RequireAuth><RequireCharacter><YenApp /></RequireCharacter></RequireAuth>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
