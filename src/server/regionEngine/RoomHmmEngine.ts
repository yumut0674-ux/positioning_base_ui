import { createHash } from "node:crypto";
import type { TrackingPosition } from "../trackingBuffer";
import { distanceToSegment, pointInPolygon } from "./geometry";
import type {
  CompiledRegion, CompiledRegionsConfig, DecisionEventType, DecisionSeverity, DecisionTrace, EvidenceScoreComponents,
  ProcessedPosition, RegionEngineStatus, RegionVehicleDiagnostic, VehicleRegionState, VehicleRegionStatus,
} from "./types";

/**
 * Olasılıksal oda motoru (gizli Markov modeli).
 *
 * Neden: sahada odaya giren tagın verisi çoğu zaman kapıda kesiliyor, oda içindeki
 * az sayıdaki ölçüm Jetson tarafında koridor/kapı girintisine çekiliyor ve tekil
 * sıçramalar komşu odaya düşebiliyor. Eski kural motoru tek bir "son güvenilir
 * nokta" ile karar verdiği için bu durumların hepsinde yanlış karar üretiyordu.
 *
 * Bu motor her tag için şu yerler üzerinde olasılık dağılımı tutar:
 *  - koridor (hareketli / hareketsiz),
 *  - her oda (kapıya yakın-ölçülebilir / iç-sessiz),
 *  - alan dışı (çıkış kapısının hemen dışı / uzak),
 *  - bilinmeyen (sebebi belirsiz sessizlik).
 * Geçişler yalnız fiziksel topolojiye göre olur: koridordan odaya yalnız o odanın
 * kapısının yakınından, alan dışına yalnız çıkış kapısından. Ölçüm geldiğinde konum
 * olabilirliği, ölçüm GELMEDİĞİNDE ise yerlerin beklenen veri hızı kullanılır
 * ("negatif bilgi"): koridorda veri sürekli gelir, odada/alan dışında gelmez.
 * Böylece kapıda kesilen tag doğru odaya, çıkış kapısında kesilen tag alan dışına
 * atanır; birkaç yanlış nokta toplam kanıtı tek başına çeviremez.
 */
export const HMM_ROOM_ENGINE_VERSION = "room-hmm-2";

export interface RoomHmmSettings {
  /** Koridor ölçüm gürültüsü (m). */
  readonly corridorSigmaMeters: number;
  /** Oda poligonu dışına taşan oda ölçümlerinin gürültüsü (m). */
  readonly roomSigmaMeters: number;
  /** Odadaki tagın Jetson tarafından kapı önüne çekilmiş ölçümü için yayılım (m). */
  readonly doorClampSigmaMeters: number;
  /** Kapı önüne çekilmiş ölçümün oda içi ölçüme göre göreli olabilirliği. */
  readonly doorClampWeight: number;
  /**
   * Oda içi ölçümler NLOS ve kıstırma nedeniyle güvenilmez: tek ölçüm iki oda arasında
   * en fazla 1/roomLikelihoodFloor kat fark yaratabilir. Komşu odaya düşen 1-2 sıçrama
   * kapı yaklaşımı kanıtını çeviremez.
   */
  readonly roomLikelihoodFloor: number;
  /** Odadaki tagın oda cephesindeki (önündeki koridor şeridi) ölçümünün göreli olabilirliği; 0 kapatır. */
  readonly frontageWeight: number;
  /** Duvara paralel bu hızın üstünde kapının önünden geçen tag için giriş oranı çarpanı. */
  readonly passingSpeedMetersPerSecond: number;
  readonly passingFactor: number;
  readonly frontageAlongSigmaMeters: number;
  readonly frontageAcrossSigmaMeters: number;
  /** Kapı yakınlık çekirdeği (m); koridordan odaya geçiş oranını belirler. */
  readonly doorProximitySigmaMeters: number;
  /** Kapı dibinde koridordan odaya geçiş oranı (1/sn). */
  readonly doorEntryRatePerSecond: number;
  /** Bu mesafeden uzak kapılara geçiş olmaz (m). */
  readonly doorReachMeters: number;
  /** Odadan koridora çıkış oranı (1/sn). */
  readonly roomExitRatePerSecond: number;
  /** Çıkış kapısında alan dışına geçiş oranı (1/sn). */
  readonly gateExitRatePerSecond: number;
  readonly gateProximitySigmaMeters: number;
  /** Belirsiz sessizliğe geçiş oranı (1/sn). Kapıdan uzakta kesilen tag için kullanılır. */
  readonly unknownRatePerSecond: number;
  /** Koridorda beklenen asgari/azami çözüm hızı (1/sn); tag başına öğrenilir. */
  readonly corridorRateMinPerSecond: number;
  readonly corridorRateMaxPerSecond: number;
  /** Öğrenilen hızın ne kadarının beklendiği (kapsama boşluklarına pay). */
  readonly corridorRateSafetyFactor: number;
  /** Hareketsiz tag (10 sn blink) için koridor veri hızı (1/sn). */
  readonly stationaryRatePerSecond: number;
  /** Kapıya yakın oda içi alt durumunun veri hızı (1/sn). */
  readonly roomOpenRatePerSecond: number;
  /** Sessiz durumların (oda içi, alan dışı uzak, bilinmeyen) veri hızı (1/sn). */
  readonly silentRatePerSecond: number;
  /** Sessiz durumlardan ölçülebilir komşularına sızma oranı (1/sn); hepsinde aynı. */
  readonly silentLeakRatePerSecond: number;
  /** Alan dışında çıkış kapısının hemen dışındaki veri hızı (1/sn). */
  readonly outsideNearRatePerSecond: number;
  /** Bir yere geçmek için gereken olasılık (histerezis üst eşiği). */
  readonly enterProbability: number;
  /** Atanmış yerin bırakılması için olasılığın düşmesi gereken eşik. */
  readonly releaseProbability: number;
  /** Aday gösterimi için asgari oda olasılığı. */
  readonly candidateProbability: number;
  /** Tek ölçümün yerler arasındaki etkisinin üst sınırı (sınırlı etki). */
  readonly maximumMeasurementInfluence: number;
  /** Fiziksel olarak erişilemeyen (sıçrama) ölçümün etki sınırı. */
  readonly spikeMeasurementInfluence: number;
  /** İzleyici için azami yürüme hızı (m/sn). */
  readonly maximumSpeedMetersPerSecond: number;
  /**
   * Koridordan yalnız sessizlikle (oda içi ölçüm olmadan) odaya geçmek için asgari veri
   * kesintisi (ms). Koridordaki 1-2 sn'lik normal paket boşlukları oda girişi sayılmaz.
   */
  readonly minimumSilenceForRoomMs: number;
  /** Ölçüm oda kanıtı sayılırsa "ölçülen" durumu için azami yaş (ms). */
  readonly measuredFreshMs: number;
  /** Koridorda bu süre veri yoksa konum belirsiz gösterilir (ms). */
  readonly corridorLostAfterMs: number;
  /** Oda tahmini bu süreden uzun veri yoksa belirsize düşer (ms). */
  readonly inferredRoomMaxAgeMs: number;
  /** Bu PDOP üstündeki ölçümler zayıf (sıçrama gibi) değerlendirilir. */
  readonly weakPdop: number;
  /**
   * Tagın kendi hareket bilgisi (Jetson `motion`: 0 hareketli, 1 hareketsiz) bu süre boyunca
   * geçerli sayılır (ms). Hareketsiz tag 10 sn'de bir veri yollar; daha uzun sessizlikte bilgi
   * bayatlar (tag kalkıp kapsama dışına yürümüş olabilir) ve konuma dayalı tahmine dönülür.
   */
  readonly motionFlagFreshMs: number;
  /** Tag "hareketsiz" bildirdiğinde ölçülebilir durumların beklenen veri hızı (1/sn). */
  readonly reportedStationaryRatePerSecond: number;
  /** Tag "hareketsiz" bildirdiğinde kapı/çıkış geçiş oranlarının çarpanı. */
  readonly reportedStationaryTransitionFactor: number;
  /** Tag "hareketsiz" iken tek ölçümün etki sınırı (aynı noktanın tekrarı olduğu için düşük). */
  readonly reportedStationaryMeasurementInfluence: number;
  /**
   * 1: veri kesilince son karar (oda/koridor) korunur ve gösterilir; "belirsiz"e düşülmez.
   * 0: eski davranış (kapıdan uzakta kesilen veya uzun süre koridorda susan tag belirsiz olur).
   */
  readonly keepLastDecisionOnSignalLoss: number;
  /** Bu süre veri gelmezse karar "sinyal yok · son karar" olarak işaretlenir (ms). */
  readonly signalLostAfterMs: number;
  /**
   * Karşılıklı (koridorun iki yanında kapıları karşı karşıya) odalar için oda içi ölçüm tabanı.
   * Sahada odadaki tagın noktaları karşı odaya düşüyor (ayna hatası); 0 kapalı.
   */
  readonly facingRoomLikelihoodFloor: number;
  /**
   * Koridordaki tag sustuğunda olasılık birkaç komşu odaya dağılırsa (toplam oda olasılığı
   * enterProbability üstünde) en olası oda bu olasılığa ulaşınca gösterilir; 0: kapalı (koridorda kalır).
   */
  readonly commitMostLikelyRoomOnSilence: number;
  /**
   * Ölçümle (veri gelirken) bir odaya geçiş için olasılığın bu süre boyunca eşik üstünde kalması
   * gerekir (ms). Kapı önünde birkaç sapan noktanın tagı kısa süre odaya atmasını (pik) önler.
   * Sessizlikle giriş zaten kesinti süresi beklediği için etkilenmez. 0 kapalı.
   */
  readonly roomEntryConfirmMs: number;
  /** 0: onay her ölçümlü oda girişinde; 1: yalnız odadan odaya (veya odadan çıktıktan sonraki 10 sn içinde) geçişte. */
  readonly roomEntryConfirmScope: number;
  /**
   * Jetson çözümünde kullanılan (inlier) anchor sayısı bunun altındaysa ölçüm güvenilmez sayılır.
   * 3 anchorlu TDoA çözümünün koridorun karşı tarafında bir ayna çözümü vardır; sahada karşı odaya
   * düşen noktaların %92'si 3 anchorlu. 0 kapalı. Bilgi gelmezse (eski Jetson) uygulanmaz.
   */
  readonly minimumInlierAnchors: number;
  /** 0: az anchorlu ölçüm hiç kullanılmaz (sessizlik gibi); 1: zayıf ölçüm (etkisi sınırlı); 2: yalnız varlık bilgisi (tag duyuluyor, konum kullanılmaz); 3: koridordaki az anchorlu nokta normal kullanılır, odadaki atılır. */
  readonly lowAnchorMode: number;
  /**
   * Kapı önünde bekleme: son bu süre (ms) içindeki kabul edilen noktalar koridorda dar bir alanda
   * (dwellRadiusMeters) kalıyor ve tagdan hâlâ paket geliyorsa, kişi kapıda bekliyor sayılır ve
   * odaya geçiş oranı dwellHazardFactor ile çarpılır. 0 kapalı.
   */
  readonly dwellWindowMs: number;
  readonly dwellRadiusMeters: number;
  readonly dwellHazardFactor: number;
  /**
   * Odadan çıkış kanıtı zayıf olabilir (odadaki tagın koridora düşen noktaları). Çıkıştan sonraki
   * recentExitWindowMs içinde aynı odaya dönüş oranı recentExitBoost ile çarpılır, o odanın karşısındaki
   * odaya giriş oranı 1/recentExitBoost ile çarpılır. Kapı önünde gidip gelirken karşı odaya kaymayı önler.
   * 1 kapalı.
   */
  readonly recentExitBoost: number;
  readonly recentExitWindowMs: number;
  /** 1: çıkılan odaya dönüş de güçlendirilir; 0: yalnız karşı odaya geçiş zayıflatılır. */
  readonly recentExitBoostOwn: number;
  /**
   * Koridordaki bir nokta, kapıları noktanın hizasında (kapı boyunca ≤ corridorSideAlongMeters) olan
   * odalar arasında en fazla 1/corridorSideFloor kat fark yaratabilir. Jetson'un koridordaki enine
   * (sağ/sol) hatası büyük; koridorun ortasındaki bir nokta karşı karşıya iki odadan birini seçtirmemeli.
   * 0 kapalı.
   */
  readonly corridorSideFloor: number;
  readonly corridorSideAlongMeters: number;
  /** Kapıya uzaklıkta koridor enine bileşeninin çarpanı (1 = gerçek uzaklık). */
  readonly doorAcrossScale: number;
  /**
   * Bir odadan çıktıktan sonra bu süre (ms) içinde, karşısındaki odaya yalnız sessizlikle (o odanın içinden
   * 4+ anchorlu bir ölçüm gelmeden) geçilmez; tag çıktığı odaya geri alınır. Kapı önünde gidip gelirken
   * karşı odaya atlayıp orada kalmayı önler. 0 kapalı.
   */
  readonly facingReentryGuardMs: number;
  /** 1: odanın 0,5 m içine düşen 4+ anchorlu nokta onay beklemeden odaya alır; 0: o da beklenir. */
  readonly roomEntryConfirmDeepBypass: number;
  /**
   * Kararlı mod: Jetson anchor sayısı gönderiyorsa (inlier_anchor_count) ölçümle her oda girişi bu süre
   * (ms) boyunca doğrulanmalı. Kapı önünde/eşiğinde beklerken odanın erken ya da kısa süre görünmesini
   * önler; bedeli girişte bu kadar gecikme. Veri kesilerek (sessizlikle) giriş etkilenmez. 0 kapalı.
   */
  readonly stableEntryConfirmMs: number;
  /** 1: kararlı mod yalnız anchor sayısı gelen taglarda; 0: her tagda. */
  readonly stableEntryRequiresAnchorInfo: number;
  /** Kararlı modda aday oda bu kadar ms görünmezse sayaç sıfırlanır (aradaki ayna/koridor pikleri sayacı bozmaz). */
  readonly stableEntryGraceMs: number;
  /**
   * Hareket bayrağı gelmeyen taglarda yavaş yanıp sönmeden (≈10 sn) duruş çıkarımı: bu aralıkta ve
   * aynı yerde gelen iki ölçüm tagın durduğunu gösterir; aradaki sessizlik oda kanıtı sayılmaz. 0: kapalı.
   */
  readonly inferStationaryFromCadence: number;
  /**
   * Odadan koridora çıkış, son ölçüm odaya roomExitNearMeters'tan yakınken bu kadar ms sürmeden yayımlanmaz
   * (camlı odalarda oda içindeki tag koridorda, duvar dibinde görünür). 0: kapalı (Servis).
   */
  readonly roomExitConfirmMs: number;
  /**
   * Camlı oda cephesi: odadaki tagın Jetson konumu çoğu zaman cephenin önünde, koridorda (kırpma ve cam).
   * Kapı duvarının önündeki bu genişlikteki şerit (m) o oda için kanıt sayılır; 0: kapalı (Servis).
   */
  readonly glassWallStripMeters: number;
  /** Şeritteki noktanın oda olabilirliği (koridor = 1). */
  readonly glassWallRoomWeight: number;
  /** Duvar dibinde koridor olabilirliğinin düştüğü alt sınır (1: değişmez). */
  readonly glassWallCorridorFloor: number;
  /**
   * Hareketsiz tagın koridordaki gösterim konumu sabitlenir: duruş süresince ölçümlerin ortancası
   * yayımlanır, Jetson'un 1–3 m'lik sıçramaları işareti oynatmaz. Bu mesafeden uzak art arda iki ölçüm
   * yeni yer sayılır. 0: kapalı (ham konum).
   */
  readonly stationaryDisplayHoldMeters: number;
  readonly roomExitNearMeters: number;
}

