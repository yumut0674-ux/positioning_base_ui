"use client";

import { useId, useMemo, useRef, useState } from "react";
import { completeRoomTestTag, matchingRoomTestTags, type RoomTestTagOption } from "../services/roomTestTags";
import styles from "./roomTests.module.css";

interface Props {
  readonly label: string;
  readonly value: string;
  readonly options: readonly RoomTestTagOption[];
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly onChange: (value: string) => void;
}

export function RoomTestTagInput({ label, value, options, disabled, loading, loadFailed, onChange }: Props) {
  const inputId = useId(), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [caret, setCaret] = useState(value.length);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const matches = useMemo(() => matchingRoomTestTags(options, value, caret), [options, value, caret]);
  const highlightedIndex = matches.findIndex(tag => tag.id === highlightedId);
  const expanded = open && !disabled;

  const choose = (tag: RoomTestTagOption) => {
    const completed = completeRoomTestTag(value, tag.id, caret);
    onChange(completed.value);
    setCaret(completed.caret);
    setHighlightedId(null);
    setOpen(false);
    requestAnimationFrame(() => input.current?.setSelectionRange(completed.caret, completed.caret));
  };

  return <div className={styles.tagInput} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={inputId}>{label}</label>
    <input ref={input} id={inputId} value={value} disabled={disabled} autoComplete="off"
      placeholder="Tag adı veya kodu yazın" role="combobox" aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={expanded ? `${inputId}-options` : undefined}
      aria-activedescendant={expanded && highlightedIndex >= 0 ? `${inputId}-option-${highlightedIndex}` : undefined}
      onFocus={event => { setCaret(event.currentTarget.selectionStart ?? value.length); setOpen(true); }}
      onClick={event => { setCaret(event.currentTarget.selectionStart ?? value.length); setOpen(true); }}
      onSelect={event => { setCaret(event.currentTarget.selectionStart ?? value.length); setHighlightedId(null); }}
      onChange={event => {
        onChange(event.target.value);
        setCaret(event.target.selectionStart ?? event.target.value.length);
        setHighlightedId(null);
        setOpen(true);
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === "Enter" && expanded && matches.length) {
          event.preventDefault(); choose(matches[Math.max(0, highlightedIndex)]);
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          if (!matches.length) return;
          const index = highlightedIndex < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1)
            : (highlightedIndex + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
          setHighlightedId(matches[index].id);
          requestAnimationFrame(() => document.getElementById(`${inputId}-option-${index}`)?.scrollIntoView({ block: "nearest" }));
        }
      }} />
    {expanded && <div id={`${inputId}-options`} className={styles.tagOptions} role="listbox" aria-label="Aktif ve kayıtlı taglar">
      {matches.map((tag, index) => <button key={tag.id} id={`${inputId}-option-${index}`} type="button"
        role="option" tabIndex={-1} aria-selected={tag.id === highlightedId}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(tag)}>
        <span><strong>{tag.name}</strong><code>{tag.id}</code></span>
        <small className={tag.active ? styles.tagActive : undefined}>{tag.active ? "Aktif" : "Kayıtlı"}</small>
      </button>)}
      {!matches.length && <p role="status">{loading ? "Taglar yükleniyor…" : loadFailed ? "Tag listesi yüklenemedi; kodu elle yazabilirsiniz." : "Eşleşen tag bulunamadı."}</p>}
    </div>}
  </div>;
}
