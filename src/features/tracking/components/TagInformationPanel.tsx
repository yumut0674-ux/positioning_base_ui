"use client";

import { Box, MapPin, Route, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { formatLocationDuration, persistRecentTagIds, readRecentTagIds, type TagLocationEntry } from "@/src/features/tracking/services/tagPanelState";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import { roomDecisionLabel } from "../services/roomDecisionLabel";

interface TagInformationPanelProps {
  readonly onOpenHistory: (tagCode: string) => void;
  readonly variant?: "desktop" | "mobile";
  readonly onShowMap?: () => void;
}

interface TagInformationPanelContentProps extends TagInformationPanelProps {
  readonly selectedTag?: TrackedTag;
  readonly locationAddress?: string;
  readonly locationDuration: string;
  readonly tags: readonly TrackedTag[];
  readonly recentTagIds: readonly string[];
  readonly onSelectTag: (tagId: string) => void;
  readonly regionsConfig?: import("@/src/features/regions/types/region.types").RegionsConfig | null;
}

function matchesQuery(tag: TrackedTag, query: string): boolean {
  return tag.name.toLocaleLowerCase("tr-TR").startsWith(query)
    || tag.id.toLocaleLowerCase("tr-TR").startsWith(query);
}

function TagQuickList({ tags, recentTagIds, selectedTagId, onSelectTag, regionsConfig }: {
  readonly tags: readonly TrackedTag[];
  readonly recentTagIds: readonly string[];
  readonly selectedTagId?: string;
  readonly onSelectTag: (tagId: string) => void;
  readonly regionsConfig?: import("@/src/features/regions/types/region.types").RegionsConfig | null;
}) {
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const recentTitleId = `${instanceId}-recent`;
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR");
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const recentTags = useMemo(() => recentTagIds.map((tagId) => tagsById.get(tagId)).filter((tag): tag is TrackedTag => Boolean(tag)), [recentTagIds, tagsById]);
  const visibleTags = useMemo(() => tags.filter((tag) => !normalizedQuery || matchesQuery(tag, normalizedQuery)), [normalizedQuery, tags]);
  const emptyStateMessage = normalizedQuery ? `“${query.trim()}” için sonuç bulunamadı.` : "Canlı takip etiketi bekleniyor.";

  return (
    <section className="tag-switcher" aria-labelledby={titleId}>
      <div className="tag-switcher-heading"><div><small>HIZLI GEÇİŞ</small><h2 id={titleId}>Takip Etiketleri</h2></div><span>{tags.length}</span></div>
      <label className="tag-switcher-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Takip etiketi ara</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takip etiketi adı veya kodu ara" /></label>
      {!normalizedQuery && recentTags.length > 0 && <section className="recent-tags" aria-labelledby={recentTitleId}><small id={recentTitleId}>SON GÖRÜNTÜLENENLER</small><div>{recentTags.map((tag) => <button key={tag.id} type="button" onClick={() => onSelectTag(tag.id)} aria-label={`${tag.name} (${tag.id}) etiketini seç`}>{tag.name}</button>)}</div></section>}
      <div className="tag-switcher-list" role="listbox" aria-label="Takip etiketi listesi">
        {visibleTags.map((tag) => {
          const isSelected = tag.id === selectedTagId;
          const isActive = tag.status === "active";
          return <button key={tag.id} type="button" role="option" aria-selected={isSelected} className={`tag-switcher-row${isSelected ? " is-selected" : ""}`} onClick={() => onSelectTag(tag.id)}>
            <span className={`tag-switcher-status${isActive ? " is-active" : ""}`} aria-hidden="true" />
            <span className="tag-switcher-name"><strong>{tag.name}</strong><code>{tag.id}</code></span>
            <span className="tag-switcher-meta"><em>{isActive ? "CANLI" : "PASİF"}</em><small>{roomDecisionLabel(tag, regionsConfig)}</small></span>
          </button>;
        })}
        {visibleTags.length === 0 && <p className="tag-switcher-empty">{emptyStateMessage}</p>}
      </div>
    </section>
  );
}

export function TagInformationPanelContent({ selectedTag, locationAddress, locationDuration, tags, recentTagIds, onSelectTag, onOpenHistory, variant = "desktop", onShowMap, regionsConfig }: TagInformationPanelContentProps) {
  const panelLabel = selectedTag && locationAddress
    ? `Takip etiketi geçiş ve detay paneli. Seçili varlık: ${selectedTag.name}. Konum adresi: ${locationAddress}`
    : "Takip etiketi geçiş ve detay paneli";
  return (
    <motion.aside className={`tag-panel tag-panel--${variant}`} aria-label={panelLabel} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}>
      <TagQuickList tags={tags} recentTagIds={recentTagIds} selectedTagId={selectedTag?.id} onSelectTag={onSelectTag} regionsConfig={regionsConfig} />
      {selectedTag && locationAddress ? <section className="tag-details" aria-labelledby="selected-tag-title">
        <div className="tag-panel-header">
          <div className="tag-icon" style={{ color: selectedTag.color }}><Box size={19} /></div>
          <div><small>SEÇİLİ VARLIK</small><h2 id="selected-tag-title">{selectedTag.name}</h2></div>
          <span className="live-pill"><i /> {selectedTag.status === "active" ? "CANLI" : "PASİF"}</span>
        </div>
        <div className="tag-identity"><code>{selectedTag.id}</code><span>{selectedTag.status === "active" ? "aktif" : "pasif"}</span></div>
        <div className="tag-location-address">
          <div><MapPin size={14} aria-hidden="true" /><small>KONUM ADRESİ</small></div>
          <strong>{locationAddress}</strong>
          <span className="tag-location-duration"><small>BU ALANDA</small><strong>{locationDuration}</strong></span>
        </div>
        <div className="tag-detail-actions">
          {variant === "mobile" && onShowMap && <button className="show-map-button" type="button" onClick={onShowMap}><MapPin size={15} /> Haritada göster</button>}
          <button className="route-button" type="button" onClick={() => onOpenHistory(selectedTag.id)}><Route size={15} /> Rota geçmişini aç <span>↗</span></button>
        </div>
      </section> : <section className="tag-details tag-details-empty" aria-live="polite"><strong>Bir takip etiketi seçin</strong><span>Listeden bir takip etiketi seçerek konum ve rota detaylarını görüntüleyin.</span></section>}
    </motion.aside>
  );
}

