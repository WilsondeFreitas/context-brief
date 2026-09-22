import { put, list, del } from "@vercel/blob";
import { json, readBody, blobPath, parsePath, isAdmin, COLS, ADMIN_COLS } from "./_lib.js";

const PREFIX = "dh/";

async function findBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 10 });
  return blobs.find((b) => b.pathname === pathname) || null;
}

async function fetchJson(url) {
  const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`blob_fetch_${r.status}`);
  return r.json();
}

async function listCollection(col) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: `${PREFIX}${col}/`, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const docs = await Promise.all(
    out.map(async (b) => {
      try {
        const data = await fetchJson(b.url);
        const id = decodeURIComponent(b.pathname.slice(`${PREFIX}${col}/`.length).replace(/\.json$/, ""));
        return { id, data };
      } catch { return null; }
    })
  );
  return docs.filter(Boolean);
}

export default async function handler(req, res) {
  try {
    const body = req.method === "GET" ? { ...req.query } : await readBody(req);
    const op = String(body.op || "");
    const admin = isAdmin(req);

    if (op === "list") {
      const col = String(body.col || "");
      if (!COLS.includes(col)) return json(res, 400, { error: "bad_collection" });
      let docs = await listCollection(col);
      if (body.whereField) {
        const f = String(body.whereField);
        const v = body.whereValue;
        docs = docs.filter((d) => String(d.data?.[f] ?? "") === String(v));
      }
      return json(res, 200, { docs });
    }

    if (op === "get") {
      const p = parsePath(body.path);
      if (!p) return json(res, 400, { error: "bad_path" });
      const b = await findBlob(blobPath(p.col, p.id));
      if (!b) return json(res, 200, { exists: false, data: null });
      return json(res, 200, { exists: true, data: await fetchJson(b.url) });
    }

    if (op === "set" || op === "delete") {
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
      const p = parsePath(body.path);
      if (!p) return json(res, 400, { error: "bad_path" });
      if (ADMIN_COLS.includes(p.col) && !admin) return json(res, 403, { error: "not_granted" });

      const pathname = blobPath(p.col, p.id);
      if (op === "delete") {
        const b = await findBlob(pathname);
        if (b) await del(b.url);
        return json(res, 200, { ok: true });
      }
      const data = body.data && typeof body.data === "object" ? body.data : {};
      await put(pathname, JSON.stringify(data), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
      });
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: "bad_op" });
  } catch (e) {
    return json(res, 500, { error: "server_error", detail: String(e?.message || e) });
  }
}
