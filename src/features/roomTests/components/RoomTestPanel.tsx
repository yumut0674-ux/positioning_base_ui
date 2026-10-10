"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Check, CheckCircle2, Clipboard, Clock3, DoorOpen, Download, FileJson, FolderClock, Layers3, MapPin, Pause, Play, Plus, Radio, Search, Settings2, Square, Terminal, Trash2, Undo2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTags } from "@/src/features/tracking/services/tagApi";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { effectiveEvents, exportSession, projectSession, recordedMs, type ExportFormat, type TestArea, type TestPlan } from "../services/roomTestModel";
import { downloadTest, fetchTestPlan } from "../services/roomTestApi";
import { useRoomTestRecorder } from "../services/useRoomTestRecorder";
import { TestDialog } from "./TestDialog";
import { TestPlanEditor, AREA_LABELS } from "./TestPlanEditor";
import { TestHistoryDialog, STATUS_LABELS } from "./TestHistoryDialog";
import styles from "./roomTests.module.css";

interface LiveFile { name: string; createWritable: () => Promise<{ write: (contents: string) => Promise<void>; close: () => Promise<void> }> }
type FilePickerWindow = Window & { showSaveFilePicker?: (options: unknown) => Promise<LiveFile> };
const parseTags = (value: string) => [...new Set(value.split(/[,;\s]+/).map(tag => tag.trim().toUpperCase()).filter(Boolean))];
const stamp = (value: string) => new Date(value).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, fractionalSecondDigits: 3 });
const elapsed = (value: number) => `${Math.floor(Math.max(0, value) / 60000).toString().padStart(2, "0")}:${Math.floor(Math.max(0, value) / 1000 % 60).toString().padStart(2, "0")}`;
const EVENT_LABELS: Record<string, string> = { start: "Kayıt başladı", select: "Alan geçişi", leave: "Alandan çıkıldı", pause: "Kayıt duraklatıldı", resume: "Kayıt sürdürüldü", complete: "Test tamamlandı", undo: "Son geçiş geri alındı", tags: "Tag bilgisi düzeltildi", recover: "Gözlem kesintisi · kayıt kurtarıldı" };

