import { useEffect, useRef } from 'react'
import './ChatArea.css'

// Область истории сообщений в стиле макета (список + набор текста ботом).
function ChatArea({ messages, isYenTyping, visible, expanded, onExpand }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isYenTyping, visible])

  return (
    <section
      className={`yen-chat ${visible ? 'yen-chat--vis' : ''}`}
      aria-label="История сообщений"
    >
      {visible && (
        <button
          type="button"
          className="yen-expand-btn"
          onClick={onExpand}
          aria-label={expanded ? 'Свернуть чат' : 'Развернуть чат'}
        >
          {expanded ? '↙' : '↗'}
        </button>
      )}
      {messages.map((message) => (
        <article
          key={message.id}
          className={`yen-msg ${message.role === 'user' ? 'yen-msg--u' : 'yen-msg--y'}`}
        >
          {message.text}
        </article>
      ))}
      {isYenTyping ? (
        <div className="yen-chat-typing" aria-live="polite" aria-busy="true">
          <span className="yen-chat-typing__label">Йен набирает</span>
          <span className="yen-chat-typing__dots" aria-hidden="true">
            <span className="yen-chat-typing__dot" />
            <span className="yen-chat-typing__dot" />
            <span className="yen-chat-typing__dot" />
          </span>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </section>
  )
}

export default ChatArea
