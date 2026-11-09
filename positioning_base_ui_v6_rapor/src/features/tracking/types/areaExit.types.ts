/** Historical display information. Never an input to tracking or room inference. */
export interface ArchivedAreaExit {
  readonly tagCode: string;
  readonly mapId: string;
  readonly areaName: string;
  readonly gateName: string | null;
  readonly exitedAt: string;
  readonly publishedAt: string;
  readonly decisionId: string | null;
}

export interface AreaExitReadStatus {
  readonly tagCode: string;
  readonly publishedAt: string | null;
  readonly exit: ArchivedAreaExit | null;
}

export interface AreaExitReadSnapshot {
  readonly serverNow: number;
  readonly byTag: Readonly<Record<string, AreaExitReadStatus>>;
}
