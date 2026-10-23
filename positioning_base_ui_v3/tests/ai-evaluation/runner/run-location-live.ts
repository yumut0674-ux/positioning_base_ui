import { locationQuestionCases } from "../datasets/location-questions";

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const name = value("--entity-name");
if (!name) throw new Error("Provide --entity-name for a locally registered test entity.");
const base = (value("--base-url") ?? "http://127.0.0.1:3000").replace(/\/$/u, "");

type Match = { entityId: number; name: string; tagCode: string | null };
const searchResponse = await fetch(`${base}/api/location/entities/search?q=${encodeURIComponent(name)}&limit=10`);
if (!searchResponse.ok) throw new Error(`Entity search returned HTTP ${searchResponse.status}`);
const search = await searchResponse.json() as { data: { matches: Match[] } };
const exact = search.data.matches.filter((item) => item.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"));
if (exact.length !== 1 || !exact[0].tagCode) throw new Error("Expected one exact entity with an assigned tag.");
const entity = exact[0];
const currentResponse = await fetch(`${base}/api/location/entities/${entity.entityId}/current`);
if (!currentResponse.ok) throw new Error(`Current location returned HTTP ${currentResponse.status}`);
const current = await currentResponse.json() as { data: { trackingStatus: string }; meta: { dataStatus: string } };

let passed = 0;
const failures: string[] = [];
for (const item of locationQuestionCases) {
  const prompt = item.prompt.replaceAll("Hasan", entity.name);
  const response = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt, context: { mode: "live", tagCode: entity.tagCode } }),
  });
  const payload = await response.json().catch(() => ({})) as { data?: { answer?: string }; meta?: { provider?: string } };
  const answer = payload.data?.answer ?? "";
  const valid = response.ok && payload.meta?.provider === "local"
    && !/erişim yetkim bulunmuyor|güvenlik nedeniyle paylaşılmadı/iu.test(answer)
    && (item.intent === "last" ? /son ölçüm|son bilinen konum/iu.test(answer) : /şu an/iu.test(answer))
    && (item.intent !== "current" || current.data.trackingStatus === "live" && current.meta.dataStatus !== "ambiguous" || /doğrulanamıyor/iu.test(answer));
  if (valid) passed++;
  else failures.push(`${item.id}: HTTP ${response.status}, provider ${payload.meta?.provider ?? "missing"}`);
}

process.stdout.write(`Local location answers: ${passed}/${locationQuestionCases.length}\n`);
for (const failure of failures) process.stderr.write(`${failure}\n`);
if (failures.length) process.exitCode = 1;
