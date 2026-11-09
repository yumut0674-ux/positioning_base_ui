import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { ArchiveManifest } from "../data-export/exporter";
import { datasetDir, inspectRows, readTruth } from "./importer";
import { compareRows, ms, sha256, type Manifest, type RawRow, type Truth } from "./model";

/** Adapt a verified local archive to an existing independent truth without contacting PostgreSQL. */
export async function buildArchiveDataset(directory: string, truth: Truth, tags: readonly string[], warmupMs = 30_000, observationMs = 60_000): Promise<{ raw: Buffer; manifest: Manifest }> {
  if (!tags.length || tags.some(tag => !tag)) throw new Error("Arşivden içe aktarım için --tags gerekli.");
  for (const duration of [warmupMs, observationMs]) if (!Number.isSafeInteger(duration) || duration < 0 || duration > 3_600_000) throw new Error("Geçersiz ön/son gözlem penceresi.");
  const archive = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as ArchiveManifest;
  if (archive.kind !== "uwb-benchmark-archive" || archive.schemaVersion !== 1 || archive.status !== "complete") throw new Error("Tamamlanmış benchmark veri arşivi gerekli.");
  const rawFile = archive.files.find(file => file.path === "raw.jsonl");
  if (!rawFile || !rawFile.rowCount) throw new Error("Arşivde ham konum verisi bulunmuyor.");
  for (const tag of tags) if (!archive.selectedTags.includes(tag)) throw new Error("Tag arşivde dışa aktarılmamış: " + tag);
  const from = ms(truth.test.from) - warmupMs, to = ms(truth.test.to) + observationMs;
  if (ms(archive.exportRange.from) > from || ms(archive.exportRange.to) < to) throw new Error("Arşiv testin ön/son gözlem aralığını kapsamıyor. Daha geniş tarih aralığı dışa aktarın veya pencereyi açıkça azaltın.");
  const hash = createHash("sha256"), rows: RawRow[] = [], stream = createReadStream(path.join(directory, "raw.jsonl"));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let inputError: Error | undefined, totalRows = 0, bytes = 0;
  stream.on("data", chunk => { hash.update(chunk); bytes += Buffer.byteLength(chunk); });
  stream.on("error", error => { inputError = error; lines.close(); });
  try {
    for await (const line of lines) {
      if (!line) throw new Error("Ham arşivde boş JSONL satırı var.");
      const row = JSON.parse(line) as RawRow;
      if (typeof row.id !== "string" || !/^\d+$/.test(row.id) || typeof row.tag_code !== "string" || !row.created_at) throw new Error("Ham arşiv satırı benchmark şemasına uymuyor.");
      totalRows++;
      const time = ms(row.created_at);
      if (tags.includes(row.tag_code) && time >= from && time < to) rows.push(row);
    }
    if (inputError) throw inputError;
    if (hash.digest("hex") !== rawFile.sha256 || bytes !== rawFile.bytes || totalRows !== rawFile.rowCount) throw new Error("raw.jsonl SHA-256, boyut veya satır sayısı uyuşmuyor.");
  } finally { lines.close(); stream.destroy(); }
  if (!rows.length) throw new Error("Seçilen tag ve test aralığı için arşivde ham kayıt yok.");
  rows.sort(compareRows);
  const raw = Buffer.from(rows.map(row => JSON.stringify(row)).join("\n") + "\n"), quality = inspectRows(rows);
  const mapIds = new Map<string, number>();
  for (const row of rows) { const map = row.map_id ?? "(eksik)"; mapIds.set(map, (mapIds.get(map) ?? 0) + 1); }
  const known = rows.flatMap(row => row.pdop == null ? [] : [row.pdop]);
  const manifest: Manifest = {
    testId: truth.testId, source: "Yerel benchmark veri arşivi " + archive.archiveId + "; tag_location_history SELECT",
    timezone: "Europe/Istanbul", importedAt: new Date().toISOString(), warmupMs, observationMs, selectedTags: [...tags],
    candidateTags: Object.fromEntries(archive.candidateTags.map(candidate => [candidate.tagCode, candidate.rawCount])),
    rowCount: rows.length, sha256: await sha256(raw), timing: quality.missingReceivedAt ? "approximate" : "exact", mapIds: Object.fromEntries(mapIds), quality,
    caveat: archive.warnings.join(" ") + " Arşiv ham dosyası doğrulandı; canlı motor çıktıları asıl arşivin decisions.jsonl dosyasında korunur.",
    pdop: { columnAvailable: archive.tables.tag_location_history?.some(column => column.name === "pdop") ?? false,
      knownValues: known.length, missingValues: rows.length - known.length,
      minimum: known.length ? known.reduce((minimum, value) => Math.min(minimum, value), Infinity) : null,
      maximum: known.length ? known.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null,
      above20: known.filter(value => value > 20).length, caveat: "Kalıcı kayıttan önce PDOP yüzünden elenmiş canlı paketler arşivde yoktur." },
  };
  return { raw, manifest };
}

export async function importArchive(id: string, directory: string, tags: string[], warmupMs = 30_000, observationMs = 60_000): Promise<Manifest> {
  const dir = datasetDir(id);
  for (const name of ["raw.jsonl", "manifest.json"]) {
    try { await readFile(path.join(dir, name)); throw new Error(name + " zaten mevcut; değişmez veri üzerine yazılmaz"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const result = await buildArchiveDataset(path.resolve(directory), await readTruth(id), tags, warmupMs, observationMs);
  await writeFile(path.join(dir, "raw.jsonl"), result.raw, { flag: "wx" });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n", { flag: "wx" });
  return result.manifest;
}