export function RoomTestPanel({ onRecordingChange }: { onRecordingChange: (recording: boolean) => void }) {
  const recorder = useRoomTestRecorder(), session = recorder.session;
  const state = useMemo(() => session ? projectSession(session) : null, [session]);
  const plans = useQuery({ queryKey: ["room-test-plans"], queryFn: fetchTestPlan });
  const tags = useQuery({ queryKey: ["tag-definitions"], queryFn: fetchTags });
  const activeMapId = useIpsStore(store => store.activeMapId);
  const [customPlan, setCustomPlan] = useState<TestPlan | null>(null), [floorId, setFloorId] = useState(""), [search, setSearch] = useState("");
  const [name, setName] = useState("Oda testi"), [tagInput, setTagInput] = useState(""), [verified, setVerified] = useState(false);
  const [mode, setMode] = useState<"floor" | "route">("floor"), [route, setRoute] = useState<{ mapId: string; areaId: string }[]>([]);
  const [dialog, setDialog] = useState<"plan" | "settings" | "history" | "export" | "tags" | null>(null);
  const [format, setFormat] = useState<ExportFormat>("tagged"), [scope, setScope] = useState(false), [notice, setNotice] = useState("");
  const [tagCorrection, setTagCorrection] = useState({ codes: "", verified: false, reason: "" });
  const [now, setNow] = useState(0), [rawLogs, setRawLogs] = useState(false), [autoScroll, setAutoScroll] = useState(true);
  const log = useRef<HTMLDivElement>(null), preview = useRef<HTMLTextAreaElement>(null);
  const [fileStatus, setFileStatus] = useState(""), [fileSupported, setFileSupported] = useState(false), [fileSessionId, setFileSessionId] = useState<string | null>(null);
  const liveFile = useRef<{ file: LiveFile; sessionId: string } | null>(null), fileQueue = useRef(Promise.resolve());
  const latestSession = useRef(session);
  const plan = session?.plan ?? customPlan ?? plans.data?.plan;
  const floor = plan?.floors.find(item => item.mapId === floorId) ?? plan?.floors.find(item => item.mapId === activeMapId) ?? plan?.floors[0];
  const running = state?.status === "running", locked = Boolean(session), disabled = !recorder.ready || !recorder.writer || recorder.busy || recorder.conflict;
  const active = state?.active, selectedMode = session?.mode ?? mode;
  const areas = floor?.areas.filter(area => `${area.name} ${area.id}`.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr"))) ?? [];
  const routeList = session?.route ?? route;
  const nextStep = routeList[state?.routeProgress ?? 0];
  const nextFloor = plan?.floors.find(item => item.mapId === nextStep?.mapId), nextArea = nextFloor?.areas.find(item => item.id === nextStep?.areaId);
  const recorded = session ? recordedMs(session, now) : 0;
  const history = recorder.records.map(record => { const projected = projectSession(record.session); return {
    id: record.session.id, name: record.session.name, createdAt: record.session.createdAt, status: projected.status,
    tagCodes: projected.tagCodes, visits: projected.visits.length, version: record.session.version,
  }; });
  const output = useMemo(() => {
    if (!session) return { json: "", error: "", parts: [] };
    try { const data = exportSession(session, format, scope); return { json: JSON.stringify(data, null, 2), error: "", parts: "parts" in data ? data.parts ?? [] : [] }; }
    catch (cause) { return { json: "", error: cause instanceof Error ? cause.message : "Çıktı hazırlanamadı.", parts: [] }; }
  }, [session, format, scope]);

  useEffect(() => {
    const getNow = recorder.now;
    const timer = setInterval(() => setNow(getNow()), 500);
    const deferred = setTimeout(() => setFileSupported(Boolean((window as FilePickerWindow).showSaveFilePicker)), 0);
    return () => { clearInterval(timer); clearTimeout(deferred); };
  }, [recorder.now]);
  useEffect(() => { onRecordingChange(Boolean(running)); }, [running, onRecordingChange]);
  useEffect(() => { if (autoScroll && log.current) log.current.scrollTop = log.current.scrollHeight; }, [session?.version, autoScroll]);
  useEffect(() => {
    latestSession.current = session;
    const binding = liveFile.current;
    if (!binding || !session || binding.sessionId !== session.id) return;
    const contents = JSON.stringify(exportSession(session, "full"), null, 2);
    fileQueue.current = fileQueue.current.then(async () => {
      if (liveFile.current !== binding) return;
      try { const writable = await binding.file.createWritable(); await writable.write(contents); await writable.close();
        if (liveFile.current === binding) setFileStatus(`${binding.file.name} güncellendi`); }
      catch { if (liveFile.current === binding) setFileStatus("Dosya yazılamadı. Yeniden bağlayın veya tam oturumu indirin."); }
    });
  }, [session]);

  const choose = (area: TestArea) => {
    if (!floor || !running) return;
    if (active?.mapId === floor.mapId && active.areaId === area.id) { leave(); return; }
    void recorder.perform({ type: "select", location: { mapId: floor.mapId, areaId: area.id } });
  };
  const leave = () => {
    if (!active || !plan) return;
    const activeFloor = plan.floors.find(item => item.mapId === active.mapId)!;
    const source = activeFloor.areas.find(item => item.id === active.areaId)!;
    const corridor = source.type === "room" ? activeFloor.areas.find(item => item.id === source.connectsTo && item.type === "corridor") : null;
    void recorder.perform(corridor ? { type: "select", location: { mapId: activeFloor.mapId, areaId: corridor.id } } : { type: "leave" });
  };
  const start = () => {
    if (!plan) { setNotice("Önce sistem planını yükleyin veya özel bir plan oluşturun."); return; }
    setNotice(""); void recorder.begin({ name, tagCodes: parseTags(tagInput), tagVerified: verified, plan, mode, route: mode === "route" ? route : [], clockSample: plans.data?.clockSample });
  };
  const next = () => { if (nextStep) { setFloorId(nextStep.mapId); void recorder.perform({ type: "select", location: nextStep, routeStep: state?.routeProgress ?? 0 }); } };
  const saveFile = async () => {
    if (!session) return;
    try {
      const file = await (window as FilePickerWindow).showSaveFilePicker?.({ suggestedName: `${session.id}-canli.json`, types: [{ description: "JSON kayıt dosyası", accept: { "application/json": [".json"] } }] });
      if (!file) return;
      const current = latestSession.current;
      if (!current || current.id !== session.id) return;
      const binding = { file, sessionId: current.id };
      liveFile.current = binding;
      setFileSessionId(session.id);
      fileQueue.current = fileQueue.current.then(async () => {
        if (liveFile.current !== binding) return;
        const writable = await file.createWritable(); await writable.write(JSON.stringify(exportSession(current, "full"), null, 2)); await writable.close();
        if (liveFile.current === binding) setFileStatus(`${file.name} bağlı · her işlemde güncellenir`);
      }).catch(() => { if (liveFile.current === binding) setFileStatus("Dosya yazılamadı. Yeniden bağlayın veya tam oturumu indirin."); });
      await fileQueue.current;
    } catch (cause) { if ((cause as Error).name !== "AbortError") setFileStatus("Dosya bağlanamadı. JSON indir seçeneğini kullanın."); }
  };
  const download = (full = false) => {
    if (!session) return;
    try { downloadTest(exportSession(session, full ? "full" : format, full || scope), `${session.id}-${full ? "tam-oturum" : format}`); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Çıktı indirilemedi."); }
  };

  return <div className={styles.panel}>
    <header className={styles.heading}><div><small>İNCELE / SAHA TESTLERİ</small><h1>Oda Test Kaydı</h1><p>Gerçek oda geçişlerini işaretleyin, saha testini zamanlarıyla kaydedin.</p></div>
      <div className={styles.actions}><button type="button" disabled={running || recorder.busy} onClick={() => setDialog("history")}><FolderClock size={15}/>Geçmiş</button>
        <button type="button" disabled={disabled || running} onClick={() => { void recorder.open(null); setNotice(""); }}><Plus size={15}/>Yeni test</button></div>
    </header>
    {(recorder.error || notice) && <div className={styles.error} role="alert"><span>{recorder.error || notice}</span><button type="button" aria-label="Bildirimi kapat" onClick={() => { recorder.clearError(); setNotice(""); }}><X size={15}/></button></div>}
    {!recorder.ready && <div className={styles.notice} role="status">Yerel kayıtlar hazırlanıyor…</div>}
    {recorder.ready && !recorder.writer && <div className={styles.notice}>Bu tarayıcıdaki kayıt başka bir sekmede açık. Bu sekmede geçmişi görüntüleyebilir ve JSON indirebilirsiniz.</div>}
    {recorder.conflict && <div className={styles.error} role="alert"><span>Sunucuyla çakışma var. Önce tam oturumu indirerek yerel kaydı yedekleyin.</span><button type="button" onClick={() => download(true)}>Yerel kaydı indir</button><button type="button" disabled={!session || recorder.busy} onClick={() => {
      if (session && window.confirm("Yerel bekleyen değişiklikler sunucudaki kayıtla değiştirilecek. Yedeği indirdiniz mi?")) void recorder.open(session.id, true);
    }}>Sunucudan yükle</button></div>}
    {state?.status === "paused" && effectiveEvents(session!).at(-1)?.type === "recover" && <div className={styles.notice}>Kayıt kurtarıldı. Sayfa kapalıyken geçen süre sayılmadı. Sürdürüp bulunduğunuz alanı yeniden seçin.</div>}
    {Math.abs((session?.clockSample ?? plans.data?.clockSample)?.offsetMs ?? 0) > 2000 && <div className={styles.notice}>Cihaz ve sunucu saati arasında yaklaşık {Math.abs((session?.clockSample ?? plans.data?.clockSample)!.offsetMs / 1000).toFixed(1)} saniye fark var. Olaylar cihaz saatiyle kaydedilir; saat ölçümü tam oturum çıktısına eklenir.</div>}
    <section className={styles.setup} aria-label="Test bilgileri"><div className={styles.identity}>
      <label>Test adı<input value={session?.name ?? name} disabled={locked || disabled} maxLength={150} onChange={event => setName(event.target.value)} placeholder="Örn. Servis katı · yürüyüş testi"/></label>
      <label>Tag kimliği<input value={state ? state.tagCodes.join(", ") : tagInput} disabled={locked || disabled} list="room-test-tags" onChange={event => { setTagInput(event.target.value); setVerified(false); }} placeholder="Tag kodu seçin veya yazın"/></label>
      <datalist id="room-test-tags">{tags.data?.map(tag => <option key={tag.id} value={tag.id}>{tag.displayName}</option>)}</datalist>
      <div className={styles.tagVerification}>{locked ? <><span className={styles.tagBadge}><Radio size={12}/>{state?.tagVerified ? "Tag doğrulandı" : "Tag doğrulanmadı"}</span><button type="button" disabled={running || disabled} onClick={() => {
        setTagCorrection({ codes: state?.tagCodes.join(", ") ?? "", verified: Boolean(state?.tagVerified), reason: "" }); setDialog("tags");
      }}>Tag bilgisini düzenle</button></> : <label className={styles.check}><input type="checkbox" checked={verified} disabled={disabled || !tagInput.trim()} onChange={event => setVerified(event.target.checked)}/>Bu tagları birlikte taşıdığımı doğruluyorum</label>}</div>
    </div>{!locked && <p className={styles.help}>Birlikte taşınan tag kodlarını virgülle ayırabilirsiniz. Kimliği doğrulanmayan testler benchmark değerlendirmesinde puanlanmaz.{tags.isError ? " Tag listesi yüklenemedi; gerçek kodu elle yazabilirsiniz." : ""}</p>}</section>
    <section className={styles.toolbar} aria-label="Kayıt kontrolleri"><div className={styles.actions}>
      {!session && <button type="button" className={styles.primary} disabled={disabled || !plan?.floors.some(item => item.areas.length)} onClick={start}><Play size={15}/>Kaydı başlat</button>}
      {state?.status === "paused" && <button type="button" className={styles.primary} disabled={disabled} onClick={() => void recorder.perform({ type: "resume" })}><Play size={15}/>Kaydı sürdür</button>}
      {running && <button type="button" disabled={disabled} onClick={() => void recorder.perform({ type: "pause" })}><Pause size={15}/>Duraklat</button>}
      {session && state?.status !== "completed" && <button type="button" className={styles.danger} disabled={disabled} onClick={() => void recorder.perform({ type: "complete" })}><Square size={13}/>Testi bitir</button>}
      <span className={`${styles.badge} ${running ? styles.live : state?.status === "paused" ? styles.paused : ""}`}><i/>{STATUS_LABELS[state?.status ?? "draft"]}</span>
    </div><div className={styles.actions}><button type="button" disabled={Boolean(session) || disabled} onClick={() => setDialog("settings")}><Settings2 size={14}/>Test ayarları</button><button type="button" disabled={!session} onClick={() => setDialog("export")}><FileJson size={14}/>JSON çıktısı</button></div></section>
    <div className={styles.content}><div className={styles.leftStack}>
      <section className={styles.card}><div className={styles.cardHeader}><div><h2><Layers3 size={16}/>Kat ve alanlar</h2><p>{plan?.building ?? "Plan yükleniyor…"} · {plan?.source === "custom" ? "Özel test planı" : "Sistem planı"}</p></div>
        <div className={styles.actions}>{customPlan && !session && <button type="button" disabled={disabled} onClick={() => { setCustomPlan(null); setFloorId(""); setRoute([]); }}>Sistem planı</button>}<button type="button" disabled={locked || disabled} onClick={() => setDialog("plan")}><Upload size={13}/>{customPlan ? "Planı düzenle" : "Özel plan"}</button></div></div>
        {plans.isError && !customPlan && !session && <div className={styles.notice}>Sistem planı yüklenemedi. <button type="button" onClick={() => void plans.refetch()}>Tekrar dene</button></div>}
        <div className={styles.planTools}><label><span className={styles.srOnly}>Kat ve birim</span><select value={floor?.mapId ?? ""} onChange={event => setFloorId(event.target.value)}>{plan?.floors.map(item => <option key={item.mapId} value={item.mapId}>{item.name}</option>)}</select></label>
          <label className={styles.search}><Search size={15}/><span className={styles.srOnly}>Alan ara</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Oda adı veya kimlik ara"/></label></div>
        <div className={styles.modeBar}><div className={styles.tabs} role="tablist" aria-label="Test modu"><button type="button" role="tab" aria-selected={selectedMode === "floor"} disabled={locked || disabled} onClick={() => setMode("floor")}>Kat planı</button><button type="button" role="tab" aria-selected={selectedMode === "route"} disabled={locked || disabled} onClick={() => { setMode("route"); setDialog("settings"); }}>Sıralı rota</button></div><small>{floor?.areas.length ?? 0} alan</small></div>
        <p className={styles.interactionHint}>{running ? "Yeni alanı seçin: önceki çıkış ve yeni giriş birlikte kaydedilir. Aktif karta tekrar basmak çıkışı işaretler." : state?.status === "completed" ? "Test tamamlandı. Ziyaretleri inceleyebilir veya JSON çıktısını indirebilirsiniz." : state?.status === "paused" ? "Kaydı sürdürün, ardından bulunduğunuz alanı yeniden seçin." : "Kaydı başlatın, ardından tag'ın gerçekten bulunduğu alanı seçin."}</p>
        {selectedMode === "route" && <div className={styles.routeHint}><div><small>SIRADAKİ ADIM · {(state?.routeProgress ?? 0) + (nextStep ? 1 : 0)} / {routeList.length}</small><strong>{nextArea?.name ?? (routeList.length ? "Rota adımları tamamlandı" : "Test ayarlarından rota ekleyin")}</strong>{nextFloor && <span>{nextFloor.name}</span>}</div><button type="button" className={styles.primary} disabled={!running || !nextStep || disabled} onClick={next}><ArrowRight size={14}/>Bu alana girdim</button></div>}
        <div className={styles.areaGroups}>{(["room", "paths"] as const).map(group => {
          const items = areas.filter(area => group === "room" ? area.type === "room" : area.type !== "room");
          return items.length ? <div key={group}><div className={styles.groupHeading}><span>{group === "room" ? "ODALAR" : "KORİDOR VE GİRİŞ / ÇIKIŞ"}</span><small>{items.length} alan</small></div><div className={`${styles.areaGrid} ${group === "paths" ? styles.paths : ""}`}>{items.map(area => {
            const isActive = Boolean(active && active.mapId === floor?.mapId && active.areaId === area.id);
            return <button type="button" key={area.id} className={`${styles.area} ${isActive ? styles.activeArea : ""}`} aria-pressed={isActive} disabled={!running || disabled} onClick={() => choose(area)}>
              <div className={styles.areaTop}><span className={styles.areaIcon}>{area.type === "room" ? <DoorOpen size={20}/> : <MapPin size={19}/>}</span><span>{isActive ? "● Aktif" : running ? "Giriş →" : "Hazır"}</span></div><strong>{area.name}</strong><small>{AREA_LABELS[area.type]} · {area.id}</small>
            </button>;
          })}</div></div> : null;
        })}{!areas.length && <div className={styles.empty}><Layers3 size={25}/><strong>{search ? "Eşleşen alan bulunamadı" : "Henüz alan yok"}</strong><span>{search ? "Aramayı değiştirerek tekrar deneyin." : "Sistem planını yükleyin veya özel bir plan oluşturun."}</span></div>}</div>
        <div className={styles.cardFooter}><button type="button" disabled={!running || !active || disabled} onClick={leave}><DoorOpen size={14}/>{active?.areaType === "room" ? "Odadan çıktım" : "Alandan çıktım"}</button><button type="button" disabled={!state?.undoTarget || disabled} onClick={() => void recorder.perform({ type: "undo", targetId: state!.undoTarget!, reason: "Operatör son geçişi geri aldı" })}><Undo2 size={14}/>Son geçişi geri al</button></div>
      </section>
      <section className={styles.card}><div className={styles.cardHeader}><div><h2><Clock3 size={16}/>Ziyaret geçmişi</h2><p>Giriş, çıkış ve alanda kalış süreleri</p></div><span className={styles.count}>{state?.visits.length ?? 0} ziyaret</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Alan</th><th>Kat / birim</th><th>Giriş</th><th>Çıkış</th><th>Süre</th></tr></thead><tbody>{state?.visits.map(visit => <tr key={visit.id}><td><strong>{visit.areaName}</strong><small>{visit.areaId}</small></td><td>{visit.floorName}</td><td>{stamp(visit.enteredAt)}</td><td>{visit.exitedAt ? stamp(visit.exitedAt) : <span className={styles.activeText}>Aktif</span>}</td><td>{visit.durationSeconds === null ? "—" : `${visit.durationSeconds.toFixed(3)} sn`}</td></tr>)}</tbody></table>{!state?.visits.length && <p className={styles.emptySmall}>İlk alan seçildiğinde ziyaretler burada listelenir.</p>}</div>
      </section>
    </div><div className={styles.rightStack}>
      <section className={`${styles.card} ${styles.statusCard}`}><div className={styles.statusHead}><span>ANLIK TEST DURUMU</span><Activity size={17}/></div><div className={styles.currentArea}><span><MapPin size={25}/></span><div><h2>{active?.areaName ?? (state?.status === "completed" ? "Test tamamlandı" : state?.status === "paused" ? "Kayıt duraklatıldı" : "Alan seçilmedi")}</h2><p>{active ? `${active.floorName} · ${active.areaId}` : running ? "Bulunduğunuz alanı soldan seçin." : state?.status === "paused" ? "Sürdürüp bulunduğunuz alanı seçin." : state?.status === "completed" ? "Kayıt geçmişte saklandı." : "Saha kaydına hazır"}</p></div></div>
        <div className={styles.metrics}><div><span>Kayıt süresi</span><strong>{elapsed(recorded)}</strong><small>Duraklatma süresi hariç</small></div><div><span>Tamamlanan oda</span><strong>{state?.visits.filter(visit => visit.areaType === "room" && visit.exitedAt).length ?? 0}</strong><small>{active ? `Alan süresi: ${Math.max(0, (now - Date.parse(active.enteredAt)) / 1000).toFixed(1)} sn` : "Alan süresi: —"}</small></div></div>
        <p className={styles.statusCaption}>{state?.tagCodes.join(", ") || "Tag kimliği belirtilmedi"}{session ? ` · Revizyon ${session.revision}` : ""}</p>
      </section>
      <section className={`${styles.card} ${styles.terminal}`}><div className={styles.terminalHeader}><h2><Terminal size={15}/>Olay akışı</h2><div><label><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)}/>Takip et</label><label><input type="checkbox" checked={rawLogs} onChange={event => setRawLogs(event.target.checked)}/>Ham JSON</label></div></div>
        <div ref={log} className={styles.log}>{session?.events.slice(-100).map(event => {
          const eventFloor = session.plan.floors.find(item => item.mapId === event.location?.mapId), eventArea = eventFloor?.areas.find(item => item.id === event.location?.areaId);
          const undone = session.events.some(item => item.type === "undo" && item.targetId === event.id);
          return <div key={event.id} className={undone ? styles.undone : ""}>{rawLogs ? <pre>{JSON.stringify(event, null, 2)}</pre> : <><strong>[{stamp(event.at)}] {EVENT_LABELS[event.type]}{undone ? " · geri alındı" : ""}</strong>{eventArea && <p>{eventArea.name} <span>· {eventFloor?.name} · {eventArea.id}</span></p>}{event.reason && <p>{event.reason}</p>}</>}</div>;
        })}{!session && <p className={styles.logEmpty}>&gt; Plan hazır.<br/>&gt; İlk giriş işareti bekleniyor…</p>}</div>
        <div className={styles.terminalFooter}>{session?.events.length ?? 0} olay · son 100 olay gösterilir · {running ? "Kayıt sürüyor" : "Hazır"}</div>
      </section>
    </div></div>
    <footer className={styles.footer}><span role="status">{recorder.pending ? <Clock3 size={12}/> : <CheckCircle2 size={12}/>} {recorder.syncing ? "Sunucuyla eşitleniyor…" : recorder.pending ? `${recorder.pending} işlem yerelde bekliyor` : session ? "Sunucuya kaydedildi" : "Her işlem otomatik kaydedilir"}</span>
      <div>{recorder.syncError && <span className={styles.syncError} title={recorder.syncError}>{recorder.syncError}</span>}{recorder.pending > 0 && <button type="button" disabled={recorder.syncing || recorder.conflict || !recorder.writer} onClick={() => void recorder.sync()}>Tekrar eşitle</button>}<span>İstanbul saati · UTC+03:00</span></div></footer>

    {dialog === "plan" && plan && <TestPlanEditor initial={plan} onClose={() => setDialog(null)} onApply={nextPlan => { setCustomPlan(nextPlan); setFloorId(nextPlan.floors[0].mapId); setRoute([]); setDialog(null); }}/>} 
    {dialog === "plan" && !plan && <TestPlanEditor initial={{ source: "custom", building: "Özel test planı", floors: [{ id: "kat-1", mapId: "custom-kat-1", name: "Kat 1", areas: [] }] }} onClose={() => setDialog(null)} onApply={nextPlan => { setCustomPlan(nextPlan); setFloorId(nextPlan.floors[0].mapId); setDialog(null); }}/>} 
    {dialog === "settings" && <TestDialog title="Test ayarları" description="Test başlamadan kayıt modunu ve sıralı rotayı hazırlayın." onClose={() => setDialog(null)}>
      <label className={styles.field}>Kayıt modu<select value={mode} onChange={event => setMode(event.target.value as "floor" | "route")}><option value="floor">Kat planı · serbest alan seçimi</option><option value="route">Sıralı rota · adım adım kayıt</option></select></label>
      {mode === "route" && <><p className={styles.help}>Alanı seçerek sıraya ekleyin. Aynı oda birden fazla adımda kullanılabilir.</p><select aria-label="Rotaya alan ekle" value="" onChange={event => {
        const [mapId, areaId] = JSON.parse(event.target.value) as [string, string]; setRoute([...route, { mapId, areaId }]);
      }}><option value="">+ Rotaya alan ekle</option>{plan?.floors.map(item => <optgroup key={item.mapId} label={item.name}>{item.areas.map(area => <option key={area.id} value={JSON.stringify([item.mapId, area.id])}>{area.name}</option>)}</optgroup>)}</select>
        <ol className={styles.routeList}>{route.map((step, index) => <li key={index}><span>{plan?.floors.find(item => item.mapId === step.mapId)?.areas.find(area => area.id === step.areaId)?.name}</span><button type="button" aria-label={`${index + 1}. adımı kaldır`} onClick={() => setRoute(route.filter((_, candidate) => candidate !== index))}><Trash2 size={14}/></button></li>)}</ol></>}
      <p className={styles.help}>Oturum başlayınca plan ve rota korunur. Değiştirmek için yeni test oluşturun.</p><button type="button" className={styles.primary} onClick={() => setDialog(null)}><Check size={14}/>Tamam</button>
    </TestDialog>}
    {dialog === "history" && <TestHistoryDialog local={history} currentId={recorder.currentId} onOpen={recorder.open} onClose={() => setDialog(null)}/>}
    {dialog === "tags" && <TestDialog title="Tag bilgisini düzelt" description="Düzeltme önceki kayıtları silmeden yeni bir revizyon oluşturur." onClose={() => setDialog(null)}>
      <div className={styles.field}><label>Tag kodları<input value={tagCorrection.codes} list="room-test-tags" onChange={event => setTagCorrection({ ...tagCorrection, codes: event.target.value, verified: false })}/></label></div>
      <label className={styles.check}><input type="checkbox" checked={tagCorrection.verified} onChange={event => setTagCorrection({ ...tagCorrection, verified: event.target.checked })}/>Bu tagları birlikte taşıdığımı doğruluyorum</label>
      <label className={styles.field}>Düzeltme açıklaması<input value={tagCorrection.reason} placeholder="Örn. Gerçek tag kodu saha kaydıyla doğrulandı" onChange={event => setTagCorrection({ ...tagCorrection, reason: event.target.value })}/></label>
      <button type="button" className={styles.primary} disabled={!tagCorrection.reason.trim() || disabled} onClick={() => { void recorder.perform({ type: "tags", tagCodes: parseTags(tagCorrection.codes), tagVerified: tagCorrection.verified, reason: tagCorrection.reason }).then(() => setDialog(null)); }}>Düzeltmeyi kaydet</button>
    </TestDialog>}
    {dialog === "export" && session && <TestDialog title="JSON çıktısı" description="Ziyaretleri veya plan ve olaylarla birlikte tam oturumu indirin." wide onClose={() => setDialog(null)}>
      <div className={styles.formGrid}><label>Çıktı biçimi<select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}><option value="tagged">Test bilgileri ve tag kimliği</option><option value="array">Yalnızca ziyaret dizisi</option><option value="full">Tam oturum · plan ve olaylar</option><option value="benchmark">Benchmark · harita bazında parçalar</option></select></label>
        <label>Kapsam<select value={scope ? "all" : "rooms"} disabled={format === "full" || format === "benchmark"} onChange={event => setScope(event.target.value === "all")}><option value="rooms">Yalnızca odalar</option><option value="all">Tüm alanlar</option></select></label></div>
      {output.error && <div className={styles.notice}>{output.error}</div>}
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={!output.json} onClick={() => download()}><Download size={14}/>JSON indir</button><button type="button" disabled={!output.json} onClick={async () => {
        try { await navigator.clipboard.writeText(output.json); setNotice("JSON panoya kopyalandı."); } catch { preview.current?.focus(); preview.current?.select(); setNotice("JSON seçildi. Ctrl+C ile kopyalayın."); }
      }}><Clipboard size={14}/>Kopyala</button><button type="button" onClick={() => download(true)}>Tam oturum indir</button></div>
      <textarea ref={preview} className={styles.jsonPreview} rows={14} value={output.json} readOnly aria-label="JSON önizlemesi"/>
      {output.parts.length > 0 && <div className={styles.editorSection}><h3>Benchmark dosyaları</h3>{output.parts.map((part, index) => <div className={styles.actions} key={part.truth.testId}><span className={styles.help}>{index + 1}. parça · {part.mapId}</span><button type="button" onClick={() => downloadTest(part.truth, `${part.truth.testId}-truth`)}>Truth indir</button>{Boolean(part.config) && <button type="button" onClick={() => downloadTest(part.config, `${part.truth.testId}-regions`)}>Harita yapılandırmasını indir</button>}</div>)}</div>}
      <p className={styles.help}>Zamanlar UTC olarak kaydedilir. Aktif ziyarette çıkış ve süre null olur. Benchmark, yalnız gözlenen kesintisiz aralıkları ayrı truth parçaları olarak üretir.</p>
      <details className={styles.editorSection}><summary>Bir JSON dosyasını canlı güncelle</summary><p className={styles.help}>Tam oturum seçtiğiniz dosyaya her işlemde yazılır. Her test için yeniden dosya seçin.</p><div className={styles.actions}><button type="button" disabled={!fileSupported} onClick={() => void saveFile()}><Download size={14}/>{fileSupported ? "Canlı dosya seç" : "Bu tarayıcı canlı dosyayı desteklemiyor"}</button>{fileSessionId === session.id && <button type="button" onClick={() => { liveFile.current = null; setFileSessionId(null); setFileStatus("Dosya bağlantısı kesildi."); }}>Bağlantıyı kes</button>}</div>{fileStatus && <p className={styles.help} role="status">{fileStatus}</p>}</details>
    </TestDialog>}
  </div>;
}
