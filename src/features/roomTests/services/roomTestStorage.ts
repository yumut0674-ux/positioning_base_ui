import type { TestAction, TestSession } from "./roomTestModel";

export interface LocalTestRecord {
  session: TestSession;
  pending: { action: TestAction; expectedVersion: number }[];
  createdOnServer: boolean;
  lastSeen: string;
}
let connection: Promise<IDBDatabase> | null = null;
function database() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("gekon-room-tests", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "session.id" });
      request.result.createObjectStore("preferences");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(new Error("Tarayıcı kaydı açılamadı. Tarayıcı depolama iznini kontrol edin.")); };
  });
  return connection;
}
export async function readLocalTests(): Promise<{ records: LocalTestRecord[]; currentId: string | null }> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions", "preferences"], "readonly");
    const records = transaction.objectStore("sessions").getAll();
    const current = transaction.objectStore("preferences").get("currentId");
    transaction.oncomplete = () => resolve({ records: records.result as LocalTestRecord[], currentId: current.result as string | null });
    transaction.onerror = () => reject(new Error("Yerel test geçmişi okunamadı."));
  });
}
export async function writeLocalTest(record: LocalTestRecord | null, currentId: string | null) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["sessions", "preferences"], "readwrite");
    if (record) transaction.objectStore("sessions").put(record);
    transaction.objectStore("preferences").put(currentId, "currentId");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("Yerel kayıt yazılamadı. Tam oturumu indirerek yedek alın."));
    transaction.onabort = transaction.onerror;
  });
}