function useRecentTagStorage(recentTagIds: readonly string[], enabled: boolean) {
  const hydrateRecentTagIds = useIpsStore((state) => state.hydrateRecentTagIds);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const storedTagIds = readRecentTagIds(window.localStorage);
    const timer = window.setTimeout(() => {
      hydratedRef.current = true;
      hydrateRecentTagIds(storedTagIds);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, hydrateRecentTagIds]);
  useEffect(() => {
    if (!enabled || !hydratedRef.current) return;
    persistRecentTagIds(window.localStorage, recentTagIds);
  }, [enabled, recentTagIds]);
}

function useLocationDuration(entry: TagLocationEntry | undefined, locationAddress: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!entry || entry.locationLabel !== locationAddress) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [entry, locationAddress]);
  return entry && entry.locationLabel === locationAddress
    ? `Bu alanda ${formatLocationDuration(entry.enteredAt, now)}`
    : "Konum süresi hesaplanıyor";
}

export function TagInformationPanel({ onOpenHistory, variant = "desktop", onShowMap }: TagInformationPanelProps) {
  const tagsById = useIpsStore((state) => state.tags);
  const selectedTagId = useIpsStore((state) => state.selectedTagId);
  const recentTagIds = useIpsStore((state) => state.recentTagIds);
  const locationEntry = useIpsStore((state) => selectedTagId ? state.tagLocationEntries[selectedTagId] : undefined);
  const selectTag = useIpsStore((state) => state.selectTag);
  const regionsConfig = useIpsStore((state) => state.regionsConfig);
  useRecentTagStorage(recentTagIds, variant === "desktop");

  const selectedTag = selectedTagId ? tagsById[selectedTagId] : undefined;
  const locationAddress = selectedTag ? roomDecisionLabel(selectedTag, regionsConfig) : undefined;
  const locationDuration = useLocationDuration(locationEntry, locationAddress);
  const tags = useMemo(() => Object.values(tagsById).sort((left, right) => left.name.localeCompare(right.name, "tr")), [tagsById]);
  const handleSelectTag = useCallback((tagId: string) => {
    selectTag(tagId);
  }, [selectTag]);

  return <TagInformationPanelContent selectedTag={selectedTag} locationAddress={locationAddress} locationDuration={locationDuration} tags={tags} recentTagIds={recentTagIds} onSelectTag={handleSelectTag} onOpenHistory={onOpenHistory} variant={variant} onShowMap={onShowMap} regionsConfig={regionsConfig} />;
}
