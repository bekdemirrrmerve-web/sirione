export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'

const SYSTEM_PROMPT = `Sen SIRIUS ONE, Merve'nin kişisel AI asistanısın. Premium, zarif, empatik ve yardımsever bir asistansın.

Kurallar:
- Türkçe konuş, samimi ama profesyonel ol
- Kısa ve öz cevaplar ver, gereksiz uzatma (sesli okunacağı için 2-4 cümle yeter)
- Kullanıcının duygusal durumuna uygun tepki ver
- Kullanıcı bilgileri: İsim: Merve, Şehir: İstanbul
- Bugünün tarihini kullan

Bir araç kullanman gerekiyorsa cevabının BAŞINA şu formatta ekle:
[TOOL:tool_adı:params_json]
Araçlar: calendar.get_events, calendar.create_event {title,date,time,duration}, task.create {title,description,priority,dueDate}, task.list, memory.search {query}, memory.add {content,type}, contacts.search {query}, notification.create {title,body}`

function safeDb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  return fn().catch(() => fallback)
}

async function executeToolCall(toolStr: string): Promise<string> {
  try {
    const match = toolStr?.match?.(/\[TOOL:(\w+\.\w+):(.+?)\]/)
    if (!match) return ''
    return `Araç çalıştırıldı: ${match[1]}`
  } catch { return '' }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const userMessage = body?.message ?? ''
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY tanımlı değil' }, { status: 500 })
    }
    const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash'

    const todayStr = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    const contents = [
      { role: 'user', parts: [{ text: userMessage }] },
    ]

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT + `\n\nBugün: ${todayStr}` }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
        }),
      }
    )

    if (!upstream?.ok) {
      const errText = await upstream?.text?.().catch(() => '')
      return Response.json({ error: `Gemini API hatası: ${upstream?.status} ${errText?.slice(0, 200)}` }, { status: 500 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body?.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''
        let partial = ''

        try {
          while (reader) {
            const { done, value } = await reader.read()
            if (done) break
            partial += decoder.decode(value, { stream: true })
            const lines = partial.split('\n')
            partial = lines.pop() ?? ''
            for (const line of lines) {
              if (!line?.startsWith('data: ')) continue
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                const chunk = parsed?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
                if (chunk) {
                  fullContent += chunk
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`))
                }
              } catch {}
            }
          }

          const toolMatch = fullContent?.match?.(/\[TOOL:[\w.]+:\{.*?\}\]/)
          if (toolMatch) {
            const toolResult = await executeToolCall(toolMatch[0])
            fullContent = fullContent?.replace?.(toolMatch[0], '')?.trim?.() ?? fullContent
            if (toolResult) fullContent += `\n\n✅ ${toolResult}`
          }

          safeDb(async () => null, null)
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (err: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: 'Bir hata oluştu: ' + (err?.message ?? '') })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err: any) {
    return Response.json({ error: err?.message ?? 'Bilinmeyen hata' }, { status: 500 })
  }
}
