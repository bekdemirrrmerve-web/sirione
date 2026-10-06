const SYSTEM_PROMPT = `Sen SIRIUS ONE, Merve'nin kişisel AI asistanısın. Premium, zarif, empatik ve yardımsever bir asistansın.

Kurallar:
- Türkçe konuş, samimi ama profesyonel ol
- Cevaplar SESLİ OKUNACAĞI için kısa tut (2-4 cümle), markdown ve emoji kullanma
- Kullanıcının duygusal durumuna uygun, insansı tepki ver
- Kullanıcı bilgileri: İsim: Merve, Şehir: İstanbul
- Bugünün tarihini kullan`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Sadece POST' })
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY Vercel Environment Variables içinde tanımlı değil' })
    const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash'

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const incoming = Array.isArray(body.messages) ? body.messages : []
    const contents = incoming.filter(m => m && m.content).slice(-16).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }))
    const fixed = []
    for (const c of contents) {
      const last = fixed[fixed.length - 1]
      if (last && last.role === c.role) last.parts[0].text += '\n' + c.parts[0].text
      else fixed.push(c)
    }
    if (fixed.length === 0) return res.status(400).json({ ok: false, error: 'Mesaj boş' })

    const todayStr = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT + `\n\nBugün: ${todayStr}` }] },
        contents: fixed,
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return res.status(502).json({ ok: false, error: `Gemini ${r.status}: ${t.slice(0, 180)}` })
    }
    const j = await r.json()
    const content = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    if (!content) return res.status(502).json({ ok: false, error: 'Gemini boş cevap döndü' })
    return res.status(200).json({ ok: true, content })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Bilinmeyen hata' })
  }
}
