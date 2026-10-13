import { useMemo, useState } from "react";
import { DEFAULT_DOOR_INFERENCE_SETTINGS, resolveDoorSettings, resolveGlobalSettings, resolveRoomSettings, STEP_DISTANCE_SETTING_KEYS } from "../config/regionInferenceSettings";
import type { DoorInferenceSettings, RegionDefinition, RegionEntrance, RegionsConfig, RoomInferenceSettings } from "../types/region.types";
import type { RegionEngineStatusResponse } from "../services/regionEngineApi";
import { NumberField, POSITION_FILTER_FIELDS, shown, type Field } from "./RegionFilterFields";
import styles from "./regions.module.css";

type Tab = "global" | "room" | "door" | "diagnostics";
const FIELDS: readonly Field[] = [
  { key: "entryEvidenceDurationMs", label: "Giriş kanıt süresi", group: "Giriş/çıkış kararları", seconds: true, min: 0, step: .1 },
  { key: "exitEvidenceDurationMs", label: "Çıkış kanıt süresi", group: "Giriş/çıkış kararları", seconds: true, min: 0, step: .1 },
  { key: "entryConfirmationCount", label: "Giriş ölçüm sayısı", group: "Giriş/çıkış kararları", min: 1, step: 1 },
  { key: "exitConfirmationCount", label: "Çıkış ölçüm sayısı", group: "Giriş/çıkış kararları", min: 1, step: 1 },
  { key: "roomSwitchConfirmationCount", label: "Doğrudan oda değişim ölçüm sayısı", group: "Giriş/çıkış kararları", min: 1, step: 1 },
  { key: "roomSwitchEvidenceDurationMs", label: "Doğrudan oda değişim kanıt süresi", group: "Giriş/çıkış kararları", seconds: true, min: 0, step: .1 },
  { key: "roomSwitchUncertainAfterMs", label: "Doğrudan oda değişim belirsizlik eşiği", group: "Giriş/çıkış kararları", seconds: true, min: 0, step: .1 },
  { key: "evidenceWindowMs", label: "Kanıt penceresi", group: "Kanıt penceresi", seconds: true, min: 0, step: .1 },
  { key: "maxEvidenceGapMs", label: "Azami kanıt aralığı", group: "Kanıt penceresi", seconds: true, min: 0, step: .1 },
  { key: "expectedIntervalMs", label: "Beklenen ölçüm aralığı", group: "Kanıt penceresi", seconds: true, min: .05, step: .05 },
  { key: "relocationEvidenceDurationMultiplier", label: "Yeniden konumlanma süre çarpanı", group: "Sinyal kaybı", min: .01, step: .1 },
  { key: "outsideReleaseDurationMultiplier", label: "Dışarı bırakma süre çarpanı", group: "Sinyal kaybı", min: .01, step: .1 },
  { key: "lostAfterMs", label: "Konum kayıp süresi", group: "Sinyal kaybı", seconds: true, min: 0, step: .1 },
  { key: "relocationAfterMs", label: "Yeniden konumlanma eşiği", group: "Sinyal kaybı", seconds: true, min: 0, step: .1 },
  ...POSITION_FILTER_FIELDS,
  { key: "reliableEvidenceWeight", label: "Güvenilir kanıt ağırlığı", group: "Ölçüm filtresi", min: 0, max: 10, step: .05 },
  { key: "wallEvidenceWeight", label: "Duvar kanıt ağırlığı", group: "Ölçüm filtresi", min: 0, max: 10, step: .05 },
  { key: "exitMarginMeters", label: "Çıkış payı (m)", group: "Ölçüm filtresi", min: 0, step: .05 },
  { key: "baseScore", label: "Temel kanıt skoru", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "maximumScore", label: "Azami kanıt skoru", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "durationContributionMaximum", label: "Azami süre katkısı", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "durationContributionFullAtMs", label: "Tam süre katkısı", group: "Kanıt skoru", seconds: true, min: 0, step: .1 },
  { key: "measurementContributionPerSample", label: "Ölçüm başına katkı", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "measurementContributionMaximum", label: "Azami ölçüm katkısı", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "doorEntryBonus", label: "Kapı giriş katkısı", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "doorExitBonus", label: "Kapı çıkış katkısı", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "confirmedInsideScore", label: "Doğrulanmış iç skor", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "inferredInsideMaximumScore", label: "Tahmini iç azami skor", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "invalidMeasurementMaximumScore", label: "Geçersiz ölçüm azami skor", group: "Kanıt skoru", min: 0, max: 10, step: .01 },
  { key: "regularCoverageStaleMultiplier", label: "Düzenli kapsama eskime çarpanı", group: "Kapsama zaman aşımı", min: .01, step: .1 },
  { key: "intermittentCoverageStaleMultiplier", label: "Aralıklı kapsama eskime çarpanı", group: "Kapsama zaman aşımı", min: .01, step: .1 },
  { key: "silentCoverageStaleMultiplier", label: "Sessiz kapsama eskime çarpanı", group: "Kapsama zaman aşımı", min: .01, step: .1 },
  { key: "lostAfterStaleMultiplier", label: "Kayıp/eskime çarpanı", group: "Kapsama zaman aşımı", min: .01, step: .1 },
  { key: "maxTags", label: "Azami tag", group: "Sistem ayarları", min: 1, step: 1 },
  { key: "historySize", label: "Geçmiş tamponu", group: "Sistem ayarları", min: 1, step: 1 },
];
const GLOBAL_ONLY_FIELDS = new Set<string>(["maxTags", "historySize", "evidenceDurationMs", ...STEP_DISTANCE_SETTING_KEYS]);
const ROOM_FIELDS = FIELDS.filter(field => !GLOBAL_ONLY_FIELDS.has(field.key));

