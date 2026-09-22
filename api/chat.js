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

/* Canal preferencial: webhook de entrada do próprio Google Chat (CHAT_WEBHOOK_URL).
   Sem ele, cai no webhook do n8n (N8N_WEBHOOK_URL + N8N_WEBHOOK_TOKEN). */
const DIRECT = process.env.CHAT_WEBHOOK_URL || "";

async function send(text) {
  if (DIRECT) {
    const r = await fetch(DIRECT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
    const body = (await r.text()).slice(0, 500);
    return { ok: r.ok, status: r.status, body, via: "google" };
  }
  const r = await fetch(HOOK, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.N8N_WEBHOOK_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId: `spaces/${SPACE_ID}`, text }),
  });
  const body = (await r.text()).slice(0, 500);
  return { ok: r.ok, status: r.status, body, via: "n8n" };
}

/* Menção: o n8n aceita {{mention:email}}; o webhook direto do Google não resolve e-mail,
   então vai o nome em texto. */
const mentionLine = () => {
  if (!DIRECT) return `Responsável: {{mention:${MENTION}}}`;
  const id = (process.env.CHAT_MENTION_USER_ID || "").replace(/^users\//, "").trim();
  return id ? `Responsável: <users/${id}>` : `Responsável: ${process.env.CHAT_MENTION_NAME || "Wilson Freitas"}`;
};

export default async function handler(req, res) {
  if (!DIRECT && !process.env.N8N_WEBHOOK_TOKEN) return json(res, 503, { error: "not_configured", detail: "defina CHAT_WEBHOOK_URL ou N8N_WEBHOOK_TOKEN" });

  // GET /api/chat?test=1 → dispara uma mensagem de teste e devolve a resposta crua do webhook.
  if (req.method === "GET") {
    if (String(req.query?.test || "") !== "1") {
      return json(res, 200, { via: DIRECT ? "google-webhook" : "n8n", spaceId: `spaces/${SPACE_ID}`, hint: "use ?test=1 para enviar uma mensagem de teste" });
    }
    const r = await send(`*Context Hub — teste de integração*\nSe você está vendo esta mensagem, o webhook está funcionando.\n${mentionLine()}`);
    return json(res, r.ok ? 200 : 502, { sent: r.ok, via: r.via, status: r.status, webhookResponse: r.body, spaceId: `spaces/${SPACE_ID}` });
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
    mentionLine(),
  ].filter((l) => l !== null).join("\n").slice(0, 3800);

  try {
    const r = await send(text);
    if (!r.ok) return json(res, 502, { error: "webhook_error", via: r.via, status: r.status, webhookResponse: r.body, spaceId: `spaces/${SPACE_ID}` });
    return json(res, 200, { ok: true, via: r.via, spaceId: `spaces/${SPACE_ID}`, chars: text.length });
  } catch (e) {
    return json(res, 502, { error: "webhook_error", detail: String(e?.message || e), hook: HOOK });
  }
}
