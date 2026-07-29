import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ProcessedPosition } from "./types";
import { logger } from "../logger";

const STREAM_PATHS = new Set(["/api/tracking/ingest", "/api/tracking/stream"]);

function loopbackRequest(
  port: number,
  path: string,
  method: "GET" | "POST",
  body?: string,
  timeoutMs = 2_000,
): Promise<{ readonly statusCode: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      agent: false,
      headers: {
        connection: "close",
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Loopback request timed out")));
    request.end(body);
  });
}

export class ProcessedPositionServer {
  private server: Server | null = null;
  private external = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private readonly clients = new Map<ServerResponse, boolean>();

  public constructor(
    public readonly port: number,
    private readonly allowedOrigin: string,
    private readonly preferExternal = false,
    private readonly schedulerTick?: () => void,
    private readonly schedulerIntervalMs = 1_000,
  ) {}

  public async start(): Promise<void> {
    if (this.server?.listening) return;
    if (this.external) return;
    if (this.preferExternal && await this.externalServerAvailable()) {
      this.external = true;
      return;
    }
    const server = createServer((request, response) => {
      const path = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
      if (request.method === "GET" && path === "/__region-position-output/health") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ service: "region-position-output", port: this.port }));
        return;
      }
      if (request.method === "POST" && path === "/__region-position-output/publish") {
        if (!this.isLoopback(request.socket.remoteAddress)) {
          response.writeHead(403).end();
          return;
        }
        void this.acceptExternalPublish(request, response);
        return;
      }
      if (request.method === "POST" && path === "/__region-position-output/reset") {
        if (!this.isLoopback(request.socket.remoteAddress)) {
          response.writeHead(403).end();
          return;
        }
        for (const client of this.clients.keys()) client.end();
        this.clients.clear();
        this.clearActivityTimers();
        response.writeHead(204).end();
        return;
      }
      if (request.method !== "GET" || !STREAM_PATHS.has(path)) {
        response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Processed position SSE endpoint bulunamadı" }));
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": this.allowedOrigin,
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 3000\n\n");
      this.clients.set(response, false);
      this.ensureHeartbeat();
      const remove = () => {
        this.clients.delete(response);
        if (this.clients.size === 0) this.clearActivityTimers();
      };
      request.on("close", remove);
      response.on("close", remove);
      response.on("error", (error) => {
        remove();
        logger.error("region_engine.processed_connection_failed", error);
      });
      response.on("drain", () => {
        if (this.clients.has(response)) this.clients.set(response, false);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        const message = error.code === "EADDRINUSE"
          ? `REGION_POSITION_PORT ${this.port} kullanımda; boş bir 300x portu seçin`
          : `Processed position portu ${this.port} başlatılamadı: ${error.message}`;
        logger.error("region_engine.processed_port_start_failed", error, { port: this.port, message });
        reject(new Error(message));
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, "0.0.0.0");
    });
    this.server = server;
  }

  public publish(position: ProcessedPosition): void {
    if (this.external) {
      const body = JSON.stringify(position);
      void loopbackRequest(this.port, "/__region-position-output/publish", "POST", body)
        .then((response) => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`Processed position publish HTTP ${response.statusCode}`);
          }
        })
        .catch((error) => logger.error("region_engine.processed_publish_failed", error, { port: this.port }));
      return;
    }
    this.writeToClients(`event: position\ndata: ${JSON.stringify(position)}\n\n`);
  }

  public async stop(): Promise<void> {
    if (this.external) {
      this.external = false;
      await loopbackRequest(this.port, "/__region-position-output/reset", "POST").catch(() => undefined);
      return;
    }
    this.clearActivityTimers();
    for (const client of this.clients.keys()) client.end();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  public get clientCount(): number {
    return this.clients.size;
  }

  public get boundPort(): number {
    const address = this.server?.address();
    return address && typeof address === "object" ? (address as AddressInfo).port : this.port;
  }

  private writeToClients(message: string): void {
    for (const [client, blocked] of this.clients) {
      if (blocked || client.destroyed || client.writableEnded) continue;
      // A slow client is skipped until drain, preventing an unbounded application queue.
      if (!client.write(message)) this.clients.set(client, true);
    }
  }

  private ensureHeartbeat(): void {
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.writeToClients(": keep-alive\n\n"), 15_000);
      this.heartbeat.unref?.();
    }
    if (this.schedulerTick && !this.scheduler) {
      this.scheduler = setInterval(this.schedulerTick, this.schedulerIntervalMs);
      this.scheduler.unref?.();
    }
  }

  private clearActivityTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.scheduler) clearInterval(this.scheduler);
    this.heartbeat = null;
    this.scheduler = null;
  }

  private async externalServerAvailable(): Promise<boolean> {
    try {
      const response = await loopbackRequest(this.port, "/__region-position-output/health", "GET", undefined, 750);
      const body = JSON.parse(response.body) as { service?: string };
      return response.statusCode >= 200 && response.statusCode < 300 && body.service === "region-position-output";
    } catch {
      return false;
    }
  }

  private async acceptExternalPublish(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 1_000_000) throw new Error("Processed position mesajı çok büyük");
        chunks.push(buffer);
      }
      const position = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProcessedPosition;
      if (!position.tagCode || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Geçersiz processed position");
      this.publish(position);
      response.writeHead(204).end();
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private isLoopback(address: string | undefined): boolean {
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  }
}
