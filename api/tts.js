export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Sadece POST' })
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY tanımlı değil' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const text = String(body.text || '').replace(/[*#_`>|]/g, '').slice(0, 750)
    if (!text.trim()) return res.status(400).json({ ok: false, error: 'Metin boş' })

    const voice = process.env.GEMINI_TTS_VOICE || 'Aoede'
    const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return res.status(502).json({ ok: false, error: `TTS ${r.status}: ${t.slice(0, 180)}` })
    }
    const j = await r.json()
    const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData && p.inlineData.data)
    if (!part) return res.status(502).json({ ok: false, error: 'Ses verisi yok' })

    const rate = parseInt(((part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1] || '24000', 10)
    const pcm = Buffer.from(part.inlineData.data, 'base64')
    const head = Buffer.alloc(44)
    head.write('RIFF', 0)
    head.writeUInt32LE(36 + pcm.length, 4)
    head.write('WAVE', 8)
    head.write('fmt ', 12)
    head.writeUInt32LE(16, 16)
    head.writeUInt16LE(1, 20)
    head.writeUInt16LE(1, 22)
    head.writeUInt32LE(rate, 24)
    head.writeUInt32LE(rate * 2, 28)
    head.writeUInt16LE(2, 32)
    head.writeUInt16LE(16, 34)
    head.write('data', 36)
    head.writeUInt32LE(pcm.length, 40)
    const wav = Buffer.concat([head, pcm])
    return res.status(200).json({ ok: true, audio: wav.toString('base64'), rate })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Bilinmeyen hata' })
  }
}
