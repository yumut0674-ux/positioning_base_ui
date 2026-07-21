"use client";

import { Clock3, Search, Star, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";

const FAVORITE_TAGS_STORAGE_KEY = "gekon-ips.favorite-tag-ids";

function formatUpdateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function matchesQuery(tag: TrackedTag, query: string): boolean {
  return tag.id.toLocaleLowerCase("tr-TR").includes(query)
    || tag.name.toLocaleLowerCase("tr-TR").includes(query);
}

function readFavoriteTagIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(FAVORITE_TAGS_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((tagId): tagId is string => typeof tagId === "string"))]
      : [];
  } catch {
    return [];
  }
}

interface TagResultProps {
  readonly tag: TrackedTag;
  readonly index: number;
  readonly listboxId: string;
  readonly isHighlighted: boolean;
  readonly isSelected: boolean;
  readonly isFavorite: boolean;
  readonly onHighlight: (index: number) => void;
  readonly onChoose: (tag: TrackedTag) => void;
  readonly onToggleFavorite: (tagId: string) => void;
}

function TagResult({ tag, index, listboxId, isHighlighted, isSelected, isFavorite, onHighlight, onChoose, onToggleFavorite }: TagResultProps) {
  const isOffline = tag.status !== "active";

  return (
    <div
      id={`${listboxId}-option-${index}`}
      role="option"
      aria-selected={isSelected}
      className={`tag-search-result ${isHighlighted ? "is-highlighted" : ""} ${isSelected ? "is-selected" : ""} ${isOffline ? "is-offline" : ""}`}
      onMouseMove={() => onHighlight(index)}
      onClick={() => onChoose(tag)}
    >
      <i className="tag-search-status" aria-hidden="true" />
      <span className="tag-search-result-name">
        <strong>{tag.name}</strong>
        <code>{tag.id}</code>
      </span>
      <span className="tag-search-result-meta">
        <span className={`tag-search-live-state ${isOffline ? "is-offline" : ""}`}>{isOffline ? "PASİF" : "CANLI"}</span>
        <span><Clock3 size={12} aria-hidden="true" /> {formatUpdateTime(tag.timestamp)}</span>
      </span>
      <button
        type="button"
        className={`tag-search-favorite ${isFavorite ? "is-favorite" : ""}`}
        aria-label={isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}
        aria-pressed={isFavorite}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleFavorite(tag.id);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Star size={15} aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

export function TagSearchPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(readFavoriteTagIds);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const tagsById = useIpsStore((state) => state.tags);
  const selectedTagId = useIpsStore((state) => state.selectedTagId);
  const selectTag = useIpsStore((state) => state.selectTag);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITE_TAGS_STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }, [favoriteIds]);

  const activeTags = useMemo(
    () => Object.values(tagsById)
      .filter((tag) => tag.status === "active")
      .sort((left, right) => left.name.localeCompare(right.name, "tr")),
    [tagsById],
  );
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const favoriteTags = useMemo(
    () => favoriteIds
      .map((tagId) => tagsById[tagId])
      .filter((tag): tag is TrackedTag => Boolean(tag))
      .sort((left, right) => left.name.localeCompare(right.name, "tr")),
    [favoriteIds, tagsById],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR");
  const visibleTags = useMemo(() => {
    if (!normalizedQuery) return activeTags.filter((tag) => !favoriteIdSet.has(tag.id));
    const matchingFavorites = favoriteTags.filter((tag) => matchesQuery(tag, normalizedQuery));
    const matchingActiveTags = activeTags.filter((tag) => !favoriteIdSet.has(tag.id) && matchesQuery(tag, normalizedQuery));
    return [...matchingFavorites, ...matchingActiveTags];
  }, [activeTags, favoriteIdSet, favoriteTags, normalizedQuery]);
  const keyboardTags = normalizedQuery ? visibleTags : [...favoriteTags, ...visibleTags];
  const highlightedIndex = keyboardTags.length === 0 ? -1 : Math.min(activeIndex, keyboardTags.length - 1);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [isOpen]);

  const openPanel = () => {
    setIsOpen(true);
    setActiveIndex(0);
  };
  const closePanel = () => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  };
  const chooseTag = (tag: TrackedTag) => {
    selectTag(tag.id);
    closePanel();
  };
  const toggleFavorite = (tagId: string) => {
    setFavoriteIds((current) => current.includes(tagId)
      ? current.filter((currentId) => currentId !== tagId)
      : [...current, tagId]);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openPanel();
        return;
      }
      if (keyboardTags.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + keyboardTags.length) % keyboardTags.length);
      return;
    }
    if (event.key === "Enter" && isOpen && highlightedIndex >= 0) {
      event.preventDefault();
      chooseTag(keyboardTags[highlightedIndex]);
    }
  };

  const emptyMessage = activeTags.length === 0
    ? "Canlı akışta aktif tag bulunamadı."
    : "Aramayla eşleşen tag bulunamadı.";
  let resultIndex = 0;
  const renderResult = (tag: TrackedTag) => {
    const index = resultIndex++;
    return <TagResult key={tag.id} tag={tag} index={index} listboxId={listboxId} isHighlighted={index === highlightedIndex} isSelected={tag.id === selectedTagId} isFavorite={favoriteIdSet.has(tag.id)} onHighlight={setActiveIndex} onChoose={chooseTag} onToggleFavorite={toggleFavorite} />;
  };

  return (
    <div className={`tag-search ${isOpen ? "is-open" : ""}`} ref={rootRef}>
      <div className="tag-search-input-wrap">
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Tag ara…"
          aria-label="Tag ara"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={highlightedIndex >= 0 && isOpen ? `${listboxId}-option-${highlightedIndex}` : undefined}
          onFocus={openPanel}
          onClick={openPanel}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {query && <button type="button" className="tag-search-clear" aria-label="Aramayı temizle" onClick={() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }}><X size={14} /></button>}
      </div>

      {isOpen && (
        <div className="tag-search-dropdown">
          <div className="tag-search-dropdown-header">
            <div><small>CANLI VARLIKLAR</small><strong>Tag seçimi</strong></div>
            <span>{activeTags.length} AKTİF</span>
          </div>
          <div className="tag-search-results" id={listboxId} role="listbox" aria-label="Tag sonuçları">
            {!normalizedQuery && favoriteTags.length > 0 && <section className="tag-search-section" aria-labelledby={`${listboxId}-favorites`}><h2 id={`${listboxId}-favorites`}>FAVORİ TAGLAR</h2>{favoriteTags.map(renderResult)}</section>}
            <section className="tag-search-section" aria-labelledby={`${listboxId}-active`}>
              <h2 id={`${listboxId}-active`}>{normalizedQuery ? "ARAMA SONUÇLARI" : "AKTİF TAGLAR"}</h2>
              {visibleTags.length > 0 ? visibleTags.map(renderResult) : <div className="tag-search-empty" role="status"><Search size={20} aria-hidden="true" /><strong>{emptyMessage}</strong><span>{activeTags.length === 0 ? "Yeni telemetri verileri burada görünecek." : "Farklı bir ad veya tag ID’si deneyin."}</span></div>}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
