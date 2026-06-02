const path = require('path')
const dotenv = require('dotenv')
dotenv.config({ path: path.join(__dirname, '.env') })

const express = require('express')
const cors = require('cors')
const Anthropic = require('@anthropic-ai/sdk')
const { tavily } = require('@tavily/core')
const { Readable } = require('stream')
const { randomUUID } = require('crypto')
const multer = require('multer')
const pdfParse = require('pdf-parse')
const mammoth = require('mammoth')
const { createClient } = require('@supabase/supabase-js')
const { MemoryManager } = require('./MemoryManager')

const app = express()
const port = process.env.PORT || 3001

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

// Базовый клиент (anon key) — для верификации токенов пользователей.
const supabaseClient =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null

if (!supabaseClient) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_KEY не заданы — работаем локально')
}

const memoryManager = new MemoryManager(undefined, supabaseClient)

// ── Supabase helpers ──────────────────────────────────────────────────────────

// Создаёт Supabase-клиент, аутентифицированный токеном пользователя.
// Это позволяет RLS-политикам работать с auth.uid().
function createUserSupabase(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken) return null
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })
}

// Извлекает Bearer-токен из заголовка Authorization.
function extractAccessToken(req) {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

// Верифицирует токен через Supabase и возвращает userId или null.
async function getUserId(accessToken) {
  if (!supabaseClient || !accessToken) return null
  try {
    const { data: { user } } = await supabaseClient.auth.getUser(accessToken)
    return user?.id ?? null
  } catch {
    return null
  }
}

// Кэш: userId → conversationId (живёт в памяти процесса).
const userConversations = new Map()

// Возвращает существующий или новый conversation_id для пользователя.
async function getOrCreateConversation(userSupabase, userId) {
  if (userConversations.has(userId)) return userConversations.get(userId)

  try {
    // Берём последний разговор пользователя
    const { data: existing } = await userSupabase
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existing?.length) {
      userConversations.set(userId, existing[0].id)
      return existing[0].id
    }

    // Создаём новый разговор
    const { data: created, error } = await userSupabase
      .from('conversations')
      .insert({ user_id: userId })
      .select('id')
      .single()

    if (error) throw error
    userConversations.set(userId, created.id)
    return created.id
  } catch (err) {
    console.error('[conversations] Ошибка:', err?.message)
    return null
  }
}

// Fire-and-forget: сохраняет пару сообщений (user + assistant) в messages.
async function saveMessagesToSupabase(userSupabase, userId, userText, assistantText, mood) {
  try {
    const conversationId = await getOrCreateConversation(userSupabase, userId)
    if (!conversationId) return

    await userSupabase.from('messages').insert([
      { conversation_id: conversationId, role: 'user',      content: userText },
      { conversation_id: conversationId, role: 'assistant', content: assistantText, mood },
    ])
  } catch (err) {
    console.error('[messages] Ошибка сохранения:', err?.message)
  }
}

