import { trackingBuffer, type TrackingPosition } from "@/src/server/trackingBuffer";

export const runtime = "nodejs";

const encoder = new TextEncoder();

function eventMessage(position: TrackingPosition): Uint8Array {
  return encoder.encode(`event: position\ndata: ${JSON.stringify(position)}\n\n`);
}

export function GET(request: Request): Response {
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const publish = (position: TrackingPosition) => controller.enqueue(eventMessage(position));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
      const close = () => {
        clearInterval(heartbeat);
        trackingBuffer.off("position", publish);
        try { controller.close(); } catch { /* Client connection already closed. */ }
      };
      cleanup = close;
      trackingBuffer.on("position", publish);
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
