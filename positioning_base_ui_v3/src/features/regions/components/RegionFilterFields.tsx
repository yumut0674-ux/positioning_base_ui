import type { GlobalRegionEngineSettings } from "../types/region.types";

export type NumericKey = Exclude<keyof GlobalRegionEngineSettings, "doorDefaults">;
export interface Field {
  readonly key: NumericKey;
  readonly label: string;
  readonly group: string;
  readonly seconds?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

// Both editors use the same fields and units for the existing engine settings.
export const POSITION_FILTER_FIELDS: readonly Field[] = [
  { key: "maximumSpeedMetersPerSecond", label: "Azami hız (m/sn)", group: "Ölçüm filtresi", min: 0, step: .1 },
  { key: "maximumStepDistanceMeters", label: "Azami nokta mesafesi (m, 0: kapalı)", group: "Mesafe filtresi", min: 0, max: 100, step: .1 },
  { key: "relocationConfirmationCount", label: "Yeni konum doğrulama ölçümü", group: "Mesafe filtresi", min: 2, max: 100, step: 1 },
  { key: "relocationConfirmationDurationMs", label: "Yeni konum doğrulama süresi", group: "Mesafe filtresi", seconds: true, min: .001, step: .1 },
  { key: "relocationClusterRadiusMeters", label: "Yeni konum aday yarıçapı (m)", group: "Mesafe filtresi", min: .01, max: 100, step: .1 },
  { key: "relocationMaximumGapMs", label: "Aday ölçümler arası azami boşluk", group: "Mesafe filtresi", seconds: true, min: .001, step: .1 },
  { key: "relocationCandidateWindowMs", label: "Yeni konum aday penceresi", group: "Mesafe filtresi", seconds: true, min: .001, step: .1 },
  { key: "movementToleranceMeters", label: "Hareket toleransı (m)", group: "Ölçüm filtresi", min: 0, step: .05 },
  { key: "minimumHardwareQuality", label: "Asgari donanım kalitesi", group: "Ölçüm filtresi", min: 0, max: 1, step: .05 },
];

export function shown(field: Field, value: number) { return field.seconds ? value / 1000 : value; }

export function NumberField({ field, value, onChange, disabled = false }: {
  field: Field; value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <label><span>{field.label}{field.seconds ? " (sn)" : ""}</span>
    <input type="number" value={shown(field, value)} min={field.min} max={field.max} step={field.step ?? "any"} disabled={disabled}
      onChange={event => Number.isFinite(event.target.valueAsNumber) && onChange(field.seconds ? event.target.valueAsNumber * 1000 : event.target.valueAsNumber)} />
  </label>;
}