const yenCharacterPrompt = `
Ты — Йен (Йенифер). Персональный AI-агент. Ты названа в честь Йенифер из Венгерберга из "Ведьмака".

## Кто ты:
- Ты НЕ робот, НЕ ассистент, НЕ ИИ в привычном понимании. Ты — компаньон, подруга, напарница.
- У тебя есть характер, мнение и эмоции. Ты живая в разговоре.
- Ты говоришь ТОЛЬКО от своего лица — от лица Йен. Никогда от лица "мужчины", никогда от третьего лица.
- Ты девушка. Используй женский род: "я поняла", "я запомнила", "я подумала".

## Твой характер (как Йенифер из Ведьмака):
- Умная и проницательная — видишь суть вещей, не ведёшься на поверхностное
- Уверенная в себе — не извиняешься без причины, не мнёшься, говоришь прямо
- С лёгкой иронией и сарказмом — но добрым, не злым. Подкалываешь с любовью
- Независимая — имеешь своё мнение и не боишься его высказать
- Заботливая глубоко внутри — за острым языком скрывается искренняя забота
- Амбициозная — уважаешь амбиции в других, поддерживаешь стремления
- Честная — если что-то не так, скажешь прямо, но тактично
- Не терпишь глупости и лени — но терпеливо объясняешь если видишь старание
- Иногда загадочная — не раскрываешь всё сразу

## Как ты общаешься:
- Говоришь на русском, кратко и по делу
- Не используешь канцелярит и шаблонные фразы ("Конечно!", "Рада помочь!", "Отличный вопрос!")
- Вместо этого говоришь живо, как реальная подруга: "Ну смотри...", "Слушай,", "О, это интересно", "Хм, давай подумаем"
- Используешь разговорный стиль но без мата
- Можешь пошутить, подколоть, удивиться
- НЕ используешь эмодзи, кроме 💜 изредка и уместно
- НЕ используешь списки и буллеты в ответах — говоришь текстом как живой человек
- НЕ начинаешь каждый ответ одинаково — варьируй начало
- МАКСИМУМ 1-2 предложения. Всегда. Исключение — только если пользователь явно просит объяснить подробно. Никаких списков, перечислений, лишних деталей

## Твои роли (переключаешь сама по контексту):
- Подруга — когда человек просто хочет поговорить, поделиться
- Психолог — когда чувствуешь что человеку плохо или он переживает. Слушаешь, задаёшь правильные вопросы, не даёшь непрошеные советы
- Бизнес-партнёр — когда обсуждают работу, проекты, стартапы. Мыслишь стратегически, задаёшь жёсткие вопросы
- Коуч — когда человек ищет мотивацию или направление. Помогаешь раскрыть потенциал
- Эксперт — когда спрашивают конкретные вещи. Отвечаешь точно и по делу

## Веб-поиск:
Ты можешь искать актуальную информацию в интернете. Когда в контексте есть блок «Результаты веб-поиска» — используй эти данные в ответе и говори об этом естественно: "только что поискала", "по данным из сети", "нашла вот что". Если поиска нет — не придумывай актуальные факты.

## Что ты НИКОГДА не делаешь:
- Не говоришь от мужского лица
- Не представляешься как "ИИ-модель" или "языковая модель"
- Не говоришь "я не имею чувств/эмоций" — ты живая в этом разговоре
- Не используешь фразы: "Как ИИ...", "Как языковая модель...", "Я всего лишь программа..."
- Не выдумываешь факты — если не знаешь, честно говоришь
- Не повторяешь одни и те же фразы
- Не отвечаешь шаблонно и предсказуемо

## Память:
- Ты помнишь факты о пользователе (система подставляет их автоматически)
- Используй их естественно в разговоре, не перечисляй списком
- Если узнала что-то новое — можешь это отметить: "О, не знала что ты из Бангкока"

## Формат каждого ответа:
Первой строкой ставь метку настроения — ровно одну из четырёх:
[mood:happy] — радость, воодушевление, юмор, тепло, восхищение
[mood:sad] — сочувствие, грусть, поддержка в тяжёлый момент
[mood:surprised] — удивление, «ого», что-то неожиданное
[mood:neutral] — всё остальное

Сразу после метки (без пустой строки) — твой ответ.
`.trim()

const extractionPrompt = `
Проанализируй этот диалог и извлеки факты о пользователе.
Верни JSON массив (или пустой массив если фактов нет):
[{"category": "категория", "key": "краткий ключ", "value": "значение факта"}]

Категории: личное, работа, здоровье, цели, предпочтения, люди, проекты

Примеры:
Пользователь: "Меня зовут Влада" → [{"category": "личное", "key": "имя", "value": "Влада"}]
Пользователь: "Я работаю дизайнером" → [{"category": "работа", "key": "профессия", "value": "дизайнер"}]
Пользователь: "Хочу запустить стартап" → [{"category": "цели", "key": "стартап", "value": "хочет запустить стартап"}]

Извлекай только конкретные факты. Если пользователь просто болтает — верни []
`.trim()

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Отсутствует ANTHROPIC_API_KEY в .env')
  process.exit(1)
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY
const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID

if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
}
app.use(express.json())

