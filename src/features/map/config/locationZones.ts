export interface LocationZonePoint {
  readonly x: number;
  readonly y: number;
}

interface LocationZoneBase {
  readonly id: string;
  readonly floorPlanId: string;
  readonly label: string;
  readonly priority: number;
}

export interface RectangleLocationZone extends LocationZoneBase {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface PolygonLocationZone extends LocationZoneBase {
  readonly polygon: readonly LocationZonePoint[];
}

export type LocationZone = RectangleLocationZone | PolygonLocationZone;

export const LOCATION_ZONES = [
  // Öncelik, sınır çizgilerinde veya üst üste gelen operasyon alanlarında
  // daha özel klinik alanın seçilmesini sağlar.
  { id: "l1-operating-theatre", floorPlanId: "hq-l1", minX: 28.3, maxX: 37.7, minY: 14.0, maxY: 19.4, label: "Kat 01 · Ameliyathane ve Steril Alan", priority: 1 },
  { id: "l1-orthopedic-trauma", floorPlanId: "hq-l1", minX: 23.8, maxX: 28.3, minY: 14.0, maxY: 20.5, label: "Kat 01 · Acil Ortopedi ve Travma", priority: 2 },
  { id: "l1-imaging-consultation", floorPlanId: "hq-l1", minX: 14.0, maxX: 23.8, minY: 14.0, maxY: 20.5, label: "Kat 01 · Görüntüleme ve Konsültasyon", priority: 3 },
  { id: "l1-orthopedic-outpatient", floorPlanId: "hq-l1", minX: 5.0, maxX: 14.0, minY: 14.0, maxY: 20.5, label: "Kat 01 · Ortopedi Poliklinikleri", priority: 4 },
  { id: "l1-patient-transfer-corridor", floorPlanId: "hq-l1", minX: 5.0, maxX: 37.7, minY: 12.0, maxY: 14.0, label: "Kat 01 · Ana Hasta Transfer Koridoru", priority: 5 },
  { id: "l1-west-emergency-core", floorPlanId: "hq-l1", minX: 6.3, maxX: 8.0, minY: 5.3, maxY: 12.0, label: "Kat 01 · Batı Acil Çıkış ve Merdiven Çekirdeği", priority: 6 },
  { id: "l1-east-lift-core", floorPlanId: "hq-l1", minX: 35.8, maxX: 37.7, minY: 5.3, maxY: 12.0, label: "Kat 01 · Doğu Hasta Asansörü ve Merdiven Çekirdeği", priority: 7 },
  { id: "l1-physical-therapy", floorPlanId: "hq-l1", minX: 5.0, maxX: 20.0, minY: 5.3, maxY: 12.0, label: "Kat 01 · Fizik Tedavi ve Rehabilitasyon", priority: 8 },
  { id: "l1-inpatient-ward", floorPlanId: "hq-l1", minX: 20.0, maxX: 35.8, minY: 5.3, maxY: 12.0, label: "Kat 01 · Ortopedi Yatan Hasta Servisi", priority: 9 },
] as const satisfies readonly LocationZone[];

export const LOCATION_ZONE_FALLBACK_LABEL = "Tanımlı alan dışında";
