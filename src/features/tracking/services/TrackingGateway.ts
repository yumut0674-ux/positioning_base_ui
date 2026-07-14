import { io, type Socket } from "socket.io-client";
import type { PositionMessage, TrackedTag } from "../types/tracking.types";

export interface TrackingGateway {
  connect(onPosition: (tag: TrackedTag) => void): () => void;
}

const TAG_BLUEPRINTS = [
  { id: "TAG-001", name: "Forklift 07", color: "#5de4c7", x: 8.8, y: 7.8, battery: 86 },
  { id: "TAG-014", name: "Operatör A14", color: "#f6c760", x: 21.4, y: 12.4, battery: 71 },
  { id: "TAG-028", name: "Palet 28", color: "#7aa2f7", x: 31.2, y: 4.2, battery: 94 },
] as const;

export class SocketTrackingGateway implements TrackingGateway {
  private socket: Socket | null = null;

  public constructor(private readonly endpoint: string) {}

  public connect(onPosition: (tag: TrackedTag) => void): () => void {
    this.socket = io(this.endpoint, { transports: ["websocket"] });
    this.socket.on("tag:position", (message: PositionMessage) => {
      onPosition({ ...message, name: message.id, color: "#5de4c7", status: "active", battery: 100 });
    });
    return () => this.socket?.disconnect();
  }
}

/** Drop-in local source. Replace its construction with SocketTrackingGateway for production. */
export class MockTrackingGateway implements TrackingGateway {
  public connect(onPosition: (tag: TrackedTag) => void): () => void {
    let tick = 0;
    const publish = () => {
      tick += 0.16;
      TAG_BLUEPRINTS.forEach((tag, index) => {
        onPosition({
          ...tag,
          x: tag.x + Math.cos(tick + index * 2.1) * (index === 1 ? 2.8 : 1.25),
          y: tag.y + Math.sin(tick * 0.78 + index) * (index === 2 ? 1.8 : 0.9),
          status: index === 2 ? "idle" : "active",
          timestamp: Date.now(),
          direction: ((tick * 42 + index * 115) % 360),
        });
      });
    };
    publish();
    const interval = window.setInterval(publish, 850);
    return () => window.clearInterval(interval);
  }
}
