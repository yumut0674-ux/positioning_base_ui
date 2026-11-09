import { notifications } from "@/src/server/notifications/notificationRepository";
import { notificationRuntime } from "@/src/server/notifications/notificationRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  try { await notificationRuntime.start(); }
  catch { return Response.json({ error: "Bildirim gözlemcisi başlatılamadı." }, { status: 503 }); }
  const serverNow = Date.now();
  let warning = notificationRuntime.status();
  let stored: Awaited<ReturnType<typeof notifications.active>> = [];
  try { stored = await notifications.active(serverNow); }
  catch { warning = "Bildirim geçmişine erişilemiyor; bekleyen yerel bildirimler gösteriliyor."; }
  const pending = notificationRuntime.pending().filter(item => Date.parse(item.createdAt) + item.displayDurationMs > serverNow);
  const items = [...new Map([...stored, ...pending].map(item => [item.id, item])).values()];
  return Response.json({ items, serverNow, warning }, { headers: { "Cache-Control": "no-store" } });
}
