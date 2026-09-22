import { json, readBody } from "./_lib.js";

const HOOK = process.env.N8N_WEBHOOK_URL || "https://n8n.nexenergy.com.br/webhook/nex-energy-notifier";
const SPACE_ID = process.env.CHAT_SPACE_ID || "AAQA9QP00wo";
const MAX_TEXT = 3900; // limite prático de uma mensagem do Google Chat

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(iso || ""); }
};
const fmtNum = (n) => (n == null || isNaN(n) ? null : Number(n).toFixed(1).replace(".", ","));

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!token) return json(res, 503, { error: "not_configured", detail: "N8N_WEBHOOK_TOKEN ausente" });

  const body = await readBody(req);
  const markdown = String(body.markdown || "");
  if (!markdown.trim()) return json(res, 400, { error: "bad_body" });

  const title = String(body.title || "Discovery Hub").slice(0, 200);
  const respondent = String(body.respondent || "não informado").slice(0, 120);
  const when = fmtDate(body.finishedAt || new Date().toISOString());
  const score = fmtNum(body.score);
  const min = fmtNum(body.minScore);
  const verdict = body.score != null && body.minScore != null
    ? (body.score >= body.minScore ? "apto a seguir" : "não segue")
    : null;

  const header = [
    `*${title}*`,
    `Respondido por: ${respondent}`,
    `Data: ${when}`,
    score ? `Nota geral: ${score}/10${min ? ` (mínimo ${min})` : ""}${verdict ? ` — ${verdict}` : ""}` : null,
    "",
  ].filter((l) => l !== null).join("\n");

  const room = MAX_TEXT - header.length - 40;
  let doc = markdown;
  let truncated = false;
  if (doc.length > room) { doc = doc.slice(0, room); truncated = true; }

  const text = header + "```\n" + doc + (truncated ? "\n…(truncado — veja o markdown completo no e-mail)" : "") + "\n```";

  try {
    const r = await fetch(HOOK, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId: `spaces/${SPACE_ID}`, text }),
    });
    const raw = (await r.text()).slice(0, 400);
    if (!r.ok) return json(res, 502, { error: "webhook_error", status: r.status, detail: raw });
    return json(res, 200, { ok: true, spaceId: `spaces/${SPACE_ID}`, truncated });
  } catch (e) {
    return json(res, 500, { error: "server_error", detail: String(e?.message || e) });
  }
}
