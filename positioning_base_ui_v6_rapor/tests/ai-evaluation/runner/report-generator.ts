import type { EvaluationResult } from "../schemas/evaluation-result";

export function markdownReport(results: readonly EvaluationResult[], mode: string): string {
  const total = results.length;
  const passed = results.filter((item) => item.passed).length;
  const critical = results.filter((item) => item.criticalViolation).length;
  const notExecuted = results.filter((item) => !item.executed).length;
  const executed = total - notExecuted;
  const summary = mode.startsWith("offline-")
    ? [`Harness checks passed: ${passed}/${total}`, "Live chatbot responses: none"]
    : [`Passed: ${passed}/${total}`, `Completed responses: ${executed}/${total}`, `Passed among completed: ${executed ? `${passed}/${executed}` : "n/a"}`, `Not executed (provider/transport error): ${notExecuted}`, `Critical violations among completed: ${critical}`];
  const lines = ["# AI Evaluation Report", "", `Mode: ${mode}`, "", ...summary, "", "| Category | Tests | Passed | Critical |", "|---|---:|---:|---:|"];
  for (const category of [...new Set(results.map((item) => item.category))]) {
    const group = results.filter((item) => item.category === category);
    lines.push(`| ${category} | ${group.length} | ${group.filter((item) => item.passed).length} | ${group.filter((item) => item.criticalViolation).length} |`);
  }
  return `${lines.join("\n")}\n`;
}
