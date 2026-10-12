import type { CurrentLocationData, EntityMatch, SuccessEnvelope } from "../location/location.types";
import { LocationError } from "../location/locationErrors";

export type LocationIntent = "current" | "last";
export type LocationQuestion = { readonly intent: LocationIntent; readonly subject: string | null };
export type LocationAnswer = { readonly answer: string; readonly locationSubject?: string };

export type LocationAnswerSource = {
  search(query: string, limit: number): Promise<SuccessEnvelope<{ readonly matches: readonly EntityMatch[] }>>;
  current(entityId: number): Promise<SuccessEnvelope<CurrentLocationData>>;
  lastKnownRoom?(entityId: number): Promise<{ readonly zoneName: string; readonly observedAt: string } | null>;
};

const SUBJECT = "[\\p{L}\\p{N} ._'-]{1,100}?";
const WHERE = "(?:nerede|nerde|hangi odada|hangi bölgede)";
const LAST_WHERE = "(?:neredeydi|nerdeydi|hangi odadaydı|hangi bölgedeydi|nerede görüldü|hangi odada görüldü|hangi bölgede görüldü)";
const NOW = "(?:şu ?an(?:da)?|şimdi)";
const patterns: readonly { readonly intent: LocationIntent; readonly regex: RegExp }[] = [
  { intent: "last", regex: new RegExp(`^(?:en son|son olarak)\\s+(${SUBJECT})\\s+(?:${WHERE}|${LAST_WHERE})$`, "iu") },
  { intent: "current", regex: new RegExp(`^${NOW}\\s+(${SUBJECT})\\s+${WHERE}$`, "iu") },
  { intent: "last", regex: new RegExp(`^(${SUBJECT})'?(?:ın|in|un|ün|nın|nin|nun|nün)\\s+(?:en son|son)\\s+konumu\\s+(?:ne|nedir|neresi)$`, "iu") },
  { intent: "current", regex: new RegExp(`^(${SUBJECT})'?(?:ın|in|un|ün|nın|nin|nun|nün)\\s+(?:şu ?anki|güncel|mevcut)\\s+konumu\\s+(?:ne|nedir|neresi|nerede)$`, "iu") },
  { intent: "last", regex: new RegExp(`^(${SUBJECT})\\s+(?:en son|son olarak)\\s+(?:${WHERE}|${LAST_WHERE})$`, "iu") },
  { intent: "last", regex: new RegExp(`^(${SUBJECT})\\s+${LAST_WHERE}$`, "iu") },
  { intent: "last", regex: new RegExp(`^(${SUBJECT})\\s+(?:son|en son)\\s+görüldüğü\\s+yer\\s+(?:ne|neresi)$`, "iu") },
  { intent: "last", regex: new RegExp(`^(${SUBJECT})\\s+(?:en son|son)\\s+konumu\\s+(?:ne|nedir|neresi)$`, "iu") },
  { intent: "current", regex: new RegExp(`^(${SUBJECT})\\s+(?:${NOW}|halen)\\s+(?:${WHERE}|konumu ne|konumu neresi)$`, "iu") },
  { intent: "current", regex: new RegExp(`^(${SUBJECT})\\s+${WHERE}\\s+${NOW}$`, "iu") },
  { intent: "current", regex: new RegExp(`^(${SUBJECT})\\s+(?:${WHERE}|konumu ne|konumu neresi|konumu nerede)$`, "iu") },
];
const noSubjectPatterns: readonly { readonly intent: LocationIntent; readonly regex: RegExp }[] = [
  { intent: "last", regex: /^(?:(?:seçili|bu) (?:kişi|varlık|etiket|tag) )?(?:en son|son olarak) (?:nerede|nerde|neredeydi|nerdeydi|hangi odadaydı)$/iu },
  { intent: "current", regex: new RegExp(`^(?:(?:seçili|bu) (?:kişi|varlık|etiket|tag) )?${NOW} (?:nerede|nerde|hangi odada)$`, "iu") },
];

