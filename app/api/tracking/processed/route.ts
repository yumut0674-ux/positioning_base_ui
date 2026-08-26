import { logger } from "@/src/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_REGION_POSITION_PORT = 3001;

function regionPositionPort(): number {
  const value = Number(process.env.REGION_POSITION_PORT ?? DEFAULT_REGION_POSITION_PORT);
  return Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : DEFAULT_REGION_POSITION_PORT;
}

function unavailableResponse(): Response {
  return Response.json({ error: "Processed tracking stream is unavailable" }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const upstreamController = new AbortController();
  const abortUpstream = () => upstreamController.abort();
  request.signal.addEventListener("abort", abortUpstream, { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(
      `http://127.0.0.1:${regionPositionPort()}/api/tracking/stream`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal: upstreamController.signal,
      },
    );
  } catch (error) {
    request.signal.removeEventListener("abort", abortUpstream);
    logger.error("tracking.processed_proxy_unavailable", error);
    return unavailableResponse();
  }

  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !upstream.body || !upstreamContentType.toLowerCase().startsWith("text/event-stream")) {
    request.signal.removeEventListener("abort", abortUpstream);
    abortUpstream();
    logger.warn("tracking.processed_proxy_bad_status", { status: upstream.status });
    return unavailableResponse();
  }

  request.signal.removeEventListener("abort", abortUpstream);
  const reader = upstream.body.getReader();
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    request.signal.removeEventListener("abort", cleanup);
    abortUpstream();
    void reader.cancel().catch(() => undefined);
  };

  request.signal.addEventListener("abort", cleanup, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finished = true;
          request.signal.removeEventListener("abort", cleanup);
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        const wasAborted = upstreamController.signal.aborted;
        cleanup();
        if (!wasAborted) {
          logger.error("tracking.processed_proxy_stream_failed", error);
        }
        try { controller.close(); } catch { /* Stream is already closed. */ }
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": upstreamContentType,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
