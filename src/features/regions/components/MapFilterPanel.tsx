import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { resolveGlobalSettings } from "../config/regionInferenceSettings";
import { DEFAULT_MAP_DISPLAY_CONFIG } from "@/src/features/tracking/config/mapDisplayConfig";
import type { RegionsConfig } from "../types/region.types";
import { MapPdopFilterEditor } from "./MapPdopFilterEditor";
import { NumberField, POSITION_FILTER_FIELDS, type Field } from "./RegionFilterFields";
import styles from "./regions.module.css";

export function MapFilterPanel({ mapId, config, onConfigChange }: {
  mapId: string; config: RegionsConfig; onConfigChange: (config: RegionsConfig) => void;
}) {
  const settings = resolveGlobalSettings(config.engine);
  const distanceFields = POSITION_FILTER_FIELDS.filter(field => field.group === "Mesafe filtresi");
  const measurementFields = POSITION_FILTER_FIELDS.filter(field => field.group === "Ölçüm filtresi");
  const renderField = (field: Field) => <NumberField key={field.key} field={field} value={Number(settings[field.key])}
    onChange={value => onConfigChange({ ...config, engine: { ...config.engine, [field.key]: value } })} />;

  return <details className={styles.mapFilters} aria-label="Harita filtreleri">
    <summary className={styles.mapFiltersHeading}>
      <SlidersHorizontal size={15} aria-hidden="true" />
      <div><strong>Harita filtreleri</strong><span>PDOP · mesafe · hız · kalite</span></div>
      <ChevronDown className={styles.mapFiltersChevron} size={15} aria-hidden="true" />
    </summary>
    <div className={styles.mapFilterBody}>
      <MapPdopFilterEditor mapId={mapId} />
      <details className={styles.filterGroup}>
        <summary><strong>Mesafe filtresi</strong><span>{settings.maximumStepDistanceMeters > 0 ? `Açık · ${settings.maximumStepDistanceMeters} m` : "Kapalı · 0 m"}</span></summary>
        <div className={styles.filterGroupBody}>
          <p>Seçili haritadaki tüm etiketlere uygulanır. 0 değeri mesafe filtresini kapatır.</p>
          {distanceFields.filter(field => field.key === "maximumStepDistanceMeters").map(renderField)}
          <details className={styles.filterAdvanced}>
            <summary>Yeni konum doğrulama</summary>
            {distanceFields.filter(field => field.key !== "maximumStepDistanceMeters").map(renderField)}
            <p>Eşiği aşan noktalar aday olarak izlenir. Yeni konum, gerekli ölçüm sayısı ve süre sağlanınca kabul edilir.</p>
          </details>
        </div>
      </details>
      <details className={styles.filterGroup}>
        <summary><strong>Hız ve kalite filtresi</strong><span>{settings.maximumSpeedMetersPerSecond} m/sn · kalite ≥ {settings.minimumHardwareQuality}</span></summary>
        <div className={styles.filterGroupBody}>
          {measurementFields.map(renderField)}
          <p>Hız kontrolü hareket toleransını kullanır. Bu değerler harita varsayılanlarıdır; oda için tanımlanmış özel hız ve kalite ayarları geçerliliğini korur.</p>
        </div>
      </details>
      <details className={styles.filterGroup}>
        <summary><strong>Harita gösterimi</strong><span>Alan dışı bekleme · {config.mapDisplay?.outsideHoldMs ?? DEFAULT_MAP_DISPLAY_CONFIG.outsideHoldMs} ms</span></summary>
        <div className={styles.filterGroupBody}>
          <label><span>Alan dışı gösterim bekleme süresi (ms)</span>
            <input type="number" min={0} max={3600000} step={100}
              value={config.mapDisplay?.outsideHoldMs ?? DEFAULT_MAP_DISPLAY_CONFIG.outsideHoldMs}
              onChange={event => {
                const value = event.target.valueAsNumber;
                if (Number.isInteger(value) && value >= 0 && value <= 3600000) {
                  onConfigChange({ ...config, mapDisplay: { ...config.mapDisplay, outsideHoldMs: value } });
                }
              }} />
          </label>
          <p>Tag bu süre boyunca son geçerli konumda tutulur, ardından haritada gizlenir.</p>
        </div>
      </details>
      <p className={styles.filterSaveHelp}>Mesafe, hız, kalite ve gösterim değişiklikleri üstteki <strong>Kaydet</strong> düğmesiyle uygulanır. PDOP kendi düğmesiyle kaydedilir.</p>
    </div>
  </details>;
}
