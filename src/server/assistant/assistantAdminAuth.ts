import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveUiMode } from "../../app/uiMode";
import { AssistantAdminError } from "./assistantManagementRepository";

export const ADMIN_COOKIE = "gekon_ai_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const credentials = () => process.env.GEKON_AI_ADMIN_PASSWORD?.trim() || "";
const digest = (value: string) => createHash("sha256").update(value).digest();
const sessionKey = (password: string) => digest(`gekon-ai-admin-session-v1:${password}`);
const signature = (payload: string, password: string) => createHmac("sha256", sessionKey(password)).update(payload).digest("base64url");

export function adminAuthConfigured(): boolean { return credentials().length >= 16; }
export function requireAdminHost(request: Request): void {
  if (resolveUiMode(new URL(request.url).host) !== "admin") throw new AssistantAdminError("Bu ekran yalnızca admin arayüzünde kullanılabilir.", 403, "ADMIN_ONLY");
}
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  let matches = false;
  try {
    const parsed = new URL(origin ?? "");
    matches = ["http:", "https:"].includes(parsed.protocol) && parsed.host === new URL(request.url).host;
  } catch { /* Missing or opaque origins cannot mutate administrator state. */ }
  if (!matches || request.headers.get("sec-fetch-site") === "cross-site") throw new AssistantAdminError("İstek kaynağı doğrulanamadı.", 403, "INVALID_ORIGIN");
}
export function validAdminPassword(password: string): boolean {
  return adminAuthConfigured() && timingSafeEqual(digest(password), digest(credentials()));
}
export function createAdminSession(now = Date.now()): string {
  if (!adminAuthConfigured()) throw new AssistantAdminError("Yönetim erişim parolası yapılandırılmamış.", 503, "ADMIN_AUTH_NOT_CONFIGURED");
  const payload = Buffer.from(JSON.stringify({ expiresAt: now + SESSION_SECONDS * 1000, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${signature(payload, credentials())}`;
}
export function requireAssistantAdmin(request: Request, now = Date.now()): string {
  requireAdminHost(request);
  if (!adminAuthConfigured()) throw new AssistantAdminError("Yönetim erişim parolası yapılandırılmamış.", 503, "ADMIN_AUTH_NOT_CONFIGURED");
  const token = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
  try {
    const [payload, signed, extra] = token?.split(".") ?? [];
    if (!payload || !signed || extra || payload.length > 512) throw new Error("Invalid session");
    const expected = signature(payload, credentials());
    if (signed.length !== expected.length || !timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) throw new Error("Invalid signature");
    const { expiresAt } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { expiresAt?: number };
    if (!expiresAt || expiresAt <= now || expiresAt > now + SESSION_SECONDS * 1000) throw new Error("Session expired");
    return "gekon-ai-admin";
  } catch {
    throw new AssistantAdminError("Gekon AI yönetimine erişmek için giriş yapın.", 401, "ADMIN_LOGIN_REQUIRED");
  }
}
export function adminCookie(token: string, clear = false): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${token}; Path=/api/admin/gekon-ai; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure}`;
}

// A small global bound also prevents forged IP headers from evading login throttling.
let loginWindow = { until: 0, attempts: 0 };
export function checkLoginRate(now = Date.now()): void {
  if (loginWindow.until <= now) loginWindow = { until: now + 60_000, attempts: 0 };
  if (++loginWindow.attempts > 20) throw new AssistantAdminError("Çok fazla giriş denemesi yapıldı. Bir dakika sonra tekrar deneyin.", 429, "LOGIN_RATE_LIMITED");
}
