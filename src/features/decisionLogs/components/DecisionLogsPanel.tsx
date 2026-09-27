"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { DecisionLogFilters, type DecisionFilterForm } from "./DecisionLogFilters";
import { DecisionLogList } from "./DecisionLogList";
import { DecisionLogDetail } from "./DecisionLogDetail";
import { downloadDecisionLogs, fetchDecisionLogDetail, fetchDecisionLogs } from "../services/decisionLogsApi";
import { RouteReportDialog } from "@/src/features/reports/components/RouteReportDialog";
import type { DecisionLogDetail as Detail, DecisionLogFilters as Filters, DecisionLogSummary } from "../types/decisionLog.types";
import styles from "./decisionLogs.module.css";

function localInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0,16);
}
function initialForm(): DecisionFilterForm { const now=new Date(); return { tagCode:"",from:localInput(new Date(now.getTime()-3_600_000)),to:localInput(now),mapId:"",regionId:"",eventType:"",measurementKind:"",importantOnly:false }; }
function toFilters(form: DecisionFilterForm, cursor?: string): Filters {
  return { from:new Date(form.from).toISOString(),to:new Date(form.to).toISOString(),limit:100,
    ...(form.tagCode.trim()?{tagCode:form.tagCode.trim()}:{}),...(form.mapId.trim()?{mapId:form.mapId.trim()}:{}),...(form.regionId.trim()?{regionId:form.regionId.trim()}:{}),
    ...(form.eventType?{eventType:form.eventType as Filters["eventType"]}:{}),...(form.measurementKind?{measurementKind:form.measurementKind as Filters["measurementKind"]}:{}),
    ...(form.importantOnly?{importantOnly:true}:{}),...(cursor?{cursor}:{}) };
}
function merge(current: readonly DecisionLogSummary[], incoming: readonly DecisionLogSummary[]): DecisionLogSummary[] {
  const unique=new Map(current.map(item=>[item.decisionId,item])); for(const item of incoming) unique.set(item.decisionId,item);
  return [...unique.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||b.decisionId.localeCompare(a.decisionId));
}

