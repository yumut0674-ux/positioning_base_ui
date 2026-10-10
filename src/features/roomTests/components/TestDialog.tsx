"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./roomTests.module.css";

export function TestDialog({ title, description, onClose, children, wide = false }: {
  title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.wideDialog : ""}`} aria-label={title} onCancel={onClose}
    onClick={event => { if (event.target === ref.current) { const rect = ref.current!.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className={styles.dialogHeader}><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button type="button" onClick={onClose} aria-label="Pencereyi kapat"><X size={18}/></button></div>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
