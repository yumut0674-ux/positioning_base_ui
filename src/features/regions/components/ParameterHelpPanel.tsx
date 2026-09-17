"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  filterParameterHelpItems,
  PARAMETER_HELP_GROUPS,
  type ParameterHelpItem,
} from "../config/inferenceParameterHelp";
import styles from "./regions.module.css";

interface ParameterHelpPanelProps {
  readonly id: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

function HelpItem({ item }: { readonly item: ParameterHelpItem }) {
  return (
    <article className={styles.parameterHelpItem} data-parameter-id={item.id}>
      <div className={styles.parameterHelpItemTitle}>
        <strong>{item.label}</strong>
        <span className={styles.parameterBadge}>{item.advanced ? "Gelişmiş" : "Temel"}</span>
        {item.unit && <span className={styles.parameterUnit}>{item.unit}</span>}
      </div>
      <p>{item.description}</p>
      <p><b>Etkisi:</b> {item.effect}</p>
      {(item.increaseEffect || item.decreaseEffect) && (
        <div className={styles.parameterDirectionEffects}>
          {item.increaseEffect && <p><b>Artırılırsa:</b> {item.increaseEffect}</p>}
          {item.decreaseEffect && <p><b>Azaltılırsa:</b> {item.decreaseEffect}</p>}
        </div>
      )}
      {item.formula && <pre className={styles.parameterFormula}>{item.formula}</pre>}
      {item.example && <div className={styles.parameterExample}><b>Örnek:</b> {item.example}</div>}
      {item.warning && <div className={styles.parameterItemWarning}><b>Dikkat:</b> {item.warning}</div>}
    </article>
  );
}

export function ParameterHelpPanel({ id, open, onClose }: ParameterHelpPanelProps) {
  const [query, setQuery] = useState("");
  const [includeAdvanced, setIncludeAdvanced] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(["Temel oda ve geometri"]),
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const filteredItems = useMemo(
    () => filterParameterHelpItems(query, query.trim().length > 0 || includeAdvanced),
    [includeAdvanced, query],
  );
  const groupedItems = useMemo(() => PARAMETER_HELP_GROUPS.map(group => ({
    group,
    items: filteredItems.filter(item => item.group === group),
  })).filter(entry => entry.items.length > 0), [filteredItems]);

  const toggleGroup = (group: string, nextOpen: boolean) => {
    if (query.trim()) return;
    setOpenGroups(current => {
      const next = new Set(current);
      if (nextOpen) next.add(group);
      else next.delete(group);
      return next;
    });
  };

  return (
    <section
      id={id}
      className={styles.parameterHelpPanel}
      aria-labelledby={`${id}-title`}
      hidden={!open}
    >
      <div className={styles.parameterHelpHeader}>
        <div>
          <span>BAŞVURU KILAVUZU</span>
          <h2 id={`${id}-title`}>Özellik ve Hesaplama Rehberi</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Özellik ve hesaplama rehberini kapat" title="Kapat">
          <X size={15} />
        </button>
      </div>

      <p className={styles.parameterHelpIntro}>
        Oda geometrisinin, motor eşiklerinin, kanıt skorunun ve kapı politikasının karara nasıl katıldığını açıklar. Bu rehber salt okunurdur; açılması veya aranması ayarları değiştirmez.
      </p>

      <div className={styles.parameterWarning} role="note">
        <strong>Kanıt skoru bir olasılık değildir</strong>
        <p>Kanıt skoru kalibre edilmiş bir olasılık değildir. Örneğin 0,80 değeri doğrudan %80 doğruluk anlamına gelmez.</p>
      </div>

      <label className={styles.parameterHelpSearch}>
        <Search size={14} aria-hidden="true" />
        <span className={styles.srOnly}>Parametre ara</span>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          placeholder="Parametre veya açıklama ara…"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Aramayı temizle"><X size={13} /></button>}
      </label>

      <div className={styles.parameterHelpMode} role="group" aria-label="Parametre ayrıntı düzeyi">
        <button type="button" className={!includeAdvanced ? styles.parameterHelpModeActive : ""} onClick={() => setIncludeAdvanced(false)}>Temel</button>
        <button type="button" className={includeAdvanced ? styles.parameterHelpModeActive : ""} onClick={() => setIncludeAdvanced(true)}>Temel + gelişmiş</button>
      </div>

      {filteredItems.length === 0 ? (
        <div className={styles.parameterHelpEmpty} role="status">
          <strong>Sonuç bulunamadı</strong>
          <span>Farklı bir parametre adı veya açıklama sözcüğü deneyin.</span>
        </div>
      ) : (
        <div className={styles.parameterHelpGroups}>
          {groupedItems.map(({ group, items }) => (
            <details
              key={group}
              className={styles.parameterHelpGroup}
              open={Boolean(query.trim()) || openGroups.has(group)}
              onToggle={event => toggleGroup(group, event.currentTarget.open)}
            >
              <summary><span>{group}</span><small>{items.length} başlık</small></summary>
              <div>{items.map(item => <HelpItem key={item.id} item={item} />)}</div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
