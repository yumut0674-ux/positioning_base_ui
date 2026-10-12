import { ASSISTANT_UNAVAILABLE_MESSAGE } from "../../features/assistant/services/assistantAvailability";
import type { AssistantProvider, AssistantSettings } from "../../features/assistantAdmin/types/assistantAdmin.types";
import type { BeginAssistantRequest, FinishAssistantRequest } from "./assistantManagementRepository";
import { logger } from "../logger";

export class AssistantExecutionError extends Error {
  constructor(readonly code: string, readonly summary: string, readonly upstreamStatus?: number) { super(summary); }
}
interface RequestRepository {
  begin(input: BeginAssistantRequest): Promise<void>;
  settings(): Promise<AssistantSettings>;
  markAttempt(id: string, provider: AssistantProvider): Promise<void>;
  finish(id: string, input: FinishAssistantRequest): Promise<void>;
}
export interface AssistantResult { answer: string; model: string; locationSubject?: string; }
export type ManagedAssistantResult = ({ available: true; provider: AssistantProvider } & AssistantResult) | { available: false; answer: string };

export async function runManagedAssistantRequest(
  input: BeginAssistantRequest,
  provider: AssistantProvider,
  repository: RequestRepository,
  execute: () => Promise<AssistantResult>,
  clock: () => number = Date.now,
  timeoutMs = 30_000,
): Promise<ManagedAssistantResult> {
  const startedAt = clock();
  let recorded = false;
  const unavailable = (): ManagedAssistantResult => ({ available: false, answer: ASSISTANT_UNAVAILABLE_MESSAGE });
  const finishDisabled = (code: string) => repository.finish(input.id, {
    status: "disabled", answer: ASSISTANT_UNAVAILABLE_MESSAGE, durationMs: clock() - startedAt, errorCode: code,
  });
  try {
    await repository.begin(input);
    recorded = true;
    if (!(await repository.settings()).enabled) {
      await finishDisabled("ADMIN_DISABLED");
      return unavailable();
    }
    await repository.markAttempt(input.id, provider);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      execute(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AssistantExecutionError("REQUEST_TIMEOUT", "Yanıt üretimi zaman aşımına uğradı.")), timeoutMs); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!(await repository.settings()).enabled) {
      await finishDisabled("DISABLED_DURING_REQUEST");
      return unavailable();
    }
    await repository.finish(input.id, { status: "success", answer: result.answer, provider, model: result.model, durationMs: clock() - startedAt });
    return { available: true, ...result, provider };
  } catch (error) {
    const detail = error instanceof AssistantExecutionError ? error : new AssistantExecutionError("REQUEST_FAILED", "İstek veya kayıt servisi tamamlanamadı.");
    logger.error("assistant.request_unavailable", new Error(detail.summary), { requestId: input.id, code: detail.code });
    if (recorded) {
      try {
        await repository.finish(input.id, {
          status: "error", answer: ASSISTANT_UNAVAILABLE_MESSAGE, durationMs: clock() - startedAt,
          errorCode: detail.code, errorSummary: detail.summary, upstreamStatus: detail.upstreamStatus,
        });
      } catch {
        logger.error("assistant.record_completion_failed", new Error("Request log could not be completed"), { requestId: input.id });
      }
    }
    return unavailable();
  }
}
