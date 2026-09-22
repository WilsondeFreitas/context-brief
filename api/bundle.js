import { json } from "./_lib.js";
import { loadSession, buildBundle } from "./_bundle.js";

export default async function handler(req, res) {
  const sessionId = String(req.query?.session || "");
  if (!/^[\w.~:@+-]{4,60}$/.test(sessionId)) return json(res, 400, { error: "bad_session" });

  try {
    const sess = await loadSession(sessionId);
    if (!sess) return json(res, 404, { error: "not_found" });
    const { zip, filename } = await buildBundle(sess, { title: req.query?.title });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(zip.length));
    res.setHeader("Cache-Control", "no-store");
    return res.end(zip);
  } catch (e) {
    return json(res, 500, { error: "server_error", detail: String(e?.message || e) });
  }
}
