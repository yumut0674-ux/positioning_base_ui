import type { ConversationTurn } from "../../features/assistant/services/assistantConversation";
import { locationQuestionUsesSelection, parseLocationQuestion, type LocationQuestion } from "./locationAnswer";

export function conversationLocationQuestion(message: string, history: readonly ConversationTurn[]): LocationQuestion | null {
  const question = parseLocationQuestion(message);
  if (question) return question;
  // A short change of subject inherits the last location question's intent.
  const previous = history.at(-1);
  if (previous?.provider !== "local" || !previous.locationSubject) return null;
  const intent = history.map((turn) => turn.provider === "local" ? parseLocationQuestion(turn.question) : null)
    .findLast((question) => question !== null)?.intent;
  const subject = /^(?:peki(?: ya)?|ya)\s+([\p{L}\p{N} ._'’-]{1,100})[?.!]*$/iu.exec(message.trim())?.[1]?.trim();
  if (!intent || !subject) return null;
  return parseLocationQuestion(`${subject} ${intent === "last" ? "en son neredeydi" : "şu an nerede"}`);
}

export function conversationLocationSubject(
  message: string, question: LocationQuestion, selectedTagCode: string | undefined, history: readonly ConversationTurn[],
): string | undefined {
  if (question.subject) return question.subject;
  if (locationQuestionUsesSelection(message)) return selectedTagCode;
  const previous = history.findLast((turn) => turn.provider === "local");
  // An unresolved new subject must not silently reuse an older person.
  return previous ? previous.locationSubject : selectedTagCode;
}

export function modelConversationHistory(history: readonly ConversationTurn[]): { question: string; answer: string }[] {
  // The app currently sends only general UWB conversation to the model provider.
  // Location exchanges remain local, including when they occur in the same chat.
  return history.filter((turn) => turn.provider === "gemini" && !parseLocationQuestion(turn.question))
    .map(({ question, answer }) => ({ question, answer }));
}
