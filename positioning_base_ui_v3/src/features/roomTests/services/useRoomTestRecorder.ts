"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyAction, createSession, projectSession, seedSchema, type SessionSeed, type TestAction, type TestSession } from "./roomTestModel";
import { fetchTest, testApi, TestApiError } from "./roomTestApi";
import { readLocalTests, writeLocalTest, type LocalTestRecord } from "./roomTestStorage";

export function useRoomTestRecorder() {
  const [records, setRecords] = useState<LocalTestRecord[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [writer, setWriter] = useState(false), [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false), [syncError, setSyncError] = useState(""), [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const all = useRef(new Map<string, LocalTestRecord>()), selected = useRef<string | null>(null);
  const ownsLock = useRef(false), syncingRef = useRef(false), conflictRef = useRef(false), mounted = useRef(false);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const clock = useRef({ wall: 0, mono: 0 });
  const now = useCallback(() => Math.round(clock.current.wall + performance.now() - clock.current.mono), []);
  const publish = useCallback(() => {
    if (!mounted.current) return;
    setRecords([...all.current.values()].sort((a, b) => b.session.createdAt.localeCompare(a.session.createdAt)));
    setCurrentId(selected.current);
  }, []);
  const exclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const task = serial.current.then(fn, fn); serial.current = task.catch(() => undefined); return task;
  }, []);
  const persist = useCallback(async (record: LocalTestRecord, select = false) => {
    await writeLocalTest(record, select ? record.session.id : selected.current);
    all.current.set(record.session.id, record);
    if (select) selected.current = record.session.id;
    publish();
  }, [publish]);

  const sync = useCallback(async () => {
    if (!ownsLock.current || syncingRef.current || conflictRef.current) return;
    syncingRef.current = true; setSyncing(true);
    try {
      for (const id of all.current.keys()) {
        let record = all.current.get(id)!;
        if (record.createdOnServer && !record.pending.length) continue;
        const merge = async (remote: TestSession) => exclusive(async () => {
          const local = all.current.get(id)!;
          if (remote.events.some(event => !local.session.events.some(own => own.id === event.id))) {
            conflictRef.current = true; setConflict(true);
            throw new TestApiError("Bu test başka bir sekmede değiştirildi. Yerel kaydı indirip sunucudan yükleyin.", 409);
          }
          const remoteIds = new Set(remote.events.map(event => event.id));
          await persist({ ...local, createdOnServer: true, pending: local.pending.filter(item => !remoteIds.has(item.action.id)),
            session: { ...local.session, configHash: remote.configHash,
              events: local.session.events.map(event => remote.events.find(item => item.id === event.id) ?? event) } });
        });
        if (!record.createdOnServer) {
          const response = await testApi<{ session: TestSession }>("", seedSchema.parse(record.session));
          await merge(response.session);
        }
        record = all.current.get(id)!;
        while (record.pending.length) {
          const item = record.pending[0];
          const response = await testApi<{ session: TestSession }>(`/${encodeURIComponent(id)}/actions`, item);
          await merge(response.session); record = all.current.get(id)!;
        }
      }
      setSyncError("");
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : "Bağlantı yok. Kayıtlar yerelde bekliyor.");
      if (cause instanceof TestApiError && cause.status === 409) { conflictRef.current = true; setConflict(true); }
    } finally { syncingRef.current = false; if (mounted.current) setSyncing(false); }
  }, [exclusive, persist]);

  useEffect(() => {
    clock.current = { wall: Date.now(), mono: performance.now() };
    mounted.current = true;
    let disposed = false, release: (() => void) | undefined, acquiring = false;
    const initialize = async () => {
      try {
        const stored = await readLocalTests();
        if (disposed) return;
        for (const record of stored.records) all.current.set(record.session.id, record);
        selected.current = stored.currentId && all.current.has(stored.currentId) ? stored.currentId : null;
        publish(); setReady(true);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Yerel kayıt açılamadı."); }
    };
    const lock = () => {
      if (disposed || acquiring || ownsLock.current) return;
      if (!navigator.locks) { setError("Kayıt için HTTPS veya localhost üzerinde güncel bir tarayıcı kullanın."); return; }
      acquiring = true;
      void navigator.locks.request("gekon-room-test-writer", { ifAvailable: true }, async held => {
        acquiring = false;
        if (!held || disposed) return;
        ownsLock.current = true; setWriter(true);
        await initialize();
        // A reload is an observation break, closed at the last locally observed time.
        await exclusive(async () => {
          for (const record of all.current.values()) if (projectSession(record.session).status === "running") {
            const at = record.lastSeen > (record.session.events.at(-1)?.at ?? record.session.createdAt) ? record.lastSeen : record.session.events.at(-1)!.at;
            const action: TestAction = { id: crypto.randomUUID(), at, type: "recover", reason: "Sayfa yeniden açıldı; gözlem kesintisi" };
            const session = applyAction(record.session, action);
            await persist({ ...record, session, pending: [...record.pending, { action, expectedVersion: record.session.version }] });
          }
        });
        void sync();
        await new Promise<void>(resolve => { release = resolve; if (disposed) resolve(); });
        ownsLock.current = false;
      }).catch(cause => { acquiring = false; if (!disposed) setError(String(cause)); });
    };
    void initialize().then(lock);
    const lockTimer = setInterval(lock, 5000);
    const heartbeat = setInterval(() => {
      if (!ownsLock.current) return;
      void exclusive(async () => {
        const record = selected.current ? all.current.get(selected.current) : null;
        if (record && projectSession(record.session).status === "running") await persist({ ...record, lastSeen: new Date(now()).toISOString() });
      }).catch(cause => setError(String(cause)));
    }, 2000);
    const syncTimer = setInterval(() => void sync(), 8000);
    const warn = (event: BeforeUnloadEvent) => {
      const running = [...all.current.values()].some(record => projectSession(record.session).status === "running" || record.pending.length);
      if (running && ownsLock.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("online", sync); window.addEventListener("beforeunload", warn);
    return () => { disposed = true; mounted.current = false; release?.(); clearInterval(heartbeat); clearInterval(syncTimer); clearInterval(lockTimer);
      window.removeEventListener("online", sync); window.removeEventListener("beforeunload", warn); };
  }, [exclusive, now, persist, publish, sync]);

  const perform = useCallback(async (input: Omit<TestAction, "id" | "at">) => {
    setBusy(true); setError("");
    try {
      await exclusive(async () => {
        if (!ownsLock.current || conflictRef.current) throw new Error("Kayıt başka bir sekmede açık veya sunucuyla çakışıyor.");
        const record = selected.current ? all.current.get(selected.current) : null;
        if (!record) throw new Error("Önce yeni test oluşturun.");
        if (Math.abs(Date.now() - now()) > 5000) throw new Error("Cihaz saati değişti. Kaydı yedekleyip sayfayı yeniden açın.");
        const action: TestAction = { ...input, id: crypto.randomUUID(), at: new Date(now()).toISOString() };
        const session = applyAction(record.session, action);
        await persist({ ...record, session, lastSeen: action.at, pending: [...record.pending, { action, expectedVersion: record.session.version }] });
      });
      void sync();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kayıt işlemi başarısız."); }
    finally { setBusy(false); }
  }, [exclusive, now, persist, sync]);

  const begin = useCallback(async (input: Omit<SessionSeed, "id" | "createdAt">) => {
    setBusy(true); setError("");
    try {
      await exclusive(async () => {
        if (!ownsLock.current || conflictRef.current) throw new Error("Yazma yetkisi bu sekmede değil.");
        if ([...all.current.values()].some(record => projectSession(record.session).status === "running")) throw new Error("Önce aktif testi duraklatın.");
        const at = new Date(now()).toISOString(), seed = { ...input, id: `test-${crypto.randomUUID()}`, createdAt: at };
        const initial = createSession(seed), action: TestAction = { id: crypto.randomUUID(), at, type: "start" };
        const session = applyAction(initial, action);
        await persist({ session, createdOnServer: false, lastSeen: at, pending: [{ action, expectedVersion: 0 }] }, true);
      });
      void sync();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Test başlatılamadı."); }
    finally { setBusy(false); }
  }, [exclusive, now, persist, sync]);

  const open = useCallback(async (id: string | null, reloadServer = false) => {
    setBusy(true); setError("");
    try {
      const current = selected.current ? all.current.get(selected.current) : null;
      if (current && projectSession(current.session).status === "running" && id !== selected.current) throw new Error("Önce aktif testi duraklatın.");
      const cached = id ? all.current.get(id) : undefined;
      if (id && (reloadServer || !cached || (cached.createdOnServer && !cached.pending.length && projectSession(cached.session).status !== "running"))) {
        let remote: TestSession;
        try { remote = (await fetchTest(id)).session; }
        catch (cause) {
          if (!cached || reloadServer) throw cause;
          await exclusive(async () => { if (ownsLock.current) await writeLocalTest(null, id); selected.current = id; publish(); });
          setSyncError("Sunucuya ulaşılamadı; yerel kopya açıldı."); return;
        }
        if (ownsLock.current) {
          await exclusive(async () => {
            // A server-only running test has no local observation heartbeat. Stop at its last event.
            let record: LocalTestRecord = { session: remote, pending: [], createdOnServer: true, lastSeen: new Date(now()).toISOString() };
            if (projectSession(remote).status === "running") {
              const at = remote.events.at(-1)!.at;
              const action: TestAction = { id: crypto.randomUUID(), at, type: "recover", reason: "Sunucudan açıldı; gözlenmeyen süre çıkarıldı" };
              record = { ...record, session: applyAction(remote, action), pending: [{ action, expectedVersion: remote.version }] };
            }
            await persist(record, true);
          });
          conflictRef.current = false; setConflict(false); setSyncError("");
          void sync();
        } else {
          all.current.set(id, { session: remote, pending: [], createdOnServer: true, lastSeen: new Date(now()).toISOString() });
          selected.current = id; publish();
        }
      } else {
        await exclusive(async () => { if (ownsLock.current) await writeLocalTest(null, id); selected.current = id; publish(); });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Test yüklenemedi."); }
    finally { setBusy(false); }
  }, [exclusive, now, persist, publish, sync]);

  return { session: records.find(record => record.session.id === currentId)?.session ?? null, records, currentId,
    pending: records.reduce((total, record) => total + record.pending.length + (record.createdOnServer ? 0 : 1), 0),
    ready, writer, busy, syncing, syncError, error, conflict, now, begin, perform, open, sync, clearError: () => setError("") };
}
