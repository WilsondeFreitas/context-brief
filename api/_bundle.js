import { list } from "@vercel/blob";
import { makeZip, safeName } from "./_zip.js";
import { blobPath } from "./_lib.js";

const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

async function fetchJson(url) {
  const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`blob_fetch_${r.status}`);
  return r.json();
}

export async function loadSession(sessionId) {
  const pathname = blobPath("sessions", sessionId);
  const { blobs } = await list({ prefix: pathname, limit: 10 });
  const b = blobs.find((x) => x.pathname === pathname);
  if (!b) return null;
  return fetchJson(b.url);
}

export function sessionFiles(sess) {
  const out = [];
  for (const a of sess?.answers || []) {
    for (const f of (a?.files || []).concat(a?.followupFiles || [])) {
      if (f && f.url) out.push(f);
    }
  }
  return out;
}

export const bundleName = (sess, title) =>
  safeName(`${title || "respostas"}-${sess?.respondent || "resposta"}`, "respostas").toLowerCase();

/** Monta o zip com o markdown e todos os anexos da sessão. */
export async function buildBundle(sess, { markdown, title } = {}) {
  const md = markdown || sess?.markdown || "";
  const entries = [{ name: "respostas.md", data: Buffer.from(md, "utf8") }];
  const files = sessionFiles(sess);
  const skipped = [];
  let total = Buffer.byteLength(md);
  const used = new Set(["respostas.md"]);

  for (const f of files) {
    if (total >= MAX_BUNDLE_BYTES) { skipped.push(f.name); continue; }
    try {
      const r = await fetch(f.url, { cache: "no-store" });
      if (!r.ok) { skipped.push(f.name); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (total + buf.length > MAX_BUNDLE_BYTES) { skipped.push(f.name); continue; }
      let name = "anexos/" + safeName(f.name);
      let i = 2;
      while (used.has(name)) name = `anexos/${i++}-${safeName(f.name)}`;
      used.add(name);
      entries.push({ name, data: buf });
      total += buf.length;
    } catch { skipped.push(f.name); }
  }

  if (skipped.length) {
    entries.push({ name: "anexos/NAO-INCLUIDOS.txt", data: Buffer.from("Não foi possível incluir:\n" + skipped.join("\n"), "utf8") });
  }

  return { zip: makeZip(entries), count: entries.length - 1, skipped, filename: bundleName(sess, title) + ".zip" };
}
