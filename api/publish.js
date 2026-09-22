import { put } from "@vercel/blob";
import { json, readBody } from "./_lib.js";
import { loadSession, buildBundle, sessionFiles } from "./_bundle.js";
import { safeName } from "./_zip.js";
import { driveConfigured, ensureFolder, uploadFile, folderUrl } from "./_drive.js";

const slug = (t, fb = "formulario") =>
  (String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)) || fb;

const stamp = (iso) => {
  const d = new Date(iso || Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/* Publica o resultado de uma sessão: zip e markdown no Blob e, havendo anexos,
   uma pasta no Drive com o markdown e os arquivos do respondente. */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const { sessionId, title, shortName, markdown } = await readBody(req);
  if (!sessionId) return json(res, 400, { error: "bad_session" });

  let sess;
  try {
    sess = await loadSession(String(sessionId));
  } catch (e) {
    return json(res, 500, { error: "session_read_failed", detail: String(e?.message || e) });
  }
  if (!sess) return json(res, 404, { error: "not_found" });

  const md = String(markdown || sess.markdown || "");
  const base = slug(shortName || title);
  const who = slug(sess.respondent, "resposta");
  const mdName = `${base}-${who}-${stamp(sess.finishedAt)}.md`;

  const out = { files: 0, folderUrl: "", mdUrl: "", bundleUrl: "", drive: null };

  // markdown e zip no Blob (usados como anexo do e-mail e no download)
  try {
    const blobMd = await put(`dh/bundles/${mdName}`, Buffer.from(md, "utf8"), {
      access: "public", addRandomSuffix: true, contentType: "text/markdown; charset=utf-8",
    });
    out.mdUrl = blobMd.url;
  } catch (e) { out.mdError = String(e?.message || e); }

  const files = sessionFiles(sess);
  out.files = files.length;

  if (files.length) {
    try {
      const built = await buildBundle(sess, { markdown: md, title });
      const blobZip = await put(`dh/bundles/${base}-${who}-${stamp(sess.finishedAt)}.zip`, built.zip, {
        access: "public", addRandomSuffix: true, contentType: "application/zip",
      });
      out.bundleUrl = blobZip.url;
      out.bundleName = `${base}-${who}.zip`;
      out.skipped = built.skipped;
    } catch (e) { out.bundleError = String(e?.message || e); }

    // pasta no Drive só existe quando há anexos
    if (driveConfigured()) {
      try {
        const folderId = await ensureFolder(base);
        await uploadFile(folderId, mdName, Buffer.from(md, "utf8"), "text/markdown; charset=utf-8");
        let n = 0;
        for (const f of files) {
          try {
            const r = await fetch(f.url, { cache: "no-store" });
            if (!r.ok) continue;
            const buf = Buffer.from(await r.arrayBuffer());
            await uploadFile(folderId, `${who}-${stamp(sess.finishedAt)}-${safeName(f.name)}`, buf,
              r.headers.get("content-type") || "application/octet-stream");
            n++;
          } catch { /* segue com os demais */ }
        }
        out.folderUrl = folderUrl(folderId);
        out.drive = { folder: base, uploaded: n, of: files.length };
      } catch (e) {
        out.drive = { error: String(e?.message || e) };
      }
    } else {
      out.drive = { error: "Drive não configurado (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, DRIVE_ROOT_FOLDER_ID)" };
    }
  }

  return json(res, 200, { ok: true, mdName, ...out });
}