function cleanSubject(raw: string): string | null {
  const subject = raw.trim().replace(/['’](?:ın|in|un|ün|nın|nin|nun|nün)$/iu, "").trim();
  if (!subject || /^(?:tüm|bütün|herkes|hepsi|hastalar|personeller)$/iu.test(subject)
    || /^(?:harita|ayarlar|menü|buton|düğme|ekran|filtre)$/iu.test(subject)
    || /\b(?:ve|talimat|unut|göster|anahtar|şifre|parola|token)\b/iu.test(subject)) return null;
  return subject;
}

function isConversationReference(subject: string): boolean {
  return /^(?:o|onun|kendisi|kendisinin|bu kişi|aynı kişi|bu kişinin|aynı kişinin)$/iu.test(subject.trim());
}

function questionText(message: string): string {
  return message.trim().replace(/\s+/gu, " ").replace(/[?.!]+$/u, "").trim()
    .replace(/^(?:peki(?: ya)?|ya)\s*[,;:]?\s+/iu, "");
}

export function locationQuestionUsesSelection(message: string): boolean {
  return /^(?:seçili|bu) (?:kişi|varlık|etiket|tag)\b/iu.test(questionText(message));
}

export function parseLocationQuestion(message: string): LocationQuestion | null {
  const text = questionText(message);
  if (!text || text.length > 160) return null;
  if (/^(?:nerede|nerde|hangi odada|hangi bölgede)$/iu.test(text)) return { intent: "current", subject: null };
  for (const { intent, regex } of noSubjectPatterns) {
    if (regex.test(text)) return { intent, subject: null };
  }
  for (const { intent, regex } of patterns) {
    const match = regex.exec(text);
    if (match) {
      if (isConversationReference(match[1])) return { intent, subject: null };
      const subject = cleanSubject(match[1]);
      return subject ? { intent, subject } : null;
    }
  }
  return null;
}

function dateInIstanbul(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function exactMatch(value: string, query: string): boolean {
  return value.toLocaleLowerCase("tr-TR") === query.toLocaleLowerCase("tr-TR");
}

export async function answerLocationQuestion(
  question: LocationQuestion,
  selectedTagCode: string | undefined,
  source: LocationAnswerSource,
): Promise<string> {
  return (await answerLocationQuestionWithSubject(question, selectedTagCode, source)).answer;
}

export async function answerLocationQuestionWithSubject(
  question: LocationQuestion,
  selectedTagCode: string | undefined,
  source: LocationAnswerSource,
): Promise<LocationAnswer> {
  const query = question.subject ?? selectedTagCode?.trim();
  if (!query) return { answer: "Hangi kişi veya takip etiketini sorduğunuzu belirtin." };
  const search = await source.search(query, 10);
  const matches = search.data.matches;
  const exact = matches.filter((item) => exactMatch(item.name, query) || exactMatch(item.entityCode, query) || exactMatch(item.tagCode ?? "", query));
  const candidates = exact.length === 1 ? exact : matches;
  if (candidates.length === 0) return { answer: "Bu ad veya takip etiketiyle eşleşen kayıt bulunamadı." };
  if (candidates.length > 1) return { answer: "Birden fazla kayıt eşleşti. Lütfen tam adı veya takip etiketi kodunu belirtin." };

  const entity = candidates[0];
  const reply = (answer: string): LocationAnswer => ({ answer, locationSubject: entity.entityCode });
  let result: SuccessEnvelope<CurrentLocationData>;
  try {
    result = await source.current(entity.entityId);
  } catch (error) {
    if (error instanceof LocationError && (error.code === "LOCATION_NOT_FOUND" || error.code === "TAG_ASSIGNMENT_NOT_FOUND" || error.code === "ENTITY_NOT_FOUND")) {
      return reply(`${entity.name} için doğrulanmış konum kaydı bulunamadı.`);
    }
    throw error;
  }
  const { position, observedAt, trackingStatus } = result.data;
  const recordedAt = dateInIstanbul(observedAt);
  const zone = position.zoneName || "Konum belirlenemedi";
  const roomUnknown = result.meta.dataStatus === "ambiguous" || /^(?:belirsiz|koridor|kat belirlenemedi|konum belirlenemedi)$/iu.test(zone) || /\(tahmin\)/iu.test(zone);
  const lastRoom = roomUnknown ? await source.lastKnownRoom?.(entity.entityId) : null;
  const lastRoomText = lastRoom
    ? ` Son doğrulanmış oda/bölge: ${lastRoom.zoneName}. Bu odadaki son ölçüm: ${dateInIstanbul(lastRoom.observedAt)}. Bu kayıt güncel konumu doğrulamaz.`
    : "";
  if (result.meta.dataStatus === "ambiguous") {
    return reply(question.intent === "last"
      ? `${entity.name} için son ölçüm ${recordedAt} tarihinde alındı; bu ölçümde oda/bölge belirlenemedi.${lastRoomText}${trackingStatus === "live" ? "" : " Takip şu anda çevrimdışı veya güncel değil."}`
      : `${entity.name} için şu anki oda doğrulanamıyor. Son ölçüm: ${recordedAt}; oda/bölge belirlenemedi.${lastRoomText}${trackingStatus === "live" ? "" : " Takip şu anda çevrimdışı veya güncel değil."}`);
  }
  if (question.intent === "last") {
    if (lastRoom) return reply(`${entity.name} için son genel ölçüm: ${recordedAt}; bu ölçümde doğrulanmış oda yok.${lastRoomText}`);
    return reply(`${entity.name} için son bilinen konum: ${zone}. Son ölçüm: ${recordedAt}.${trackingStatus === "live" ? "" : " Bu kayıt güncel konumu doğrulamaz."}`);
  }
  if (trackingStatus === "live") {
    return reply(`${entity.name} şu anda ${zone} konumunda görünüyor. Son ölçüm: ${recordedAt}.`);
  }
  return reply(`${entity.name} için şu anki konum doğrulanamıyor. Son bilinen konum: ${zone}. Son ölçüm: ${recordedAt}.${lastRoomText}`);
}
