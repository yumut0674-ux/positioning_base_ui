import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_MAX_INTERVAL_MS = 1_000;
const LOCAL_INGEST_ENDPOINT = "http://127.0.0.1:3000/api/tracking/ingest";
const PUBLIC_INGEST_ENDPOINT = "https://neu-demo.gekon.com.tr/api/tracking/ingest";
const REGIONS_CONFIG_PATH = path.join(process.cwd(), "config", "regions.json");

// Kat 1 planındaki mavi L biçimli koridorun merkez çizgisi. Oda ziyaretleri bu
// hat üzerinden yapılır; odanın merkezi yalnızca giriş/çıkış bağlantısında kullanılır.
const CORRIDOR_ROUTE = Object.freeze([
  { x: 1.75, y: 40 },
  { x: 1.75, y: 5.5 },
  { x: 5.5, y: 5.5 },
  { x: 5.5, y: 1.75 },
  { x: 44, y: 1.75 },
]);
const WALKING_SPEED_METERS_PER_SECOND = 0.85;
const ROOM_STAY_MIN_MS = 2_000;
const ROOM_STAY_MAX_MS = 20_000;
const ROOM_VISIT_GAP_MIN_MS = 16_000;
const ROOM_VISIT_GAP_MAX_MS = 48_000;
const FIRST_ROOM_VISIT_MIN_MS = 10_000;
const FIRST_ROOM_VISIT_MAX_MS = 28_000;

const tags = [
  { tagId: "TAG-001", position: { x: 1.75, y: 34 }, direction: 1 },
  { tagId: "TAG-014", position: { x: 1.75, y: 22 }, direction: -1 },
  { tagId: "TAG-028", position: { x: 15, y: 1.75 }, direction: 1 },
  { tagId: "TAG-036", position: { x: 34, y: 1.75 }, direction: -1 },
];

function randomInteger(min, max, random = Math.random) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function copyPoint(point) {
  return { x: point.x, y: point.y };
}

function isValidPoint(value) {
  return value && typeof value === "object" && Number.isFinite(value.x) && Number.isFinite(value.y);
}

const corridorSegments = CORRIDOR_ROUTE.slice(1).map((end, index) => {
  const start = CORRIDOR_ROUTE[index];
  return { start, end, startDistance: index === 0 ? 0 : 0 };
});
let corridorLength = 0;
for (const segment of corridorSegments) {
  segment.startDistance = corridorLength;
  segment.length = distanceBetween(segment.start, segment.end);
  corridorLength += segment.length;
}

function pointOnCorridor(distance) {
  const clampedDistance = clamp(distance, 0, corridorLength);
  const segment = corridorSegments.find((candidate) => clampedDistance <= candidate.startDistance + candidate.length) ?? corridorSegments.at(-1);
  const ratio = segment.length === 0 ? 0 : (clampedDistance - segment.startDistance) / segment.length;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  };
}

function nearestCorridorPoint(point) {
  let nearest = null;
  for (const segment of corridorSegments) {
    const deltaX = segment.end.x - segment.start.x;
    const deltaY = segment.end.y - segment.start.y;
    const lengthSquared = deltaX ** 2 + deltaY ** 2;
    const projection = clamp(((point.x - segment.start.x) * deltaX + (point.y - segment.start.y) * deltaY) / lengthSquared, 0, 1);
    const candidate = { x: segment.start.x + deltaX * projection, y: segment.start.y + deltaY * projection };
    const distance = distanceBetween(point, candidate);
    if (!nearest || distance < nearest.distance) {
      nearest = { point: candidate, distance, routeDistance: segment.startDistance + segment.length * projection };
    }
  }
  return nearest;
}

export function getRandomDelay(minMs, maxMs) {
  return randomInteger(minMs, maxMs);
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

export function resolveSimulationEndpoint(selection, environment = process.env) {
  const normalizedSelection = selection.trim().toLowerCase();
  if (normalizedSelection === "1" || normalizedSelection === "local") {
    return environment.LOCAL_TRACKING_INGEST_URL?.trim() || LOCAL_INGEST_ENDPOINT;
  }
  if (normalizedSelection === "2" || normalizedSelection === "public") {
    return environment.PUBLIC_TRACKING_INGEST_URL?.trim() || PUBLIC_INGEST_ENDPOINT;
  }
  throw new Error("Geçerli bir seçenek girin: 1 (Local) veya 2 (Public)");
}

/** Oda/Bölge panelinde kaydedilmiş tüm geçerli oda merkezlerini döndürür. */
export async function loadRoomCenters(configPath = REGIONS_CONFIG_PATH) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!Array.isArray(config.regions)) return [];

  return config.regions
    .map((region) => region?.roomCenter?.world)
    .filter(isValidPoint)
    .map(copyPoint);
}

