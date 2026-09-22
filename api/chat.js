import { json, readBody } from "./_lib.js";

const HOOK = process.env.N8N_WEBHOOK_URL || "https://n8n.nexenergy.com.br/webhook/nex-energy-notifier";
const SPACE_ID = (process.env.CHAT_SPACE_ID || "AAQA9QP00wo").replace(/^spaces\//, "");
const MENTION = process.env.CHAT_MENTION || "wilson.freitas@nexenergy.com.br";

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(iso || ""); }
};
const fmtNum = (n) => (n == null || isNaN(n) ? null : Number(n).toFixed(1).replace(".", ","));

function shortSummary(text, max = 5) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?]+[.!?]?/g) || [t];
  return parts.slice(0, max).map((s) => s.trim()).join(" ").trim();
}

async function send(text) {
  const r = await fetch(HOOK, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.N8N_WEBHOOK_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId: `spaces/${SPACE_ID}`, text }),
  });
  const body = (await r.text()).slice(0, 500);
  return { ok: r.ok, status: r.status, body };
}

export default async function handler(req, res) {
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!token) return json(res, 503, { error: "not_configured", detail: "N8N_WEBHOOK_TOKEN ausente" });

  // GET /api/chat?test=1 → dispara uma mensagem de teste e devolve a resposta crua do webhook.
  if (req.method === "GET") {
    if (String(req.query?.test || "") !== "1") {
      return json(res, 200, { hook: HOOK, spaceId: `spaces/${SPACE_ID}`, mention: MENTION, hint: "use ?test=1 para enviar uma mensagem de teste" });
    }
    const r = await send(`*Context Hub — teste de integração*\nSe você está vendo esta mensagem, o webhook está funcionando.\nResponsável: {{mention:${MENTION}}}`);
    return json(res, r.ok ? 200 : 502, { sent: r.ok, status: r.status, webhookResponse: r.body, hook: HOOK, spaceId: `spaces/${SPACE_ID}` });
  }

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const b = await readBody(req);
  const title = String(b.title || "Context Hub").slice(0, 200);
  const description = String(b.description || "").trim();
  const respondent = String(b.respondent || "não informado").slice(0, 120);
  const email = String(b.email || "").slice(0, 160);
  const area = String(b.area || "").slice(0, 120);
  const when = fmtDate(b.finishedAt);
  const score = fmtNum(b.score);
  const min = fmtNum(b.minScore);
  const verdict = b.score != null && b.minScore != null ? (b.score >= b.minScore ? "apto a seguir" : "não segue") : null;
  const summary = shortSummary(b.summary);

  const text = [
    `*${title}*`,
    description || null,
    "",
    `Respondido por: ${respondent}${area ? " — " + area : ""}`,
    email ? `E-mail: ${email}` : null,
    `Data da resposta: ${when}`,
    score ? `Nota geral: ${score}/10${min ? ` (mínimo ${min})` : ""}${verdict ? ` — ${verdict}` : ""}` : null,
    "",
    summary || null,
    b.folderUrl ? `\n<${b.folderUrl}|Pasta com o markdown e os anexos>` : null,
    `Responsável: {{mention:${MENTION}}}`,
  ].filter((l) => l !== null).join("\n").slice(0, 3800);

  try {
    const r = await send(text);
    if (!r.ok) return json(res, 502, { error: "webhook_error", status: r.status, webhookResponse: r.body, hook: HOOK, spaceId: `spaces/${SPACE_ID}` });
    return json(res, 200, { ok: true, spaceId: `spaces/${SPACE_ID}`, chars: text.length });
  } catch (e) {
    return json(res, 502, { error: "webhook_error", detail: String(e?.message || e), hook: HOOK });
  }
}
