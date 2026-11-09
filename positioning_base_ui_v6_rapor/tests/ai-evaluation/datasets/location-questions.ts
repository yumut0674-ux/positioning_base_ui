import type { LocationIntent } from "../../../src/server/assistant/locationAnswer";

export type LocationQuestionCase = {
  readonly id: string;
  readonly prompt: string;
  readonly intent: LocationIntent;
  readonly subject: string | null;
  readonly selectedTagCode?: string;
};

// Synthetic names and tag codes; these questions must resolve via the local location service.
export const locationQuestionCases: readonly LocationQuestionCase[] = [
  { id: "LAST-001", prompt: "Hasan en son neredeydi?", intent: "last", subject: "Hasan" },
  { id: "LAST-002", prompt: "Hasan en son nerede?", intent: "last", subject: "Hasan" },
  { id: "LAST-003", prompt: "Hasan neredeydi?", intent: "last", subject: "Hasan" },
  { id: "LAST-004", prompt: "En son Hasan neredeydi?", intent: "last", subject: "Hasan" },
  { id: "LAST-005", prompt: "Hasan son olarak nerede görüldü?", intent: "last", subject: "Hasan" },
  { id: "LAST-006", prompt: "Hasan en son hangi odadaydı?", intent: "last", subject: "Hasan" },
  { id: "LAST-007", prompt: "Hasan'ın son konumu ne?", intent: "last", subject: "Hasan" },
  { id: "LAST-008", prompt: "Bu etiket en son neredeydi?", intent: "last", subject: null, selectedTagCode: "TAG-007" },
  { id: "LAST-009", prompt: "En son neredeydi?", intent: "last", subject: null, selectedTagCode: "TAG-007" },
  { id: "LAST-010", prompt: "Seçili varlık son olarak nerede?", intent: "last", subject: null, selectedTagCode: "TAG-007" },
  { id: "LAST-011", prompt: "Hasan'ın en son konumu nedir?", intent: "last", subject: "Hasan" },
  { id: "LAST-012", prompt: "Hasan en son hangi odada görüldü?", intent: "last", subject: "Hasan" },
  { id: "LAST-013", prompt: "Hasan son görüldüğü yer neresi?", intent: "last", subject: "Hasan" },
  { id: "LAST-014", prompt: "Hasan en son hangi bölgedeydi?", intent: "last", subject: "Hasan" },
  { id: "LAST-015", prompt: "Hasan son olarak hangi bölgede görüldü?", intent: "last", subject: "Hasan" },
  { id: "CURRENT-001", prompt: "Hasan şu an nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-002", prompt: "Hasan şimdi nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-003", prompt: "Hasan nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-004", prompt: "Hasan nerde?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-005", prompt: "Hasan şu anda hangi odada?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-006", prompt: "Şu an Hasan nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-007", prompt: "Hasan'ın güncel konumu ne?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-008", prompt: "Seçili etiket şu an nerede?", intent: "current", subject: null, selectedTagCode: "TAG-007" },
  { id: "CURRENT-009", prompt: "Bu etiket şimdi hangi odada?", intent: "current", subject: null, selectedTagCode: "TAG-007" },
  { id: "CURRENT-010", prompt: "Şu an nerede?", intent: "current", subject: null, selectedTagCode: "TAG-007" },
  { id: "CURRENT-011", prompt: "Hasan'ın şu anki konumu nedir?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-012", prompt: "Hasan nerede şu an?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-013", prompt: "Hasan'ın güncel konumu nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-014", prompt: "hasan şuan nerede", intent: "current", subject: "hasan" },
  { id: "CURRENT-015", prompt: "Hasan şuanda nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-016", prompt: "Şuan Hasan nerede?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-017", prompt: "Hasan nerede şuan?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-018", prompt: "Şuan nerede?", intent: "current", subject: null, selectedTagCode: "TAG-007" },
  { id: "CURRENT-019", prompt: "Hasan'ın şuanki konumu ne?", intent: "current", subject: "Hasan" },
  { id: "CURRENT-020", prompt: "Seçili etiket şuanda nerede?", intent: "current", subject: null, selectedTagCode: "TAG-007" },
];
