import { io, type Socket } from "socket.io-client";
import type { PositionMessage } from "../types/tracking.types";

export interface TrackingGateway {
  connect(onPosition: (position: PositionMessage) => void): () => void;
}

const TAG_BLUEPRINTS = [
  { id: "TAG-001", name: "Forklift 07", color: "#5de4c7", x: 8.8, y: 7.8, battery: 86 },
  { id: "TAG-014", name: "Operatör A14", color: "#f6c760", x: 21.4, y: 12.4, battery: 71 },
  { id: "TAG-028", name: "Palet 28", color: "#7aa2f7", x: 31.2, y: 4.2, battery: 94 },
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

type SsePositionPayload = { readonly tagCode: string; readonly x: number; readonly y: number; readonly battery: number | null; readonly createdAt: string; };

/** Browser gateway for the /api/tracking/stream Server-Sent Events feed. */
export class SseTrackingGateway implements TrackingGateway {
  public constructor(private readonly endpoint = "/api/tracking/stream") {}

  public connect(onPosition: (position: PositionMessage) => void): () => void {
    const source = new EventSource(this.endpoint);
    source.addEventListener("position", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as SsePositionPayload;
        if (!payload.tagCode || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
        const timestamp = Date.parse(payload.createdAt);
        onPosition({ id: payload.tagCode, x: payload.x, y: payload.y, battery: payload.battery, timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() });
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
          id: tag.id,
          x: tag.x + Math.cos(tick + index * 2.1) * (index === 1 ? 2.8 : 1.25),
          y: tag.y + Math.sin(tick * 0.78 + index) * (index === 2 ? 1.8 : 0.9),
          battery: tag.battery,
          timestamp: Date.now(),
        });
      });
    };
    publish();
    const interval = window.setInterval(publish, 850);
    return () => window.clearInterval(interval);
  }
}
