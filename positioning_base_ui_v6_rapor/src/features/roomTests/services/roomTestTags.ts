import type { TagDefinition } from "../../tracking/services/tagApi";
import type { TrackedTag } from "../../tracking/types/tracking.types";

export interface RoomTestTagOption {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export function roomTestTagOptions(
  definitions: readonly TagDefinition[],
  liveTags: readonly Pick<TrackedTag, "id" | "name" | "status">[],
): RoomTestTagOption[] {
  const options = new Map<string, RoomTestTagOption>();
  for (const tag of definitions) {
    const id = tag.id.trim().toUpperCase();
    if (id) options.set(id, { id, name: tag.displayName || id, active: false });
  }
  for (const tag of liveTags) {
    if (tag.status !== "active") continue;
    const id = tag.id.trim().toUpperCase();
    if (id) options.set(id, { id, name: options.get(id)?.name || tag.name || id, active: true });
  }
  return [...options.values()].sort((left, right) => Number(right.active) - Number(left.active) || left.id.localeCompare(right.id, "tr", { numeric: true }));
}

export function tagInputToken(value: string, caret = value.length) {
  const position = Math.max(0, Math.min(caret, value.length));
  let start = position, end = position;
  while (start > 0 && !/[,;]/.test(value[start - 1])) start -= 1;
  while (end < value.length && !/[,;]/.test(value[end])) end += 1;
  while (start < end && /\s/.test(value[start])) start += 1;
  while (end > start && /\s/.test(value[end - 1])) end -= 1;
  return { start, end, query: value.slice(start, end) };
}

export function matchingRoomTestTags(options: readonly RoomTestTagOption[], value: string, caret = value.length) {
  const token = tagInputToken(value, caret);
  const selected = new Set(`${value.slice(0, token.start)},${value.slice(token.end)}`.split(/[,;\s]+/).map(code => code.toUpperCase()));
  return options.filter(tag => !selected.has(tag.id) && (
    tag.id.toLowerCase().includes(token.query.toLowerCase()) ||
    tag.name.toLocaleLowerCase("tr-TR").includes(token.query.toLocaleLowerCase("tr-TR"))
  ));
}

export function completeRoomTestTag(value: string, id: string, caret = value.length) {
  const token = tagInputToken(value, caret);
  const code = id.trim().toUpperCase();
  return { value: `${value.slice(0, token.start)}${code}${value.slice(token.end)}`, caret: token.start + code.length };
}
