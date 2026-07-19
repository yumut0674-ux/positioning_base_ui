import { LocationError, messageForCode } from "../../src/server/location/locationErrors";
import {
  LOCATION_TIMEZONE, type ApiEnvelope, type CurrentLocationData, type LocationAtTimeData,
  type LocationErrorCode, type LocationHistoryData, type SearchEntitiesData,
} from "../../src/server/location/location.types";
import type {
  LocationAtTimeInput, LocationHistoryInput, SearchEntitiesInput,
} from "../../src/server/location/location.validation";

export interface LocationApiClient {
  searchEntities(input: SearchEntitiesInput): Promise<ApiEnvelope<SearchEntitiesData>>;
  getCurrentLocation(entityId: number): Promise<ApiEnvelope<CurrentLocationData>>;
  getLocationAtTime(input: LocationAtTimeInput): Promise<ApiEnvelope<LocationAtTimeData>>;
  getLocationHistory(input: LocationHistoryInput): Promise<ApiEnvelope<LocationHistoryData>>;
}

export interface LocationApiClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const ERROR_CODES = new Set<LocationErrorCode>([
  "VALIDATION_ERROR", "ENTITY_NOT_FOUND", "ENTITY_AMBIGUOUS", "TAG_ASSIGNMENT_NOT_FOUND",
  "LOCATION_NOT_FOUND", "INVALID_DATE_RANGE", "DATE_RANGE_TOO_LARGE", "UPSTREAM_TIMEOUT",
  "UPSTREAM_UNAVAILABLE", "INTERNAL_ERROR",
]);
const DATA_STATUSES = new Set(["complete", "partial", "no_data", "stale", "ambiguous"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorCode(value: unknown): LocationErrorCode | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== "string") return null;
  return ERROR_CODES.has(value.error.code as LocationErrorCode) ? value.error.code as LocationErrorCode : null;
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (!isRecord(value) || !isRecord(value.meta)) return false;
  if (value.meta.timezone !== LOCATION_TIMEZONE || typeof value.meta.generatedAt !== "string") return false;
  if (!Number.isFinite(Date.parse(value.meta.generatedAt))) return false;
  if (typeof value.meta.dataStatus !== "string" || !DATA_STATUSES.has(value.meta.dataStatus)) return false;
  if (!Array.isArray(value.meta.warnings) || !value.meta.warnings.every((warning) => typeof warning === "string")) return false;
  return "data" in value || readErrorCode(value) !== null;
}

function safePositiveInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && (value ?? 0) >= minimum && (value ?? 0) <= maximum ? value! : fallback;
}

export class HttpLocationApiClient implements LocationApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  public constructor(options: LocationApiClientOptions = {}) {
    const configuredUrl = options.baseUrl ?? process.env.UWB_LOCATION_API_BASE_URL ?? "http://127.0.0.1:3000";
    const parsedUrl = new URL(configuredUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new LocationError("VALIDATION_ERROR");
    this.baseUrl = `${parsedUrl.toString().replace(/\/$/, "")}/`;
    this.token = options.token ?? process.env.UWB_LOCATION_API_TOKEN;
    this.timeoutMs = safePositiveInteger(
      options.timeoutMs ?? Number(process.env.UWB_LOCATION_API_TIMEOUT_MS), 5_000, 100, 60_000,
    );
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  private async request<T>(path: string, params: Readonly<Record<string, string | number | undefined>> = {}): Promise<ApiEnvelope<T>> {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        method: "GET",
        headers: { Accept: "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown;
      try { body = JSON.parse(text); }
      catch { throw new LocationError("UPSTREAM_UNAVAILABLE", { retryable: true }); }
      if (!response.ok) {
        const code = readErrorCode(body);
        if (response.status >= 400 && response.status < 500 && code) {
          throw new LocationError(code, { retryable: false });
        }
        throw new LocationError("UPSTREAM_UNAVAILABLE", { retryable: true });
      }
      if (!isEnvelope(body)) throw new LocationError("UPSTREAM_UNAVAILABLE", { retryable: true });
      if ("error" in body) {
        const code = readErrorCode(body) ?? "UPSTREAM_UNAVAILABLE";
        throw new LocationError(code, { retryable: code === "UPSTREAM_TIMEOUT" || code === "UPSTREAM_UNAVAILABLE" });
      }
      return body as ApiEnvelope<T>;
    } catch (error) {
      if (timedOut) throw new LocationError("UPSTREAM_TIMEOUT", { retryable: true });
      if (error instanceof LocationError) throw error;
      throw new LocationError("UPSTREAM_UNAVAILABLE", { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  public searchEntities(input: SearchEntitiesInput): Promise<ApiEnvelope<SearchEntitiesData>> {
    return this.request("api/location/entities/search", { q: input.query, limit: input.limit });
  }

  public getCurrentLocation(entityId: number): Promise<ApiEnvelope<CurrentLocationData>> {
    return this.request(`api/location/entities/${encodeURIComponent(String(entityId))}/current`);
  }

  public getLocationAtTime(input: LocationAtTimeInput): Promise<ApiEnvelope<LocationAtTimeData>> {
    return this.request(`api/location/entities/${encodeURIComponent(String(input.entityId))}/at`, {
      at: input.at, toleranceSeconds: input.toleranceSeconds,
    });
  }

  public getLocationHistory(input: LocationHistoryInput): Promise<ApiEnvelope<LocationHistoryData>> {
    return this.request(`api/location/entities/${encodeURIComponent(String(input.entityId))}/history`, input);
  }
}

export function createLocationApiClientFromEnv(): LocationApiClient {
  return new HttpLocationApiClient();
}

export { messageForCode };
