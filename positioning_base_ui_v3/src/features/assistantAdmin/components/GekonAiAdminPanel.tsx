"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, ArrowDownRight, Bot, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, KeyRound, Loader2, LogOut, MessageSquare, Power, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { ASSISTANT_UNAVAILABLE_MESSAGE } from "../../assistant/services/assistantAvailability";
import { AssistantAdminApiError, fetchAdminSession, fetchAdminSettings, fetchAssistantRequest, fetchAssistantRequests, fetchAssistantSummary, loginAdmin, logoutAdmin, saveAdminSettings } from "../services/gekonAiAdminApi";
import { istanbulDate, shiftDate, REQUEST_STATUSES, STATUS_LABELS, type AssistantRequestFilters, type AssistantRequestStatus, type AssistantSummary } from "../types/assistantAdmin.types";
import styles from "./gekonAiAdmin.module.css";

const KEY = "gekon-ai-admin";
const SESSION_KEY = [KEY, "session"];
const number = (value: number) => value.toLocaleString("tr-TR");
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const dayLabel = (value: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00+03:00`));
const duration = (ms: number | null) => ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

function StatusBadge({ status }: { status: AssistantRequestStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}><i />{STATUS_LABELS[status]}</span>;
}
function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const query = useQuery({ queryKey: [KEY, "detail", id], queryFn: ({ signal }) => fetchAssistantRequest(id, signal), retry: false, staleTime: 0 });
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const record = query.data;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="gekon-request-title" onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className={styles.detailHeading}><div><small>SORU KAYDI</small><h2 id="gekon-request-title">Konuşma detayı</h2></div><button type="button" onClick={onClose} aria-label="Detayı kapat"><X size={18} /></button></header>
    <div className={styles.detailBody}>
      {query.isPending && <div className={styles.empty}><Loader2 className={styles.spin} size={22} />Kayıt yükleniyor…</div>}
      {query.isError && <div className={styles.notice} role="alert"><AlertCircle size={16} />{errorText(query.error)}</div>}
      {record && <>
        <div className={styles.detailMeta}><StatusBadge status={record.status} /><time>{dateTime(record.createdAt)}</time></div>
        <section className={styles.conversation}><h3><MessageSquare size={14} /> Kullanıcı sorusu</h3><p>{record.question}</p></section>
        <section className={`${styles.conversation} ${styles.answer}`}><h3><Bot size={14} /> Gekon AI cevabı</h3><p>{record.answer ?? (record.status === "pending" ? "Yanıt hazırlanıyor…" : "Bu istek için tamamlanmış bir cevap bulunmuyor.")}</p></section>
        <section className={styles.facts}><h3>İstek bilgileri</h3><dl>
          <dt>Yanıt kaynağı</dt><dd>{record.provider === "gemini" ? "Gemini" : record.provider === "local" ? "Yerel konum servisi" : "—"}</dd>
          <dt>Model</dt><dd>{record.model ?? "—"}</dd><dt>Yanıt süresi</dt><dd>{duration(record.durationMs)}</dd>
          <dt>Ekran</dt><dd>{record.mode === "history" ? "Rota geçmişi" : record.mode === "live" ? "Canlı harita" : "—"}</dd>
          <dt>Model isteği</dt><dd>{record.providerAttempted ? "Gönderildi" : "Gönderilmedi"}</dd>
          <dt>Oturum</dt><dd className={styles.mono}>{record.sessionKey}</dd><dt>İstek kimliği</dt><dd className={styles.mono}>{record.id}</dd>
        </dl><p className={styles.footnote}>Oturum kodu bir kullanıcı kimliği değildir.</p></section>
        {record.errorCode && <section className={styles.technical}><h3><AlertCircle size={14} /> Yönetim notu</h3><code>{record.errorCode}</code>{record.errorSummary && <p>{record.errorSummary}</p>}{record.upstreamStatus && <small>Servis durum kodu: {record.upstreamStatus}</small>}</section>}
      </>}
    </div>
  </dialog>;
}

function DailyChart({ summary, loading }: { summary?: AssistantSummary; loading: boolean }) {
  const days = summary?.days ?? [];
  const max = Math.max(1, ...days.map(day => day.total));
  return <div className={styles.chart} aria-busy={loading}>
    <div className={styles.axis}><span>{summary ? number(max) : "—"}</span><span>{summary ? number(Math.round(max / 2)) : "—"}</span><span>0</span></div>
    <div className={styles.plot} role="img" aria-label={summary ? `Günlük istek sayıları. ${days.map(day => `${dayLabel(day.date)}: ${day.total}`).join(", ")}` : "Günlük istek sayıları yükleniyor"}>
      <div className={styles.gridLines}><i /><i /><i /></div>
      {loading && !summary ? <div className={styles.chartLoading}><Loader2 className={styles.spin} size={20} /></div> : days.map((day, index) => <div key={day.date} className={styles.column} title={`${dayLabel(day.date)}: ${number(day.total)} istek · ${day.success} başarılı · ${day.error} hata · ${day.disabled} kullanım dışı`}>
        <div className={styles.barTrack}><div className={styles.bar} style={{ height: `${Math.max(day.total ? 3 : 0.7, day.total / max * 100)}%` }}>
          {day.total > 0 ? <>{day.disabled > 0 && <span className={styles.barDisabled} style={{ flex: day.disabled }} />}{day.error > 0 && <span className={styles.barError} style={{ flex: day.error }} />}{day.pending + day.interrupted > 0 && <span className={styles.barPending} style={{ flex: day.pending + day.interrupted }} />}{day.success > 0 && <span className={styles.barSuccess} style={{ flex: day.success }} />}</> : <span className={styles.barZero} />}
        </div></div><span className={styles.day}>{days.length <= 7 || index % 5 === 0 || index === days.length - 1 ? dayLabel(day.date) : ""}</span>
      </div>)}
    </div>
  </div>;
}

export function GekonAiAdminPanel() {
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [draftSetting, setDraftSetting] = useState<{ enabled: boolean; version: number } | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterError, setFilterError] = useState("");
  const [filters, setFilters] = useState<AssistantRequestFilters>(() => {
    const today = istanbulDate(); return { from: shiftDate(today, -6), to: today, status: "", provider: "", search: "", page: 1 };
  });
  const [form, setForm] = useState(filters);
  const session = useQuery({ queryKey: SESSION_KEY, queryFn: fetchAdminSession, retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const authenticated = session.data?.authenticated === true;
  const settings = useQuery({ queryKey: [KEY, "settings"], queryFn: ({ signal }) => fetchAdminSettings(signal), enabled: authenticated, retry: false, refetchInterval: 30_000, staleTime: 0 });
  const summary = useQuery({ queryKey: [KEY, "summary", filters.from, filters.to], queryFn: ({ signal }) => fetchAssistantSummary(filters.from, filters.to, signal), enabled: authenticated, retry: false, refetchInterval: 20_000, staleTime: 0 });
  const requests = useQuery({ queryKey: [KEY, "requests", filters], queryFn: ({ signal }) => fetchAssistantRequests(filters, signal), enabled: authenticated, retry: false, refetchInterval: 20_000, staleTime: 0 });
  const protectedError = settings.error ?? summary.error ?? requests.error;
  useEffect(() => {
    if (protectedError instanceof AssistantAdminApiError && protectedError.status === 401) client.setQueryData(SESSION_KEY, { authenticated: false, configured: true });
  }, [client, protectedError]);
  const login = useMutation({ mutationFn: loginAdmin, onSuccess: data => { setPassword(""); client.setQueryData(SESSION_KEY, data); void client.invalidateQueries({ queryKey: [KEY] }); } });
  const logout = useMutation({ mutationFn: logoutAdmin, onSuccess: data => {
    client.setQueryData(SESSION_KEY, data);
    client.removeQueries({ predicate: query => query.queryKey[0] === KEY && query.queryKey[1] !== "session" });
    setSelectedId(null); setDraftSetting(null); setSavedMessage("");
  } });
  const save = useMutation({ mutationFn: saveAdminSettings, onSuccess: data => {
    client.setQueryData([KEY, "settings"], data); setDraftSetting(null); setSavedMessage(data.settings.enabled ? "Gekon AI aktif olarak kaydedildi." : "Gekon AI kullanım dışı olarak kaydedildi.");
    void client.invalidateQueries({ queryKey: [KEY, "summary"] }); void client.invalidateQueries({ queryKey: [KEY, "requests"] });
  }, onError: error => {
    if (error instanceof AssistantAdminApiError && error.status === 409) { setDraftSetting(null); void client.invalidateQueries({ queryKey: [KEY, "settings"] }); }
    if (error instanceof AssistantAdminApiError && error.status === 401) client.setQueryData(SESSION_KEY, { authenticated: false, configured: true });
  } });
  const refresh = () => { setSavedMessage(""); void client.invalidateQueries({ queryKey: [KEY] }); };
  const choosePeriod = (days: number) => {
    const today = istanbulDate(); const next = { ...filters, from: shiftDate(today, 1 - days), to: today, page: 1 };
    setFilters(next); setForm(next); setFilterError("");
  };
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const days = (Date.parse(`${form.to}T00:00:00Z`) - Date.parse(`${form.from}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(days) || days < 0 || days > 30) { setFilterError("En fazla 31 günlük geçerli bir tarih aralığı seçin."); return; }
    setFilters({ ...form, search: form.search.trim(), page: 1 }); setFilterError("");
  };
  const stored = settings.data?.settings;
  const choice = draftSetting?.enabled ?? stored?.enabled;
  const changed = stored && draftSetting && draftSetting.enabled !== stored.enabled;
  const todayCounts = summary.isError ? undefined : summary.data?.today;
  const totalPages = Math.max(1, Math.ceil((requests.data?.total ?? 0) / 25));
  const cards = [
    { label: "Bugünkü istek", value: todayCounts?.total, icon: MessageSquare, className: styles.totalCard, note: "Tüm geçerli sorular" },
    { label: "Başarılı yanıt", value: todayCounts?.success, icon: CheckCircle2, className: styles.successCard, note: "Yerel servis ve AI" },
    { label: "Teknik hata", value: todayCounts?.error, icon: AlertCircle, className: styles.errorCard, note: "Tamamlanamayan yanıtlar" },
    { label: "Kullanım dışı istek", value: todayCounts?.disabled, icon: Power, className: styles.disabledCard, note: "Sabit mesaj gösterildi" },
  ];
  return <section className={styles.panel} aria-label="Gekon AI yönetim paneli">
    <header className={styles.heading}><div className={styles.headingTitle}><span className={styles.brandIcon}><Bot size={23} /></span><div><small>YÖNETİM / YAPAY ZEKA</small><h1>Gekon AI</h1><p>Kullanımı izleyin, konuşmaları inceleyin ve erişimi yönetin.</p></div></div><div className={styles.headingActions}>
      <button type="button" onClick={refresh} disabled={session.isFetching || (authenticated && (settings.isFetching || summary.isFetching || requests.isFetching))} title="Verileri yenile"><RefreshCw size={14} className={session.isFetching || summary.isFetching ? styles.spin : ""} /><span>Yenile</span></button>
      {authenticated && <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={14} /><span>Oturumu kapat</span></button>}
    </div></header>
    {session.isPending ? <div className={styles.loadingScreen}><Loader2 className={styles.spin} size={24} />Yönetim paneli hazırlanıyor…</div> : session.isError ? <div className={styles.notice} role="alert"><AlertCircle size={16} />{errorText(session.error)}</div> : !authenticated ? <div className={styles.accessFrame}><div className={styles.accessCard}>
      <span className={styles.accessIcon}><ShieldCheck size={28} /></span><small>YÖNETİCİ ERİŞİMİ</small><h2>Gekon AI yönetimine giriş</h2><p>Soru kayıtlarını görüntülemek ve sistem durumunu değiştirmek için yönetim parolanızı girin.</p>
      {session.data?.configured ? <form onSubmit={event => { event.preventDefault(); login.mutate(password); }}><label htmlFor="gekon-admin-password">Yönetim parolası</label><div className={styles.passwordInput}><KeyRound size={16} /><input id="gekon-admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} required placeholder="Parolanızı girin" /></div>{login.isError && <p className={styles.formError} role="alert">{errorText(login.error)}</p>}<button className={styles.primary} disabled={login.isPending || !password} type="submit">{login.isPending ? <Loader2 className={styles.spin} size={15} /> : <ShieldCheck size={15} />} Yönetim panelini aç</button></form> : <div className={styles.notice}><AlertCircle size={17} />Yönetim erişimi henüz hazırlanmamış. Sistem yöneticisi erişim parolasını yapılandırmalıdır.</div>}
      <span className={styles.accessFootnote}><KeyRound size={12} /> Kayıtlar yalnızca yetkili yönetici oturumuna açıktır.</span>
    </div></div> : <>
      {protectedError && <div className={styles.notice} role="alert"><AlertCircle size={16} /><span>{errorText(protectedError)}</span><button type="button" onClick={refresh}>Tekrar dene</button></div>}
      {logout.isError && <div className={styles.notice} role="alert">{errorText(logout.error)}</div>}
      <div className={styles.metrics}>{cards.map(({ label, value, icon: Icon, className, note }) => <article className={`${styles.metric} ${className}`} key={label}><div><span>{label}</span><Icon size={17} /></div><strong>{value === undefined ? "—" : number(value)}</strong><small>{note}</small></article>)}</div>
      <div className={styles.overview}>
        <section className={styles.chartCard}><header className={styles.cardHeading}><div><h2><Activity size={16} /> Günlük istekler</h2><p>{dayLabel(filters.from)} – {dayLabel(filters.to)} · İstanbul saati</p></div><div className={styles.periodButtons}><button type="button" onClick={() => choosePeriod(7)} aria-pressed={filters.from === shiftDate(istanbulDate(), -6) && filters.to === istanbulDate()}>7 gün</button><button type="button" onClick={() => choosePeriod(30)} aria-pressed={filters.from === shiftDate(istanbulDate(), -29) && filters.to === istanbulDate()}>30 gün</button></div></header>
          {summary.isError ? <div className={styles.chartUnavailable}>Günlük kullanım verileri yüklenemedi.</div> : <DailyChart summary={summary.data} loading={summary.isPending} />}
          <footer className={styles.chartFooter}><div className={styles.legend}><span><i className={styles.barSuccess} />Başarılı</span><span><i className={styles.barError} />Hata</span><span><i className={styles.barDisabled} />Kullanım dışı</span><span><i className={styles.barPending} />Diğer</span></div><span>Dönem toplamı <strong>{summary.isError || !summary.data ? "—" : number(summary.data.totals.total)}</strong></span></footer>
        </section>
        <section className={styles.statusCard}><header className={styles.cardHeading}><h2><Power size={16} /> Kullanım durumu</h2>{stored && <span className={`${styles.badge} ${stored.enabled ? styles.success : styles.disabled}`}><i />{stored.enabled ? "Aktif" : "Kullanım dışı"}</span>}</header>
          <p className={styles.statusDescription}>Bu ayar tüm kullanıcılar için geçerlidir.</p><div className={styles.stateChoices} role="group" aria-label="Gekon AI kullanım durumu">{[true, false].map(enabled => <button key={String(enabled)} type="button" aria-pressed={choice === enabled} disabled={!stored || settings.isError || save.isPending} onClick={() => { setDraftSetting({ enabled, version: stored!.version }); setSavedMessage(""); save.reset(); }}><span>{enabled ? <CheckCircle2 size={16} /> : <Power size={16} />}<strong>{enabled ? "Aktif" : "Kullanım dışı"}</strong></span><small>{enabled ? "Soruları yanıtlar" : "Sabit mesaj gösterir"}</small></button>)}</div>
          <div className={styles.messagePreview}><span>KULLANICIYA GÖSTERİLEN MESAJ</span><p>{ASSISTANT_UNAVAILABLE_MESSAGE}</p></div>
          <div className={styles.saveRow}><span>{stored ? `Son değişiklik: ${dateTime(stored.updatedAt)}` : "Durum yükleniyor…"}</span><button type="button" className={styles.primary} disabled={!changed || save.isPending || settings.isError} onClick={() => { if (draftSetting) save.mutate(draftSetting); }}>{save.isPending ? <Loader2 className={styles.spin} size={14} /> : <Check size={14} />}Kaydet</button></div>
          {save.isError && <p className={styles.formError} role="alert">{errorText(save.error)}</p>}{savedMessage && <p className={styles.saved} role="status"><CheckCircle2 size={13} />{savedMessage}</p>}
          {settings.data && !settings.isError && <div className={styles.health}><i className={settings.data.health === "reachable" ? styles.healthyDot : styles.neutralDot} /><span>{settings.data.health === "reachable" ? "AI servisine bağlantı var" : settings.data.health === "disabled" ? "AI servisi kullanım dışı" : "AI servisine ulaşılamıyor"}</span>{stored?.enabled && settings.data.health === "unreachable" && <small>Yerel konum yanıtları kullanılabilir.</small>}</div>}
        </section>
      </div>
      <section className={styles.recordsCard}><header className={styles.cardHeading}><div><h2><MessageSquare size={16} /> Soru kayıtları <span className={styles.count}>{requests.isError || !requests.data ? "—" : number(requests.data.total)}</span></h2><p>Soruları ve verilen cevapları incelemek için bir kaydı açın.</p></div><span className={styles.liveIndicator}><i />20 saniyede bir güncellenir</span></header>
        <form className={styles.filters} onSubmit={applyFilters}><label className={styles.searchField}><span>Soruda ara</span><div><Search size={14} /><input placeholder="Bir soru veya anahtar kelime…" value={form.search} maxLength={150} onChange={event => setForm({ ...form, search: event.target.value })} /></div></label><label><span>Başlangıç</span><input type="date" value={form.from} required onChange={event => setForm({ ...form, from: event.target.value })} /></label><label><span>Bitiş</span><input type="date" value={form.to} required onChange={event => setForm({ ...form, to: event.target.value })} /></label><label><span>Durum</span><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="">Tüm durumlar</option>{REQUEST_STATUSES.map(status => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label><label><span>Kaynak</span><select value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value })}><option value="">Tüm kaynaklar</option><option value="local">Yerel servis</option><option value="gemini">Gemini</option></select></label><button type="submit" className={styles.filterButton}><Search size={14} />Filtrele</button></form>
        {filterError && <p className={styles.filterError} role="alert">{filterError}</p>}
        <div className={styles.tableWrap} aria-busy={requests.isFetching}><table><thead><tr><th>Tarih / saat</th><th>Soru</th><th>Durum</th><th>Kaynak</th><th>Süre</th><th><span className={styles.srOnly}>Detay</span></th></tr></thead><tbody>
          {!requests.isError && requests.data?.items.map(item => <tr key={item.id}><td><time>{dateTime(item.createdAt)}</time><small>{item.mode === "history" ? "Rota geçmişi" : item.mode === "live" ? "Canlı harita" : "Sohbet"}</small></td><td className={styles.questionCell}><button type="button" onClick={() => setSelectedId(item.id)} title={item.question}>{item.question}</button></td><td><StatusBadge status={item.status} /></td><td><span className={styles.source}>{item.provider === "gemini" ? "Gemini" : item.provider === "local" ? "Yerel servis" : "—"}</span></td><td className={styles.duration}><Clock3 size={12} />{duration(item.durationMs)}</td><td><button className={styles.detailButton} type="button" onClick={() => setSelectedId(item.id)} aria-label={`${item.question} sorusunun detayını aç`}><ArrowDownRight size={16} /></button></td></tr>)}
        </tbody></table>
          {requests.isPending && <div className={styles.empty}><Loader2 className={styles.spin} size={22} /><strong>Soru kayıtları yükleniyor</strong></div>}
          {requests.isError && <div className={styles.empty}><AlertCircle size={24} /><strong>Kayıtlar yüklenemedi</strong><span>Yenileyerek tekrar deneyebilirsiniz.</span></div>}
          {!requests.isPending && !requests.isError && requests.data?.items.length === 0 && <div className={styles.empty}><span className={styles.emptyIcon}><MessageSquare size={25} /></span><strong>{filters.search || filters.status || filters.provider ? "Filtreye uygun kayıt bulunamadı" : "Bu tarihlerde henüz soru kaydı yok"}</strong><span>Gekon AI’ye gönderilen sorular burada listelenir.</span></div>}
        </div>
        <footer className={styles.tableFooter}><span>{requests.isError || !requests.data ? "Kayıt bilgisi alınamadı" : `${number(requests.data.total)} kayıt · Sayfa ${filters.page} / ${totalPages}`}</span><div><button type="button" disabled={filters.page <= 1 || requests.isFetching} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} aria-label="Önceki sayfa"><ChevronLeft size={16} /></button><button type="button" disabled={filters.page >= totalPages || requests.isFetching} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} aria-label="Sonraki sayfa"><ChevronRight size={16} /></button></div></footer>
      </section>
      <footer className={styles.panelFooter}><span><ShieldCheck size={12} /> Soru ve cevap kayıtları kalıcı olarak tutulur.</span>{stored && <span>Kayıt başlangıcı: {dateTime(stored.recordingStartedAt)}</span>}{todayCounts && (todayCounts.pending > 0 || todayCounts.interrupted > 0) && <span>Bugün: {todayCounts.pending} işleniyor · {todayCounts.interrupted} yarıda kalan</span>}</footer>
      {selectedId && <RequestDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} />}
    </>}
  </section>;
}
