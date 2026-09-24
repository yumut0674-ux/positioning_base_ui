export interface RawRow {
  id: string; tag_code: string; x: number | null; y: number | null;
  created_at: string | null; received_at: string | null; quality: number | null;
  map_id: string | null; zone_id: string | null; zone_name: string | null;
}
export interface Visit { roomId: string; from: string; to: string }
export interface Truth {
  testId: string; timezone: 'Europe/Istanbul'; revision: number; revisionReason: string;
  test: { from: string; to: string }; visits: Visit[];
  groups: { id: string; tagCodes: string[]; note?: string }[];
  note?: string;
}
export interface Manifest {
  testId: string; source: string; timezone: 'Europe/Istanbul'; importedAt: string;
  warmupMs: number; observationMs: number; selectedTags: string[];
  candidateTags: Record<string, number>; rowCount: number; sha256: string;
  timing: 'exact' | 'approximate'; mapIds: Record<string, number>;
  quality: { missingReceivedAt: number; missingMeasurementAt: number; missingCoordinates: number;
    missingQuality: number; timingAnomalies: number; anomalyRows: {id:string;tagCode:string;createdAt:string;receivedAt:string;deltaMs:number}[];
    largeGaps: { tagCode: string; from: string; to: string; ms: number }[] };
  caveat: string;
}
export const iso = (value: string): string => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Geçersiz zaman: ${value}`);
  return new Date(ms).toISOString();
};
export const ms = (value: string): number => Date.parse(iso(value));
export const deliveryMs = (row: RawRow): number => ms(row.received_at ?? row.created_at ?? (() => { throw new Error(`Satır ${row.id}: zaman yok`); })());
export const compareRows = (a: RawRow, b: RawRow): number => deliveryMs(a) - deliveryMs(b) ||
  (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
export const sha256 = async (bytes: Buffer): Promise<string> => (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
export const round = (n: number): number => Math.round(n * 1000) / 1000;
