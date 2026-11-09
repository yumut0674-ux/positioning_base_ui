import { parseArgs } from "node:util";
import { startProdServer } from "vinext/server/prod-server";

const { values } = parseArgs({
  options: { port: { type: "string", default: "3000" } },
  strict: true,
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("--port must be an integer between 1 and 65535");
}

if (process.platform === "win32") {
  // vinext 0.0.50 indexes its production static-file cache with Windows
  // backslashes, while URL lookups use forward slashes. Normalize the cache
  // in memory without modifying installed dependency files.
  const { StaticFileCache } = await import(
    "../node_modules/vinext/dist/server/static-file-cache.js"
  );
  const createCache = StaticFileCache.create.bind(StaticFileCache);
  StaticFileCache.create = async (clientDirectory) => {
    const cache = await createCache(clientDirectory);
    for (const [key, entry] of [...cache.entries]) {
      const normalized = key.replaceAll("\\", "/");
      if (normalized === key) continue;
      cache.entries.delete(key);
      cache.entries.set(normalized, entry);
    }
    return cache;
  };
}

await startProdServer({
  host: "127.0.0.1",
  port,
});
