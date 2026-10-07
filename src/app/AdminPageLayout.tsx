import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveUiMode } from "./uiMode";

export async function AdminPageLayout({ children }: { readonly children: React.ReactNode }) {
  if (resolveUiMode((await headers()).get("host")) !== "admin") redirect("/");
  return children;
}