export const DEFAULT_ROOM_HMM_SETTINGS: RoomHmmSettings = Object.freeze({
  corridorSigmaMeters: 0.35,
  roomSigmaMeters: 0.4,
  doorClampSigmaMeters: 0.8,
  doorClampWeight: 0.5,
  roomLikelihoodFloor: 0.4,
  frontageWeight: 0,
  passingSpeedMetersPerSecond: 0.8,
  passingFactor: 0.5,
  frontageAlongSigmaMeters: 0.8,
  frontageAcrossSigmaMeters: 2.5,
  doorProximitySigmaMeters: 0.7,
  doorEntryRatePerSecond: 0.8,
  doorReachMeters: 4,
  roomExitRatePerSecond: 0.25,
  gateExitRatePerSecond: 0.8,
  gateProximitySigmaMeters: 1.0,
  unknownRatePerSecond: 0.01,
  corridorRateMinPerSecond: 0.6,
  corridorRateMaxPerSecond: 2.5,
  corridorRateSafetyFactor: 0.6,
  stationaryRatePerSecond: 0.03,
  roomOpenRatePerSecond: 0.5,
  silentRatePerSecond: 0.02,
  silentLeakRatePerSecond: 0.2,
  outsideNearRatePerSecond: 0.5,
  enterProbability: 0.7,
  releaseProbability: 0.2,
  candidateProbability: 0.3,
  maximumMeasurementInfluence: 8,
  spikeMeasurementInfluence: 1.5,
  maximumSpeedMetersPerSecond: 2.5,
  minimumSilenceForRoomMs: 2500,
  measuredFreshMs: 3000,
  corridorLostAfterMs: 60_000,
  inferredRoomMaxAgeMs: 12 * 3_600_000,
  weakPdop: 6,
  motionFlagFreshMs: 25_000,
  reportedStationaryRatePerSecond: 0.08,
  reportedStationaryTransitionFactor: 0.001,
  reportedStationaryMeasurementInfluence: 2,
  keepLastDecisionOnSignalLoss: 1,
  signalLostAfterMs: 15_000,
  facingRoomLikelihoodFloor: 0,
  commitMostLikelyRoomOnSilence: 0.5,
  roomEntryConfirmMs: 1500,
  roomEntryConfirmScope: 1,
  minimumInlierAnchors: 4,
  lowAnchorMode: 0,
  dwellWindowMs: 0,
  dwellRadiusMeters: 1.2,
  dwellHazardFactor: 0.1,
  recentExitBoost: 1,
  recentExitWindowMs: 20_000,
  recentExitBoostOwn: 1,
  corridorSideFloor: 0,
  corridorSideAlongMeters: 2,
  doorAcrossScale: 1,
  facingReentryGuardMs: 0,
  roomEntryConfirmDeepBypass: 1,
  stableEntryConfirmMs: 6000,
  stableEntryRequiresAnchorInfo: 0,
  stableEntryGraceMs: 0,
  inferStationaryFromCadence: 1,
  roomExitConfirmMs: 0,
  glassWallStripMeters: 0,
  glassWallRoomWeight: 1,
  glassWallCorridorFloor: 0.3,
  stationaryDisplayHoldMeters: 0,
  roomExitNearMeters: 1.5,
});

