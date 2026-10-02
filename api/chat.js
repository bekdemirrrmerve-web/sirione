export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Sadece POST destekleniyor." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "GEMINI_API_KEY Vercel Environment Variables içinde tanımlı değil."
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    const contents = rawMessages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-16)
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 12000) }]
      }));

    if (!contents.length) {
      return res.status(400).json({ ok: false, error: "Mesaj bulunamadı." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text:
              "Sen SIRIUS ONE adlı Türkçe kişisel yapay zeka asistanısın. " +
              "Doğal, sıcak, kısa ama faydalı konuş. Kullanıcı Türkçe konuşuyorsa Türkçe cevap ver. " +
              "Bilmediğin kişisel bilgileri uydurma. Bir cihaz işlemini gerçekten yapmadıysan yaptığını söyleme."
          }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 900
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message ||
        `Gemini API hatası (HTTP ${response.status})`;
      return res.status(response.status).json({ ok: false, error: message });
    }

    const text = (data?.candidates || [])
      .flatMap(c => c?.content?.parts || [])
      .map(p => typeof p?.text === "string" ? p.text : "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) {
      return res.status(502).json({
        ok: false,
        error: "Gemini boş yanıt döndürdü."
      });
    }

    return res.status(200).json({
      ok: true,
      content: text,
      model
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Sunucu hatası"
    });
  }
}
