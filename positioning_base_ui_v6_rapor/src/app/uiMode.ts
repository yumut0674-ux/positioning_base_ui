export type UiMode = "admin" | "demo";

const ADMIN_HOST = "neu-admin.gekon.com.tr";

export function resolveUiMode(hostHeader: string | null): UiMode {
  if (!hostHeader) return "demo";

  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/\.$/, "");
    // Keep the existing full workspace available during local development.
    return hostname === ADMIN_HOST || hostname === "localhost" || hostname === "127.0.0.1"
      ? "admin"
      : "demo";
  } catch {
    return "demo";
  }
}
