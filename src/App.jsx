import { useCallback, useEffect, useState } from 'react'
import ChatArea from './components/Chat/ChatArea'
import MessageInput from './components/Chat/MessageInput'
import SettingsModal from './components/Settings/SettingsModal'
import YenFace from './components/YenFace/YenFace'
import { useChat } from './hooks/useChat'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'

const SHOW_CHAT_KEY = 'yen-show-chat'

// Функция читает, показывать ли панель чата (как в настройках макета).
function readShowChatFromStorage() {
  try {
    return localStorage.getItem(SHOW_CHAT_KEY) === 'true'
  } catch {
    return false
  }
}

// Главный экран Йен: лицо, статус-бабл, чат и ввод в стиле HTML-макета.
function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('agent-theme') ?? 'dark')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showChat, setShowChat] = useState(readShowChatFromStorage)
  const [chatExpanded, setChatExpanded] = useState(false)
  const [inputMode, setInputMode] = useState('voice')

  const { messages, isSpeaking, isYenTyping, mood, sendMessage, voiceEnabled, setVoiceEnabled } = useChat()
  const speech = useSpeechRecognition()

  const handleSendMessage = useCallback((text) => {
    sendMessage(text)
  }, [sendMessage])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('agent-theme', theme)
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_CHAT_KEY, showChat ? 'true' : 'false')
    } catch {
      // игнорируем
    }
  }, [showChat])

  const faceMood = speech.isListening
    ? 'listening'
    : isSpeaking
      ? 'speaking'
      : isYenTyping
        ? 'thinking'
        : 'idle'

  return (
    <div className={`yen-app${chatExpanded ? ' yen-app--chat-mode' : ''}`}>
      <SettingsModal
        open={settingsOpen}
        onOpen={() => setSettingsOpen(true)}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onToggleTheme={() => setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'))}
        voiceEnabled={voiceEnabled}
        onToggleVoice={() => setVoiceEnabled((previous) => !previous)}
        showChat={showChat}
        onToggleShowChat={() => setShowChat((previous) => !previous)}
      />

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
          onModeVoice={() => {
            setInputMode('voice')
            setShowChat(false)
            setChatExpanded(false)
          }}
          onModeText={() => {
            setInputMode('text')
            setShowChat(true)
          }}
          showChat={showChat}
          onToggleShowChat={() => setShowChat((previous) => !previous)}
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
  )
}

export default App
