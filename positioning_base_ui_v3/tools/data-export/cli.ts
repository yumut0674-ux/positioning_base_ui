import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { exportArchive, listTagCandidates } from "./exporter";
import { exportRange, istanbulTime, selectTags, type ExportRange } from "./input";

const HELP = `Yerel benchmark veri arşivi

  npm run export:data
  npm run export:data -- --from "2026-10-13 09:00" --to "2026-10-13 10:00" --tags "TAG1,TAG2"
  npm run export:data -- --from "13.10.2026 09:00" --to şimdi --list

Tarihler saat dilimi belirtilmediyse Türkiye saati (Europe/Istanbul, +03:00).
Başlangıç dahil, bitiş hariç. Tag listesi yalnız seçilen aralıktaki kayıtlardan oluşur.

  --warmup-seconds N       Önceki ham/karar kayıtları (varsayılan: 30, en fazla 3600)
  --observation-seconds N  Sonraki ham/karar kayıtları (varsayılan: 60, en fazla 3600)
  --batch-size N           Cursor başına kayıt (varsayılan: 1000, en fazla 10000)
  --timeout-seconds N      Sorgu zaman aşımı (varsayılan: 60, en fazla 600)
  --no-csv                Yalnız kayıpsız JSONL üret
  --list                  Tagları listele, dosya üretme
  --help                  Bu yardım

Veritabanı: mevcut POSTGRES_* ortam değişkenleri / .env.local.
Çıktı: .data/exports/<benzersiz-arşiv-id>/ (Git dışında).
Arayüz veya web sunucusu açık olmak zorunda değildir. PostgreSQL çalışmalıdır.`;

function terminal(signal: AbortSignal) {
  const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const queue: string[] = [];
  let ended = false;
  let waiting: { resolve: (answer: string) => void; reject: (error: Error) => void } | undefined;
  reader.on("line", answer => { if (waiting) { const pending = waiting; waiting = undefined; pending.resolve(answer); } else queue.push(answer); });
  const closed = () => {
    ended = true;
    waiting?.reject(new Error("Girdi sonlandı. --from, --to ve --tags seçenekleriyle de çalıştırabilirsiniz.")); waiting = undefined;
  };
  reader.on("close", closed);
  const abort = () => { waiting?.reject(new Error("Veri aktarımı iptal edildi.")); waiting = undefined; reader.close(); };
  signal.addEventListener("abort", abort, { once: true });
  const interrupt = () => process.emit("SIGINT");
  reader.on("SIGINT", interrupt);
  return {
    ask: async (prompt: string): Promise<string> => {
      signal.throwIfAborted(); process.stdout.write(prompt);
      if (queue.length) return queue.shift()!;
      if (ended) throw new Error("Girdi sonlandı. --from, --to ve --tags seçeneklerini kullanın.");
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
    },
    close: () => { signal.removeEventListener("abort", abort); reader.off("SIGINT", interrupt); reader.close(); },
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: {
    from: { type: "string" }, to: { type: "string" }, tags: { type: "string" },
    "warmup-seconds": { type: "string", default: "30" }, "observation-seconds": { type: "string", default: "60" },
    "batch-size": { type: "string", default: "1000" }, "timeout-seconds": { type: "string", default: "60" },
    "no-csv": { type: "boolean" }, list: { type: "boolean" }, help: { type: "boolean" },
  }, strict: true });
  if (values.help) { console.log(HELP); return; }
  const number = (key: "warmup-seconds" | "observation-seconds" | "batch-size" | "timeout-seconds", min: number, max: number): number => {
    const value = values[key]!;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${key}: ${min}–${max} arasında tam sayı girin.`);
    return Number(value);
  };
  const warmupMs = number("warmup-seconds", 0, 3600) * 1000, observationMs = number("observation-seconds", 0, 3600) * 1000;
  const batchSize = number("batch-size", 1, 10_000), timeoutMs = number("timeout-seconds", 1, 600) * 1000;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Veri aktarımı iptal edildi."));
  process.on("SIGINT", interrupt);
  const input = terminal(controller.signal);
  try {
    console.log("\nKonum + motor çıktıları | Yerel benchmark arşivi\nSaat dilimi: Türkiye (+03:00). Çıkış: Ctrl+C.\n");
    let range: ExportRange;
    while (true) {
      const from = values.from ?? await input.ask("Başlangıç tarihi ve saati (2026-10-13 09:00): ");
      const to = values.to ?? await input.ask("Bitiş tarihi ve saati (veya şimdi): ");
      try { range = exportRange(from, to); break; }
      catch (error) { if (values.from || values.to) throw error; console.error((error as Error).message); }
    }
    console.log(`\nSeçilen aralık: ${istanbulTime(range.from)} → ${istanbulTime(range.to)} (bitiş hariç)\nVeritabanındaki taglar okunuyor…`);
    const candidates = await listTagCandidates(range, undefined, controller.signal);
    if (!candidates.length) { console.log("Bu tarih/saat aralığında konum veya motor kaydı bulunamadı."); return; }
    console.table(candidates.map((candidate, index) => ({ "No": index + 1, "Tag": candidate.tagCode, "Ad": candidate.displayName ?? "—",
      "Konum": candidate.rawCount, "Motor": candidate.decisionCount, "Alan olayı": candidate.areaEventCount,
      "İlk kayıt": istanbulTime(candidate.firstAt), "Son kayıt": istanbulTime(candidate.lastAt) })));
    if (values.list) return;
    let tags: string[];
    while (true) {
      const answer = values.tags ?? await input.ask("Tag seçimi (1 veya 1,3 veya tag kodu; hepsi için tümü): ");
      try { tags = selectTags(answer, candidates.map(candidate => candidate.tagCode)); break; }
      catch (error) { if (values.tags) throw error; console.error((error as Error).message); }
    }
    console.log(`\nSeçilen taglar: ${tags.join(", ")}\nBenchmark bağlamı: ${warmupMs / 1000} sn önce + ${observationMs / 1000} sn sonra.\nKayıtlar tek bir salt okunur snapshot'tan alınıyor…`);
    const result = await exportArchive({ range, tags, warmupMs, observationMs, batchSize, timeoutMs, csv: !values["no-csv"],
      signal: controller.signal, onProgress: message => console.log(message) });
    console.log(`\nArşiv hazır: ${result.directory}`);
    console.table(result.manifest.files.filter(file => file.path.endsWith(".jsonl")).map(file => ({
      "Dosya": file.path, "Toplam kayıt": file.rowCount, "Seçilen aralık": file.windows?.requested ?? "—", "Önce": file.windows?.warmup ?? "—", "Sonra": file.windows?.observation ?? "—",
    })));
    console.log("\nJSONL: tüm sütunlar ve motor payload'ı. CSV: Excel için UTF-8, noktalı virgül ayracı.\nmanifest.json: aralıklar, snapshot, kayıt sayıları, sürümler ve SHA-256 dosya özetleri.");
    for (const warning of result.manifest.warnings) console.log(`Not: ${warning}`);
  } catch (error) {
    if (controller.signal.aborted) { process.exitCode = 130; console.error("Veri aktarımı iptal edildi."); }
    else throw error;
  } finally { input.close(); process.off("SIGINT", interrupt); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Aktarım tamamlanamadı: ${(error as Error).message}`); process.exitCode = 1; });
}
