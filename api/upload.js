import { put } from "@vercel/blob";
import { json, isAdmin } from "./_lib.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
  if (!isAdmin(req)) return json(res, 403, { error: "not_granted" });

  const name = String(req.query?.name || "arquivo");
  const safe = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 20 * 1024 * 1024) return json(res, 413, { error: "too_large" });
      chunks.push(c);
    }
    const blob = await put(`dh/assets/${id}-${safe}`, Buffer.concat(chunks), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: req.headers["content-type"] || "application/octet-stream",
    });
    return json(res, 200, { id, url: blob.url, pathname: blob.pathname });
  } catch (e) {
    return json(res, 500, { error: "server_error", detail: String(e?.message || e) });
  }
}
