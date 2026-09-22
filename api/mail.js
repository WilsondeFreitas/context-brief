import { json, readBody } from "./_lib.js";

const HOSTS = [
  process.env.AGENTMAIL_BASE_URL,
  "https://api.agentmail.to/v0",
  "https://agentmail.to/v0",
].filter(Boolean);

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(iso || ""); }
};
const fmtNum = (n) => (n == null || isNaN(n) ? null : Number(n).toFixed(1).replace(".", ","));

/** Corta o resumo em no máximo 5 frases curtas. */
export function shortSummary(text, max = 5) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?]+[.!?]?/g) || [t];
  return parts.slice(0, max).map((s) => s.trim()).join(" ").trim();
}

/** A API aceita content_type ou contentType conforme a versão; tentamos as duas e, por fim, sem anexo. */
function attachmentVariants(atts) {
  if (!atts.length) return [null];
  return [
    atts.map((a) => ({ filename: a.filename, url: a.url, content_type: a.type })),
    atts.map((a) => ({ filename: a.filename, url: a.url, contentType: a.type })),
    atts.map((a) => ({ filename: a.filename, url: a.url })),
    null,
  ];
}

async function post(url, key, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 400) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const key = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX;
  const to = process.env.MAIL_TO;
  if (!key) return json(res, 503, { error: "not_granted", detail: "AGENTMAIL_API_KEY ausente" });
  if (!inbox || !to) return json(res, 503, { error: "not_configured", detail: "AGENTMAIL_INBOX ou MAIL_TO ausente" });

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
    title,
    description || null,
    "",
    `Respondido por: ${respondent}${area ? " — " + area : ""}`,
    email ? `E-mail: ${email}` : null,
    `Data da resposta: ${when}`,
    score ? `Nota geral: ${score}/10${min ? ` (mínimo ${min})` : ""}${verdict ? ` — ${verdict}` : ""}` : null,
    "",
    summary ? `Resumo: ${summary}` : null,
    b.folderUrl ? `\nPasta com os anexos e o markdown: ${b.folderUrl}` : null,
    b.attachedZip ? "\nEm anexo: o markdown com as perguntas e respostas e um zip com os arquivos enviados pelo respondente." : "\nEm anexo: o markdown com as perguntas e respostas.",
  ].filter((l) => l !== null).join("\n");

  const atts = [];
  if (b.mdUrl) atts.push({ filename: b.mdName || "respostas.md", url: b.mdUrl, type: "text/markdown" });
  if (b.bundleUrl) atts.push({ filename: b.bundleName || "anexos.zip", url: b.bundleUrl, type: "application/zip" });

  const base = {
    to,
    subject: `${title} — ${respondent}${score ? ` — nota ${score}` : ""}`.slice(0, 200),
    text,
  };

  let last = null;
  for (const host of HOSTS) {
    const url = `${host.replace(/\/$/, "")}/inboxes/${encodeURIComponent(inbox)}/messages/send`;
    for (const variant of attachmentVariants(atts)) {
      const payload = variant ? { ...base, attachments: variant } : base;
      try {
        const r = await post(url, key, payload);
        if (r.ok) {
          let out = {};
          try { out = JSON.parse(r.text); } catch {}
          return json(res, 200, { ok: true, to, attached: variant ? variant.length : 0, ...out });
        }
        last = { status: r.status, detail: r.text, url, attached: variant ? variant.length : 0 };
        if (r.status === 404) break;
        if (r.status !== 400 && r.status !== 422) break;
      } catch (e) {
        last = { status: 0, detail: String(e?.message || e), url };
        break;
      }
    }
    if (last && last.status === 404) continue;
    break;
  }
  return json(res, 502, { error: "agentmail_error", ...last });
}
