export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Sadece GET/POST' })
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY Vercel Environment Variables içinde tanımlı değil' })
    }

    const voice = process.env.GEMINI_TTS_VOICE || 'Kore'
    const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live'
    const now = Date.now()

    const payload = {
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: `models/${model}`,
        config: {
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      }
    }

    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload)
    })

    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return res.status(502).json({ ok: false, error: `Live token ${r.status}: ${t.slice(0, 500)}` })
    }

    const j = await r.json()
    if (!j.name) {
      return res.status(502).json({ ok: false, error: 'Gemini Live token döndürmedi' })
    }

    return res.status(200).json({
      ok: true,
      token: j.name,
      model,
      expiresAt: j.expireTime || null
    })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Bilinmeyen hata' })
  }
}
