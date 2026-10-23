"use client";
import { useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { importPlan, planSchema, type TestArea, type TestPlan } from "../services/roomTestModel";
import { downloadTest } from "../services/roomTestApi";
import { TestDialog } from "./TestDialog";
import styles from "./roomTests.module.css";

export const EMPTY_TEST_PLAN: TestPlan = { source: "custom", building: "Özel test planı", floors: [{ id: "kat-1", mapId: "custom-kat-1", name: "Kat 1", areas: [] }] };
const EMPTY_AREA: TestArea = { id: "", name: "", type: "room" };
export const AREA_LABELS = { room: "Oda", corridor: "Koridor", entrance: "Kat girişi", exit: "Kat çıkışı" };

export function TestPlanEditor({ initial, onApply, onClose }: { initial: TestPlan; onApply: (plan: TestPlan) => void; onClose: () => void }) {
  const [plan, setPlan] = useState<TestPlan>(() => structuredClone(initial.source === "custom" ? initial : EMPTY_TEST_PLAN));
  const [floorIndex, setFloorIndex] = useState(0), [area, setArea] = useState<TestArea>(EMPTY_AREA), [editingId, setEditingId] = useState<string | null>(null);
  const [newFloor, setNewFloor] = useState({ id: "", name: "" }), [json, setJson] = useState(""), [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const floor = plan.floors[floorIndex];
  const changeFloor = (update: Partial<TestPlan["floors"][number]>) => setPlan({ ...plan, floors: plan.floors.map((item, index) => index === floorIndex ? { ...item, ...update } : item) });
  const validate = (next: TestPlan) => { const parsed = planSchema.safeParse(next); if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join(" ")); return parsed.data; };
  const safely = (action: () => void) => { setError(""); try { action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Plan geçersiz."); } };
  const parse = (value: string) => safely(() => { const next = importPlan(JSON.parse(value)); setPlan(next); setFloorIndex(0); setArea(EMPTY_AREA); setEditingId(null); setJson(JSON.stringify(next, null, 2)); });
  return <TestDialog title="Özel kat planı" description="Oda, koridor ve giriş/çıkış alanlarıyla bir test şablonu hazırlayın." wide onClose={onClose}>
    {error && <div className={styles.error} role="alert">{error}</div>}
    <div className={styles.notice}>Bu şablon test kaydı içindir. Sistem haritaları ve oda geometrileri değişmez.</div>
    <div className={styles.formGrid}><label>Plan adı<input value={plan.building} maxLength={150} onChange={event => setPlan({ ...plan, building: event.target.value })}/></label>
      <label>Kat<select value={floorIndex} onChange={event => { setFloorIndex(Number(event.target.value)); setArea(EMPTY_AREA); setEditingId(null); }}>{plan.floors.map((item, index) => <option key={item.mapId} value={index}>{item.name}</option>)}</select></label></div>
    <section className={styles.editorSection}><h3>Katlar</h3><div className={styles.inlineForm}><label>Seçili kat adı<input value={floor.name} onChange={event => changeFloor({ name: event.target.value })}/></label>
      <button type="button" className={styles.danger} disabled={plan.floors.length === 1} onClick={() => { if (!window.confirm(`${floor.name} ve alanları silinsin mi?`)) return;
        setPlan({ ...plan, floors: plan.floors.filter((_, index) => index !== floorIndex) }); setFloorIndex(0); setArea(EMPTY_AREA); setEditingId(null); }}><Trash2 size={14}/>Katı sil</button></div>
      <div className={styles.inlineForm}><label>Yeni kat kimliği<input placeholder="servis-kati" value={newFloor.id} onChange={event => setNewFloor({ ...newFloor, id: event.target.value })}/></label><label>Yeni kat adı<input placeholder="Servis katı" value={newFloor.name} onChange={event => setNewFloor({ ...newFloor, name: event.target.value })}/></label>
        <button type="button" onClick={() => safely(() => { const next = validate({ ...plan, floors: [...plan.floors, { ...newFloor, mapId: `custom-${newFloor.id}`, areas: [] }] });
          setPlan(next); setFloorIndex(next.floors.length - 1); setNewFloor({ id: "", name: "" }); setArea(EMPTY_AREA); setEditingId(null); })}><Plus size={14}/>Kat ekle</button></div>
    </section>
    <section className={styles.editorSection}><h3>{editingId ? "Alanı düzenle" : "Alan ekle"}</h3>
      <div className={styles.formGrid}><label>Alan adı<input placeholder="Oda 5" value={area.name} onChange={event => setArea({ ...area, name: event.target.value })}/></label>
        <label>Alan kimliği<input placeholder="oda5" disabled={Boolean(editingId)} value={area.id} onChange={event => setArea({ ...area, id: event.target.value })}/></label>
        <label>Tür<select value={area.type} onChange={event => setArea({ ...area, type: event.target.value as TestArea["type"] })}>{Object.entries(AREA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Bağlantı<select value={area.connectsTo ?? ""} onChange={event => setArea({ ...area, connectsTo: event.target.value || undefined })}><option value="">Bağlantı yok</option>{floor.areas.filter(item => item.id !== area.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => safely(() => {
        const areas = editingId ? floor.areas.map(item => item.id === editingId ? area : item) : [...floor.areas, area];
        const next = validate({ ...plan, floors: plan.floors.map((item, index) => index === floorIndex ? { ...item, areas } : item) });
        setPlan(next); setArea(EMPTY_AREA); setEditingId(null);
      })}><Plus size={14}/>{editingId ? "Alanı güncelle" : "Alan ekle"}</button>{editingId && <button type="button" onClick={() => { setArea(EMPTY_AREA); setEditingId(null); }}>Vazgeç</button>}</div>
      <div className={styles.editorList}>{floor.areas.map(item => <div key={item.id}><span><strong>{item.name}</strong><small>{AREA_LABELS[item.type]} · {item.id}</small></span><button type="button" onClick={() => { setArea(item); setEditingId(item.id); }}>Düzenle</button><button type="button" className={styles.danger} aria-label={`${item.name} alanını sil`} onClick={() => {
        if (!window.confirm(`${item.name} silinsin mi?`)) return;
        changeFloor({ areas: floor.areas.filter(candidate => candidate.id !== item.id).map(candidate => candidate.connectsTo === item.id ? { ...candidate, connectsTo: undefined } : candidate) });
        if (editingId === item.id) { setArea(EMPTY_AREA); setEditingId(null); }
      }}><Trash2 size={14}/></button></div>)}{!floor.areas.length && <p className={styles.emptySmall}>Bu kata henüz alan eklenmedi.</p>}</div>
    </section>
    <details className={styles.editorSection}><summary>JSON planını yükle veya düzenle</summary><div className={styles.actions}><button type="button" onClick={() => file.current?.click()}><Upload size={14}/>Dosya aç</button>
      <button type="button" onClick={() => setJson(JSON.stringify(plan, null, 2))}>Planı JSON olarak göster</button><button type="button" onClick={() => downloadTest(plan, "kat-plani")}><Download size={14}/>Plan indir</button></div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={async event => { const chosen = event.target.files?.[0]; event.target.value = ""; if (!chosen) return;
        if (chosen.size > 5 * 1024 * 1024) { setError("Dosya en fazla 5 MB olabilir."); return; } try { parse(await chosen.text()); } catch { setError("Dosya okunamadı."); } }}/>
      <textarea rows={10} value={json} onChange={event => setJson(event.target.value)} aria-label="Plan JSON" spellCheck={false}/><button type="button" onClick={() => parse(json)}>JSON önizlemesini yükle</button>
      <p className={styles.help}>Yüklenen planı yukarıda kontrol edip “Bu planı kullan” ile uygulayın.</p>
    </details>
    <div className={styles.dialogFooter}><button type="button" onClick={onClose}>Vazgeç</button><button type="button" className={styles.primary} onClick={() => safely(() => { const checked = validate(plan);
      if (!checked.floors.some(item => item.areas.length)) throw new Error("Plana en az bir alan ekleyin."); onApply(checked); })}>Bu planı kullan</button></div>
  </TestDialog>;
}
