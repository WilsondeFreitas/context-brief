import { json, readBody } from "./_lib.js";

const HOSTS = [
  process.env.AGENTMAIL_BASE_URL,
  "https://api.agentmail.to/v0",
  "https://agentmail.to/v0",
].filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const key = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX;
  const to = process.env.MAIL_TO;
  if (!key) return json(res, 503, { error: "not_granted", detail: "AGENTMAIL_API_KEY ausente" });
  if (!inbox || !to) return json(res, 503, { error: "not_configured", detail: "AGENTMAIL_INBOX ou MAIL_TO ausente" });

  const { subject, markdown } = await readBody(req);
  if (typeof markdown !== "string" || !markdown.trim()) return json(res, 400, { error: "bad_body" });

  const payload = {
    to,
    subject: String(subject || "Discovery Hub — respostas").slice(0, 200),
    text: markdown,
  };

  let last = null;
  for (const base of HOSTS) {
    const url = `${base.replace(/\/$/, "")}/inboxes/${encodeURIComponent(inbox)}/messages/send`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      if (r.ok) {
        let out = {};
        try { out = JSON.parse(text); } catch {}
        return json(res, 200, { ok: true, to, ...out });
      }
      last = { status: r.status, detail: text.slice(0, 400), url };
      if (r.status !== 404) break;
    } catch (e) {
      last = { status: 0, detail: String(e?.message || e), url };
    }
  }
  return json(res, 502, { error: "agentmail_error", ...last });
}
