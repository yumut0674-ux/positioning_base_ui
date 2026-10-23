import { headers } from "next/headers";
import { HomeClient } from "./HomeClient";
import { resolveUiMode } from "@/src/app/uiMode";

export default async function Home() {
  const mode = resolveUiMode((await headers()).get("host"));
  return <HomeClient mode={mode} />;
}
