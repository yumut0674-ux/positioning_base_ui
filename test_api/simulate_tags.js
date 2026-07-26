import { pathToFileURL } from "node:url";

const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_MAX_INTERVAL_MS = 1_000;
const defaultEndpoint = process.env.TRACKING_INGEST_URL ?? "http://localhost:3000/api/tracking/ingest";

const tags = [
  { tagId: "TAG-001", x: 8.8, y: 7.8, phase: 0 },
  { tagId: "TAG-014", x: 21.4, y: 12.4, phase: 2.1 },
  { tagId: "TAG-028", x: 31.2, y: 4.2, phase: 4.2 },
  { tagId: "TAG-036", x: 14.6, y: 18.3, phase: 5.6 },
];

export function getRandomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function readPositiveInterval(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export function readSimulatorIntervals(environment = process.env) {
  const minMs = readPositiveInterval(environment.SIMULATOR_MIN_INTERVAL_MS, DEFAULT_MIN_INTERVAL_MS);
  const maxMs = readPositiveInterval(environment.SIMULATOR_MAX_INTERVAL_MS, DEFAULT_MAX_INTERVAL_MS);
  if (maxMs < minMs) {
    throw new Error(`SIMULATOR_MAX_INTERVAL_MS (${maxMs}), SIMULATOR_MIN_INTERVAL_MS (${minMs}) değerinden küçük olamaz`);
  }
  return { minMs, maxMs };
}

export function createTagSimulator({
  endpoint = defaultEndpoint,
  minDelayMs = DEFAULT_MIN_INTERVAL_MS,
  maxDelayMs = DEFAULT_MAX_INTERVAL_MS,
  fetchImplementation = fetch,
  setTimeoutImplementation = setTimeout,
  clearTimeoutImplementation = clearTimeout,
  randomDelay = getRandomDelay,
  now = () => new Date(),
  logger = console,
} = {}) {
  let tick = 0;
  let timer = null;
  let stopped = true;
  let activeRequest = null;

  async function sendNextTagUpdates() {
    tick += 0.13;
    const timestamp = now().toISOString();
    const positions = tags.map((tag, index) => ({
      type: "position",
      tag_id: tag.tagId,
      x: Number((tag.x + Math.cos(tick + tag.phase) * (0.7 + index * 0.12)).toFixed(2)),
      y: Number((tag.y + Math.sin(tick * 0.8 + tag.phase) * (0.55 + index * 0.1)).toFixed(2)),
      timestamp,
    }));

    activeRequest = new AbortController();
    try {
      const responses = await Promise.all(positions.map((position) => fetchImplementation(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(position),
        signal: activeRequest.signal,
      })));
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) throw new Error(await failedResponse.text());
    } catch (error) {
      if (!stopped || error?.name !== "AbortError") {
        logger.error("Konum gönderilemedi:", error instanceof Error ? error.message : String(error));
      }
    } finally {
      activeRequest = null;
    }
  }

  async function scheduleNextUpdate() {
    if (stopped) return;
    await sendNextTagUpdates();
    if (stopped) return;
    const delay = randomDelay(minDelayMs, maxDelayMs);
    timer = setTimeoutImplementation(() => {
      timer = null;
      void scheduleNextUpdate();
    }, delay);
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    logger.log(`UWB konum simülasyonu başlatıldı: ${endpoint}`);
    logger.log(minDelayMs === maxDelayMs
      ? `Tag simulation interval: fixed ${minDelayMs} ms`
      : `Tag simulation interval: random ${minDelayMs}–${maxDelayMs} ms`);
    void scheduleNextUpdate();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeoutImplementation(timer);
    timer = null;
    activeRequest?.abort();
  }

  return { start, stop, sendNextTagUpdates, scheduleNextUpdate };
}

function run() {
  const { minMs, maxMs } = readSimulatorIntervals();
  const simulator = createTagSimulator({
    endpoint: defaultEndpoint,
    minDelayMs: minMs,
    maxDelayMs: maxMs,
  });
  simulator.start();

  const shutdown = () => {
    simulator.stop();
    console.log("Simülasyon durduruldu.");
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) run();
