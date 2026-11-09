import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const filename = path.join(process.cwd(), ".env.local");
const content = await readFile(filename, "utf8").catch(error => {
  if (error.code === "ENOENT") return "";
  throw error;
});
const existing = content.match(/^\s*GEKON_AI_ADMIN_PASSWORD\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
if (existing && existing.length >= 16) {
  console.log("Gekon AI yönetim parolası zaten yapılandırılmış. Mevcut parola korundu.");
} else {
  const password = randomBytes(24).toString("base64url");
  const withoutEmpty = content.replace(/^\s*GEKON_AI_ADMIN_PASSWORD\s*=.*(?:\r?\n|$)/gm, "");
  await writeFile(filename, `${withoutEmpty.trimEnd()}\n\n# Gekon AI management access (server-side only; do not commit)\nGEKON_AI_ADMIN_PASSWORD=${password}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("Gekon AI yönetim parolası .env.local dosyasına güvenli biçimde eklendi. Sunucuyu yeniden başlattıktan sonra bu parola ile panele giriş yapabilirsiniz.");
}
