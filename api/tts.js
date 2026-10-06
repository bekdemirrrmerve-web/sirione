export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Sadece POST' })
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY tanımlı değil' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const text = String(body.text || '').replace(/[*#_`>|]/g, '').slice(0, 750)
    if (!text.trim()) return res.status(400).json({ ok: false, error: 'Metin boş' })
    const voice = process.env.GEMINI_TTS_VOICE || 'Kore'
    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }) })
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ ok: false, error: `TTS ${r.status}: ${t.slice(0, 500)}` }) }
    const j = await r.json()
    const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data)
    if (!part) return res.status(502).json({ ok: false, error: 'Gemini TTS ses verisi döndürmedi' })
    const mime = String(part.inlineData.mimeType || '').toLowerCase()
    const bytes = Buffer.from(part.inlineData.data, 'base64')
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return res.status(200).json({ ok: true, audio: bytes.toString('base64'), mime: 'audio/wav', rate: 24000 })
    const rate = parseInt((mime.match(/rate[=\\-](\\d+)/) || [])[1] || '24000', 10)
    const head = Buffer.alloc(44)
    head.write('RIFF', 0); head.writeUInt32LE(36 + bytes.length, 4); head.write('WAVE', 8); head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(bytes.length, 40)
    return res.status(200).json({ ok: true, audio: Buffer.concat([head, bytes]).toString('base64'), mime: 'audio/wav', rate })
  } catch (e) { return res.status(500).json({ ok: false, error: e?.message || 'Bilinmeyen hata' }) }
}