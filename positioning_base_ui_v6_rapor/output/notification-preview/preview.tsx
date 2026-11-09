import React from "react";
import { createRoot } from "react-dom/client";
import { AreaExitToasts } from "../../src/features/notifications/AreaExitToasts";
import { useAreaExitNotifications } from "../../src/features/notifications/useAreaExitNotifications";

function Preview() {
  const notifications = useAreaExitNotifications();
  return <main style={{ fontFamily: "Arial, sans-serif", color: "#203c52", padding: 24 }}>
    <h1>Alan çıkış bildirimi · test önizlemesi</h1>
    <p>Üretim verisinden bağımsız test. Pompa 30 saniyede, Monitör 120 saniyede kapanır. Çarpı ile kapatılan uyarı yenilemede geri gelmez.</p>
    <section style={{ position: "relative", height: "65vh", border: "1px solid #cfdee8", borderRadius: 12, background: "linear-gradient(135deg, #e8f3f3, #f9fbfd)" }} aria-label="Test haritası">
      <p style={{ padding: 20 }}>Servis · Örnek harita</p>
      <AreaExitToasts items={notifications.items} warning={notifications.warning} onDismiss={notifications.dismiss} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
