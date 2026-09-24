import { useEffect, useId, useMemo, useState } from "react";
import type { DecisionEventType } from "@/src/server/regionEngine/types";
import { fetchTags, type TagDefinition } from "@/src/features/tracking/services/tagApi";
import styles from "./decisionLogs.module.css";

export interface DecisionFilterForm {
  tagCode: string; from: string; to: string; mapId: string; regionId: string; eventType: string; measurementKind: string; importantOnly: boolean;
}

const EVENTS: readonly DecisionEventType[] = ["MEASUREMENT_ACCEPTED","MEASUREMENT_REJECTED","ENTRY_CANDIDATE","ROOM_CONFIRMED","ROOM_TRANSITIONED","ROOM_INFERRED","EXIT_CANDIDATE","ROOM_EXITED","LOCATION_LOST","CONFIG_RELOADED"];

interface Props {
  readonly value: DecisionFilterForm; readonly live: boolean; readonly disabled?: boolean; readonly error?: string | null;
  readonly onChange: (value: DecisionFilterForm) => void; readonly onApply: () => void; readonly onClear: () => void; readonly onLiveChange: (live: boolean) => void;
}

interface TagFilterProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function TagFilter({ value, onChange }: TagFilterProps) {
  const inputId = useId();
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const visibleTags = useMemo(() => {
    const query = value.trim().toLocaleLowerCase("tr-TR");
    if (!query) return tags;
    return tags.filter((tag) => `${tag.id} ${tag.displayName}`.toLocaleLowerCase("tr-TR").includes(query));
  }, [tags, value]);

  useEffect(() => {
    let active = true;
    const apply = (next: TagDefinition[]) => { if (active) { setTags(next); setLoadFailed(false); } };
    void fetchTags().then(apply).catch(() => { if (active) setLoadFailed(true); });
    const onTagsChanged = (event: Event) => apply((event as CustomEvent<TagDefinition[]>).detail ?? []);
    window.addEventListener("tag-definitions-updated", onTagsChanged);
    return () => { active = false; window.removeEventListener("tag-definitions-updated", onTagsChanged); };
  }, []);

  const choose = (tag: TagDefinition) => {
    onChange(tag.id);
    setOpen(false);
  };

  return <div className={styles.tagFilter} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={inputId}>Tag</label>
    <div className={styles.tagPicker}>
      <input id={inputId} value={value} onChange={event => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}
        placeholder="Tag adı veya kodu" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${inputId}-options`} />
      {open && <div id={`${inputId}-options`} className={styles.tagOptions} role="listbox" aria-label="Mevcut taglar">
        {visibleTags.map(tag => <button key={tag.id} type="button" role="option" aria-selected={value === tag.id} onClick={() => choose(tag)}>
          <span>{tag.displayName}</span><code>{tag.id}</code>
        </button>)}
        {!visibleTags.length && <p>{loadFailed ? "Tag listesi yüklenemedi; kodu elle yazabilirsiniz." : "Eşleşen tag bulunamadı."}</p>}
      </div>}
    </div>
  </div>;
}

export function DecisionLogFilters({ value, live, disabled, error, onChange, onApply, onClear, onLiveChange }: Props) {
  const set = <K extends keyof DecisionFilterForm>(key: K, next: DecisionFilterForm[K]) => onChange({ ...value, [key]: next });
  return <section className={styles.filters} aria-label="Karar kaydı filtreleri">
    <div className={styles.filterGrid}>
      <TagFilter value={value.tagCode} onChange={next => set("tagCode", next)} />
      <label>Başlangıç<input type="datetime-local" value={value.from} onChange={event => set("from", event.target.value)} /></label>
      <label>Bitiş<input type="datetime-local" value={value.to} onChange={event => set("to", event.target.value)} /></label>
      <label>Harita / kat<input value={value.mapId} onChange={event => set("mapId", event.target.value)} placeholder="spor-koridor" /></label>
      <label>Oda<input value={value.regionId} onChange={event => set("regionId", event.target.value)} placeholder="room-03" /></label>
      <label>Karar türü<select value={value.eventType} onChange={event => set("eventType", event.target.value)}><option value="">Tümü</option>{EVENTS.map(event => <option key={event}>{event}</option>)}</select></label>
      <label>Ölçüm türü<select value={value.measurementKind} onChange={event => set("measurementKind", event.target.value)}><option value="">Tümü</option><option value="measured">Ölçülen</option><option value="estimated">Tahmini</option><option value="uncertain">Belirsiz</option></select></label>
    </div>
    <div className={styles.filterActions}>
      <label className={styles.check}><input type="checkbox" checked={value.importantOnly} onChange={event => set("importantOnly", event.target.checked)} /> Yalnızca önemli durum değişiklikleri</label>
      <label className={styles.check}><input type="checkbox" checked={live} onChange={event => onLiveChange(event.target.checked)} /> Canlı yenileme</label>
      <span className={styles.spacer} />
      <button type="button" className={styles.secondaryButton} onClick={onClear}>Filtreleri temizle</button>
      <button type="button" className={styles.primaryButton} onClick={onApply} disabled={disabled}>Uygula</button>
    </div>
    {error && <p className={styles.validationError} role="alert">{error}</p>}
  </section>;
}
