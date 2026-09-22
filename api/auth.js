import { json, readBody, issueToken, setAdminCookie, isAdmin } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return json(res, 200, { canEdit: isAdmin(req), configured: !!process.env.ADMIN_PASSWORD });
  }
  if (req.method === "DELETE") {
    setAdminCookie(res, null);
    return json(res, 200, { canEdit: false });
  }
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json(res, 500, { error: "admin_password_missing" });

  const { password } = await readBody(req);
  if (typeof password !== "string" || password !== expected) {
    await new Promise((r) => setTimeout(r, 400));
    return json(res, 401, { error: "invalid_password" });
  }
  setAdminCookie(res, issueToken());
  return json(res, 200, { canEdit: true });
}
