# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Two separate processes must run simultaneously. Each has its own `node_modules` and `package.json`.

**Frontend** (root directory, ESM):
```bash
npm run dev       # dev server at http://localhost:5173
npm run build     # production build
npm run lint      # eslint
npm run preview   # preview production build
```

**Backend** (from `server/` directory, CJS):
```bash
cd server
npm install       # first time only — separate node_modules
npm start         # node index.js, runs at http://localhost:3001
```

There are no tests.

## Environment

The server requires `server/.env` with:
```
ANTHROPIC_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

## Architecture

This is "Yen" — a personal AI companion with an animated face, voice input/output, and persistent memory.

### Module systems — critical distinction

- **Frontend** (`src/`): ESM (`import`/`export`), declared via `"type": "module"` in root `package.json`
- **Backend** (`server/`): CommonJS (`require`/`module.exports`), no `type` field in `server/package.json`

Never mix them: adding `import` to server files will break startup.

### Data flow

```
User speaks
  → Web Speech API (ru-RU, continuous, 1200ms silence auto-stop)
  → useSpeechRecognition → transcript → sendMessage()
  → POST /api/chat → Claude API (claude-sonnet-4-20250514, up to 20 history turns)
  → { reply, mood } returned
  → if voice enabled: POST /api/tts → ElevenLabs → audio blob → playback
  → face state updates
  → background: server calls Claude again with extractionPrompt to extract user facts → memory.json
```

### State / mood priority in `App.jsx`

`faceMood` is computed from multiple sources with strict priority:

```
listening > speaking > thinking > (happy | sad from last response) > idle
```

`isSpeaking` comes from `useAudioPlayer.isPlaying`. `isYenTyping` is true while awaiting the server response. `mood` (`'happy'`, `'sad'`, `'neutral'`) comes from server-side keyword analysis of the reply.

### Key files

| File | Role |
|------|------|
| `src/App.jsx` | Root component, computes `faceMood`, renders layout |
| `src/hooks/useChat.js` | All chat logic: messages, history, API calls, voice sync, mood state |
| `src/hooks/useAudioPlayer.js` | TTS via ElevenLabs proxied through server; `beforePlay` callback ensures text and audio appear simultaneously |
| `src/hooks/useSpeechRecognition.js` | Web Speech API wrapper with 1200ms silence timer |
| `src/components/YenFace/YenFace.jsx` | Animated face; moods: `idle`, `listening`, `thinking`, `speaking`, `happy`, `sad` |
| `server/index.js` | Express server; `/api/chat` (Claude), `/api/tts` (ElevenLabs proxy), `/api/memory` |
| `server/MemoryManager.js` | Persistent facts storage in `server/memory.json` (categories: личное, работа, здоровье, цели, предпочтения, люди, проекты) |

### Persistence

- **Chat history**: `localStorage['yen-chat-history']`, max 50 messages, format `{ id, role: 'user'|'bot', text }`
- **Voice toggle**: `localStorage['yen-voice-enabled']`, synchronized across components via custom DOM event `yen-voice-enabled-change`
- **Server memory**: `server/memory.json` — survives server restarts; written after every exchange by a background `extractAndSaveFacts()` call (fire-and-forget, never blocks the response)
- **Client memory**: `localStorage['yen-memory']` — read by `src/memory/MemoryManager.js` only for the initial greeting check via `GET /api/memory`

### CSS

- CSS variables (colors, transitions, face glow): `src/styles/variables.css`
- Global layout and theming: `src/styles/global.css`
- Animations (pulse, spin etc.): `src/styles/animations.css`
- Component styles are colocated: `YenFace.css` next to `YenFace.jsx`
- Face speaking animation uses `@keyframes yen-speak` (pure CSS, no JS timer)
- Theme switching via `data-theme` attribute on `<html>`
