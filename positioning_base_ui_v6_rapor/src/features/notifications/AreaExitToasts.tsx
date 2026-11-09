import { BellRing, X } from "lucide-react";
import { notificationMessage, type AreaExitNotification } from "./notification.types";
import styles from "./notifications.module.css";

export function AreaExitToasts({ items, warning, onDismiss }: {
  readonly items: readonly AreaExitNotification[]; readonly warning: string | null;
  readonly onDismiss: (item: AreaExitNotification) => void;
}) {
  return <section className={styles.stack} aria-label="Alan çıkış bildirimleri">
    {warning && <p className={styles.warning} role="status">{warning}</p>}
    <div className={styles.items} aria-live="polite" aria-relevant="additions">
      {items.map(item => <article key={item.id} className={styles.toast}>
        <BellRing size={19} aria-hidden="true" />
        <div><strong>{notificationMessage(item)}</strong><p><time dateTime={item.exitedAt}>{new Date(item.exitedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", hour12: false })}</time> · {item.mapId}</p></div>
        <button type="button" aria-label={`${item.tagName} bildirimini kapat`} onClick={() => onDismiss(item)}><X size={16} /></button>
      </article>)}
    </div>
  </section>;
}
