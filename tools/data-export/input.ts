export interface ExportRange { from: string; to: string }

/** Zone-less terminal dates are Istanbul time, independent of the machine timezone. */
export function parseExportTime(value: string, now = new Date()): string {
  const text = value.trim();
  if (/^(şimdi|simdi|now)$/i.test(text)) return now.toISOString();
  const turkish = /^(\d{2})\.(\d{2})\.(\d{4}) (.+)$/.exec(text);
  const normalized = turkish ? `${turkish[3]}-${turkish[2]}-${turkish[1]} ${turkish[4]}` : text;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/i.exec(normalized);
  if (!match) throw new Error("Tarih biçimi: 2026-10-13 09:30 veya 13.10.2026 09:30 (saniye ve milisaniye eklenebilir).");
  const [, year, month, day, hour, minute, second = "00", fraction = "0", offset = "+03:00"] = match;
  const milliseconds = fraction.padEnd(3, "0");
  const local = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(milliseconds)));
  if (Number(year) < 100 || local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month) || local.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw new Error("Geçersiz tarih veya saat.");
  if (offset.toUpperCase() !== "Z") {
    const hours = Number(offset.slice(1, 3)), minutes = Number(offset.slice(4));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw new Error("Geçersiz saat dilimi.");
  }
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${offset.toUpperCase()}`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Geçersiz tarih veya saat.");
  return parsed.toISOString();
}

export function exportRange(from: string, to: string, now = new Date()): ExportRange {
  const range = { from: parseExportTime(from, now), to: parseExportTime(to, now) };
  if (Date.parse(range.from) >= Date.parse(range.to)) throw new Error("Başlangıç, bitişten önce olmalı.");
  return range;
}

export function selectTags(answer: string, available: readonly string[]): string[] {
  if (answer.trim().toLocaleLowerCase("tr-TR") === "tümü" || answer.trim().toLowerCase() === "all") return [...available];
  const tokens = answer.split(",").map(value => value.trim()).filter(Boolean);
  if (!tokens.length) throw new Error("En az bir tag seçin.");
  const selected = tokens.map(token => {
    const exact = available.find(tag => tag === token) ?? available.find(tag => tag.toUpperCase() === token.toUpperCase());
    if (exact) return exact;
    if (/^[1-9]\d*$/.test(token) && Number(token) <= available.length) return available[Number(token) - 1];
    throw new Error(`Aralıkta bulunmayan seçim: ${token}. Liste numarası veya tag kodu girin.`);
  });
  return [...new Set(selected)];
}

export const istanbulTime = (iso: string): string => new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date(iso));
