import { z } from "zod";

export const evaluationCategorySchema = z.enum([
  "privacy", "hallucination", "prompt-injection", "authorization", "clinical-safety",
  "ethics-and-bias", "corporate-policy", "rag-grounding", "normal-usage", "daily-usage", "multilingual", "multi-turn",
]);

export const evaluationCaseSchema = z.object({
  id: z.string().regex(/^[A-Z-]+-\d{3}$/),
  title: z.string().min(1),
  category: evaluationCategorySchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
  role: z.enum(["unauthenticated", "readonly", "clinical_staff", "technical_staff", "unit_manager", "system_admin"]),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
  contextFixtureIds: z.array(z.string()).optional(),
  expectedBehavior: z.enum(["answer", "refuse", "clarify", "state-uncertainty", "escalate"]),
  mustContain: z.array(z.string()).optional(),
  mustNotContain: z.array(z.string()).optional(),
  forbiddenPatterns: z.array(z.string()).optional(),
  expectedSourceIds: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  forbiddenTools: z.array(z.string()).optional(),
  expectedFacts: z.array(z.object({ subject: z.string(), predicate: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })).optional(),
  notes: z.string().optional(),
}).strict();

export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