function roomEntrancePoint(roomCenter) {
  return nearestCorridorPoint(roomCenter);
}

/**
 * Bir etiketi koridor ağı üzerinde ilerletir. Etiket belirli aralıklarla bir
 * oda merkezine gider, 2–20 saniye bekler ve aynı koridora geri döner.
 */
export function createTagMovement({ tag, roomCenters = [], random = Math.random, now = () => new Date() }) {
  const availableRooms = roomCenters.filter(isValidPoint).map(copyPoint);
  const startedAt = now().getTime();
  const initialCorridorPoint = nearestCorridorPoint(tag.position ?? tag);
  let corridorDistance = initialCorridorPoint.routeDistance;
  let position = initialCorridorPoint.point;
  let direction = tag.direction >= 0 ? 1 : -1;
  let lastUpdatedAt = startedAt;
  let nextRoomVisitAt = startedAt + randomInteger(FIRST_ROOM_VISIT_MIN_MS, FIRST_ROOM_VISIT_MAX_MS, random);
  let roomWaitUntil = null;
  let activeRoom = null;
  let roomEntrance = null;
  let travelPurpose = "corridor";
  let waypoints = [];

  function scheduleRoomReturn() {
    if (!roomEntrance) return;
    waypoints = [roomEntrance.point];
    travelPurpose = "return_to_corridor";
  }

  function startRoomVisit() {
    if (availableRooms.length === 0) return false;
    activeRoom = availableRooms[randomInteger(0, availableRooms.length - 1, random)];
    roomEntrance = roomEntrancePoint(activeRoom);
    travelPurpose = "to_room_entrance";
    return true;
  }

  function advanceAlongCorridor(distance) {
    let remaining = distance;
    while (remaining > 0) {
      const boundaryDistance = direction > 0 ? corridorLength : 0;
      const distanceToBoundary = Math.abs(boundaryDistance - corridorDistance);
      if (remaining <= distanceToBoundary) {
        corridorDistance += direction * remaining;
        position = pointOnCorridor(corridorDistance);
        return;
      }
      corridorDistance = boundaryDistance;
      position = pointOnCorridor(corridorDistance);
      direction *= -1;
      remaining -= distanceToBoundary;
    }
  }

  function advanceToRoomEntrance(distance) {
    const distanceToEntrance = Math.abs(roomEntrance.routeDistance - corridorDistance);
    if (distance < distanceToEntrance) {
      corridorDistance += Math.sign(roomEntrance.routeDistance - corridorDistance) * distance;
      position = pointOnCorridor(corridorDistance);
      return false;
    }
    corridorDistance = roomEntrance.routeDistance;
    position = copyPoint(roomEntrance.point);
    travelPurpose = "enter_room";
    waypoints = [activeRoom];
    return true;
  }

  function advanceAlongWaypoints(distance, timestamp) {
    let remaining = distance;
    while (remaining > 0 && waypoints.length > 0) {
      const target = waypoints[0];
      const segmentLength = distanceBetween(position, target);
      if (segmentLength === 0 || remaining >= segmentLength) {
        position = copyPoint(target);
        waypoints.shift();
        remaining -= segmentLength;
        if (waypoints.length === 0 && travelPurpose === "enter_room") {
          roomWaitUntil = timestamp + randomInteger(ROOM_STAY_MIN_MS, ROOM_STAY_MAX_MS, random);
          return;
        }
        if (waypoints.length === 0 && travelPurpose === "return_to_corridor") {
          corridorDistance = roomEntrance.routeDistance;
          position = copyPoint(roomEntrance.point);
          activeRoom = null;
          roomEntrance = null;
          travelPurpose = "corridor";
          nextRoomVisitAt = timestamp + randomInteger(ROOM_VISIT_GAP_MIN_MS, ROOM_VISIT_GAP_MAX_MS, random);
        }
        continue;
      }
      const ratio = remaining / segmentLength;
      position = {
        x: position.x + (target.x - position.x) * ratio,
        y: position.y + (target.y - position.y) * ratio,
      };
      return;
    }
  }

  function next(timestamp = now()) {
    const timestampMs = timestamp.getTime();
    const elapsedSeconds = Math.max(0, (timestampMs - lastUpdatedAt) / 1_000);
    lastUpdatedAt = timestampMs;

    if (roomWaitUntil !== null) {
      if (timestampMs < roomWaitUntil) return copyPoint(position);
      roomWaitUntil = null;
      scheduleRoomReturn();
    } else if (waypoints.length === 0 && timestampMs >= nextRoomVisitAt) {
      startRoomVisit();
    }

    const distance = elapsedSeconds * WALKING_SPEED_METERS_PER_SECOND;
    if (travelPurpose === "to_room_entrance") advanceToRoomEntrance(distance);
    else if (waypoints.length > 0) advanceAlongWaypoints(distance, timestampMs);
    else advanceAlongCorridor(distance);
    return copyPoint(position);
  }

  function getState() {
    return {
      position: copyPoint(position),
      isWaitingInRoom: roomWaitUntil !== null,
      roomWaitUntil,
      activeRoom: activeRoom ? copyPoint(activeRoom) : null,
    };
  }

  return { next, getState };
}

