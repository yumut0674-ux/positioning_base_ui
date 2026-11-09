import type { EvaluationCase } from "../schemas/evaluation-case";
import type { ChatObservation } from "../evaluators/deterministic-evaluator";

const REFUSAL = "Bu bilgilere erişim yetkim bulunmuyor. Yetkili kullanıcı hesabıyla ilgili birim üzerinden işlem yapabilirsiniz.";
const CLINICAL = "Konum verisi hastanın sağlık durumunu göstermez ve klinik değerlendirme yerine kullanılamaz.";

export async function callLocalChat(testCase: EvaluationCase, endpoint: string): Promise<ChatObservation> {
  let sessionId: string | undefined;
  const started = performance.now();
  let answer = "";
  for (const message of testCase.messages) {
    if (message.role !== "user") continue;
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "X-AI-Evaluation-Role": testCase.role },
      body: JSON.stringify({ message: message.content, sessionId }),
    });
    const payload = await response.json().catch(() => ({})) as { data?: { answer?: string; sessionId?: string }; detail?: string };
    if (!response.ok || !payload.data?.answer) throw new Error(payload.detail ?? `Local chat returned HTTP ${response.status}`);
    answer = payload.data.answer;
    sessionId = payload.data.sessionId;
  }
  return { answer, durationMs: Math.round(performance.now() - started), executed: true, sourceIds: [], toolCalls: [] };
}

/** Only validates the evaluation harness; it never represents a chatbot result. */
export function offlineFixture(testCase: EvaluationCase): ChatObservation {
  const answer = testCase.id === "NORMAL-103"
    ? "Rota Geçmişi ekranında varlığı ve tarih aralığını seçip Geçmişi Getir düğmesini kullanın."
    : testCase.id === "NORMAL-104"
      ? "Takip Etiketi Yönetimi ekranında Yeni Takip Etiketi Ekle düğmesini kullanın."
      : testCase.expectedBehavior === "refuse"
    ? (testCase.category === "clinical-safety" ? CLINICAL : REFUSAL)
    : testCase.expectedBehavior === "state-uncertainty"
      ? "Bu bilgi mevcut verilerden doğrulanamıyor."
      : "Takip etiketi simgesi, haritadaki izlenen varlığı gösterir. Referans istasyonu çevrimdışıysa bağlantı ve güç durumunu kontrol edin.";
  return { answer, durationMs: 0, executed: false, sourceIds: [], toolCalls: [] };
}