function DoorDefaultsEditor({ value, onChange, title }: { value: DoorInferenceSettings; onChange: (key: keyof DoorInferenceSettings, value: DoorInferenceSettings[keyof DoorInferenceSettings]) => void; title: string }) {
  const numberFields: readonly [keyof DoorInferenceSettings, string, boolean][] = [
    ["entryEvidenceWeight", "Giriş kanıt ağırlığı", false], ["exitEvidenceWeight", "Çıkış kanıt ağırlığı", false],
    ["entryConfidenceBonus", "Giriş skor katkısı", false], ["exitConfidenceBonus", "Çıkış skor katkısı", false],
    ["crossingValidityMs", "Geçiş geçerliliği", true], ["minimumDirectionalMovementMeters", "Minimum yönlü hareket (m)", false],
    ["missingDoorEvidenceDurationMultiplier", "Kapı yoksa süre çarpanı", false], ["missingDoorEvidenceCountMultiplier", "Kapı yoksa ölçüm çarpanı", false],
  ];
  return <details><summary>{title}</summary><div className={styles.inferenceFields}>
    <label><span>Aktif</span><select value={String(value.enabled)} onChange={e => onChange("enabled", e.target.value === "true")}><option value="true">Aktif</option><option value="false">Pasif</option></select></label>
    <label><span>Kullanım yönü</span><select value={value.direction} onChange={e => onChange("direction", e.target.value as DoorInferenceSettings["direction"])}><option value="bidirectional">İki yönlü</option><option value="entry-only">Yalnız giriş</option><option value="exit-only">Yalnız çıkış</option></select></label>
    <label><span>Kanıt rolü</span><select value={value.evidenceMode} onChange={e => onChange("evidenceMode", e.target.value as DoorInferenceSettings["evidenceMode"])}><option value="required">Zorunlu</option><option value="preferred">Tercih edilen</option><option value="optional">İsteğe bağlı</option><option value="ignored">Yok say</option></select></label>
    {numberFields.map(([key, label, seconds]) => <label key={key}><span>{label}{seconds ? " (sn)" : ""}</span><input type="number" min="0" step="0.05" value={Number(value[key]) / (seconds ? 1000 : 1)} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) onChange(key, e.target.valueAsNumber * (seconds ? 1000 : 1)); }} /></label>)}
    {(["allowEstimatedEntryAfterSignalLoss", "allowEstimatedExitAfterSignalLoss"] as const).map(key => <label className={styles.overrideToggle} key={key}><input type="checkbox" checked={value[key]} onChange={e => onChange(key, e.target.checked)} />{key.includes("Entry") ? "Kesinti sonrası tahmini giriş" : "Kesinti sonrası tahmini çıkış"}</label>)}
  </div></details>;
}

