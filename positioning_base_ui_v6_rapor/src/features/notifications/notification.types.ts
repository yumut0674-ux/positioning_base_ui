export interface AreaExitNotification {
  readonly id: string;
  readonly tagCode: string;
  readonly tagName: string;
  readonly mapId: string;
  readonly areaId?: string;
  readonly areaName?: string;
  readonly exitedAt: string;
  readonly createdAt: string;
  readonly displayDurationMs: number;
  readonly exitDelayMs: number;
  readonly timeSource: "engine" | "observed_result";
  readonly sourceLabel: string;
}

export function notificationMessage(item: AreaExitNotification): string {
  return `${item.tagName === item.tagCode ? item.tagCode : `${item.tagName} (${item.tagCode})`} tagı ${item.areaName ? `${item.areaName} alanından` : "tanımlı alanların dışına"} çıktı.`;
}
