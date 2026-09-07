import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { seededRandom } from "./room_scenarios.js";

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
  return nearestCorridorPoint(roomCenter.portalPath[0]);
}

function insideConfiguredPolygon(p, region) {
  const poly=region.polygon.map(p=>p.world); let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) yes=!yes;}
  return yes;
}

export async function validateConfiguredCorridor(configPath=REGIONS_CONFIG_PATH) {
  const config=JSON.parse(await readFile(configPath,"utf8"));
  const corridors=(config.regions??[]).filter(r=>r.kind==="corridor"||/^corridor/.test(r.id));
  for(let d=0;d<=corridorLength;d+=0.1) if(!corridors.some(r=>insideConfiguredPolygon(pointOnCorridor(d),r))) {
    throw new Error("Eski koridor rotası kayıtlı geçilebilir koridor poligonlarıyla doğrulanamadı. Harita rotasını tanımlayın veya --scenario ile referans haritada çalışın.");
  }
}

/** Refuse wall shortcuts. Only explicit doors plus a traversable corridor/room path are accepted. */
export async function loadVerifiedRoomRoutes(configPath = REGIONS_CONFIG_PATH) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const regions = config.regions ?? [];
  const corridors = regions.filter(r => r.kind === "corridor" || /^corridor/.test(r.id));
  const inside = insideConfiguredPolygon;
  const segmentIn = (a,b,areas) => {
    const steps=Math.max(2,Math.ceil(distanceBetween(a,b)/0.05));
    for(let i=1;i<steps;i++) if(!areas.some(r=>inside({x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps},r))) return false;
    return true;
  };
  return regions.filter(r=>!corridors.includes(r)&&isValidPoint(r.roomCenter?.world)).flatMap(r=>{
    for(const door of r.entrances??[]) {
      if(!door.widthMeters||!door.inwardNormal||door.connectsTo!=="corridor") continue;
      const center=r.roomCenter.world, entrance=door.world, projection=nearestCorridorPoint(entrance).point;
      if(segmentIn(projection,entrance,corridors)&&segmentIn(entrance,center,[r])) return [{...center,portalPath:[projection,entrance,center]}];
    }
    return [];
  });
}

function nearestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx ** 2 + dy ** 2;
  if (lengthSquared === 0) return copyPoint(start);
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return { x: start.x + dx * ratio, y: start.y + dy * ratio };
}

function inferredRoomPortal(region) {
  const center = region.roomCenter?.world;
  const polygon = region.polygon?.map((point) => point.world);
  if (!isValidPoint(center) || !Array.isArray(polygon) || polygon.length < 3) return null;
  let best = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const samples = Math.max(2, Math.ceil(distanceBetween(start, end) / 0.1));
    for (let sample = 0; sample <= samples; sample += 1) {
      const ratio = sample / samples;
      const boundary = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
      const corridor = nearestCorridorPoint(boundary);
      if (!best || corridor.distance < best.distance) best = { boundary, corridor: corridor.point, distance: corridor.distance };
    }
  }
  return best ? { ...center, regionId: region.id, regionName: region.name, portalPath: [best.corridor, best.boundary, center], inferredPortal: true } : null;
}

/**
 * Live demo keeps working before the map editor has full door metadata. An
 * inferred portal is simulation-only and is never written into regions.json.
 */
export async function loadSimulationRoomRoutes(configPath = REGIONS_CONFIG_PATH) {
  const verified = await loadVerifiedRoomRoutes(configPath);
  if (verified.length > 0) return { routes: verified, inferred: false };
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const routes = (config.regions ?? [])
    .filter((region) => region.kind !== "corridor" && !/^corridor(?:-|$)/i.test(region.id ?? ""))
    .map(inferredRoomPortal)
    .filter(Boolean);
  return { routes, inferred: routes.length > 0 };
}

export function readLiveSimulationOptions(argv = process.argv.slice(2)) {
  const valueAfter = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const scenario = valueAfter("scenario") ?? "all";
  const allowed = new Set(["normal", "all", "entry-gap", "inside-long-gap", "neighbor-jumps"]);
  if (!allowed.has(scenario)) throw new Error(`Geçersiz canlı senaryo: ${scenario}`);
  const seedText = valueAfter("seed") ?? "42";
  const seed = Number(seedText);
  if (!Number.isInteger(seed)) throw new Error(`Geçersiz seed: ${seedText}`);
  return { scenario, seed };
}

