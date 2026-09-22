import { json, readBody } from "./_lib.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(res, 503, { error: "not_granted", detail: "GEMINI_API_KEY ausente" });

  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).replace(/^models\//, "");
  const { prompt, images } = await readBody(req);
  if (typeof prompt !== "string" || !prompt.trim()) return json(res, 400, { error: "bad_prompt" });

  const parts = [{ text: prompt }];
  if (Array.isArray(images)) {
    for (const im of images.slice(0, 4)) {
      const mimeType = String(im?.mimeType || "");
      const data = String(im?.data || "");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType) || !data) continue;
      if (data.length > 7_000_000) continue; // ~5 MB por imagem
      parts.push({ inlineData: { mimeType, data } });
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    const raw = await r.text();
    if (!r.ok) return json(res, 502, { error: "gemini_error", status: r.status, detail: raw.slice(0, 600) });

    let payload;
    try { payload = JSON.parse(raw); } catch { return json(res, 502, { error: "gemini_bad_json" }); }

    const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let data;
    try { data = JSON.parse(cleaned); }
    catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) return json(res, 502, { error: "gemini_not_json", detail: cleaned.slice(0, 400) });
      data = JSON.parse(m[0]);
    }
    return json(res, 200, { data, model });
  } catch (e) {
    return json(res, 500, { error: "server_error", detail: String(e?.message || e) });
  }
}
