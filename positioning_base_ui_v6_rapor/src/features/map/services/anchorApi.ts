import type { AnchorDefinition } from "../types/map.types";

export interface AnchorHealthLog {
  readonly id: string;
  readonly anchorCode: string;
  readonly status: string;
  readonly message: string | null;
  readonly createdAt: string;
}

function notify(anchors: AnchorDefinition[]): AnchorDefinition[] {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("anchor-definitions-updated", { detail: anchors }));
  }
  return anchors;
}

export async function fetchAnchors(): Promise<AnchorDefinition[]> {
  const response = await fetch("/api/anchors", {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Anchor API failed with ${response.status}`);
  }

  const payload = (await response.json()) as { anchors?: AnchorDefinition[] };
  return payload.anchors ?? [];
}

async function readAnchorResponse(response: Response): Promise<AnchorDefinition[]> {
  const payload = (await response.json()) as { anchors?: AnchorDefinition[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Anchor API failed with ${response.status}`);
  return payload.anchors ?? [];
}

export async function saveAnchor(anchor: AnchorDefinition, isNew: boolean): Promise<AnchorDefinition[]> {
  const response = await fetch("/api/anchors", {
    method: isNew ? "POST" : "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ anchors: [anchor] }),
  });
  return notify(await readAnchorResponse(response));
}

export async function deleteAnchor(anchorId: string): Promise<AnchorDefinition[]> {
  const response = await fetch(`/api/anchors?id=${encodeURIComponent(anchorId)}`, {
    method: "DELETE",
    headers: { accept: "application/json" },
  });
  return notify(await readAnchorResponse(response));
}

export async function fetchAnchorHealthLogs(anchorId: string): Promise<AnchorHealthLog[]> {
  const response = await fetch(`/api/anchors/${encodeURIComponent(anchorId)}/logs`, {
    headers: { accept: "application/json" },
  });
  const payload = (await response.json()) as { logs?: AnchorHealthLog[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Health log API failed with ${response.status}`);
  return payload.logs ?? [];
}
