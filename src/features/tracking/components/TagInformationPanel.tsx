"use client";

import { Box, MapPin, Route, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { formatLocationDuration, persistRecentTagIds, readRecentTagIds, type TagLocationEntry } from "@/src/features/tracking/services/tagPanelState";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import { roomDecisionLabel } from "../services/roomDecisionLabel";
import type { MapTagDisplay } from "../services/MapDisplayFilter";
import type { MapCatalog } from "@/src/server/maps/map.types";
import type { TagPresenceState } from "../types/tagPresence.types";
import { hiddenOnMapLabel, lastDataAgeLabel, lastObservedLocationLabel } from "../services/tagPresencePresentation";
import { useTagPresenceClock } from "../hooks/useTagPresenceClock";
import { tagActivityPresentation, type TagActivity } from "../services/tagActivityPresentation";
import { buildTagQuickList } from "../services/tagQuickList";

const TAG_ACTIVITY_ORDER: Record<TagActivity, number> = { moving: 0, stationary: 1, offline: 2 };

interface TagInformationPanelProps {
  readonly onOpenHistory: (tagCode: string) => void;
  readonly variant?: "desktop" | "mobile";
  readonly onShowMap?: () => void;
  readonly catalog?: MapCatalog;
}

interface TagInformationPanelContentProps extends TagInformationPanelProps {
  readonly presenceById?: Record<string, TagPresenceState>;
  readonly now?: number;
  readonly presenceNotice?: string | null;
  readonly mapTagDisplays?: Record<string, MapTagDisplay>;
  readonly selectedTag?: TrackedTag;
  readonly locationAddress?: string;
  readonly locationDuration: string;
  readonly tags: readonly TrackedTag[];
  readonly recentTagIds: readonly string[];
  readonly onSelectTag: (tagId: string) => void;
  readonly regionsConfig?: import("@/src/features/regions/types/region.types").RegionsConfig | null;
  readonly catalog?: MapCatalog;
}

function matchesQuery(tag: TrackedTag, query: string): boolean {
  return tag.name.toLocaleLowerCase("tr-TR").startsWith(query)
    || tag.id.toLocaleLowerCase("tr-TR").startsWith(query);
}

function TagQuickList({ tags, recentTagIds, selectedTagId, onSelectTag, regionsConfig, catalog, presenceById, now }: {
  readonly presenceById?: Record<string, TagPresenceState>;
  readonly now: number;
  readonly mapTagDisplays?: Record<string, MapTagDisplay>;
  readonly tags: readonly TrackedTag[];
  readonly recentTagIds: readonly string[];
  readonly selectedTagId?: string;
  readonly onSelectTag: (tagId: string) => void;
  readonly regionsConfig?: import("@/src/features/regions/types/region.types").RegionsConfig | null;
  readonly catalog?: MapCatalog;
}) {
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const recentTitleId = `${instanceId}-recent`;
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR");
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const recentTags = useMemo(() => recentTagIds.map((tagId) => tagsById.get(tagId)).filter((tag): tag is TrackedTag => Boolean(tag)), [recentTagIds, tagsById]);
  const visibleTags = useMemo(() => tags
    .filter((tag) => !normalizedQuery || matchesQuery(tag, normalizedQuery))
    .map((tag) => ({ tag, activity: tagActivityPresentation(tag, presenceById?.[tag.id], now) }))
    .sort((left, right) => TAG_ACTIVITY_ORDER[left.activity.activity] - TAG_ACTIVITY_ORDER[right.activity.activity]
      || left.tag.name.localeCompare(right.tag.name, "tr")), [normalizedQuery, tags, presenceById, now]);
  const emptyStateMessage = normalizedQuery ? `“${query.trim()}” için sonuç bulunamadı.` : "Henüz takip etiketi bulunmuyor.";

  return (
    <section className="tag-switcher" aria-labelledby={titleId}>
      <div className="tag-switcher-heading"><div><small>HIZLI GEÇİŞ</small><h2 id={titleId}>Takip Etiketleri</h2></div><span>{tags.length}</span></div>
      <label className="tag-switcher-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Takip etiketi ara</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takip etiketi adı veya kodu ara" /></label>
      {!normalizedQuery && recentTags.length > 0 && <section className="recent-tags" aria-labelledby={recentTitleId}><small id={recentTitleId}>SON GÖRÜNTÜLENENLER</small><div>{recentTags.map((tag) => <button key={tag.id} type="button" onClick={() => onSelectTag(tag.id)} aria-pressed={tag.id === selectedTagId} aria-label={`${tag.name} (${tag.id}) ${tag.id === selectedTagId ? "etiketinin seçimini kaldır" : "etiketini seç"}`}>{tag.name}</button>)}</div></section>}
      <div className="tag-switcher-list" role="listbox" aria-label="Takip etiketi listesi">
        {visibleTags.map(({ tag, activity }) => {
          const isSelected = tag.id === selectedTagId;
          const presence = presenceById?.[tag.id];
          const hidden = presence?.hiddenForNoData;
          return <button key={tag.id} type="button" role="option" aria-selected={isSelected} className={`tag-switcher-row${isSelected ? " is-selected" : ""}${hidden ? " is-stale-location" : ""}`} onClick={() => onSelectTag(tag.id)}>
            <span className={`tag-switcher-status${activity.isLiveColor ? " is-active" : ""}`} aria-hidden="true" />
            <span className="tag-switcher-name"><strong>{tag.name}</strong><code>{tag.id}</code></span>
            <span className={`tag-switcher-meta${activity.isLiveColor ? " is-active" : ""}`}><em>{activity.label.toLocaleUpperCase("tr-TR")}</em>{hidden && <em className="tag-reliability-status">Güvenilir değil</em>}{hidden && presence ? <small className="tag-last-location">Son görüldüğü yer: {lastObservedLocationLabel(presence)}</small> : <><small>{catalog?.maps.find((map) => map.id === tag.mapId)?.displayName ?? (tag.mapId ? tag.mapId : "Kat belirlenemedi")}</small><small>{tag.timestamp > 0 ? roomDecisionLabel(tag, regionsConfig) : "Henüz veri alınmadı"}</small></>}</span>
          </button>;
        })}
        {visibleTags.length === 0 && <p className="tag-switcher-empty">{emptyStateMessage}</p>}
      </div>
    </section>
  );
}

export function TagInformationPanelContent({ selectedTag, locationAddress, locationDuration, tags, recentTagIds, onSelectTag, onOpenHistory, variant = "desktop", onShowMap, regionsConfig, mapTagDisplays, catalog, presenceById, now: suppliedNow, presenceNotice }: TagInformationPanelContentProps) {
  const [initialNow] = useState(Date.now);
  const now = suppliedNow ?? initialNow;
  const presence = selectedTag ? presenceById?.[selectedTag.id] : undefined;
  const hidden = presence?.hiddenForNoData;
  const selectedDisplay = selectedTag ? mapTagDisplays?.[selectedTag.id] : undefined;
  const activity = tagActivityPresentation(selectedTag, presence, now);
  const noLocation = !selectedTag || selectedTag.timestamp <= 0;
  const panelLabel = selectedTag && locationAddress
    ? `Takip etiketi geçiş ve detay paneli. Seçili varlık: ${selectedTag.name}. Konum adresi: ${locationAddress}`
    : "Takip etiketi geçiş ve detay paneli";
  return (
    <motion.aside className={`tag-panel tag-panel--${variant}`} aria-label={panelLabel} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}>
      {presenceNotice && <p className="tag-presence-notice" role="status">{presenceNotice}</p>}
      <TagQuickList tags={tags} recentTagIds={recentTagIds} selectedTagId={selectedTag?.id} onSelectTag={onSelectTag} regionsConfig={regionsConfig} catalog={catalog} presenceById={presenceById} now={now} />
      {selectedTag && locationAddress ? <section className="tag-details" aria-labelledby="selected-tag-title">
        <div className="tag-panel-header">
          <div className={`tag-icon${activity.isLiveColor ? " is-active" : ""}`} style={{ color: activity.color }}><Box size={19} /></div>
          <div><small>SEÇİLİ VARLIK</small><h2 id="selected-tag-title">{selectedTag.name}</h2></div>
          <span className={`live-pill${activity.isLiveColor ? " is-active" : ""}`}><i /> {activity.label.toLocaleUpperCase("tr-TR")}</span>
        </div>
        <div className={`tag-identity${activity.isLiveColor ? " is-active" : ""}`}><code>{selectedTag.id}</code><span>{activity.label}</span></div>
        <div className="tag-location-address">
          <div><MapPin size={14} aria-hidden="true" /><small>{hidden ? "SON GÖRÜLDÜĞÜ YER" : "KONUM ADRESİ"}</small></div>
          <strong>{hidden && presence ? lastObservedLocationLabel(presence) : locationAddress}</strong>
          {hidden && <em className="tag-reliability-warning">Güvenilir değil</em>}
          <span className="tag-location-duration"><small>{hidden || noLocation ? "SON VERİ" : "BU ALANDA"}</small><strong>{hidden && presence ? lastDataAgeLabel(presence, now) : locationDuration}</strong></span>
          {hidden && <p className="tag-hidden-explanation">Güncel veri ve geçerli oda kararı olmadığı için haritada gizli.</p>}
          {!hidden && selectedDisplay?.visible === false && <p className="tag-hidden-explanation">{hiddenOnMapLabel(selectedDisplay.reason)}</p>}
        </div>
        <div className="tag-detail-actions">
          {variant === "mobile" && onShowMap && <button className="show-map-button" type="button" onClick={onShowMap} disabled={hidden || noLocation} title={hidden || noLocation ? "Güncel konum verisi bekleniyor" : undefined}><MapPin size={15} /> Haritada göster</button>}
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

function locationDurationLabel(entry: TagLocationEntry | undefined, locationAddress: string | undefined, now: number): string {
  return entry && entry.locationLabel === locationAddress
    ? `Bu alanda ${formatLocationDuration(entry.enteredAt, now)}`
    : "Konum süresi hesaplanıyor";
}

export function TagInformationPanel({ onOpenHistory, variant = "desktop", onShowMap, catalog }: TagInformationPanelProps) {
  const presenceById = useIpsStore(state => state.tagPresenceById);
  const presenceConnection = useIpsStore(state => state.presenceConnection);
  const presenceWarning = useIpsStore(state => state.presenceWarning);
  const now = useTagPresenceClock();
  const mapTagDisplays = useIpsStore((state) => state.mapTagDisplays);
  const tagsById = useIpsStore((state) => state.tags);
  const observedTags = useIpsStore((state) => state.observedTags);
  const tagDefinitions = useIpsStore((state) => state.tagDefinitions);
  const selectedTagId = useIpsStore((state) => state.selectedTagId);
  const recentTagIds = useIpsStore((state) => state.recentTagIds);
  const locationEntry = useIpsStore((state) => selectedTagId ? state.tagLocationEntries[selectedTagId] : undefined);
  const selectTag = useIpsStore((state) => state.selectTag);
  const regionsConfigByMapId = useIpsStore((state) => state.regionsConfigByMapId);
  useRecentTagStorage(recentTagIds, variant === "desktop");

  const tags = useMemo(() => buildTagQuickList(tagDefinitions, tagsById, observedTags), [tagDefinitions, tagsById, observedTags]);
  const selectedTag = selectedTagId ? tags.find(tag => tag.id === selectedTagId) : undefined;
  const regionsConfig = selectedTag?.mapId ? regionsConfigByMapId[selectedTag.mapId] ?? null : null;
  const locationAddress = selectedTag ? selectedTag.timestamp > 0 ? roomDecisionLabel(selectedTag, regionsConfig) : "Henüz konum verisi alınmadı" : undefined;
  const locationDuration = selectedTag?.timestamp ? locationDurationLabel(locationEntry, locationAddress, now) : "Henüz veri alınmadı";
  const handleSelectTag = useCallback((tagId: string) => {
    selectTag(tagId);
  }, [selectTag]);

  return <TagInformationPanelContent selectedTag={selectedTag} locationAddress={locationAddress} locationDuration={locationDuration} tags={tags} recentTagIds={recentTagIds} onSelectTag={handleSelectTag} onOpenHistory={onOpenHistory} variant={variant} onShowMap={onShowMap} regionsConfig={regionsConfig} mapTagDisplays={mapTagDisplays} catalog={catalog} presenceById={presenceById} now={now} presenceNotice={presenceConnection === "reconnecting" ? "Takip bağlantısı yenileniyor; gösterilen konumlar güncel olmayabilir." : presenceWarning} />;
}