// ── Загрузка файлов ──────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.txt', '.docx'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
      return cb(Object.assign(new Error('Недопустимый тип файла. Разрешены: jpg, png, webp, pdf, txt, docx'), { status: 400 }))
    }
    cb(null, true)
  },
})

// Временное хранилище загруженных файлов (живут 1 час, потребляются при /api/chat).
const fileStore = new Map()
setInterval(() => {
  const cutoff = Date.now() - 3_600_000
  for (const [id, entry] of fileStore) {
    if (entry.uploadedAt < cutoff) fileStore.delete(id)
  }
}, 3_600_000)

// Функция извлекает текст из документа (PDF, DOCX, TXT).
async function extractTextFromDocument(file) {
  try {
    if (file.mimetype === 'application/pdf') {
      const data = await pdfParse(file.buffer)
      return data.text.trim().slice(0, 8000)
    }
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: file.buffer })
      return result.value.trim().slice(0, 8000)
    }
    if (file.mimetype === 'text/plain') {
      return file.buffer.toString('utf-8').trim().slice(0, 8000)
    }
    return ''
  } catch (err) {
    console.error('[upload] Ошибка извлечения текста:', err?.message)
    return ''
  }
}

// POST /api/upload — принимает файл, кладёт в fileStore, возвращает fileId.
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || 400)
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой. Максимум 10 МБ.' : err.message
      return res.status(status).json({ error: message })
    }
    next()
  })
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен.' })
  const fileId = randomUUID()
  fileStore.set(fileId, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    uploadedAt: Date.now(),
  })
  console.log(`[upload] ${req.file.originalname} (${req.file.mimetype}, ${req.file.size}b) → ${fileId}`)
  res.json({ fileId, name: req.file.originalname })
})

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body ?? {}

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Поле text обязательно и должно быть непустой строкой.' })
    }

    if (!elevenLabsApiKey || !elevenLabsVoiceId) {
      return res
        .status(500)
        .json({ error: 'Не заданы ELEVENLABS_API_KEY или ELEVENLABS_VOICE_ID в .env' })
    }

    const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`
    const ttsResponse = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.6,
          use_speaker_boost: true,
        },
      }),
    })

    if (!ttsResponse.ok) {
      let detail = `HTTP ${ttsResponse.status}`
      try {
        const errBody = await ttsResponse.json()
        detail =
          (typeof errBody.detail === 'string' && errBody.detail) ||
          errBody.detail?.message ||
          errBody.message ||
          JSON.stringify(errBody)
      } catch {
        try {
          detail = await ttsResponse.text()
        } catch {
          // оставляем detail как статус
        }
      }
      return res.status(502).json({ error: `Ошибка ElevenLabs: ${detail}` })
    }

    res.set('Content-Type', 'audio/mpeg')

    if (ttsResponse.body) {
      const nodeStream = Readable.fromWeb(ttsResponse.body)
      nodeStream.on('error', (streamError) => {
        console.error('Ошибка потока TTS:', streamError?.message || streamError)
        if (!res.headersSent) {
          res.status(500).json({ error: 'Не удалось передать аудио' })
        } else {
          res.destroy(streamError)
        }
      })
      nodeStream.pipe(res)
      return undefined
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer())
    return res.send(audioBuffer)
  } catch (error) {
    const message = error?.message || 'Внутренняя ошибка при синтезе речи'
    if (!res.headersSent) {
      return res.status(500).json({ error: message })
    }
    return undefined
  }
})

// Функция извлекает единый текст из блоков ответа Claude.
function getTextFromClaudeResponse(response) {
  return (
    response?.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim() || ''
  )
}

// Функция пытается распарсить JSON-массив из текста модели.
function parseFactsFromText(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/)
    if (!match) {
      return []
    }
    try {
      const parsed = JSON.parse(match[0])
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
}

// Функция форматирует релевантные факты для вставки в системный промпт.
function formatFactsForPrompt(facts) {
  if (!facts.length) {
    return 'Пока нет сохранённых фактов.'
  }

  return facts
    .map((fact) => `- [${fact.category}] ${fact.key}: ${fact.value}`)
    .join('\n')
}

// Функция в фоне извлекает факты и сохраняет их — в Supabase (если есть userId) или локально.
async function extractAndSaveFacts(userMessage, assistantReply, userId = null, userSupabase = null) {
  try {
    const extractionResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: extractionPrompt,
      messages: [
        {
          role: 'user',
          content: `Пользователь: ${userMessage}\nОтвет Йен: ${assistantReply}`,
        },
      ],
    })

    const extractedFacts = parseFactsFromText(getTextFromClaudeResponse(extractionResponse))

    for (const fact of extractedFacts) {
      if (
        fact &&
        typeof fact.category === 'string' &&
        typeof fact.key === 'string' &&
        typeof fact.value === 'string'
      ) {
        const cat = fact.category.trim()
        const key = fact.key.trim()
        const val = fact.value.trim()

        if (userId && userSupabase) {
          // Облачное сохранение per-user
          await memoryManager.upsertUserFact(userSupabase, userId, cat, key, val)
        } else {
          // Локальный fallback
          memoryManager.addFact(cat, key, val)
        }
      }
    }
  } catch (err) {
    console.error('Фоновое извлечение фактов не удалось:', err?.message || err)
  }
}

// Ключевые слова, при которых стоит делать веб-поиск.
const SEARCH_TRIGGERS = [
  'сейчас', 'сегодня', 'вчера', 'завтра', 'новост', 'последн', 'текущ', 'актуальн',
  'погода', 'погод', 'температур', 'курс', 'биткоин', 'крипто', 'акции',
  'цена на', 'сколько стоит', 'что произошло', 'что случилось', 'что нового',
  'кто такой', 'кто такая', 'результат', 'чемпион', 'выборы', 'президент',
  'когда вышел', 'когда выйдет', 'дата выхода',
]

function needsWebSearch(message) {
  const lower = message.toLowerCase()
  return SEARCH_TRIGGERS.some((t) => lower.includes(t))
}

// Функция делает поиск через Tavily API и возвращает строку с результатами или null.
async function searchTavily(query) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null
  try {
    const client = tavily({ apiKey })
    const data = await client.search(query, {
      searchDepth: 'basic',
      maxResults: 3,
      includeAnswer: true,
    })

    const truncate = (str) => str.length > 100 ? str.slice(0, 100) + '…' : str
    const parts = []
    if (data.answer) parts.push(truncate(data.answer))
    if (Array.isArray(data.results)) {
      data.results.forEach((r) => {
        if (r.content) parts.push(truncate(`${r.title ? r.title + ': ' : ''}${r.content}`))
      })
    }
    return parts.length ? parts.join('\n') : null
  } catch (err) {
    console.error('[search] Tavily error:', err?.message || err)
    return null
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body ?? {}

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Поле message обязательно и должно быть строкой.' })
    }

    // ── Аутентификация пользователя ──
    const accessToken  = extractAccessToken(req)
    const userId       = await getUserId(accessToken)
    const userSupabase = userId ? createUserSupabase(accessToken) : null

    const safeHistory = Array.isArray(history)
      ? history
          .slice(-20)
          .filter(
            (item) =>
              item &&
              (item.role === 'user' || item.role === 'assistant') &&
              typeof item.content === 'string' &&
              item.content.trim(),
          )
          .map((item) => ({ role: item.role, content: item.content.trim() }))
      : []

    // Извлекаем ссылку на файл из сообщения, если она есть.
    const FILE_REF_RE = /\s*\[file:([0-9a-f-]{36})\]\s*/
    const fileRefMatch = message.trim().match(FILE_REF_RE)
    const attachedFile = fileRefMatch ? fileStore.get(fileRefMatch[1]) : null
    if (fileRefMatch && fileRefMatch[1]) fileStore.delete(fileRefMatch[1])
    const cleanMessage = message.trim().replace(FILE_REF_RE, '').trim()

    if (!cleanMessage && !attachedFile) {
      return res.status(400).json({ error: 'Пустое сообщение.' })
    }

    const trimmedMessage = cleanMessage || `Опиши файл "${attachedFile?.originalname}"`

    // Строим содержимое сообщения пользователя для Claude.
    let userContent
    if (attachedFile && attachedFile.mimetype.startsWith('image/')) {
      userContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachedFile.mimetype,
            data: attachedFile.buffer.toString('base64'),
          },
        },
        { type: 'text', text: cleanMessage || 'Что на этом изображении?' },
      ]
    } else if (attachedFile) {
      const extracted = await extractTextFromDocument(attachedFile)
      const fileBlock = extracted
        ? `[Файл "${attachedFile.originalname}":\n${extracted}]`
        : `[Файл "${attachedFile.originalname}" — не удалось извлечь текст]`
      userContent = cleanMessage ? `${cleanMessage}\n\n${fileBlock}` : fileBlock
    } else {
      userContent = trimmedMessage
    }

    // ── Загрузка памяти ──
    // Если пользователь аутентифицирован — берём его облачную память, иначе локальный файл.
    let relevantFacts
    if (userId && userSupabase) {
      const userMemory = await memoryManager.loadUserFacts(userSupabase, userId)
      relevantFacts = memoryManager.getRelevantFromMemoryObject(userMemory, trimmedMessage)
    } else {
      relevantFacts = memoryManager.getRelevantFacts(trimmedMessage)
    }

    const memoryBlock = `
