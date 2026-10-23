export interface TagDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
  readonly createdAt?: string;
}

async function read(response: Response): Promise<TagDefinition[]> {
  const payload = (await response.json()) as { tags?: TagDefinition[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Tag API failed with ${response.status}`);
  return payload.tags ?? [];
}

function notify(tags: TagDefinition[]) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("tag-definitions-updated", { detail: tags }));
  return tags;
}

export async function fetchTags(): Promise<TagDefinition[]> {
  return read(await fetch("/api/tags", { headers: { accept: "application/json" } }));
}

export async function saveTag(tag: TagDefinition, isNew: boolean): Promise<TagDefinition[]> {
  return notify(await read(await fetch("/api/tags", { method: isNew ? "POST" : "PUT", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ tags: [tag] }) })));
}

export async function deleteTag(id: string): Promise<TagDefinition[]> {
  return notify(await read(await fetch(`/api/tags?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { accept: "application/json" } })));
}
