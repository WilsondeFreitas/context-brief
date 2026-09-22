/* Google Drive via conta de serviço — JWT assinado com node:crypto, sem dependências. */
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const ROOT_ID = process.env.DRIVE_ROOT_FOLDER_ID || "";

function privateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function driveConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && privateKey() && ROOT_ID);
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cached = { token: null, exp: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey());
  const jwt = `${head}.${body}.${b64url(sig)}`;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`drive_auth_${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

async function api(path, opts = {}) {
  const token = await accessToken();
  const r = await fetch(`https://www.googleapis.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`drive_${r.status}: ${text.slice(0, 250)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

/** Devolve a pasta com esse nome sob a raiz, criando se não existir. */
export async function ensureFolder(name) {
  const q = [
    `name = '${String(name).replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${ROOT_ID}' in parents`,
    "trashed = false",
  ].join(" and ");
  // Raiz pode ser um Drive compartilhado (ID começa com 0A): a listagem então exige corpora=drive.
  const isSharedDriveRoot = /^0A/.test(ROOT_ID);
  const scope = isSharedDriveRoot ? `&corpora=drive&driveId=${encodeURIComponent(ROOT_ID)}` : "";
  const found = await api(
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true${scope}`
  );
  if (found.files?.length) return found.files[0].id;
  const made = await api(`/drive/v3/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [ROOT_ID] }),
  });
  return made.id;
}

/** Sobe um arquivo (Buffer) para a pasta. Devolve { id, url }. */
export async function uploadFile(folderId, name, buffer, contentType = "application/octet-stream") {
  const boundary = "dh" + crypto.randomBytes(12).toString("hex");
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const out = await api(`/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(body.length) },
    body,
  });
  return { id: out.id, url: out.webViewLink || `https://drive.google.com/file/d/${out.id}/view` };
}

export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
