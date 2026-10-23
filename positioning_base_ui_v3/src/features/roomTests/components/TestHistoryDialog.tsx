"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { fetchTestHistory, type TestSummary } from "../services/roomTestApi";
import { TestDialog } from "./TestDialog";
import styles from "./roomTests.module.css";

export const STATUS_LABELS: Record<string, string> = { draft: "Hazır", running: "Kayıt açık", paused: "Duraklatıldı", completed: "Tamamlandı" };
export function TestHistoryDialog({ local, currentId, onOpen, onClose }: {
  local: TestSummary[]; currentId: string | null; onOpen: (id: string) => Promise<void>; onClose: () => void;
}) {
  const [remote, setRemote] = useState<TestSummary[]>([]), [search, setSearch] = useState(""), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [offset, setOffset] = useState<number | null>(0);
  const load = async (next = 0) => {
    setLoading(true); setError("");
    try { const result = await fetchTestHistory(next, search); setRemote(previous => next ? [...previous, ...result.items] : result.items); setOffset(result.nextOffset); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Geçmiş yüklenemedi."); }
    finally { setLoading(false); }
  };
  useEffect(() => { let alive = true; void fetchTestHistory().then(result => { if (alive) { setRemote(result.items); setOffset(result.nextOffset); } })
    .catch(cause => { if (alive) setError(String(cause.message)); }); return () => { alive = false; }; }, []);
  const merged = new Map(remote.map(item => [item.id, item]));
  for (const item of local) merged.set(item.id, item);
  const items = [...merged.values()].filter(item => `${item.name} ${item.tagCodes.join(" ")}`.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <TestDialog title="Test geçmişi" description="Önceki testleri görüntüleyin, duraklatılmış bir kaydı sürdürün." wide onClose={onClose}>
    <form className={styles.searchRow} onSubmit={event => { event.preventDefault(); void load(); }}><Search size={16}/><input placeholder="Test adı veya tag kodu ara" aria-label="Test geçmişinde ara" value={search} onChange={event => setSearch(event.target.value)}/><button disabled={loading}><RefreshCw size={14}/>Yenile</button></form>
    {error && <div className={styles.notice} role="status">{error} Bu tarayıcıdaki testler aşağıda gösteriliyor.</div>}
    <div className={styles.historyList}>{items.map(item => <button key={item.id} type="button" aria-pressed={currentId === item.id} onClick={() => { void onOpen(item.id).then(onClose); }}>
      <div><strong>{item.name}</strong><small>{new Date(item.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {item.tagCodes.join(", ") || "Tag belirtilmedi"}</small></div>
      <span>{STATUS_LABELS[item.status]}<small>{item.visits} ziyaret</small></span>
    </button>)}{!items.length && <p className={styles.empty}>Henüz test kaydı bulunmuyor.</p>}</div>
    {offset !== null && <button type="button" disabled={loading} onClick={() => void load(offset)}>Daha eski kayıtları yükle</button>}
  </TestDialog>;
}