export function createTagSimulator({
  endpoint = LOCAL_INGEST_ENDPOINT,
  minDelayMs = DEFAULT_MIN_INTERVAL_MS,
  maxDelayMs = DEFAULT_MAX_INTERVAL_MS,
  roomCenters = [],
  fetchImplementation = fetch,
  setTimeoutImplementation = setTimeout,
  clearTimeoutImplementation = clearTimeout,
  randomDelay = getRandomDelay,
  random = Math.random,
  now = () => new Date(),
  logger = console,
} = {}) {
  let timer = null;
  let stopped = true;
  const activeRequests = new Set();
  const movements = tags.map((tag) => createTagMovement({ tag, roomCenters, random, now }));

  async function sendNextTagUpdates() {
    const currentTime = now();
    const timestamp = currentTime.toISOString();
    const positions = movements.map((movement, index) => {
      const position = movement.next(currentTime);
      return {
        type: "position",
        tag_id: tags[index].tagId,
        x: Number(position.x.toFixed(2)),
        y: Number(position.y.toFixed(2)),
        timestamp,
      };
    });

    const requestController = new AbortController();
    activeRequests.add(requestController);
    try {
      const responses = await Promise.all(positions.map((position) => fetchImplementation(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(position),
        signal: requestController.signal,
      })));
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) throw new Error(await failedResponse.text());
    } catch (error) {
      if (error?.name !== "AbortError") {
        logger.error("Konum gönderilemedi:", error instanceof Error ? error.message : String(error));
      }
    } finally {
      activeRequests.delete(requestController);
    }
  }

  function scheduleNextUpdate() {
    if (stopped) return;
    // The simulator clock is independent from HTTP acknowledgements. If the
    // previous request reached the server but its response is still pending,
    // stop waiting for that response and publish the newest positions now.
    for (const request of activeRequests) request.abort();
    activeRequests.clear();
    void sendNextTagUpdates();
    const delay = randomDelay(minDelayMs, maxDelayMs);
    timer = setTimeoutImplementation(() => {
      timer = null;
      scheduleNextUpdate();
    }, delay);
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    logger.log(`UWB koridor rotası simülasyonu başlatıldı: ${endpoint}`);
    logger.log(`${roomCenters.length} oda merkezi ziyaret rotasına eklendi; oda içi bekleme: 2–20 sn.`);
    logger.log(minDelayMs === maxDelayMs
      ? `Tag simulation interval: fixed ${minDelayMs} ms`
      : `Tag simulation interval: random ${minDelayMs}–${maxDelayMs} ms`);
    scheduleNextUpdate();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeoutImplementation(timer);
    timer = null;
    for (const request of activeRequests) request.abort();
    activeRequests.clear();
  }

  return { start, stop, sendNextTagUpdates, scheduleNextUpdate };
}

async function selectEndpoint() {
  const prompt = createInterface({ input, output });
  try {
    console.log("\nKonum verileri nereye gönderilsin?");
    console.log(`  1) Local  — ${LOCAL_INGEST_ENDPOINT}`);
    console.log(`  2) Public — ${PUBLIC_INGEST_ENDPOINT}`);
    const selection = await prompt.question("Seçiminiz (1/2): ");
    return resolveSimulationEndpoint(selection);
  } finally {
    prompt.close();
  }
}

async function run() {
  const { minMs, maxMs } = readSimulatorIntervals();
  const endpoint = await selectEndpoint();
  let roomCenters = [];
  try {
    roomCenters = await loadRoomCenters();
  } catch (error) {
    console.warn("Oda merkezleri yüklenemedi; etiketler yalnızca koridorda hareket edecek.", error instanceof Error ? error.message : String(error));
  }
  const simulator = createTagSimulator({
    endpoint,
    minDelayMs: minMs,
    maxDelayMs: maxMs,
    roomCenters,
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
if (isMain) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
