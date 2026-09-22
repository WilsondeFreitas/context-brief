import { put, list, del } from "@vercel/blob";
import { json } from "./_lib.js";

const VARS = ["BLOB_READ_WRITE_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL", "ADMIN_PASSWORD", "MAIL_TO", "AGENTMAIL_INBOX", "AGENTMAIL_API_KEY"];

export default async function handler(req, res) {
  const env = {};
  for (const v of VARS) env[v] = !!process.env[v];

  const out = {
    ok: true,
    env,
    blob: "skipped",
    gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    mail: process.env.MAIL_TO ? "configured" : "missing",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    env_name: process.env.VERCEL_ENV || null,
    time: new Date().toISOString(),
  };

  if (req.query?.ping) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) out.blob = "missing token";
    else {
      try {
        const p = `dh/_health/${Date.now().toString(36)}.txt`;
        const b = await put(p, "ok", { access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
        await list({ prefix: "dh/_health/", limit: 1 });
        await del(b.url);
        out.blob = "ok";
      } catch (e) {
        out.blob = `error: ${String(e?.message || e).slice(0, 200)}`;
      }
    }
    if (!process.env.GEMINI_API_KEY) out.gemini = "missing key";
  }

  out.ok = Object.values(env).every(Boolean) && (out.blob === "ok" || out.blob === "skipped");
  return json(res, 200, out);
}
