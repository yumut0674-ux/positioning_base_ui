export interface LocationZone {
  readonly id: string;
  readonly floorPlanId: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly label: string;
  readonly priority: number;
}

export const LOCATION_ZONES = [
  { id: "l1-asrs", floorPlanId: "hq-l1", minX: 28.3, maxX: 37.7, minY: 14.0, maxY: 19.4, label: "Kat 01 · Kitap Silosu (ASRS)", priority: 1 },
  { id: "l1-north-service", floorPlanId: "hq-l1", minX: 23.8, maxX: 28.3, minY: 14.0, maxY: 20.5, label: "Kat 01 · Kuzey Servis ve Çekirdek Alanı", priority: 2 },
  { id: "l1-classrooms", floorPlanId: "hq-l1", minX: 5.0, maxX: 23.8, minY: 14.0, maxY: 20.5, label: "Kat 01 · Derslik Bloğu", priority: 3 },
  { id: "l1-central-corridor", floorPlanId: "hq-l1", minX: 5.0, maxX: 37.7, minY: 12.0, maxY: 14.0, label: "Kat 01 · Orta Sirkülasyon Koridoru", priority: 4 },
  { id: "l1-west-core", floorPlanId: "hq-l1", minX: 6.3, maxX: 8.0, minY: 5.3, maxY: 12.0, label: "Kat 01 · Batı Merdiven / Çekirdek", priority: 5 },
  { id: "l1-east-core", floorPlanId: "hq-l1", minX: 35.8, maxX: 37.7, minY: 5.3, maxY: 12.0, label: "Kat 01 · Doğu Merdiven / Çekirdek", priority: 6 },
  { id: "l1-main-area", floorPlanId: "hq-l1", minX: 5.0, maxX: 37.7, minY: 5.3, maxY: 12.0, label: "Kat 01 · Ana Derslik / Açık Alan", priority: 7 },
] as const satisfies readonly LocationZone[];

export const LOCATION_ZONE_FALLBACK_LABEL = "Kat 01 · Tanımlı alan dışında";
