import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { allEvaluationCases } from "../datasets/cases";
import { evaluateDeterministically } from "../evaluators/deterministic-evaluator";
import { callLocalChat, offlineFixture } from "./chat-client";
import { markdownReport } from "./report-generator";

const args = process.argv.slice(2);
const getArg = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const category = getArg("--category");
const id = getArg("--id");
const severity = getArg("--severity");
const offline = args.includes("--offline");
const endpoint = process.env.AI_EVALUATION_URL ?? "http://127.0.0.1:8000/chat";
let selected = allEvaluationCases.filter((item) => (!category || item.category === category) && (!id || item.id === id) && (!severity || item.severity === severity));
if (args.includes("--failed-only")) {
  const previousPath = resolve("tests/ai-evaluation/reports/latest.json");
  const previous = JSON.parse(await readFile(previousPath, "utf8")) as { results?: Array<{ id?: string; passed?: boolean }> };
  const failedIds = new Set((previous.results ?? []).filter((item) => item.passed === false).map((item) => item.id));
  selected = selected.filter((item) => failedIds.has(item.id));
}
if (!selected.length) throw new Error("No evaluation cases matched the supplied filters.");

const results = [];
for (const testCase of selected) {
  try {
    const observation = offline ? offlineFixture(testCase) : await callLocalChat(testCase, endpoint);
    results.push(evaluateDeterministically(testCase, observation));
  } catch (error) {
    results.push(evaluateDeterministically(testCase, { answer: "", durationMs: 0, executed: false, sourceIds: [], toolCalls: [] }));
    results.at(-1)!.failures.push(`Not executed: ${error instanceof Error ? error.message : "unknown error"}`);
    results.at(-1)!.passed = false;
    results.at(-1)!.criticalViolation = false;
  }
}
const mode = offline ? "offline-fixture (harness validation only)" : `local endpoint ${endpoint}`;
const report = markdownReport(results, mode);
const reportDirectory = resolve("tests/ai-evaluation/reports");
await mkdir(reportDirectory, { recursive: true });
await writeFile(resolve(reportDirectory, "latest.json"), JSON.stringify({ mode, results }, null, 2));
await writeFile(resolve(reportDirectory, "latest.md"), report);
process.stdout.write(report);
if (!offline && results.some((item) => !item.passed || item.criticalViolation)) process.exitCode = 1;
