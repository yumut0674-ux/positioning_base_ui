import type { TagPresenceService } from "./TagPresenceService";
import type { TagPresenceSnapshot } from "../../features/tracking/types/tagPresence.types";

export function createTagPresenceResponse(request: Request, service: TagPresenceService, snapshot: () => TagPresenceSnapshot): Response {
  if (!request.headers.get("accept")?.includes("text/event-stream")) {
    return Response.json(snapshot(), { headers: { "Cache-Control": "no-store" } });
  }
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, value: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      const unsubscribe = service.subscribe(value => send("presence", value));
      const heartbeat = setInterval(() => send("status", { warning: snapshot().warning, serverNow: Date.now() }), 15_000);
      heartbeat.unref?.();
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe(); clearInterval(heartbeat);
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      send("snapshot", snapshot());
      if (request.signal.aborted) cleanup();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  } });
}