export function resolveRoomHmmSettings(input?: Partial<RoomHmmSettings> | null): RoomHmmSettings {
  const result: Record<string, number> = { ...DEFAULT_ROOM_HMM_SETTINGS };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!(key in DEFAULT_ROOM_HMM_SETTINGS)) throw new Error(`Oda HMM ayarı bilinmiyor: ${key}`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Oda HMM ayarı geçersiz: ${key}`);
    result[key] = value;
  }
  if (result.enterProbability <= 0.5 || result.enterProbability >= 1) throw new Error("Oda HMM: enterProbability 0.5–1 arasında olmalı");
  if (result.releaseProbability >= result.enterProbability) throw new Error("Oda HMM: releaseProbability enterProbability'den küçük olmalı");
  if (result.maximumMeasurementInfluence < 1 || result.spikeMeasurementInfluence < 1 || result.reportedStationaryMeasurementInfluence < 1) throw new Error("Oda HMM: ölçüm etki sınırı en az 1 olmalı");
  return Object.freeze(result) as unknown as RoomHmmSettings;
}

type Point = { readonly x: number; readonly y: number };
export interface EmissionCorrection {
  readonly cellSize: number;
  readonly places: Readonly<Record<string, { readonly rest: number; readonly cells: Readonly<Record<string, number>> }>>;
}
type Sub = "move" | "still" | "open" | "deep" | "near" | "far" | "unknown";
interface HiddenState { readonly place: string; readonly sub: Sub; readonly roomIndex: number }
interface DoorModel {
  readonly roomIndex: number; readonly id: string; readonly center: Point;
  readonly a: Point; readonly b: Point; readonly normal: Point | null;
  /** The room's extent along its door wall (tangent coordinate relative to the door centre). */
  readonly spanMin: number; readonly spanMax: number;
}
interface GateModel { readonly id: string; readonly polygon: readonly Point[]; readonly bounds: Bounds; readonly centroid: Point }
interface Bounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
interface Model {
  readonly states: readonly HiddenState[];
  readonly corridorMove: number; readonly corridorStill: number; readonly unknown: number;
  readonly outsideNear: number; readonly outsideFar: number; // -1 when the map has no exit gates
  readonly roomOpen: readonly number[]; readonly roomDeep: readonly number[];
  readonly doors: readonly DoorModel[]; readonly gates: readonly GateModel[];
  readonly areas: readonly { readonly polygon: readonly Point[]; readonly bounds: Bounds }[];
}

const CORRIDOR = "corridor", UNKNOWN = "unknown", OUTSIDE = "outside";
const isRoomPlace = (place: string | null): boolean => place !== null && place !== CORRIDOR && place !== UNKNOWN && place !== OUTSIDE;

interface Track {
  x: number; y: number; vx: number; vy: number; at: number;
  pending: { x: number; y: number; at: number }[];
}
interface Sample { readonly x: number; readonly y: number; readonly at: number }

interface HmmVehicle extends VehicleRegionStatus {
  belief: Float64Array; beliefAt: number;
  track: Track | null; recent: Sample[]; recentAccepted: Sample[]; stillAnchor: Point | null; fastBlinkCount: number;
  /** Last motion state reported by the tag itself (null = never reported). */
  reportedMotion: "moving" | "stationary" | null; reportedMotionAt: number;
  lastExit: { readonly regionId: string; readonly at: number } | null; leftAreaAt: number | null;
  pendingPlace: string | null; pendingSince: number;
  dwellAnchor: Point | null; hasAnchorInfo: boolean; pendingLastSeen: number; motionInferred: boolean; exitPendingSince: number; holdSamples: Point[]; holdPos: Point | null; holdFar: number;
  committed: string | null; committedSince: number;
  lastKnown: string | null;
  rateEma: number; latencyEma: number;
  lastMeasurementAt: number; lastMeasurementRoom: string | null; lastFlagged: boolean;
  lastRoomSupport: { readonly roomId: string; readonly at: number } | null;
  lastMeasurementOutsideArea: boolean;
  reasons: string[]; probabilities: Record<string, number>;
  tracePreviousState?: VehicleRegionState; traceTrigger?: DecisionTrace["trigger"]; traceInput?: TrackingPosition;
  transitionFrom?: string;
}

const EMPTY_SCORE: EvidenceScoreComponents = { base: 0, duration: 0, measurements: 0, door: 0, total: 0 };

function boundsOf(polygon: readonly Point[]): Bounds {
  return { minX: Math.min(...polygon.map(p => p.x)), minY: Math.min(...polygon.map(p => p.y)),
    maxX: Math.max(...polygon.map(p => p.x)), maxY: Math.max(...polygon.map(p => p.y)) };
}
function inside(point: Point, area: { readonly polygon: readonly Point[]; readonly bounds: Bounds }): boolean {
  return pointInPolygon(point, area);
}
function polygonDistance(point: Point, area: { readonly polygon: readonly Point[]; readonly bounds: Bounds }): number {
  if (inside(point, area)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = area.polygon.length - 1; i < area.polygon.length; j = i++) best = Math.min(best, distanceToSegment(point, area.polygon[j], area.polygon[i]));
  return best;
}
const gauss = (distance: number, sigma: number): number => Math.exp(-0.5 * (distance / Math.max(1e-6, sigma)) ** 2);
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function buildModel(config: CompiledRegionsConfig): Model {
  const states: HiddenState[] = [];
  const add = (place: string, sub: Sub, roomIndex = -1) => { states.push({ place, sub, roomIndex }); return states.length - 1; };
  const corridorMove = add(CORRIDOR, "move"), corridorStill = add(CORRIDOR, "still"), unknown = add(UNKNOWN, "unknown");
  const gates: GateModel[] = config.largeAreas.flatMap(area => area.gates.filter(gate => gate.role !== "entry").map(gate => ({
    id: gate.id, polygon: gate.polygon, bounds: boundsOf(gate.polygon),
    centroid: { x: gate.polygon.reduce((s, p) => s + p.x, 0) / gate.polygon.length, y: gate.polygon.reduce((s, p) => s + p.y, 0) / gate.polygon.length },
  })));
  const outsideNear = gates.length ? add(OUTSIDE, "near") : -1;
  const outsideFar = gates.length ? add(OUTSIDE, "far") : -1;
  const roomOpen: number[] = [], roomDeep: number[] = [], doors: DoorModel[] = [];
  config.regions.forEach((region, roomIndex) => {
    roomOpen.push(add(region.id, "open", roomIndex));
    roomDeep.push(add(region.id, "deep", roomIndex));
    for (const door of region.entrances) {
      if (!door.settings.enabled || door.settings.direction === "exit-only") continue;
      const normal = door.inwardNormal ?? null;
      const half = (door.widthMeters ?? 1.0) / 2;
      const tangent = normal ? { x: -normal.y, y: normal.x } : { x: 0, y: 0 };
      const along = region.polygon.map(p => (p.x - door.x) * tangent.x + (p.y - door.y) * tangent.y);
      doors.push({ roomIndex, id: door.id, center: { x: door.x, y: door.y }, normal,
        a: { x: door.x - tangent.x * half, y: door.y - tangent.y * half }, b: { x: door.x + tangent.x * half, y: door.y + tangent.y * half },
        spanMin: normal ? Math.min(...along) : -half, spanMax: normal ? Math.max(...along) : half });
    }
  });
  return { states, corridorMove, corridorStill, unknown, outsideNear, outsideFar, roomOpen, roomDeep, doors, gates,
    areas: config.largeAreas.map(area => ({ polygon: area.polygon, bounds: boundsOf(area.polygon) })) };
}

/** Same public surface as RegionPositionEngine so the controller and replay can swap engines. */
export class RoomHmmEngine {
  private config: CompiledRegionsConfig | null = null; private model: Model | null = null; private enabled = false;
  private scheduler: ReturnType<typeof setInterval> | null = null; private readonly vehicles = new Map<string, HmmVehicle>();
  private readonly settings: RoomHmmSettings;

  /**
   * Learned room confusion (field calibration): confusion[trueRoom][observedRoom] = share of the
   * in-room solutions of a tag in trueRoom that the Jetson places inside observedRoom.
   * Fixes systematic mirror errors (e.g. a tag in 202 measured inside 215). Optional.
   */
  private confusion: Readonly<Record<string, Readonly<Record<string, number>>>> | null = null;
  /**
   * Learned emission correction (field calibration, tools/room-benchmark/field-sim/learnEmission.ts):
   * the geometric likelihood of each place is multiplied by factor[place][cell] = P_field(cell|place) /
   * P_geometric(cell|place). Where the Jetson systematically reports a room's tag (corridor strip in
   * front of it, the room across the corridor) the room gains likelihood. Missing table = factor 1.
   */
  private emission: EmissionCorrection | null = null;
  public setEmissionCorrection(table: EmissionCorrection | null | undefined): void { this.emission = table ?? null; }
  public setRoomConfusion(confusion: Readonly<Record<string, Readonly<Record<string, number>>>> | null | undefined): void { this.confusion = confusion ?? null; }

  public constructor(private readonly publish: (position: ProcessedPosition) => void, private readonly broadcastIntervalMs: number,
    private readonly now: () => number = Date.now, private readonly automaticTicks = true, settings?: Partial<RoomHmmSettings> | null) {
    this.settings = resolveRoomHmmSettings(settings);
  }

  public enable(config: CompiledRegionsConfig): void {
    if (this.enabled) return;
    this.config = config; this.model = buildModel(config); this.facingCache = null; this.enabled = true; this.vehicles.clear();
    if (this.automaticTicks) { this.scheduler = setInterval(() => this.tick(), this.broadcastIntervalMs); this.scheduler.unref?.(); }
  }
  public disable(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null; this.enabled = false; this.config = null; this.model = null; this.vehicles.clear();
  }
  public reload(config: CompiledRegionsConfig): void {
    this.config = config; this.model = buildModel(config); this.facingCache = null;
    for (const v of this.vehicles.values()) {
      v.tracePreviousState = v.state; v.traceTrigger = "config_reload"; v.traceInput = undefined;
      v.belief = this.initialBelief(null); v.track = null; v.recent = []; v.recentAccepted = []; v.stillAnchor = null;
      v.committed = UNKNOWN; v.transitionFrom = undefined; v.activeRegionId = null; v.candidateRegionId = null; v.state = "LOCATION_LOST";
      v.reasons = ["Harita değişti; yeni ölçüm kanıtı bekleniyor"]; this.send(v, true);
    }
  }
  public getVehicleState(id: string): HmmVehicle | undefined { return this.vehicles.get(id); }
  public removeVehicle(id: string): void { this.vehicles.delete(id); }

  public getStatus(rawPort: number, processedPort: number): RegionEngineStatus {
    const config = this.config;
    return { enabled: this.enabled, engineVersion: HMM_ROOM_ENGINE_VERSION, rawPort, processedPort,
      activeVehicleCount: [...this.vehicles.values()].filter(v => v.state !== "LOCATION_LOST").length,
      vehiclesInRegions: [...this.vehicles.values()].filter(v => v.activeRegionId).length, configLoaded: config !== null, configVersion: config?.version,
      diagnostics: [...this.vehicles.values()].map((v): RegionVehicleDiagnostic => ({
        vehicleId: v.vehicleId, state: v.state, activeRegionId: v.activeRegionId, candidateRegionId: v.candidateRegionId,
        doorId: null, doorDirection: null, doorEvidenceMode: null, collectedDurationMs: 0, requiredDurationMs: 0,
        collectedMeasurements: 0, requiredMeasurements: 0, lastMeasurementQuality: null, doorEvidenceRemainingMs: null,
        score: { ...EMPTY_SCORE, total: v.entryConfidence }, silentDoorCandidateRegionId: null, silentDoorCandidateDoorId: null,
        silentDoorDistanceMeters: null, silentDoorObservedAt: null, silentDoorCandidateSource: null,
        reasons: [...v.reasons, `Olasılıklar: ${this.describeProbabilities(v.probabilities)}`], configVersion: config?.version,
      })) };
  }

  // ---------------------------------------------------------------- ingest
  public ingest(raw: TrackingPosition): ProcessedPosition | undefined {
    if (!this.enabled || !this.config || !this.model) return;
    const at = Date.parse(raw.timestamp), now = this.now();
    if (!Number.isFinite(at) || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || at > now + 2000) return;
    // The Jetson clamps solutions into its zone polygon; when its zone has no room notches an
    // in-room solution is pushed to the corridor edge. The unclamped one is room evidence then.
    const solverRaw = raw.solverRaw;
    if (solverRaw && Number.isFinite(solverRaw.x) && Number.isFinite(solverRaw.y) && this.config.regions.some(r => pointInPolygon(solverRaw, r)))
      raw = { ...raw, x: solverRaw.x, y: solverRaw.y };
    let lowAnchors = this.settings.minimumInlierAnchors > 0 && raw.anchorCount != null && raw.anchorCount < this.settings.minimumInlierAnchors;
    // A 3-anchor solution's mirror twin lies across the anchor line, which runs along the corridor:
    // a corridor solution's twin is still in the corridor, a room solution's twin is in the facing room.
    // Mode 3 keeps corridor solutions (as ordinary evidence) and drops only the room ones.
    if (lowAnchors && this.settings.lowAnchorMode >= 2.5 && this.config.corridors.some(c => pointInPolygon(raw, c))
      && !this.config.regions.some(r => pointInPolygon(raw, r))) lowAnchors = false;
    let v = this.vehicles.get(raw.tagCode);
    if (v && raw.anchorCount != null) v.hasAnchorInfo = true;
    if (lowAnchors && (this.settings.lowAnchorMode < 0.5 || this.settings.lowAnchorMode >= 2.5)) {
      // Ambiguous geometry: keep only the timestamp for the display; the belief sees silence.
      if (v) v.lastRawDataTimestamp = Math.max(v.lastRawDataTimestamp, at);
      return v ? this.send(v) : undefined;
    }
    if (lowAnchors && this.settings.lowAnchorMode >= 1.5 && v && at > v.lastMeasurementAt) {
      // Presence only: the tag is heard (so it is not deep in a silent room) but where it is
      // stays unknown — a mirrored 3-anchor solution must neither move it nor read as silence.
      v.tracePreviousState = v.state; v.traceTrigger = "measurement"; v.traceInput = raw;
      this.propagate(v, Math.max(v.beliefAt, at));
      const rates = this.rates(v, at), b = v.belief;
      for (let i = 0; i < b.length; i++) b[i] *= rates[i];
      v.belief = normalize(b);
      v.lastMeasurementAt = at; v.lastRawDataTimestamp = at;
      this.decide(v, at, ["3 anchorlu ölçüm: yalnız varlık bilgisi kullanıldı"]);
      return this.send(v);
    }
    if (v && at <= v.lastMeasurementAt) return; // duplicate or out of order
    if (!v) {
      if (this.vehicles.size >= this.config.rules.maxTags) this.vehicles.delete(this.vehicles.keys().next().value!);
      v = this.createVehicle(raw, at);
      v.hasAnchorInfo = raw.anchorCount != null;
      this.vehicles.set(raw.tagCode, v);
    }
    v.tracePreviousState = v.state; v.traceTrigger = "measurement"; v.traceInput = raw;
    const latency = Math.max(0, now - at);
    v.latencyEma = v.lastMeasurementAt ? v.latencyEma * 0.9 + latency * 0.1 : latency;
    // Too old to be useful relative to the already-integrated silence: keep only for display.
    if (at < v.beliefAt - 10_000) { v.lastRawPosition = raw; return this.send(v); }

    const dtMs = v.lastMeasurementAt ? at - v.lastMeasurementAt : 0;
    const flaggedBySolver = (raw.quality !== undefined && raw.quality < this.config.rules.minimumHardwareQuality)
      || (raw.pdop != null && Number.isFinite(raw.pdop) && raw.pdop > this.settings.weakPdop) || lowAnchors;
    const spike = this.updateTrack(v, raw, at);
    const flagged = spike || flaggedBySolver;
    if (raw.motion === "moving" || raw.motion === "stationary") {
      v.motionInferred = false;
      v.reportedMotion = raw.motion; v.reportedMotionAt = at;
      // The tag's own IMU overrides the position-based stillness guess.
      if (raw.motion === "moving") { v.stillAnchor = null; v.fastBlinkCount = 0; }
    }
    else if (this.settings.inferStationaryFromCadence >= 0.5 && (v.reportedMotion === null || v.motionInferred)) this.inferMotionFromCadence(v, raw, at, dtMs);
    if (raw.motion !== "stationary" && this.placeProbability(v, CORRIDOR) > 0.6 && dtMs > 0 && dtMs < 3000) v.rateEma = v.rateEma * 0.9 + (1000 / Math.max(50, dtMs)) * 0.1;

    // A lone sample far from where a stationary tag lies is a solver jump: limited influence.
    const holdOutlier = this.updateDisplayHold(v, raw, at);
    this.propagate(v, Math.max(v.beliefAt, at));
    this.measurementUpdate(v, raw, flagged || holdOutlier);
    const previousAt = v.lastMeasurementAt;
    v.lastMeasurementAt = at; v.lastRawPosition = raw; v.lastRawDataTimestamp = at; v.lastFlagged = flagged;
    v.lastMeasurementRoom = this.supportedRoom(raw);
    v.lastMeasurementOutsideArea = this.model.areas.length > 0 && !this.model.areas.some(area => inside(raw, area));
    if (!flagged && v.committed && isRoomPlace(v.committed)) {
      const room = this.config.regions.find(r => r.id === v!.committed);
      if (room && (v.lastMeasurementRoom === room.id || polygonDistance(raw, room) <= 0.5)) v.lastRoomSupport = { roomId: room.id, at };
    } else if (v.lastMeasurementRoom && !flagged) v.lastRoomSupport = { roomId: v.lastMeasurementRoom, at };
    v.recent.push({ x: raw.x, y: raw.y, at });
    if (!flagged) {
      this.updateStillness(v, { x: raw.x, y: raw.y, at }, previousAt);
      v.recentAccepted.push({ x: raw.x, y: raw.y, at });
      if (v.recentAccepted.length > 12) v.recentAccepted.shift();
      this.updateDwell(v, at);
    }
    while (v.recent.length && at - v.recent[0].at > 40_000) v.recent.shift();
    this.decide(v, at, flagged ? ["Fiziksel olarak tutarsız/zayıf ölçüm; etkisi sınırlandı"] : []);
    return this.send(v);
  }

  public tick(): void {
    if (!this.enabled || !this.config || !this.model) return;
    const now = this.now();
    for (const [id, v] of this.vehicles) {
      if (now - v.lastRawDataTimestamp > Math.max(this.settings.inferredRoomMaxAgeMs, 3_600_000) + 3_600_000) { this.vehicles.delete(id); continue; }
      const clock = now - clamp(v.latencyEma, 0, 4000);
      if (clock > v.beliefAt) this.propagate(v, clock);
      const before = `${v.state}|${v.activeRegionId}|${v.candidateRegionId}`;
      v.tracePreviousState = v.state; v.traceTrigger = "timer"; v.traceInput = undefined;
      this.decide(v, clock, []);
      const changed = before !== `${v.state}|${v.activeRegionId}|${v.candidateRegionId}`;
      if (changed || now - v.lastPublishedTimestamp >= this.broadcastIntervalMs) this.send(v, true);
    }
  }

  // ---------------------------------------------------------------- model
  private createVehicle(raw: TrackingPosition, at: number): HmmVehicle {
    const vehicle: HmmVehicle = {
      vehicleId: raw.tagCode, state: "TRACKING_OUTSIDE", lastRawPosition: raw, resolvedPosition: undefined as unknown as ProcessedPosition,
      activeRegionId: null, candidateRegionId: null, entryConfidence: 0, lastRawDataTimestamp: at, lastPublishedTimestamp: 0,
      insideConfirmationCount: 0, exitConfirmationCount: 0,
      belief: this.initialBelief(raw), beliefAt: at, track: null, recent: [], recentAccepted: [], stillAnchor: null, fastBlinkCount: 0, reportedMotion: null, reportedMotionAt: 0, lastExit: null, leftAreaAt: null, pendingPlace: null, pendingSince: 0, pendingLastSeen: 0, motionInferred: false, exitPendingSince: 0, holdSamples: [], holdPos: null, holdFar: 0, dwellAnchor: null, hasAnchorInfo: false, committed: null, committedSince: at, lastKnown: null,
      rateEma: 2, latencyEma: 0, lastMeasurementAt: 0, lastMeasurementRoom: null, lastFlagged: false, lastRoomSupport: null, lastMeasurementOutsideArea: false, reasons: [], probabilities: {},
    };
    return vehicle;
  }

  private initialBelief(raw: TrackingPosition | null): Float64Array {
    const m = this.model!, b = new Float64Array(m.states.length).fill(1e-6);
    b[m.corridorMove] = 0.7; b[m.unknown] = 0.02;
    if (m.outsideNear >= 0) b[m.outsideNear] = 0.05;
    const share = 0.25 / Math.max(1, m.roomOpen.length);
    for (const index of m.roomOpen) b[index] = share;
    // The first measurement itself is applied by measurementUpdate; this is only a weak prior.
    void raw;
    return normalize(b);
  }

  /** Robust alpha-beta tracker. Returns true when the sample is physically unreachable (spike). */
  private updateTrack(v: HmmVehicle, raw: TrackingPosition, at: number): boolean {
    const s = this.settings;
    const t = v.track;
    if (!t || at - t.at > 5000) { v.track = { x: raw.x, y: raw.y, vx: 0, vy: 0, at, pending: [] }; return false; }
    const dt = Math.max(0.01, (at - t.at) / 1000), dtp = Math.min(dt, 1);
    const px = t.x + t.vx * dtp, py = t.y + t.vy * dtp;
    const ex = raw.x - px, ey = raw.y - py, error = Math.hypot(ex, ey);
    // 3σ solver noise plus a brisk walk; anything further is not a physically reachable sample.
    const gate = 1.4 + 2.0 * dt;
    if (error > gate) {
      t.pending.push({ x: raw.x, y: raw.y, at });
      t.pending = t.pending.filter(p => at - p.at <= 4000).slice(-3);
      // Three consecutive samples that are consistent with each other (walking speed between them)
      // mean the tag really moved (or the track was wrong): restart the track there.
      const consistent = t.pending.length >= 3 && t.pending.every((p, i) => i === 0
        || Math.hypot(p.x - t.pending[i - 1].x, p.y - t.pending[i - 1].y) <= 1.4 + 2.0 * Math.max(0.05, (p.at - t.pending[i - 1].at) / 1000));
      if (consistent) {
        const first = t.pending[0], span = Math.max(0.2, (at - first.at) / 1000);
        v.track = { x: raw.x, y: raw.y, vx: (raw.x - first.x) / span, vy: (raw.y - first.y) / span, at, pending: [] };
        return false;
      }
      return true;
    }
    const alpha = 0.55, beta = 0.2;
    t.x = px + alpha * ex; t.y = py + alpha * ey;
    t.vx += beta * ex / Math.max(dt, 0.1); t.vy += beta * ey / Math.max(dt, 0.1);
    const speed = Math.hypot(t.vx, t.vy);
    if (speed > s.maximumSpeedMetersPerSecond) { t.vx *= s.maximumSpeedMetersPerSecond / speed; t.vy *= s.maximumSpeedMetersPerSecond / speed; }
    t.at = at; t.pending = [];
    return false;
  }

  /**
   * True while the tag firmware is believed to be in its stationary (10 s blink) mode:
   * the last ~30 s of samples stayed in one spot. It stays sticky through the sparse
   * stationary blinks and is released by movement or by fast (moving-mode) blinks.
   */
  private isStill(v: HmmVehicle, at = v.lastMeasurementAt): boolean {
    const reported = this.reportedMotion(v, at);
    return reported ? reported === "stationary" : v.stillAnchor !== null;
  }

  /** A stationary tag blinks every 10 s: its last sample stays "measured" until the next one is due. */
  private measuredFreshMs(v: HmmVehicle, at: number): number {
    return this.reportedMotion(v, at) ? Math.max(this.settings.measuredFreshMs, 12_000) : this.settings.measuredFreshMs;
  }

  /** The tag's own motion report while it is fresh; null falls back to the position heuristic. */
  private reportedMotion(v: HmmVehicle, at: number): "stationary" | null {
    // "moving" only says the tag blinks at its normal rate, which the position heuristic already
    // assumes; it is used to end a stationary period at once (see ingest), not as a state of its own.
    return v.reportedMotion === "stationary" && at - v.reportedMotionAt <= (v.motionInferred ? 120_000 : this.settings.motionFlagFreshMs) ? "stationary" : null;
  }

  /**
   * Without an IMU flag: a stationary tag blinks every ~10 s. A slow gap at the same spot means the tag
   * is lying still (a silence explained by the blink rate, not by a room); fast blinks end it.
   */
  private inferMotionFromCadence(v: HmmVehicle, raw: Point, at: number, dtMs: number): void {
    const last = v.lastRawPosition;
    if (!last || dtMs <= 0) return;
    const moved = Math.hypot(raw.x - last.x, raw.y - last.y);
    if (dtMs >= 6000 && dtMs <= 16_000 && moved <= 3) {
      v.reportedMotion = "stationary"; v.reportedMotionAt = at; v.motionInferred = true;
    } else if (v.motionInferred && (dtMs < 2500 || moved > 3)) {
      v.reportedMotion = null; v.motionInferred = false;
    }
  }

  /** Display-only: a stationary tag keeps one marker position (median of its samples) instead of every Jetson jump. */
  private updateDisplayHold(v: HmmVehicle, raw: Point, at: number): boolean {
    const limit = this.settings.stationaryDisplayHoldMeters;
    if (limit <= 0 || this.reportedMotion(v, at) !== "stationary") { v.holdSamples = []; v.holdPos = null; v.holdFar = 0; return false; }
    const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[sorted.length >> 1]; };
    const away = v.holdPos ? Math.hypot(raw.x - v.holdPos.x, raw.y - v.holdPos.y) : 0;
    if (v.holdPos && away > limit) {
      // Two far samples in a row: the tag really is somewhere else now.
      if (++v.holdFar < 2) return true;
      v.holdSamples = []; v.holdPos = null;
    }
    v.holdFar = 0;
    // A sample 1.5 m+ off the resting point still joins the display median but barely moves the room belief.
    const outlier = v.holdPos !== null && away > Math.min(1.5, limit);
    v.holdSamples.push({ x: raw.x, y: raw.y });
    if (v.holdSamples.length > 15) v.holdSamples.shift();
    const center = { x: median(v.holdSamples.map(p => p.x)), y: median(v.holdSamples.map(p => p.y)) };
    if (!v.holdPos || Math.hypot(center.x - v.holdPos.x, center.y - v.holdPos.y) > 0.5) v.holdPos = center;
    return outlier;
  }

  private updateStillness(v: HmmVehicle, sample: Sample, previousAt: number): void {
    if (this.reportedMotion(v, sample.at)) return;
    const anchor = v.stillAnchor;
    if (anchor) {
      const moved = Math.hypot(sample.x - anchor.x, sample.y - anchor.y) > 1.5;
      const fastBlink = previousAt > 0 && sample.at - previousAt < 2000 && v.fastBlinkCount++ >= 1;
      if (moved || fastBlink) { v.stillAnchor = null; v.fastBlinkCount = 0; }
      else if (!(sample.at - previousAt < 2000)) v.fastBlinkCount = 0;
      return;
    }
    const recent = v.recent.filter(p => sample.at - p.at <= 30_000);
    // Firmware switches to 10 s blinks only after 30 s without motion.
    if (recent.length < 8 || sample.at - recent[0].at < 25_000) return;
    const xs = recent.map(p => p.x).sort((a, b) => a - b), ys = recent.map(p => p.y).sort((a, b) => a - b);
    const mx = xs[xs.length >> 1], my = ys[ys.length >> 1];
    if (recent.filter(p => Math.hypot(p.x - mx, p.y - my) > 1.0).length <= recent.length * 0.1) { v.stillAnchor = { x: mx, y: my }; v.fastBlinkCount = 0; }
  }

  /** Standing in the corridor in front of a door (still sending): see dwellWindowMs. */
  private updateDwell(v: HmmVehicle, at: number): void {
    const s = this.settings;
    v.dwellAnchor = null;
    if (s.dwellWindowMs <= 0) return;
    const recent = v.recent.filter(p => at - p.at <= s.dwellWindowMs);
    if (recent.length < 5 || at - recent[0].at < s.dwellWindowMs * 0.7) return;
    const xs = recent.map(p => p.x).sort((a, b) => a - b), ys = recent.map(p => p.y).sort((a, b) => a - b);
    const center = { x: xs[xs.length >> 1], y: ys[ys.length >> 1] };
    if (this.config!.regions.some(r => pointInPolygon(center, r))) return;
    if (recent.filter(p => Math.hypot(p.x - center.x, p.y - center.y) > s.dwellRadiusMeters).length > recent.length * 0.2) return;
    v.dwellAnchor = center;
  }

  private corridorRate(v: HmmVehicle): number {
    const s = this.settings;
    return clamp(v.rateEma * s.corridorRateSafetyFactor, s.corridorRateMinPerSecond, s.corridorRateMaxPerSecond);
  }

  /**
   * Expected solution rate of every hidden state (negative information).
   * Corridor, the measurable door side of a room and just outside an exit share the same
   * rate: some rooms leak data at full rate, so arrival itself must not favour the corridor.
   * Silent states (room interior, far outside, unknown, stationary tag) explain gaps.
   */
  private rates(v: HmmVehicle, at: number): Float64Array {
    const m = this.model!, s = this.settings, r = new Float64Array(m.states.length);
    // A tag that reports itself stationary blinks every 10 s wherever it is.
    const reportedStill = this.reportedMotion(v, at) === "stationary";
    const data = reportedStill ? s.reportedStationaryRatePerSecond : this.corridorRate(v);
    const still = reportedStill ? s.reportedStationaryRatePerSecond : s.stationaryRatePerSecond;
    for (let i = 0; i < m.states.length; i++) {
      const sub = m.states[i].sub;
      r[i] = sub === "move" || sub === "open" || sub === "near" ? data : sub === "still" ? still : s.silentRatePerSecond;
    }
    return r;
  }

  private directionFactor(v: HmmVehicle, direction: Point | null, at: number): number {
    const t = v.track;
    if (!t || !direction) return 1;
    const age = (at - t.at) / 1000;
    const decay = age <= 2 ? 1 : Math.max(0, 1 - (age - 2) / 4);
    const along = (t.vx * direction.x + t.vy * direction.y) * decay;
    return Math.max(0.2, 1 + 1.5 * clamp(along / 0.5, 0, 1) - 0.6 * clamp(-along / 0.5, 0, 1));
  }

  /**
   * Corridor-side positions used for door/gate hazards: the last three accepted samples that are not
   * inside a room, weighted 0.5/0.3/0.2 by recency. In-room samples (often NLOS points in the
   * neighbouring room) speak only through the bounded measurement likelihood, never by moving the
   * person next to another door; a single stray corridor sample carries at most half the weight.
   */
  private hazardSamples(v: HmmVehicle): { readonly p: Point; readonly w: number }[] {
    const corridorSide = v.recentAccepted.filter(p => !this.config!.regions.some(r => pointInPolygon(p, r)));
    const last = corridorSide.at(-1);
    if (!last) return v.track ? [{ p: v.track, w: 1 }] : [];
    // Older samples fade quickly (1.5 s time constant): a door passed 2–3 s ago no longer matters.
    const recent = corridorSide.filter(p => last.at - p.at <= 2500).slice(-3).reverse();
    const weights = recent.map((p, i) => [0.5, 0.3, 0.2][i] * Math.exp(-(last.at - p.at) / 1500));
    const total = weights.reduce((a, b) => a + b, 0);
    return recent.map((p, i) => ({ p, w: weights[i] / total }));
  }

  /**
   * Distance from a corridor sample to a door opening. The across-corridor component is scaled by
   * doorAcrossScale (<1): the Jetson's lateral error in the corridor is large, so a sample in the
   * middle of the corridor must not pick the left or the right door by a metre of bias.
   */
  private doorDistance(p: Point, door: DoorModel): number {
    const scale = this.settings.doorAcrossScale;
    if (scale >= 1 || !door.normal) return distanceToSegment(p, door.a, door.b);
    const n = door.normal, dx = p.x - door.center.x, dy = p.y - door.center.y;
    const across = Math.abs(dx * n.x + dy * n.y), along = Math.abs(-dx * n.y + dy * n.x);
    const half = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y) / 2;
    return Math.hypot(Math.max(0, along - half), across * scale);
  }

  /** Walking briskly along the wall past a door makes an entry at that instant unlikely. */
  private passingFactor(v: HmmVehicle, normal: Point | null, at: number): number {
    const t = v.track, s = this.settings;
    if (!t || !normal || at - t.at > 2000) return 1;
    const parallel = Math.abs(t.vx * -normal.y + t.vy * normal.x), inward = t.vx * normal.x + t.vy * normal.y;
    // Turning towards the opening (inward component) is an approach, not a pass-by.
    return parallel > s.passingSpeedMetersPerSecond && inward < 0.2 ? s.passingFactor : 1;
  }

  /** Continuous-time transition hazards from the current tracker position. */
  private transitionRates(v: HmmVehicle, at: number): { rooms: Float64Array; gate: number; still: boolean; reported: "stationary" | null; stillFactor: number } {
    const m = this.model!, s = this.settings, rooms = new Float64Array(m.roomOpen.length);
    const samples = this.hazardSamples(v), still = this.isStill(v, at), reported = this.reportedMotion(v, at);
    // A tag that says it is not moving cannot be walking through a door.
    const dwelling = v.dwellAnchor !== null && at - v.lastRawDataTimestamp <= 2000;
    const stillFactor = (!still ? 1 : reported === "stationary" ? s.reportedStationaryTransitionFactor : 0.05) * (dwelling ? s.dwellHazardFactor : 1);
    // The tracked position is the last *seen* one. Once it is stale the person may be anywhere,
    // so door/gate hazards fade out: entry decisions are made in the first seconds of silence and
    // a long silence must not slowly drain unknown/outside belief into the nearest room.
    const age = at - v.lastMeasurementAt;
    const freshness = age <= 3000 ? 1 : Math.exp(-(age - 3000) / 4000);
    let gate = 0;
    if (samples.length && freshness > 1e-3) {
      for (const door of m.doors) {
        let k = 0;
        for (const { p, w } of samples) {
          const distance = this.doorDistance(p, door);
          if (distance <= s.doorReachMeters) k += w * gauss(distance, s.doorProximitySigmaMeters);
        }
        if (k <= 0) continue;
        k *= this.directionFactor(v, door.normal, at) * this.passingFactor(v, door.normal, at) * stillFactor;
        rooms[door.roomIndex] = Math.max(rooms[door.roomIndex], s.doorEntryRatePerSecond * k * freshness);
      }
      if (s.recentExitBoost !== 1 && v.lastExit && at - v.lastExit.at <= s.recentExitWindowMs) {
        const exited = this.config!.regions.findIndex(r => r.id === v.lastExit!.regionId);
        if (exited >= 0) {
          if (s.recentExitBoostOwn >= 0.5) rooms[exited] *= s.recentExitBoost;
          for (const facing of this.facingRooms()[exited] ?? []) rooms[facing] /= s.recentExitBoost;
        }
      }
      const t = samples[0].p;
      for (const g of m.gates) {
        let k = 0;
        for (const { p, w } of samples) { const distance = polygonDistance(p, g); if (distance <= s.doorReachMeters) k += w * gauss(distance, s.gateProximitySigmaMeters); }
        if (k <= 0) continue;
        const dx = g.centroid.x - t.x, dy = g.centroid.y - t.y, length = Math.hypot(dx, dy);
        const toward = length > 1e-6 ? { x: dx / length, y: dy / length } : null;
        gate = Math.max(gate, s.gateExitRatePerSecond * k * this.directionFactor(v, toward, at) * stillFactor * freshness);
      }
    }
    return { rooms, gate, still, reported, stillFactor };
  }

  private propagate(v: HmmVehicle, to: number): void {
    const m = this.model!, s = this.settings;
    let from = v.beliefAt;
    if (!(to > from)) return;
    while (from < to) {
      const step = Math.min(500, to - from), dt = step / 1000;
      const rates = this.rates(v, from + step);
      const { rooms, gate, still, reported, stillFactor } = this.transitionRates(v, from + step);
      const b = v.belief, next = new Float64Array(b);
      const move = (source: number, targets: readonly (readonly [number, number])[]) => {
        const total = targets.reduce((sum, [, rate]) => sum + rate, 0);
        if (total <= 0 || b[source] <= 0) return;
        const out = b[source] * (1 - Math.exp(-total * dt));
        next[source] -= out;
        for (const [target, rate] of targets) next[target] += out * rate / total;
      };
      const toStill = reported === "stationary" ? 2 : still ? 0.3 : 0.003;
      const corridorTargets: [number, number][] = [[m.corridorStill, toStill], [m.unknown, s.unknownRatePerSecond]];
      // A person entering a room usually walks past the door into the silent interior.
      rooms.forEach((rate, index) => { if (rate > 0) corridorTargets.push([m.roomOpen[index], rate * 0.5], [m.roomDeep[index], rate * 0.5]); });
      // As with rooms, a person passing the exit gate usually walks on out of coverage at once.
      if (m.outsideNear >= 0 && gate > 0) corridorTargets.push([m.outsideNear, gate * 0.5], [m.outsideFar, gate * 0.5]);
      move(m.corridorMove, corridorTargets);
      move(m.corridorStill, [[m.corridorMove, still ? 0.05 : 1.0], [m.unknown, s.unknownRatePerSecond / 4]]);
      for (let index = 0; index < m.roomOpen.length; index++) {
        move(m.roomOpen[index], [[m.roomDeep[index], 0.1], [m.corridorMove, s.roomExitRatePerSecond * (reported === "stationary" ? stillFactor : 1)]]);
        move(m.roomDeep[index], [[m.roomOpen[index], s.silentLeakRatePerSecond]]);
      }
      // Every silent explanation leaks into its measurable neighbour at the same rate, so a long
      // silence never changes which silent explanation is preferred; only the entry evidence does.
      move(m.unknown, [[m.corridorMove, s.silentLeakRatePerSecond]]);
      if (m.outsideNear >= 0) {
        move(m.outsideNear, [[m.outsideFar, 0.2], [m.corridorMove, 0.1]]);
        move(m.outsideFar, [[m.outsideNear, s.silentLeakRatePerSecond]]);
      }
      // Negative information: the expected number of solutions that did not arrive.
      for (let i = 0; i < next.length; i++) next[i] *= Math.exp(-rates[i] * dt);
      v.belief = normalize(next);
      from += step;
    }
    v.beliefAt = to;
  }

  private spatial(point: Point): Float64Array {
    const m = this.model!, s = this.settings, config = this.config!, l = new Float64Array(m.states.length);
    let corridor: number;
    if (config.corridors.length) {
      corridor = config.corridors.some(c => pointInPolygon(point, c)) ? 1
        : gauss(Math.min(...config.corridors.map(c => polygonDistance(point, c))), s.corridorSigmaMeters);
    } else {
      const containing = config.regions.filter(r => pointInPolygon(point, r));
      corridor = containing.length ? gauss(Math.min(...containing.map(r => this.edgeDistance(point, r))), s.corridorSigmaMeters) : 1;
    }
    l[m.corridorMove] = corridor; l[m.corridorStill] = corridor;
    l[m.unknown] = 0.15;
    config.regions.forEach((region, index) => {
      const distance = polygonDistance(point, region);
      let value = gauss(distance, s.roomSigmaMeters);
      for (const door of m.doors) if (door.roomIndex === index) {
        value = Math.max(value, s.doorClampWeight * gauss(distanceToSegment(point, door.a, door.b), s.doorClampSigmaMeters));
        value = Math.max(value, this.frontage(point, door));
      }
      l[m.roomOpen[index]] = value; l[m.roomDeep[index]] = value;
    });
    // Bounded room-vs-room influence: in-room samples are NLOS/clamped and often land in the
    // neighbouring room, so one sample may favour one room over another at most 1/floor times.
    // Corridor-vs-room discrimination is untouched (a clear corridor sample stays decisive).
    // Only for an in-room sample and only towards rooms next to it (≤3 m): a corridor sample keeps
    // its full power against every room.
    const containingIndex = config.regions.findIndex(region => pointInPolygon(point, region));
    if (containingIndex < 0 && s.corridorSideFloor > 0) {
      let bestRoom = 0; const near: number[] = [];
      for (const door of m.doors) {
        if (!door.normal) continue;
        const along = Math.abs(-(point.x - door.center.x) * door.normal.y + (point.y - door.center.y) * door.normal.x);
        if (along <= s.corridorSideAlongMeters) { near.push(door.roomIndex); bestRoom = Math.max(bestRoom, l[m.roomOpen[door.roomIndex]]); }
      }
      for (const index of near) {
        const value = Math.max(l[m.roomOpen[index]], s.corridorSideFloor * bestRoom);
        l[m.roomOpen[index]] = value; l[m.roomDeep[index]] = value;
      }
    }
    if (containingIndex < 0 && s.glassWallStripMeters > 0) {
      let strongest = 0;
      for (const door of m.doors) {
        const n = door.normal;
        if (!n) continue;
        const dx = point.x - door.center.x, dy = point.y - door.center.y;
        const across = -(dx * n.x + dy * n.y);
        if (across < -0.3) continue;
        const along = dx * -n.y + dy * n.x;
        const outside = along < door.spanMin ? door.spanMin - along : along > door.spanMax ? along - door.spanMax : 0;
        const w = gauss(Math.max(0, across), s.glassWallStripMeters) * gauss(outside, 0.3);
        if (w <= 1e-3) continue;
        strongest = Math.max(strongest, w);
        const value = Math.max(l[m.roomOpen[door.roomIndex]], s.glassWallRoomWeight * w);
        l[m.roomOpen[door.roomIndex]] = value; l[m.roomDeep[door.roomIndex]] = value;
      }
      const factor = 1 - (1 - s.glassWallCorridorFloor) * strongest;
      l[m.corridorMove] *= factor; l[m.corridorStill] *= factor;
    }
    if (containingIndex >= 0) {
      let bestRoom = 0;
      for (const index of m.roomOpen) bestRoom = Math.max(bestRoom, l[index]);
      const observed = config.regions[containingIndex].id;
      if (this.confusion) {
        // P(observed | true room) relative to the best explanation: the room the sample is in is
        // not automatically the most likely one when the Jetson mirrors that room systematically.
        let top = 0;
        const shares = config.regions.map(region => { const value = this.confusion![region.id]?.[observed]; if (value !== undefined) top = Math.max(top, value); return value; });
        if (top > 0) config.regions.forEach((region, index) => {
          const share = shares[index];
          if (share === undefined) return;
          const value = bestRoom * Math.max(share / top, 0.02);
          l[m.roomOpen[index]] = value; l[m.roomDeep[index]] = value;
        });
      }
      const facing = this.facingRooms()[containingIndex] ?? [];
      if (s.facingRoomLikelihoodFloor > 0) for (const index of facing) {
        const value = Math.max(l[m.roomOpen[index]], s.facingRoomLikelihoodFloor * bestRoom);
        l[m.roomOpen[index]] = value; l[m.roomDeep[index]] = value;
      }
      config.regions.forEach((region, index) => {
        if (polygonDistance(point, region) > 3) return;
        const value = Math.max(l[m.roomOpen[index]], s.roomLikelihoodFloor * bestRoom);
        l[m.roomOpen[index]] = value; l[m.roomDeep[index]] = value;
      });
    }
    if (this.emission) {
      const size = this.emission.cellSize, key = `${Math.floor(point.x / size)},${Math.floor(point.y / size)}`;
      const factor = (place: string) => { const t = this.emission!.places[place]; return t ? t.cells[key] ?? t.rest : 1; };
      const corridorFactor = factor(CORRIDOR);
      l[m.corridorMove] *= corridorFactor; l[m.corridorStill] *= corridorFactor;
      config.regions.forEach((region, index) => { const f = factor(region.id); l[m.roomOpen[index]] *= f; l[m.roomDeep[index]] *= f; });
    }
    if (m.outsideNear >= 0) {
      const outsideArea = m.areas.length > 0 && !m.areas.some(area => inside(point, area));
      const gateDistance = Math.min(...m.gates.map(g => polygonDistance(point, g)));
      const value = outsideArea ? 1 : 0.6 * gauss(gateDistance, s.gateProximitySigmaMeters * 0.7);
      l[m.outsideNear] = value; l[m.outsideFar] = value;
    }
    return l;
  }

  /** The latest accepted sample lies clearly inside the room (≥0.5 m from its walls), not on the door line. */
  private deepInRoom(v: HmmVehicle, roomId: string): boolean {
    const room = this.config!.regions.find(r => r.id === roomId), raw = v.lastRawPosition;
    return !!room && !!raw && !v.lastFlagged && pointInPolygon(raw, room) && this.edgeDistance(raw, room) >= 0.5;
  }

  private facingCache: number[][] | null = null;
  /** Rooms whose door faces this room's door across the corridor (opposite normals, ≤1.5 m apart along the wall). */
  private facingRooms(): number[][] {
    if (this.facingCache) return this.facingCache;
    const m = this.model!, result: number[][] = this.config!.regions.map(() => []);
    for (const a of m.doors) for (const b of m.doors) {
      if (a.roomIndex === b.roomIndex || !a.normal || !b.normal) continue;
      if (a.normal.x * b.normal.x + a.normal.y * b.normal.y > -0.7) continue;
      const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
      const across = Math.abs(dx * a.normal.x + dy * a.normal.y), along = Math.abs(-dx * a.normal.y + dy * a.normal.x);
      if (along <= 1.5 && across <= 6 && !result[a.roomIndex].includes(b.roomIndex)) result[a.roomIndex].push(b.roomIndex);
    }
    return this.facingCache = result;
  }

  /**
   * Field data (12 Oct, 43 real visits): while a tag is in a room the Jetson reports ~60% of its
   * solutions in the corridor, 73% of them inside the room's frontage (the corridor strip in front
   * of the room's wall), often mid-corridor. So a frontage sample is almost as likely from the
   * room as from the corridor; along-wall position separates neighbouring rooms.
   */
  private frontage(point: Point, door: DoorModel): number {
    const n = door.normal, s = this.settings;
    if (!n || s.frontageWeight <= 0) return 0;
    const dx = point.x - door.center.x, dy = point.y - door.center.y;
    const across = -(dx * n.x + dy * n.y); // metres from the room wall into the corridor
    if (across < -0.3) return 0;
    const along = dx * -n.y + dy * n.x;
    const outside = along < door.spanMin ? door.spanMin - along : along > door.spanMax ? along - door.spanMax : 0;
    return s.frontageWeight * gauss(outside, s.frontageAlongSigmaMeters) * gauss(Math.max(0, across), s.frontageAcrossSigmaMeters);
  }

  private edgeDistance(point: Point, region: CompiledRegion): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0, j = region.polygon.length - 1; i < region.polygon.length; j = i++) best = Math.min(best, distanceToSegment(point, region.polygon[j], region.polygon[i]));
    return best;
  }

  private measurementUpdate(v: HmmVehicle, raw: TrackingPosition, flagged: boolean): void {
    const s = this.settings, spatial = this.spatial(raw), rates = this.rates(v, Date.parse(raw.timestamp));
    // A stationary tag repeats one (possibly leaky) location every 10 s: the samples are strongly
    // correlated, so each one may shift the belief only a little and none can flip the place alone.
    const stationary = this.reportedMotion(v, Date.parse(raw.timestamp)) !== null;
    const influence = flagged ? s.spikeMeasurementInfluence : stationary ? Math.min(s.maximumMeasurementInfluence, s.reportedStationaryMeasurementInfluence) : s.maximumMeasurementInfluence;
    const maximum = Math.max(...spatial);
    const b = v.belief;
    for (let i = 0; i < b.length; i++) b[i] *= rates[i] * Math.max(spatial[i], maximum / influence);
    v.belief = normalize(b);
  }

  /** The room a single measurement directly supports (inside it or at its door). */
  private supportedRoom(point: Point): string | null {
    const m = this.model!, config = this.config!;
    const containing = config.regions.find(r => pointInPolygon(point, r));
    if (containing) return containing.id;
    let best: { id: string; d: number } | null = null;
    for (const door of m.doors) {
      const d = distanceToSegment(point, door.a, door.b);
      if (d <= 0.6 && (!best || d < best.d)) best = { id: config.regions[door.roomIndex].id, d };
    }
    return best?.id ?? null;
  }

  private placeProbabilities(v: HmmVehicle): Record<string, number> {
    const m = this.model!, result: Record<string, number> = {};
    m.states.forEach((state, index) => { result[state.place] = (result[state.place] ?? 0) + v.belief[index]; });
    return result;
  }
  private placeProbability(v: HmmVehicle, place: string): number {
    const m = this.model!; let total = 0;
    m.states.forEach((state, index) => { if (state.place === place) total += v.belief[index]; });
    return total;
  }

  // ---------------------------------------------------------------- decision
  private decide(v: HmmVehicle, at: number, extraReasons: string[]): void {
    const s = this.settings, config = this.config!;
    const probabilities = this.placeProbabilities(v);
    v.probabilities = probabilities;
    let best = CORRIDOR, bestP = -1, secondP = 0;
    for (const [place, p] of Object.entries(probabilities)) {
      if (p > bestP) { secondP = Math.max(secondP, bestP); best = place; bestP = p; }
      else secondP = Math.max(secondP, p);
    }
    const previous = v.committed;
    const current = previous ? probabilities[previous] ?? 0 : 0;
    const silenceMs = at - v.lastMeasurementAt;
    // A slow tag (≈1 solution/s) has ordinary corridor gaps of several seconds: scale with its rate.
    const requiredSilenceMs = Math.min(8000, Math.max(s.minimumSilenceForRoomMs, 4500 / Math.max(0.3, v.rateEma)));
    // Entering a room on silence alone needs a real gap; in-room/door data may decide earlier.
    const silentEntryTooEarly = silenceMs < requiredSilenceMs && (
      (isRoomPlace(best) && !isRoomPlace(previous) && v.lastMeasurementRoom !== best)
      || (best === OUTSIDE && previous !== OUTSIDE && !v.lastMeasurementOutsideArea));
    // Field requirement: when the signal is lost the last decision stays on screen; "unknown"
    // is never a place of its own then (silence keeps the room/corridor the tag was last in).
    const keepLast = s.keepLastDecisionOnSignalLoss >= 0.5;
    const fallback = keepLast && previous ? previous : UNKNOWN;
    if (previous === null) v.committed = bestP >= 0.5 && !silentEntryTooEarly && !(keepLast && best === UNKNOWN) ? best : CORRIDOR;
    else if (best !== previous && bestP >= s.enterProbability && !silentEntryTooEarly && !(keepLast && best === UNKNOWN)) v.committed = best;
    // The committed place became implausible but no place is clearly better: an honest
    // "uncertain" (or, with keepLast, the last decision) beats a coin flip between two rooms.
    else if (best !== previous && current < s.releaseProbability && !silentEntryTooEarly) {
      // Rooms jointly dominate after the silence (e.g. two neighbouring doors 2 m apart): the most
      // likely room beats keeping a tag that surely left the corridor on the corridor.
      let roomMass = 0;
      for (const region of config.regions) roomMass += probabilities[region.id] ?? 0;
      const likelyRoom = s.commitMostLikelyRoomOnSilence > 0 && isRoomPlace(best) && !isRoomPlace(previous)
        && roomMass >= s.enterProbability && bestP >= s.commitMostLikelyRoomOnSilence;
      v.committed = (bestP >= 0.45 && bestP >= 1.3 * secondP || likelyRoom) && !(keepLast && best === UNKNOWN) ? best : fallback;
    }
    // Facing-room guard: right after leaving room A, a silent switch to the room across the corridor
    // is a mirror artefact unless that room itself produced a reliable sample; go back to A instead.
    if (s.facingReentryGuardMs > 0 && v.committed !== previous && isRoomPlace(v.committed) && v.lastExit
      && at - v.lastExit.at <= s.facingReentryGuardMs && v.lastMeasurementRoom !== v.committed) {
      const exited = config.regions.findIndex(r => r.id === v.lastExit!.regionId);
      const target = config.regions.findIndex(r => r.id === v.committed);
      if (exited >= 0 && target >= 0 && (this.facingRooms()[exited] ?? []).includes(target)) v.committed = v.lastExit.regionId;
    }
    // Measurement-driven room entries must persist for roomEntryConfirmMs; a few stray samples
    // in front of a door must not flash the tag into the room. Silent entries already waited.
    // Stable mode: once the Jetson reports anchor counts (mirror solutions are filtered), every
    // measured room entry must hold for stableEntryConfirmMs — standing at the door line must not show
    // the room. Without anchor info this would delay too much (in-room 3-anchor points keep arriving).
    const stable = s.stableEntryConfirmMs > 0 && (v.hasAnchorInfo || s.stableEntryRequiresAnchorInfo < 0.5);
    const confirmMs = stable ? s.stableEntryConfirmMs : s.roomEntryConfirmMs;
    if (confirmMs > 0 && previous !== null && v.committed !== previous && isRoomPlace(v.committed) && silenceMs < requiredSilenceMs
      && !(!stable && s.roomEntryConfirmDeepBypass >= 0.5 && this.deepInRoom(v, v.committed!))
      && (stable || s.roomEntryConfirmScope < 0.5 || isRoomPlace(previous) || (v.lastExit !== null && at - v.lastExit.at <= 10_000))) {
      const grace = stable ? s.stableEntryGraceMs : 0;
      if (v.pendingPlace === v.committed) v.pendingLastSeen = at;
      else if (v.pendingPlace === null || at - v.pendingLastSeen > grace) { v.pendingPlace = v.committed; v.pendingSince = at; v.pendingLastSeen = at; }
      if (v.pendingPlace !== v.committed || at - v.pendingSince < confirmMs) v.committed = previous;
    }
    const pendingGrace = stable ? s.stableEntryGraceMs : 0;
    if (v.committed === previous || !isRoomPlace(best) || best !== v.pendingPlace) {
      if (!(isRoomPlace(best) && best === v.pendingPlace)) {
        if (best === previous && !isRoomPlace(best) && pendingGrace <= 0) v.pendingPlace = null;
        else if (v.pendingPlace !== null && at - v.pendingLastSeen > pendingGrace) v.pendingPlace = null;
      }
    }
    // Glass-walled rooms: a tag inside the room near the wall shows up just outside it in the corridor.
    // An exit is published only when it persists or the tag is clearly away from the room.
    if (s.roomExitConfirmMs > 0 && previous !== null && isRoomPlace(previous) && v.committed === CORRIDOR) {
      const room = config.regions.find(r => r.id === previous), raw = v.lastRawPosition;
      const near = !!room && !!raw && polygonDistance(raw, room) <= s.roomExitNearMeters;
      if (near) {
        if (v.exitPendingSince === 0) v.exitPendingSince = at;
        if (at - v.exitPendingSince < s.roomExitConfirmMs) v.committed = previous;
      }
    } else if (v.committed === previous) v.exitPendingSince = 0;
    if (v.committed !== previous) {
      v.exitPendingSince = 0;
      v.pendingPlace = null;
      v.committedSince = at;
      v.transitionFrom = previous && isRoomPlace(previous) && isRoomPlace(v.committed!) ? previous : undefined;
      if (previous && isRoomPlace(previous) && v.committed !== previous) v.lastExit = { regionId: previous, at };
      if (v.committed === OUTSIDE) v.leftAreaAt = at;
    }

    const committed = v.committed!;
    const isRoom = isRoomPlace(committed);
    const age = at - v.lastMeasurementAt;
    const reasons: string[] = [...extraReasons];
    let roomCandidate: { id: string; p: number } | null = null;
    for (const region of config.regions) {
      const p = probabilities[region.id] ?? 0;
      if (region.id !== committed && p >= s.candidateProbability && (!roomCandidate || p > roomCandidate.p)) roomCandidate = { id: region.id, p };
    }
    v.candidateRegionId = roomCandidate?.id ?? null;
    v.entryConfidence = round3(probabilities[committed] ?? 0);
    if (isRoom) {
      const room = config.regions.find(r => r.id === committed)!;
      v.activeRegionId = committed; v.lastKnown = committed;
      const freshMs = this.measuredFreshMs(v, at);
      const measured = v.lastRoomSupport?.roomId === committed && at - v.lastRoomSupport.at <= freshMs;
      if (age > s.inferredRoomMaxAgeMs && !keepLast) { v.state = "LOCATION_LOST"; reasons.push("Çok uzun süre veri yok; oda tahmini belirsize düştü"); }
      else if ((probabilities[CORRIDOR] ?? 0) + (probabilities[OUTSIDE] ?? 0) >= 0.3 && age <= freshMs) { v.state = "EXIT_CANDIDATE"; reasons.push(`${room.name ?? room.id}: çıkış kanıtı birikiyor`); }
      else if (measured) { v.state = "IN_REGION"; reasons.push(`${room.name ?? room.id}: oda içi/kapı ölçümleri ve geçmiş rota odayı destekliyor`); }
      else {
        v.state = "INFERRED_IN_REGION";
        reasons.push(age > freshMs
          ? `${room.name ?? room.id}: tag kapı önünden sonra sustu; veri kesintisi odada olma kanıtı sayıldı`
          : `${room.name ?? room.id}: oda tahmini korunuyor`);
      }
    } else if (committed === OUTSIDE) {
      v.activeRegionId = null; v.state = "TRACKING_OUTSIDE";
      reasons.push("Tag çıkış kapısından alan dışına çıktı");
    } else if (committed === UNKNOWN) {
      v.activeRegionId = null; v.state = "LOCATION_LOST";
      reasons.push("Veri kesildi; kapıya yakın olmadığı için oda tahmini yapılamadı");
    } else {
      v.activeRegionId = null;
      if (age > s.corridorLostAfterMs && !keepLast) { v.state = "LOCATION_LOST"; reasons.push("Koridorda uzun süre veri yok; konum belirsiz"); }
      else if (age > s.signalLostAfterMs && keepLast) { v.state = "TRACKING_OUTSIDE"; reasons.push(`Veri yok (${Math.round(age / 1000)} sn); son karar korunuyor: koridor`); }
      else if (roomCandidate) { v.state = "ENTRY_CANDIDATE"; reasons.push(`Oda adayı: ${roomCandidate.id} (%${Math.round(roomCandidate.p * 100)})`); }
      else { v.state = "TRACKING_OUTSIDE"; reasons.push("Ölçülen koridor konumu"); }
    }
    v.reasons = reasons;
  }

  private describeProbabilities(probabilities: Record<string, number>): string {
    return Object.entries(probabilities).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([place, p]) => `${place} %${Math.round(p * 100)}`).join(", ");
  }

  // ---------------------------------------------------------------- output
  private eventType(v: HmmVehicle): DecisionEventType {
    if (v.traceTrigger === "config_reload") return "CONFIG_RELOADED";
    if (v.activeRegionId && v.transitionFrom && v.transitionFrom !== v.activeRegionId) return "ROOM_TRANSITIONED";
    if (v.lastFlagged && v.traceTrigger === "measurement") return "MEASUREMENT_REJECTED";
    if (v.state === "LOCATION_LOST") return "LOCATION_LOST";
    if (v.state === "ENTRY_CANDIDATE") return "ENTRY_CANDIDATE";
    if (v.state === "EXIT_CANDIDATE") return "EXIT_CANDIDATE";
    if (v.state === "INFERRED_IN_REGION") return "ROOM_INFERRED";
    if (v.state === "IN_REGION" && v.tracePreviousState !== "IN_REGION") return "ROOM_CONFIRMED";
    if (v.state === "TRACKING_OUTSIDE" && ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE"].includes(v.tracePreviousState ?? "")) return "ROOM_EXITED";
    return "MEASUREMENT_ACCEPTED";
  }
  private severity(eventType: DecisionEventType): DecisionSeverity {
    if (eventType === "LOCATION_LOST") return "error";
    if (["MEASUREMENT_REJECTED", "ROOM_INFERRED", "CONFIG_RELOADED"].includes(eventType)) return "warning";
    return "info";
  }
  private reasonCode(message: string): string {
    if (message.includes("Harita değişti")) return "CONFIG_RELOADED";
    if (message.includes("etkisi sınırlandı")) return "SPIKE_DOWNWEIGHTED";
    if (message.includes("alan dışına çıktı")) return "LEFT_AREA_VIA_GATE";
    if (message.includes("veri kesintisi odada olma")) return "ROOM_INFERRED_AFTER_SIGNAL_LOSS";
    if (message.includes("oda tahmini korunuyor")) return "ROOM_RETAINED_DURING_DROPOUT";
    if (message.includes("geçmiş rota odayı destekliyor")) return "ROOM_MEASURED";
    if (message.includes("çıkış kanıtı birikiyor")) return "ROOM_EXIT_EVIDENCE";
    if (message.includes("Oda adayı")) return "ROOM_EVIDENCE_ACCUMULATING";
    if (message.includes("kapıya yakın olmadığı")) return "NO_SUITABLE_DOOR_NEARBY";
    if (message.includes("uzun süre veri yok")) return "LONG_SIGNAL_LOSS";
    if (message.includes("koridor konumu")) return "CORRIDOR_MEASURED";
    return "ENGINE_OBSERVATION";
  }

  private send(v: HmmVehicle, synthetic = false): ProcessedPosition {
    const config = this.config!;
    const region = v.activeRegionId && v.state !== "LOCATION_LOST" ? config.regions.find(r => r.id === v.activeRegionId) : undefined;
    const raw = v.lastRawPosition;
    const kind = v.state === "IN_REGION" || (v.state === "TRACKING_OUTSIDE" && v.committed !== OUTSIDE) ? "measured"
      : v.state === "INFERRED_IN_REGION" || v.state === "EXIT_CANDIDATE" || v.committed === OUTSIDE ? "estimated" : "uncertain";
    const eventType = this.eventType(v);
    const input = v.traceInput ?? raw;
    const transition = eventType === "ROOM_TRANSITIONED" && v.transitionFrom ? {
      transitionId: createHash("sha256").update(JSON.stringify([v.vehicleId, v.transitionFrom, v.activeRegionId, v.committedSince])).digest("hex"),
      fromRegionId: v.transitionFrom, toRegionId: v.activeRegionId!, candidateStartedAt: new Date(v.committedSince).toISOString(),
      effectiveAt: new Date(v.committedSince).toISOString(), confirmedAt: new Date(v.committedSince).toISOString(),
    } : {};
    const trace: DecisionTrace = {
      eventType, severity: this.severity(eventType), ...(v.tracePreviousState ? { previousState: v.tracePreviousState } : {}),
      nextState: v.state, trigger: v.traceTrigger ?? (v.traceInput ? "measurement" : "timer"), ...transition,
      input: { measuredAt: input.timestamp, ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}), x: input.x, y: input.y,
        ...(input.quality !== undefined ? { quality: input.quality } : {}), signalGapMs: Math.max(0, this.now() - Date.parse(input.timestamp)) },
      evidence: { score: { ...EMPTY_SCORE, total: v.entryConfidence },
        lastReliableLocation: { x: raw.x, y: raw.y, measuredAt: raw.timestamp, ...(v.lastMeasurementRoom ? { kind: "room" as const, regionId: v.lastMeasurementRoom } : { kind: "corridor" as const }) } },
      outcome: { ...(region ? { regionId: region.id, ...(region.name ? { regionName: region.name } : {}) } : {}),
        ...(v.candidateRegionId ? { candidateRegionId: v.candidateRegionId } : {}), confidence: v.entryConfidence, measurementKind: kind },
      reasons: [...v.reasons, `Olasılıklar: ${this.describeProbabilities(v.probabilities)}`].map(message => ({ code: this.reasonCode(message), message })),
    };
    const position: ProcessedPosition = {
      ...raw, x: region?.roomCenter.x ?? v.holdPos?.x ?? raw.x, y: region?.roomCenter.y ?? v.holdPos?.y ?? raw.y,
      decisionId: createHash("sha256").update(JSON.stringify([v.vehicleId, raw.timestamp, this.now(), v.state, v.activeRegionId, v.candidateRegionId, config.version])).digest("hex"),
      timestamp: raw.timestamp, publishedAt: new Date(this.now()).toISOString(), synthetic, engineVersion: HMM_ROOM_ENGINE_VERSION,
      configVersion: config.version ?? "unversioned", positionSource: region ? "REGION_CENTER" : "RAW",
      // Held display position for a stationary tag (the true sample stays in decisionTrace.input).
      rawPosition: v.holdPos && !region ? { ...raw, x: v.holdPos.x, y: v.holdPos.y } : raw,
      lastRawDataTimestamp: raw.timestamp, decisionTrace: trace,
      regionInference: { enabled: true, state: v.state, regionId: region?.id ?? null, regionName: region?.name ?? null,
        candidateRegionId: v.candidateRegionId, lastKnownRegionId: v.lastKnown, confidence: v.entryConfidence, reasons: v.reasons,
        measurementKind: kind, ...(v.committed === OUTSIDE ? { outsideArea: true, leftAreaAt: v.leftAreaAt ? new Date(v.leftAreaAt).toISOString() : null } : {}),
        ...(v.lastExit ? { exitedRegionId: v.lastExit.regionId, exitedAt: new Date(v.lastExit.at).toISOString() } : {}),
        ...(this.now() - v.lastRawDataTimestamp > this.settings.signalLostAfterMs ? { signalLost: true } : {}),
        validUntil: new Date(v.lastRawDataTimestamp + this.measuredFreshMs(v, v.lastRawDataTimestamp)).toISOString(),
        uncertainAfter: new Date(v.lastRawDataTimestamp + (region ? this.settings.inferredRoomMaxAgeMs : this.settings.corridorLostAfterMs)).toISOString() },
    };
    v.resolvedPosition = position; v.lastPublishedTimestamp = this.now(); v.transitionFrom = undefined;
    this.publish(position);
    return position;
  }
}

function normalize(values: Float64Array): Float64Array {
  let total = 0;
  for (let i = 0; i < values.length; i++) { if (!(values[i] > 1e-12)) values[i] = 1e-12; total += values[i]; }
  for (let i = 0; i < values.length; i++) values[i] /= total;
  return values;
}
const round3 = (value: number): number => Math.round(value * 1000) / 1000;