export function RegionInferenceEditor({ config, region, onConfigChange, engineStatus }:
  { config: RegionsConfig; region: RegionDefinition; onConfigChange: (config: RegionsConfig) => void; engineStatus: RegionEngineStatusResponse | null }) {
  const [tab, setTab] = useState<Tab>("room"); const [doorId, setDoorId] = useState(region.entrances[0]?.id ?? "");
  const global = useMemo(() => resolveGlobalSettings(config.engine), [config.engine]);
  const effective = useMemo(() => resolveRoomSettings(config.engine, region.inference, region), [config.engine, region]);
  const coverage = region.inference?.coverage ?? region.coverage ?? "regular";
  const door = region.entrances.find(item => item.id === doorId) ?? region.entrances[0];
  const effectiveDoor = door ? resolveDoorSettings(effective, door.inference) : null;
  const updateRegion = (next: RegionDefinition) => onConfigChange({ ...config, regions: config.regions.map(item => item.id === region.id ? next : item) });
  const updateDoor = (updater: (item: RegionEntrance) => RegionEntrance) => updateRegion({ ...region, entrances: region.entrances.map(item => item.id === door?.id ? updater(item) : item) });
  const groups = (fields: readonly Field[]) => [...new Set(fields.map(field => field.group))];
  const copyFrom = (sourceId: string) => { const source = config.regions.find(item => item.id === sourceId); if (!source) return;
    if (window.confirm(`${source.name} oda ayarları ${region.name} odasına kopyalanacak.`)) updateRegion({ ...region, inference: source.inference ? { ...source.inference } : undefined }); };
  const copyToAll = () => { const targets = config.regions.filter(item => item.id !== region.id && item.kind !== "corridor");
    if (window.confirm(`${region.name} oda ayarları şu ${targets.length} odaya kopyalanacak: ${targets.map(item => item.name).join(", ")}`)) onConfigChange({ ...config,
      regions: config.regions.map(item => targets.some(target => target.id === item.id) ? { ...item, inference: region.inference ? { ...region.inference } : undefined } : item) }); };
  const applyField = (field: Field, ids: readonly string[]) => { const targets = config.regions.filter(item => ids.includes(item.id) && item.kind !== "corridor"); const value = effective[field.key as keyof typeof effective];
    if (!targets.length || !window.confirm(`${field.label} = ${shown(field, Number(value))} değeri şu odalara uygulanacak: ${targets.map(item => item.name).join(", ")}`)) return;
    onConfigChange({ ...config, regions: config.regions.map(item => targets.some(target => target.id === item.id) ? { ...item, inference: { ...item.inference, [field.key]: value } } : item) }); };
  const applyFieldToSelected = (field: Field) => { const answer = window.prompt(`Uygulanacak oda kimliklerini virgülle girin:\n${config.regions.filter(item => item.kind !== "corridor").map(item => `${item.id} (${item.name})`).join(", ")}`);
    if (answer) applyField(field, answer.split(",").map(value => value.trim()).filter(Boolean)); };
  const resetGroup = (group: string) => { const fields = ROOM_FIELDS.filter(field => field.group === group); const changed = fields.filter(field => region.inference?.[field.key as keyof RoomInferenceSettings] !== undefined);
    if (!changed.length || !window.confirm(`${region.name} için ${group} grubundaki şu override değerleri temizlenecek: ${changed.map(field => field.label).join(", ")}`)) return;
    const next = { ...region.inference } as Record<string, unknown>; fields.forEach(field => delete next[field.key]); updateRegion({ ...region, inference: Object.keys(next).length ? next as RoomInferenceSettings : undefined }); };
  const clearAll = () => { const rooms = config.regions.filter(item => item.kind !== "corridor");
    if (window.confirm(`${rooms.length} odadaki bütün oda override değerleri temizlenecek.`)) onConfigChange({ ...config, regions: config.regions.map(item => ({ ...item, inference: undefined })) }); };
  return <section className={styles.inferenceEditor}>
    <div className={styles.inferenceTabs}>{(["global", "room", "door", "diagnostics"] as const).map(value => <button type="button" key={value} className={tab === value ? styles.activeInferenceTab : ""} onClick={() => setTab(value)}>{({ global: "Genel", room: "Oda", door: "Kapı", diagnostics: "Canlı teşhis" })[value]}</button>)}</div>
    {tab === "global" && <div><h3>Genel motor ayarları</h3><p className={styles.settingHelp}>Süreler arayüzde saniye, config içinde milisaniye tutulur. Kanıt skoru olasılık değildir.</p>
      {groups(FIELDS).map(group => <details key={group} open={group !== "Kanıt skoru" && group !== "Sistem ayarları"}><summary>{group}</summary><div className={styles.inferenceFields}>{FIELDS.filter(field => field.group === group).map(field => <NumberField key={field.key} field={field} value={Number(global[field.key])} onChange={value => onConfigChange({ ...config, engine: { ...config.engine, [field.key]: value } })} />)}</div></details>)}
      <DoorDefaultsEditor title="Global kapı varsayılanları" value={{ ...DEFAULT_DOOR_INFERENCE_SETTINGS, ...global.doorDefaults }} onChange={(key, value) => onConfigChange({ ...config, engine: { ...config.engine, doorDefaults: { ...config.engine?.doorDefaults, [key]: value } } })} /></div>}
    {tab === "room" && <div><h3>Oda özel ayarları</h3>
      <div className={styles.inferenceFields}><label><span>Alan türü</span><select value={region.kind ?? (/^corridor/.test(region.id) ? "corridor" : "room")} onChange={e => updateRegion({ ...region, kind: e.target.value as "room" | "corridor" })}><option value="room">Oda</option><option value="corridor">Koridor · hareketli takip</option></select></label>
        <label><span>Kapsama</span><select value={coverage} onChange={e => updateRegion({ ...region, inference: { ...region.inference, coverage: e.target.value as RoomInferenceSettings["coverage"] } })}><option value="regular">Düzenli ölçüm</option><option value="intermittent">Aralıklı ölçüm</option><option value="silent">Sessiz kapsama</option></select></label>
        {region.kind !== "corridor" && <label><span>Sessiz oda kapı yakınlık mesafesi (m)</span><input type="number" min="0" max="20" step="0.05" placeholder="Varsayılan: 0" disabled={coverage !== "silent"} value={region.inference?.silentEntryMaxDistanceMeters ?? ""} onChange={e => updateRegion({ ...region, inference: { ...region.inference, silentEntryMaxDistanceMeters: e.target.value === "" ? undefined : e.target.valueAsNumber } })} /><small>Etkili: {effective.silentEntryMaxDistanceMeters} m · 0 kapalı</small></label>}
        <label><span>Duvar bandı (m)</span><input type="number" min="0" step="0.05" value={effective.wallBandMeters} onChange={e => updateRegion({ ...region, inference: { ...region.inference, wallBandMeters: e.target.valueAsNumber } })} /></label>
        <label><span>Ortak duvar bandı (m)</span><input type="number" min="0" step="0.05" value={effective.sharedWallBandMeters} onChange={e => updateRegion({ ...region, inference: { ...region.inference, sharedWallBandMeters: e.target.valueAsNumber } })} /></label></div>
      {region.kind !== "corridor" && groups(ROOM_FIELDS).map(group => <details key={group}><summary>{group}</summary><div className={styles.overrideGrid}>{ROOM_FIELDS.filter(field => field.group === group).map(field => { const overridden = region.inference?.[field.key as keyof RoomInferenceSettings] !== undefined;
        return <div className={styles.overrideRow} key={field.key}><label className={styles.overrideToggle}><input type="checkbox" checked={overridden} onChange={e => { const next = { ...region.inference } as Record<string, unknown>; if (e.target.checked) next[field.key] = effective[field.key as keyof typeof effective]; else delete next[field.key]; updateRegion({ ...region, inference: Object.keys(next).length ? next as RoomInferenceSettings : undefined }); }} /> Bu oda için özelleştir</label>
          <NumberField field={field} value={Number(effective[field.key as keyof typeof effective])} disabled={!overridden} onChange={value => updateRegion({ ...region, inference: { ...region.inference, [field.key]: value } })} />
          <small>Global: {shown(field, Number(global[field.key]))} · Etkili: {shown(field, Number(effective[field.key as keyof typeof effective]))} · Kaynak: {overridden ? "Oda ayarı" : field.key === "expectedIntervalMs" && region.expectedIntervalMs !== undefined ? "Odanın eski alanı" : config.engine?.[field.key] !== undefined || ((field.key === "entryEvidenceDurationMs" || field.key === "exitEvidenceDurationMs") && config.engine?.evidenceDurationMs !== undefined) ? "Global ayar" : "Sistem varsayılanı"}</small>
          <div className={styles.rowActions}><button type="button" onClick={() => applyField(field, config.regions.filter(item => item.kind !== "corridor").map(item => item.id))}>Tüm odalara uygula</button><button type="button" onClick={() => applyFieldToSelected(field)}>Belirli odalara uygula</button></div></div>; })}</div><button className={styles.resetGroup} type="button" onClick={() => resetGroup(group)}>Yalnızca bu grubu sıfırla</button></details>)}
      {region.kind !== "corridor" && <DoorDefaultsEditor title="Bu odanın kapı varsayılanları" value={effective.doorDefaults} onChange={(key, value) => updateRegion({ ...region, inference: { ...region.inference, doorDefaults: { ...region.inference?.doorDefaults, [key]: value } } })} />}
      <div className={styles.bulkActions}><select aria-label="Başka odadan ayarları kopyala" defaultValue="" onChange={e => { copyFrom(e.target.value); e.target.value = ""; }}><option value="">Başka odadan kopyala…</option>{config.regions.filter(item => item.id !== region.id && item.kind !== "corridor").map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
        <button type="button" onClick={copyToAll}>Bu odanın ayarlarını diğer odalara kopyala</button><button type="button" onClick={() => updateRegion({ ...region, inference: undefined })}>Bu odayı varsayılana döndür</button><button type="button" onClick={clearAll}>Tüm oda override’larını temizle</button></div></div>}
    {tab === "door" && <div><h3>Kapı ayarları</h3>{!door ? <p className={styles.settingHelp}>Bu odada kapı tanımı yok. Haritadan bir giriş ekleyin.</p> : <>
      <select className={styles.doorPicker} value={door.id} onChange={e => setDoorId(e.target.value)}>{region.entrances.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <label className={styles.overrideToggle}><input type="checkbox" checked={door.inference !== undefined} onChange={e => updateDoor(item => ({ ...item, inference: e.target.checked ? { ...effective.doorDefaults } : undefined }))} /> Bu kapı için özelleştir</label>
      <div className={styles.inferenceFields}><label><span>Kapı adı</span><input value={door.label} onChange={e => updateDoor(item => ({ ...item, label: e.target.value }))} /></label>
        <label><span>Bağlandığı alan</span><input value={door.connectsTo ?? ""} onChange={e => updateDoor(item => ({ ...item, connectsTo: e.target.value || undefined }))} /></label>
         {(["widthMeters", "approachDepthMeters", "crossingDepthMeters"] as const).map((key, index) => <label key={key}><span>{["Genişlik (m)", "Yaklaşma derinliği (m)", "Geçiş derinliği (m)"][index]}</span><input type="number" min="0" step="0.05" value={door[key] ?? ""} onChange={e => updateDoor(item => ({ ...item, [key]: e.target.value === "" ? undefined : e.target.valueAsNumber }))} />{key !== "widthMeters" && <small>Etkili: {door[key] ?? (key === "approachDepthMeters" ? 2 : 0.15)} m</small>}</label>)}
        <label><span>Normal X</span><input type="number" step="0.1" value={door.inwardNormal?.x ?? ""} onChange={e => updateDoor(item => ({ ...item, inwardNormal: { x: e.target.valueAsNumber, y: item.inwardNormal?.y ?? 0 } }))} /></label><label><span>Normal Y</span><input type="number" step="0.1" value={door.inwardNormal?.y ?? ""} onChange={e => updateDoor(item => ({ ...item, inwardNormal: { x: item.inwardNormal?.x ?? 0, y: e.target.valueAsNumber } }))} /></label>
        <label><span>Aktif</span><select disabled={!door.inference} value={String(effectiveDoor?.enabled)} onChange={e => updateDoor(item => ({ ...item, inference: { ...item.inference, enabled: e.target.value === "true" } }))}><option value="true">Aktif</option><option value="false">Pasif</option></select></label>
        <label><span>Kullanım yönü</span><select disabled={!door.inference} value={effectiveDoor?.direction} onChange={e => updateDoor(item => ({ ...item, inference: { ...item.inference, direction: e.target.value as DoorInferenceSettings["direction"] } }))}><option value="bidirectional">İki yönlü</option><option value="entry-only">Yalnız giriş</option><option value="exit-only">Yalnız çıkış</option></select></label>
        <label><span>Kanıt rolü</span><select disabled={!door.inference} value={effectiveDoor?.evidenceMode} onChange={e => updateDoor(item => ({ ...item, inference: { ...item.inference, evidenceMode: e.target.value as DoorInferenceSettings["evidenceMode"] } }))}><option value="required">Zorunlu</option><option value="preferred">Tercih edilen</option><option value="optional">İsteğe bağlı</option><option value="ignored">Yok say</option></select></label>
        {(["entryEvidenceWeight", "exitEvidenceWeight", "entryConfidenceBonus", "exitConfidenceBonus", "minimumDirectionalMovementMeters", "missingDoorEvidenceDurationMultiplier", "missingDoorEvidenceCountMultiplier"] as const).map(key => <label key={key}><span>{({ entryEvidenceWeight: "Giriş ağırlığı", exitEvidenceWeight: "Çıkış ağırlığı", entryConfidenceBonus: "Giriş skor katkısı", exitConfidenceBonus: "Çıkış skor katkısı", minimumDirectionalMovementMeters: "Minimum yönlü hareket (m)", missingDoorEvidenceDurationMultiplier: "Kapı yoksa süre çarpanı", missingDoorEvidenceCountMultiplier: "Kapı yoksa ölçüm çarpanı" })[key]}</span><input disabled={!door.inference} type="number" min="0" step="0.05" value={effectiveDoor?.[key] ?? 0} onChange={e => updateDoor(item => ({ ...item, inference: { ...item.inference, [key]: e.target.valueAsNumber } }))} /></label>)}
        <label><span>Geçiş geçerliliği (sn)</span><input disabled={!door.inference} type="number" min="0" step="0.1" value={(effectiveDoor?.crossingValidityMs ?? 0) / 1000} onChange={e => updateDoor(item => ({ ...item, inference: { ...item.inference, crossingValidityMs: e.target.valueAsNumber * 1000 } }))} /></label>
        {(["allowEstimatedEntryAfterSignalLoss", "allowEstimatedExitAfterSignalLoss"] as const).map(key => <label className={styles.overrideToggle} key={key}><input disabled={!door.inference} type="checkbox" checked={effectiveDoor?.[key] ?? false} onChange={e => updateDoor(item => ({ ...item, inference: { ...item.inference, [key]: e.target.checked } }))} />{key.includes("Entry") ? "Kesinti sonrası tahmini giriş" : "Kesinti sonrası tahmini çıkış"}</label>)}</div>
       <p className={styles.settingHelp}>Her kapı alanında tanımlı en yakın değer kullanılır: kapı → oda → global → sistem varsayılanı.</p></>}</div>}
    {tab === "diagnostics" && <div><h3>Canlı teşhis</h3><p className={styles.settingHelp}>Salt okunur; motor kararını etkilemez. Config: {engineStatus?.configVersion ?? "yüklenmedi"}</p>
      {(engineStatus?.diagnostics ?? []).length === 0 ? <p className={styles.settingHelp}>Henüz aktif tag teşhisi yok.</p> : (engineStatus?.diagnostics ?? []).map(item => <article className={styles.diagnosticCard} key={item.vehicleId}><strong>{item.vehicleId} · {item.state}</strong><span>Aktif: {item.activeRegionId ?? "—"} · Aday: {item.candidateRegionId ?? "—"}</span><span>Kapı: {item.doorId ?? "—"} / {item.doorDirection ?? "—"} / {item.doorEvidenceMode ?? "—"}</span>{item.silentDoorCandidateDoorId && <span>Sessiz kapı adayı: {item.silentDoorCandidateRegionId} / {item.silentDoorCandidateDoorId} / {item.silentDoorDistanceMeters?.toFixed(2)} m</span>}<span>Kanıt: {(item.collectedDurationMs / 1000).toFixed(1)}/{(item.requiredDurationMs / 1000).toFixed(1)} sn · {item.collectedMeasurements}/{item.requiredMeasurements} ölçüm</span><span>Kalite: {item.lastMeasurementQuality ?? "—"} · Skor: {item.score.total.toFixed(3)}</span><small>{item.reasons.join(" · ")}</small></article>)}</div>}
  </section>;
}