export function DecisionLogsPanel() {
  const [draft,setDraft]=useState<DecisionFilterForm>(initialForm); const [active,setActive]=useState<DecisionFilterForm>(initialForm);
  const [items,setItems]=useState<DecisionLogSummary[]>([]); const [selectedId,setSelectedId]=useState<string|null>(null); const [detail,setDetail]=useState<Detail|null>(null);
  const [loading,setLoading]=useState(true); const [refreshing,setRefreshing]=useState(false); const [error,setError]=useState<string|null>(null); const [validation,setValidation]=useState<string|null>(null);
  const [detailLoading,setDetailLoading]=useState(false); const [detailError,setDetailError]=useState<string|null>(null); const [live,setLive]=useState(true); const [nextCursor,setNextCursor]=useState<string|null>(null); const [total,setTotal]=useState(0);
  const inFlight=useRef(false);
  const [reportOpen,setReportOpen]=useState(false);
  const load=useCallback(async (mode:"replace"|"poll"|"more", cursor?:string) => {
    if(inFlight.current)return; inFlight.current=true; if(mode==="replace")setLoading(true);else setRefreshing(true); setError(null);
    try { const queryForm=mode==="poll"?{...active,to:localInput(new Date())}:active; const result=await fetchDecisionLogs(toFilters(queryForm,cursor)); setItems(current=>mode==="replace"?[...result.items]:merge(current,result.items)); if(mode!=="poll")setNextCursor(result.nextCursor); setTotal(result.metadata.filteredCount); setSelectedId(current=>current??result.items[0]?.decisionId??null); }
    catch(caught){setError(caught instanceof Error?caught.message:"Karar kayıtları yüklenemedi.");}
    finally{inFlight.current=false;setLoading(false);setRefreshing(false);}
  },[active]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load("replace"),0);return()=>window.clearTimeout(timer);},[load]);
  useEffect(()=>{if(!live)return;const timer=window.setInterval(()=>void load("poll"),4000);return()=>window.clearInterval(timer);},[live,load]);
  useEffect(()=>{const controller=new AbortController();const timer=window.setTimeout(()=>{if(!selectedId){setDetail(null);return;}setDetailLoading(true);setDetailError(null);void fetchDecisionLogDetail(selectedId,controller.signal).then(setDetail).catch(caught=>{if(!controller.signal.aborted)setDetailError(caught instanceof Error?caught.message:"Karar ayrıntısı yüklenemedi.");}).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false);});},0);return()=>{window.clearTimeout(timer);controller.abort();};},[selectedId]);
  const apply=()=>{const from=Date.parse(draft.from),to=Date.parse(draft.to);if(!Number.isFinite(from)||!Number.isFinite(to)){setValidation("Başlangıç ve bitiş zamanı geçerli olmalıdır.");return;}if(from>to){setValidation("Başlangıç zamanı bitiş zamanından sonra olamaz.");return;}setValidation(null);setSelectedId(null);setDetail(null);setActive({...draft});};
  const clear=()=>{const value=initialForm();setDraft(value);setValidation(null);setSelectedId(null);setDetail(null);setActive(value);};
  const cards=useMemo(()=>({assigned:items.filter(i=>i.eventType==="ROOM_CONFIRMED").length,inferred:items.filter(i=>i.eventType==="ROOM_INFERRED").length,uncertain:items.filter(i=>i.eventType==="LOCATION_LOST"||i.measurementKind==="uncertain").length,rejected:items.filter(i=>i.eventType==="MEASUREMENT_REJECTED").length}),[items]);
  return <div className={styles.panel}>
    <header className={styles.heading}><div><small>ANALİZLER / ODA MOTORU</small><h1>Oda Motoru Karar Kayıtları</h1><p>Ham ölçümden yayımlanan oda kararına kadar kanıtları ve durum geçişlerini inceleyin.</p></div><div className={styles.headingActions}><button type="button" onClick={()=>setReportOpen(true)}><Download size={15}/> Rapor Oluştur</button><button type="button" onClick={()=>downloadDecisionLogs(items,"json")} disabled={!items.length}><Download size={15}/> JSON</button><button type="button" onClick={()=>downloadDecisionLogs(items,"csv")} disabled={!items.length}><Download size={15}/> CSV</button><button type="button" onClick={()=>void load("poll")} disabled={refreshing}><RefreshCw size={15} className={refreshing?styles.spin:""}/> Yenile</button></div></header>
    {reportOpen&&<RouteReportDialog onClose={()=>setReportOpen(false)}/>}
    <div className={styles.cards}><article><span>Toplam karar</span><strong>{total}</strong><small>{items.length} kayıt görüntüleniyor</small></article><article><span>Odaya atama</span><strong>{cards.assigned}</strong><small>Doğrulanmış</small></article><article><span>Tahmini karar</span><strong>{cards.inferred}</strong><small>Ölçüm kesintisi / çıkarım</small></article><article><span>Belirsiz / konum kayıp</span><strong>{cards.uncertain}</strong><small>İncelenen sayfada</small></article><article><span>Reddedilen ölçüm</span><strong>{cards.rejected}</strong><small>Kalite, hız veya zaman</small></article></div>
    <DecisionLogFilters value={draft} live={live} disabled={loading} error={validation} onChange={setDraft} onApply={apply} onClear={clear} onLiveChange={setLive}/>
    {error&&<div className={styles.errorBanner} role="alert"><span>{error}</span><button type="button" onClick={()=>void load("replace")}>Tekrar dene</button></div>}
    <div className={`${styles.content} ${selectedId?styles.hasMobileSelection:""}`}>
      <section className={styles.listPane} aria-busy={loading}>{loading?<div className={styles.state}>Karar kayıtları yükleniyor…</div>:!items.length&&!error?<div className={styles.state}><strong>Kayıt bulunamadı</strong><span>Seçili filtre ve zaman aralığında karar kaydı yok.</span></div>:<><DecisionLogList items={items} selectedId={selectedId} onSelect={setSelectedId}/>{nextCursor&&<button type="button" className={styles.more} onClick={()=>void load("more",nextCursor)} disabled={refreshing}>Daha eski kayıtları yükle</button>}</>}</section>
      <DecisionLogDetail item={detail} loading={detailLoading} error={detailError} onBack={()=>setSelectedId(null)}/>
    </div>
    {live&&<div className={styles.liveStatus}><i/> Canlı yenileme açık · 4 saniye</div>}
  </div>;
}