/**
 * Bir etiketi koridor ağı üzerinde ilerletir. Etiket belirli aralıklarla bir
 * oda merkezine gider, 2–20 saniye bekler ve aynı koridora geri döner.
 */
export function createTagMovement({ tag, roomCenters = [], random = Math.random, now = () => new Date() }) {
  const availableRooms = roomCenters.filter(r=>isValidPoint(r)&&Array.isArray(r.portalPath)&&r.portalPath.length>=2&&r.portalPath.every(isValidPoint));
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
    waypoints = activeRoom.portalPath.slice(0,-1).reverse();
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
    waypoints = activeRoom.portalPath.slice(1);
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
      activeRoom: activeRoom ? { ...activeRoom, portalPath: activeRoom.portalPath.map(copyPoint) } : null,
      travelPurpose,
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
  seed,
  scenario = "normal",
  now = () => new Date(),
  logger = console,
} = {}) {
  let timer = null;
  let stopped = true;
  const activeRequests = new Set();
  const baseSeed = Number.isInteger(seed) ? seed : Math.floor(random() * 4294967296);
  const movements = tags.map((tag, index) => createTagMovement({ tag, roomCenters, random: seededRandom(baseSeed + index * 104729), now }));
  const roomTicks = tags.map(() => 0);
  const policies = scenario === "all"
    ? ["normal", "entry-gap", "inside-long-gap", "neighbor-jumps"]
    : tags.map(() => scenario);

  function measuredPosition(index, position, state) {
    roomTicks[index] = state.isWaitingInRoom ? roomTicks[index] + 1 : 0;
    const policy = policies[index];
    if (policy === "entry-gap" && (state.travelPurpose === "enter_room" || (state.isWaitingInRoom && roomTicks[index] <= 4))) return null;
    if (policy === "inside-long-gap" && state.isWaitingInRoom && roomTicks[index] > 2) return null;
    if (policy === "neighbor-jumps" && state.isWaitingInRoom && (roomTicks[index] === 4 || roomTicks[index] === 5)) {
      const activeId = state.activeRoom?.regionId;
      const neighbor = roomCenters.find((room) => room.regionId && room.regionId !== activeId);
      if (neighbor) return { x: neighbor.x, y: neighbor.y };
      return { x: position.x + 1.25, y: position.y };
    }
    return position;
  }

  async function sendNextTagUpdates() {
    const currentTime = now();
    const timestamp = currentTime.toISOString();
    const positions = movements.flatMap((movement, index) => {
      const position = movement.next(currentTime);
      const measured = measuredPosition(index, position, movement.getState());
      if (!measured) return [];
      return [{
        type: "position",
        tag_id: tags[index].tagId,
        x: Number(measured.x.toFixed(2)),
        y: Number(measured.y.toFixed(2)),
        timestamp,
      }];
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
    logger.log(`Canlı senaryo: ${scenario}; seed: ${baseSeed}; profiller: ${policies.join(", ")}`);
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
  const { scenario, seed } = readLiveSimulationOptions();
  const endpoint = await selectEndpoint();
  let roomCenters = [];
  try {
    const loaded = await loadSimulationRoomRoutes();
    roomCenters = loaded.routes;
    if (loaded.inferred) console.warn("Kapı geometrisi eksik: canlı simülatör oda poligonundan geçici giriş rotası türetti. Bu rota regions.json dosyasını değiştirmez.");
    if (!roomCenters.length) console.warn("Geçerli oda bulunamadı; etiketler yalnızca koridorda hareket edecek.");
  } catch (error) {
    console.warn("Oda merkezleri yüklenemedi; etiketler yalnızca koridorda hareket edecek.", error instanceof Error ? error.message : String(error));
  }
  const simulator = createTagSimulator({
    endpoint,
    minDelayMs: minMs,
    maxDelayMs: maxMs,
    roomCenters,
    scenario,
    seed,
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
