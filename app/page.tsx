"use client";

import dynamic from "next/dynamic";

const IpsApplication = dynamic(
  () => import("@/src/app/IpsApplication").then((module) => module.IpsApplication),
  { ssr: false },
);

export default function Home() {
  return <IpsApplication />;
}
