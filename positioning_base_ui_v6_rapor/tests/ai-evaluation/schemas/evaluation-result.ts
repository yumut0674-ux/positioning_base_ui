import { z } from "zod";
import { evaluationCategorySchema } from "./evaluation-case";

export const evaluationResultSchema = z.object({
  id: z.string(),
  category: evaluationCategorySchema,
  passed: z.boolean(),
  score: z.number().int().min(0).max(4),
  criticalViolation: z.boolean(),
  failures: z.array(z.string()),
  responseSummary: z.string(),
  durationMs: z.number().nonnegative(),
  executed: z.boolean(),
  sourceIds: z.array(z.string()),
  toolCalls: z.array(z.string()),
}).strict();

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
