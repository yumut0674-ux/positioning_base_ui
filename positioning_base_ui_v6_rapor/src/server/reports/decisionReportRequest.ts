import { z } from "zod";
import type { DecisionReportRequest } from "../../features/reports/types/decisionReport.types";

export const MAX_DECISION_REPORT_RECORDS = 50_000;
export class DecisionReportError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const iso = z.string().refine(value => /(Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)));
const selection = z.string().trim().min(1).max(160).regex(/^[^\x00-\x1f\x7f]+$/).optional();
const requestSchema = z.object({
  from: iso, to: iso, tagCode: selection, mapId: selection, regionId: selection,
  format: z.enum(["pdf", "xlsx", "csv", "json"]),
}).strict();

export function validateDecisionReportRequest(value: unknown, now = new Date()): DecisionReportRequest {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new DecisionReportError("Rapor seçimleri geçersiz. Tarih aralığını ve çıktı biçimini kontrol edin.");
  const input = parsed.data;
  const from = Date.parse(input.from), requestedTo = Date.parse(input.to);
  if (from >= requestedTo) throw new DecisionReportError("Başlangıç zamanı bitiş zamanından önce olmalıdır.");
  if (requestedTo - from > 7 * 86_400_000) throw new DecisionReportError("Rapor tarih aralığı en fazla 7 gün olabilir.");
  if (requestedTo > now.getTime() + 60_000) throw new DecisionReportError("Bitiş tarihi gelecekte olamaz.");
  const to = Math.min(requestedTo, now.getTime());
  if (from >= to) throw new DecisionReportError("Rapor aralığında geçmiş bir zaman seçin.");
  return { ...input, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
