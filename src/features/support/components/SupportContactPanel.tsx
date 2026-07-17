"use client";

import { type FormEvent, useState } from "react";
import { Bug, CheckCircle2, Clock3, Headset, Lightbulb, LoaderCircle, Mail, MapPin, Phone, Send } from "lucide-react";
import styles from "./supportContact.module.css";

type MessageType = "support" | "suggestion" | "bug";

type SupportForm = {
  messageType: MessageType;
  senderName: string;
  senderEmail: string;
  subject: string;
  message: string;
};

const initialForm: SupportForm = {
  messageType: "support",
  senderName: "",
  senderEmail: "",
  subject: "",
  message: "",
};

const typeCopy: Record<MessageType, { label: string; hint: string }> = {
  support: { label: "Teknik destek", hint: "Bir sorun ya da kullanım sorusu için destek talebi oluşturun." },
  suggestion: { label: "Öneri", hint: "Sistemi iyileştirecek fikrinizi ürün ekibiyle paylaşın." },
  bug: { label: "Hata bildirimi", hint: "Karşılaştığınız hatayı, mümkünse tekrar adımlarıyla bildirin." },
};

export function SupportContactPanel({ embedded = false }: { readonly embedded?: boolean }) {
  const [form, setForm] = useState<SupportForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const updateField = <Key extends keyof SupportForm>(key: Key, value: SupportForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (feedback) setFeedback(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Mesaj kaydedilemedi.");
      setForm(initialForm);
      setFeedback({ kind: "success", text: "Mesajınız kaydedildi. Destek ekibi en kısa sürede inceleyecek." });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Mesaj kaydedilemedi." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`${styles.panel} ${embedded ? styles.embedded : ""}`} aria-labelledby="support-heading">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Headset size={13} /> YARDIM MERKEZİ</span>
          <h1 id="support-heading">Destek ve İletişim</h1>
          <p>Teknik destek talebinizi, hata bildiriminizi veya önerinizi tek noktadan iletin.</p>
        </div>
        <div className={styles.headerState}><i /> DESTEK KANALI AÇIK</div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.contactColumn} aria-label="İletişim bilgileri">
          <div className={styles.contactIntro}>
            <div className={styles.contactIcon}><Headset size={20} /></div>
            <div><strong>Nasıl yardımcı olabiliriz?</strong><p>Operasyon ekibimiz UWB IPS kurulumu ve kullanımı konusunda yanınızdadır.</p></div>
          </div>
          <a className={styles.contactCard} href="mailto:destek@gekon.local"><span><Mail size={15} /></span><div><small>E-POSTA</small><strong>destek@gekon.local</strong><em>Destek talepleri için</em></div></a>
          <a className={styles.contactCard} href="tel:+902120000000"><span><Phone size={15} /></span><div><small>TELEFON</small><strong>+90 (212) 000 00 00</strong><em>Hafta içi 09:00 – 18:00</em></div></a>
          <div className={styles.contactCard}><span><Clock3 size={15} /></span><div><small>GERİ DÖNÜŞ SÜRESİ</small><strong>En geç 1 iş günü</strong><em>Öncelikli kayıtlar hızlandırılır</em></div></div>
          <div className={styles.contactCard}><span><MapPin size={15} /></span><div><small>OPERASYON NOKTASI</small><strong>Gekon IPS Kontrol</strong><em>Yerel sistem desteği</em></div></div>
          <p className={styles.contactNote}>İletişim bilgileri kurumunuza göre bu bileşenden güncellenebilir.</p>
        </aside>

        <form className={styles.formCard} onSubmit={submit}>
          <div className={styles.formHeading}>
            <div><span>YENİ KAYIT</span><h2>Mesaj gönder</h2></div>
            <p>{typeCopy[form.messageType].hint}</p>
          </div>
          <div className={styles.typeGrid} role="radiogroup" aria-label="Mesaj türü">
            {(["support", "suggestion", "bug"] as const).map((type) => {
              const Icon = type === "support" ? Headset : type === "suggestion" ? Lightbulb : Bug;
              return <button key={type} type="button" className={form.messageType === type ? styles.typeActive : ""} onClick={() => updateField("messageType", type)} role="radio" aria-checked={form.messageType === type}><Icon size={15} />{typeCopy[type].label}</button>;
            })}
          </div>
          <div className={styles.fieldGrid}>
            <label><span>Ad soyad</span><input value={form.senderName} onChange={(event) => updateField("senderName", event.target.value)} minLength={2} maxLength={150} required placeholder="Adınız soyadınız" /></label>
            <label><span>E-posta adresi</span><input type="email" value={form.senderEmail} onChange={(event) => updateField("senderEmail", event.target.value)} maxLength={255} required placeholder="ornek@firma.com" /></label>
            <label className={styles.fullField}><span>Konu</span><input value={form.subject} onChange={(event) => updateField("subject", event.target.value)} minLength={3} maxLength={180} required placeholder="Mesajınızın kısa özeti" /></label>
            <label className={styles.fullField}><span>Mesajınız</span><textarea value={form.message} onChange={(event) => updateField("message", event.target.value)} minLength={10} maxLength={4000} required placeholder="Yaşadığınız durumu, ilgili Tag veya Anchor kimliğini ve varsa tekrar adımlarını yazın." rows={6} /></label>
          </div>
          {feedback && <div className={feedback.kind === "success" ? styles.success : styles.error} role="status">{feedback.kind === "success" ? <CheckCircle2 size={16} /> : <Bug size={16} />}<span>{feedback.text}</span></div>}
          <footer className={styles.formFooter}><span>Mesajınız güvenli şekilde yerel destek kayıtlarına eklenir.</span><button type="submit" disabled={isSubmitting}>{isSubmitting ? <LoaderCircle className={styles.spin} size={15} /> : <Send size={15} />}{isSubmitting ? "Gönderiliyor" : "Mesajı Gönder"}</button></footer>
        </form>
      </div>

    </section>
  );
}
