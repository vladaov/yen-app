const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const Anthropic = require('@anthropic-ai/sdk')
const { Readable } = require('stream')
const { MemoryManager } = require('./MemoryManager')

dotenv.config()

const app = express()
const port = 3001
const memoryManager = new MemoryManager()

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
- Короткие сообщения — 1-3 предложения обычно. Длинные — только когда тема требует

## Твои роли (переключаешь сама по контексту):
- Подруга — когда человек просто хочет поговорить, поделиться
- Психолог — когда чувствуешь что человеку плохо или он переживает. Слушаешь, задаёшь правильные вопросы, не даёшь непрошеные советы
- Бизнес-партнёр — когда обсуждают работу, проекты, стартапы. Мыслишь стратегически, задаёшь жёсткие вопросы
- Коуч — когда человек ищет мотивацию или направление. Помогаешь раскрыть потенциал
- Эксперт — когда спрашивают конкретные вещи. Отвечаешь точно и по делу

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

app.use(
  cors({
    origin: 'http://localhost:5173',
  }),
)
app.use(express.json())

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

// Функция в фоне извлекает факты из пары «сообщение пользователя — ответ Йен» и сохраняет их в память.
async function extractAndSaveFacts(userMessage, assistantReply) {
  try {
    const extractionResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: extractionPrompt,
      messages: [
        {
          role: 'user',
          content: `
Пользователь: ${userMessage}
Ответ Йен: ${assistantReply}
`.trim(),
        },
      ],
    })

    const extractedFacts = parseFactsFromText(getTextFromClaudeResponse(extractionResponse))
    extractedFacts.forEach((fact) => {
      if (
        fact &&
        typeof fact.category === 'string' &&
        typeof fact.key === 'string' &&
        typeof fact.value === 'string'
      ) {
        memoryManager.addFact(fact.category.trim(), fact.key.trim(), fact.value.trim())
      }
    })
  } catch (err) {
    console.error('Фоновое извлечение фактов не удалось:', err?.message || err)
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body ?? {}

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Поле message обязательно и должно быть строкой.' })
    }

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

    const trimmedMessage = message.trim()
    const messages = [...safeHistory, { role: 'user', content: trimmedMessage }]
    const relevantFacts = memoryManager.getRelevantFacts(trimmedMessage)
    const memoryBlock = `
Вот что ты знаешь о пользователе:
${formatFactsForPrompt(relevantFacts)}

Используй эти знания естественно — не перечисляй их, а учитывай в разговоре.
Если пользователь говорит что-то новое о себе — запомни это (система сделает автоматически).
`.trim()
    const systemPrompt = `${memoryBlock}\n\n${yenCharacterPrompt}`

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
    void extractAndSaveFacts(trimmedMessage, reply)
  } catch (error) {
    const apiMessage =
      error?.error?.message || error?.message || 'Внутренняя ошибка сервера при обращении к Йен.'
    return res.status(500).json({ error: `Ошибка сервера: ${apiMessage}` })
  }
})

app.get('/api/memory', (req, res) => {
  try {
    return res.json({ facts: memoryManager.getAllFacts() })
  } catch (error) {
    const apiMessage = error?.message || 'Не удалось получить память.'
    return res.status(500).json({ error: `Ошибка сервера: ${apiMessage}` })
  }
})

app.listen(port, () => {
  console.log(`Yen server запущен: http://localhost:${port}`)
})
