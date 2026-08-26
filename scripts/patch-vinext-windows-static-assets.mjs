import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const staticCacheFile = path.join(projectDirectory, "node_modules", "vinext", "dist", "server", "static-file-cache.js");
const unpatchedLine = 'const pathname = "/" + relativePath;';
const patchedLine = 'const pathname = "/" + relativePath.split(path.sep).join("/");';

const source = await readFile(staticCacheFile, "utf8");

if (source.includes(patchedLine)) {
  console.log("[vinext patch] Windows static-asset path normalization is already applied.");
} else if (source.includes(unpatchedLine)) {
  await writeFile(staticCacheFile, source.replace(unpatchedLine, patchedLine), "utf8");
  console.log("[vinext patch] Applied Windows static-asset path normalization.");
} else {
  throw new Error(`[vinext patch] Expected static-cache code was not found in ${staticCacheFile}. Review the installed vinext version before starting production.`);
}
