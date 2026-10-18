import { io, type Socket } from "socket.io-client";
import type { PositionMessage } from "../types/tracking.types";

export interface TrackingGateway {
  connect(onPosition: (position: PositionMessage) => void): () => void;
}

const TAG_BLUEPRINTS = [
  { id: "TAG-001", name: "Forklift 07", color: "#5de4c7", x: 11.9, y: 8.2 },
  { id: "TAG-014", name: "Operatör A14", color: "#f6c760", x: 11.9, y: 21.9 },
  { id: "TAG-028", name: "Palet 28", color: "#7aa2f7", x: 11.9, y: 36.5 },
] as const;

export class SocketTrackingGateway implements TrackingGateway {
  private socket: Socket | null = null;

  public constructor(private readonly endpoint: string) {}

  public connect(onPosition: (position: PositionMessage) => void): () => void {
    this.socket = io(this.endpoint, { transports: ["websocket"] });
    this.socket.on("tag:position", onPosition);
    return () => this.socket?.disconnect();
  }
}

export type SsePositionPayload = {
  readonly pdop?: number | null;
  readonly mapId?: string | null;
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
  readonly publishedAt?: string;
  readonly receivedAt?: string;
  readonly synthetic?: boolean;
  readonly tagCode: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp?: string;
  readonly positionSource?: PositionMessage["positionSource"];
  readonly regionInference?: PositionMessage["regionInference"];
  readonly rawPosition?: PositionMessage["rawPosition"];
  readonly lastRawDataTimestamp?: string;
};

/** Browser gateway for the ingest route's co-located Server-Sent Events feed. */
export class SseTrackingGateway implements TrackingGateway {
  public constructor(private readonly endpoint = "/api/tracking/ingest") {}

  public connect(onPosition: (position: PositionMessage) => void): () => void {
    const source = new EventSource(this.endpoint);
    source.addEventListener("position", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as SsePositionPayload;
        if (!payload.tagCode || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
        const receivedAt = Date.now();
        const parsedTimestamp = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : Number.NaN;
        const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : receivedAt;
        onPosition({
          mapId: payload.mapId ?? null,
          sourceZoneId: payload.sourceZoneId ?? null,
          sourceZoneName: payload.sourceZoneName ?? null,
          publishedAt: payload.publishedAt,
          receivedAt: payload.receivedAt,
          synthetic: payload.synthetic,
          id: payload.tagCode,
          x: payload.x,
          y: payload.y,
          pdop: payload.pdop ?? null,
          timestamp,
          positionSource: payload.positionSource,
          regionInference: payload.regionInference,
          rawPosition: payload.rawPosition,
          lastRawDataTimestamp: payload.lastRawDataTimestamp,
        });
      } catch {
        // Ignore malformed external messages without closing the live stream.
      }
    });
    return () => source.close();
  }
}

/** Local source retained only for isolated UI development and visual tests. */
export class MockTrackingGateway implements TrackingGateway {
  public connect(onPosition: (position: PositionMessage) => void): () => void {
    let tick = 0;
    const publish = () => {
      tick += 0.16;
      TAG_BLUEPRINTS.forEach((tag, index) => {
        onPosition({
          mapId: null,
          sourceZoneId: null,
          sourceZoneName: null,
          id: tag.id,
          x: tag.x + Math.cos(tick + index * 2.1) * (index === 1 ? 2.8 : 1.25),
          y: tag.y + Math.sin(tick * 0.78 + index) * (index === 2 ? 1.8 : 0.9),
          timestamp: Date.now(),
        });
      });
    };
    publish();
    const interval = window.setInterval(publish, 850);
    return () => window.clearInterval(interval);
  }
}
