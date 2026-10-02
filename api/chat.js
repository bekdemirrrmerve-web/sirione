export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Sadece POST destekleniyor." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "OPENAI_API_KEY Vercel Environment Variables içinde tanımlı değil."
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    const messages = rawMessages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-16)
      .map(m => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content.slice(0, 12000) }]
      }));

    if (!messages.length) {
      return res.status(400).json({ ok: false, error: "Mesaj bulunamadı." });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        instructions:
          "Sen SIRIUS ONE adlı Türkçe kişisel yapay zeka asistanısın. " +
          "Doğal, sıcak, kısa ama faydalı konuş. Kullanıcı Türkçe konuşuyorsa Türkçe cevap ver. " +
          "Bilmediğin kişisel bilgileri uydurma. Bir cihaz işlemini gerçekten yapmadıysan yaptığını söyleme.",
        input: messages,
        max_output_tokens: 900
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `OpenAI API hatası (HTTP ${response.status})`;
      return res.status(response.status).json({ ok: false, error: message });
    }

    const text = Array.isArray(data.output)
      ? data.output
          .flatMap(item => Array.isArray(item.content) ? item.content : [])
          .filter(part => part && part.type === "output_text" && typeof part.text === "string")
          .map(part => part.text)
          .join("\n")
          .trim()
      : "";

    if (!text) {
      return res.status(502).json({ ok: false, error: "Model boş yanıt döndürdü." });
    }

    return res.status(200).json({
      ok: true,
      content: text,
      model: data.model || process.env.OPENAI_MODEL || "gpt-6-luna"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Sunucu hatası"
    });
  }
}
