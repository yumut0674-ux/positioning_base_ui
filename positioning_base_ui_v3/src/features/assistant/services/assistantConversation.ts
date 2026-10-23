import { z } from "zod";

export const MAX_CONVERSATION_TURNS = 20;
export const MAX_CONVERSATION_CHARACTERS = 32_000;
const MAX_HISTORY_ANSWER_CHARACTERS = 8_000;

export const conversationTurnSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(MAX_HISTORY_ANSWER_CHARACTERS),
  provider: z.enum(["local", "gemini"]),
  // A search hint only: the location service must verify it again on every request.
  locationSubject: z.string().trim().min(1).max(160).optional(),
}).strict();

export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const conversationHistorySchema = z.array(conversationTurnSchema).max(MAX_CONVERSATION_TURNS)
  .refine((turns) => conversationCharacters(turns) <= MAX_CONVERSATION_CHARACTERS, "Konuşma geçmişi çok uzun.");

function conversationCharacters(turns: readonly ConversationTurn[]): number {
  return turns.reduce((total, turn) => total + turn.question.length + turn.answer.length, 0);
}

/** Keep complete, successful exchanges from this chat, with a bounded request size. */
export function conversationHistory(turns: readonly ConversationTurn[]): ConversationTurn[] {
  const history: ConversationTurn[] = [];
  let characters = 0;
  for (const turn of turns.slice(-MAX_CONVERSATION_TURNS).reverse()) {
    const bounded = { ...turn, answer: turn.answer.slice(0, MAX_HISTORY_ANSWER_CHARACTERS) };
    const size = bounded.question.length + bounded.answer.length;
    if (characters + size > MAX_CONVERSATION_CHARACTERS) break;
    history.unshift(bounded);
    characters += size;
  }
  return history;
}
