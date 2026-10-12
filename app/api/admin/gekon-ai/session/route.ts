import { z } from "zod";
import { adminAuthConfigured, adminCookie, checkLoginRate, createAdminSession, requireAdminHost, requireAssistantAdmin, requireSameOrigin, validAdminPassword } from "@/src/server/assistant/assistantAdminAuth";
import { adminError, adminResponse, readAdminBody } from "@/src/server/assistant/assistantAdminHttp";
import { AssistantAdminError } from "@/src/server/assistant/assistantManagementRepository";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAdminHost(request);
    if (!adminAuthConfigured()) return adminResponse({ authenticated: false, configured: false });
    try { requireAssistantAdmin(request); return adminResponse({ authenticated: true, configured: true }); }
    catch { return adminResponse({ authenticated: false, configured: true }); }
  } catch (error) { return adminError(error); }
}
export async function POST(request: Request) {
  try {
    requireAdminHost(request); requireSameOrigin(request); checkLoginRate();
    if (!adminAuthConfigured()) throw new AssistantAdminError("Yönetim erişim parolası yapılandırılmamış.", 503, "ADMIN_AUTH_NOT_CONFIGURED");
    const body = z.object({ password: z.string().min(1).max(256) }).strict().parse(await readAdminBody(request));
    if (!validAdminPassword(body.password)) throw new AssistantAdminError("Yönetim parolası doğru değil.", 401, "INVALID_PASSWORD");
    const response = adminResponse({ authenticated: true, configured: true });
    response.headers.set("Set-Cookie", adminCookie(createAdminSession()));
    return response;
  } catch (error) { return adminError(error); }
}
export async function DELETE(request: Request) {
  try {
    requireAdminHost(request); requireSameOrigin(request);
    const response = adminResponse({ authenticated: false, configured: adminAuthConfigured() });
    response.headers.set("Set-Cookie", adminCookie("", true));
    return response;
  } catch (error) { return adminError(error); }
}