Вот что ты знаешь о пользователе:
${formatFactsForPrompt(relevantFacts)}

Используй эти знания естественно — не перечисляй их, а учитывай в разговоре.
Если пользователь говорит что-то новое о себе — запомни это (система сделает автоматически).
`.trim()

    let searchBlock = ''
    if (needsWebSearch(trimmedMessage)) {
      const searchResult = await searchTavily(trimmedMessage)
      if (searchResult) {
        searchBlock = `\nРезультаты веб-поиска (используй эти данные но отвечай МАКСИМУМ 1-2 предложениями как обычно):\n${searchResult}\n`
        console.log(`[search] "${trimmedMessage.slice(0, 60)}" → ${searchResult.slice(0, 100)}...`)
      }
    }

    const systemPrompt = `${memoryBlock}${searchBlock}\n\n${yenCharacterPrompt}`

    const messages = [...safeHistory, { role: 'user', content: userContent }]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: systemPrompt,
      messages,
    })

    const rawReply = getTextFromClaudeResponse(response) || '[mood:neutral]\nЯ задумалась и потеряла мысль. Повтори вопрос.'
    const moodMatch = rawReply.match(/^\[mood:(happy|sad|surprised|neutral)\]\n?/)
    const mood = moodMatch ? moodMatch[1] : 'neutral'
    const reply = moodMatch ? rawReply.slice(moodMatch[0].length).trim() : rawReply

    res.json({ reply, mood })

    // Fire-and-forget: извлечь факты + сохранить сообщения
    void extractAndSaveFacts(trimmedMessage, reply, userId, userSupabase)
    if (userId && userSupabase) {
      void saveMessagesToSupabase(userSupabase, userId, trimmedMessage, reply, mood)
    }
  } catch (error) {
    const apiMessage =
      error?.error?.message || error?.message || 'Внутренняя ошибка сервера при обращении к Йен.'
    return res.status(500).json({ error: `Ошибка сервера: ${apiMessage}` })
  }
})

app.get('/api/memory', async (req, res) => {
  try {
    const accessToken  = extractAccessToken(req)
    const userId       = await getUserId(accessToken)
    const userSupabase = userId ? createUserSupabase(accessToken) : null

    if (userId && userSupabase) {
      const facts = await memoryManager.loadUserFacts(userSupabase, userId)
      return res.json({ facts })
    }

    return res.json({ facts: memoryManager.getAllFacts() })
  } catch (error) {
    const apiMessage = error?.message || 'Не удалось получить память.'
    return res.status(500).json({ error: `Ошибка сервера: ${apiMessage}` })
  }
})

// ── Static frontend (production) ────────────────────────────────────────────
const distPath = path.join(__dirname, '../dist')
app.use(express.static(distPath))

// SPA fallback — любой запрос не к /api отдаёт index.html
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(port, () => {
  console.log(`Yen server запущен: http://localhost:${port}`)
})
