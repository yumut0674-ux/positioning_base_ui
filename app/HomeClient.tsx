"use client";

import dynamic from "next/dynamic";
import type { UiMode } from "@/src/app/uiMode";

const IpsApplication = dynamic(
  () => import("@/src/app/IpsApplication").then((module) => module.IpsApplication),
  { ssr: false },
);

export function HomeClient({ mode }: { readonly mode: UiMode }) {
  return <IpsApplication mode={mode} />;
}
