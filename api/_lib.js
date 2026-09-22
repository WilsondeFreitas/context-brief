import crypto from "node:crypto";

export const COLS = ["sets", "docs", "sessions", "settings"];
export const ADMIN_COLS = ["sets", "docs", "settings"];
const PREFIX = "dh/";

export function json(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function blobPath(col, id) {
  return `${PREFIX}${col}/${encodeURIComponent(id)}.json`;
}

export function parsePath(p) {
  const m = String(p || "").match(/^([a-z]+)\/(.+)$/);
  if (!m) return null;
  const [, col, id] = m;
  if (!COLS.includes(col)) return null;
  if (!id || id.includes("/") || id.includes("..")) return null;
  return { col, id };
}

/* ---------- admin session cookie ---------- */

function secret() {
  const p = process.env.ADMIN_PASSWORD;
  return p ? String(p) : null;
}

export function issueToken() {
  const s = secret();
  if (!s) return null;
  const exp = Date.now() + 1000 * 60 * 60 * 12; // 12h
  const sig = crypto.createHmac("sha256", s).update(`admin:${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyToken(token) {
  const s = secret();
  if (!s || !token) return false;
  const m = String(token).match(/^(\d+)\.([a-f0-9]{64})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = crypto.createHmac("sha256", s).update(`admin:${exp}`).digest("hex");
  const a = Buffer.from(m[2], "hex");
  const b = Buffer.from(want, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const COOKIE = "dh_admin";

export function isAdmin(req) {
  return verifyToken(cookies(req)[COOKIE]);
}

export function setAdminCookie(res, token) {
  const base = `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax; Secure`;
  res.setHeader("Set-Cookie", token ? `${base}; Max-Age=${60 * 60 * 12}` : `${base}; Max-Age=0`);
}
