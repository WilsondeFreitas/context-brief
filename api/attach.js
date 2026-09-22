import { put } from "@vercel/blob";
import { json } from "./_lib.js";

export const config = { api: { bodyParser: false } };

const MAX = 12 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const session = String(req.query?.session || "");
  if (!/^[\w.~:@+-]{4,60}$/.test(session)) return json(res, 400, { error: "bad_session" });

  const name = String(req.query?.name || "arquivo");
  const safe = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "arquivo";
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX) return json(res, 413, { error: "too_large" });
      chunks.push(c);
    }
    if (!size) return json(res, 400, { error: "empty" });
    const blob = await put(`dh/attachments/${encodeURIComponent(session)}/${id}-${safe}`, Buffer.concat(chunks), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: req.headers["content-type"] || "application/octet-stream",
    });
    return json(res, 200, { id, url: blob.url, pathname: blob.pathname, bytes: size });
  } catch (e) {
    return json(res, 500, { error: "server_error", detail: String(e?.message || e) });
  }
}
