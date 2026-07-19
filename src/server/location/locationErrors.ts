import { errorEnvelope, type ErrorEnvelope, type LocationErrorCode } from "./location.types";

const DEFAULT_MESSAGES: Readonly<Record<LocationErrorCode, string>> = {
  VALIDATION_ERROR: "İstek doğrulanamadı.",
  ENTITY_NOT_FOUND: "İstenen varlık bulunamadı.",
  ENTITY_AMBIGUOUS: "İstek birden fazla varlıkla eşleşti.",
  TAG_ASSIGNMENT_NOT_FOUND: "İstenen zaman için tag ataması bulunamadı.",
  LOCATION_NOT_FOUND: "Konum kaydı bulunamadı.",
  INVALID_DATE_RANGE: "Başlangıç tarihi bitiş tarihinden önce olmalıdır.",
  DATE_RANGE_TOO_LARGE: "İstenen tarih aralığı izin verilen sınırı aşıyor.",
  UPSTREAM_TIMEOUT: "Konum servisi zaman aşımına uğradı.",
  UPSTREAM_UNAVAILABLE: "Konum servisine şu anda erişilemiyor.",
  INTERNAL_ERROR: "İstek işlenirken beklenmeyen bir hata oluştu.",
};

const HTTP_STATUS: Readonly<Record<LocationErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  ENTITY_NOT_FOUND: 404,
  ENTITY_AMBIGUOUS: 409,
  TAG_ASSIGNMENT_NOT_FOUND: 404,
  LOCATION_NOT_FOUND: 404,
  INVALID_DATE_RANGE: 400,
  DATE_RANGE_TOO_LARGE: 400,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class LocationError extends Error {
  public readonly code: LocationErrorCode;
  public readonly retryable: boolean;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: LocationErrorCode,
    options: { readonly retryable?: boolean; readonly details?: Readonly<Record<string, unknown>> } = {},
  ) {
    super(DEFAULT_MESSAGES[code]);
    this.name = "LocationError";
    this.code = code;
    this.retryable = options.retryable ?? (code === "UPSTREAM_TIMEOUT" || code === "UPSTREAM_UNAVAILABLE");
    this.details = options.details ?? {};
  }
}

export function toSafeLocationError(error: unknown): LocationError {
  return error instanceof LocationError ? error : new LocationError("INTERNAL_ERROR");
}

export function toErrorEnvelope(error: unknown, now?: () => Date): ErrorEnvelope {
  const safe = toSafeLocationError(error);
  return errorEnvelope(safe.code, DEFAULT_MESSAGES[safe.code], safe.retryable, safe.details, now);
}

export function statusForError(error: unknown): number {
  return HTTP_STATUS[toSafeLocationError(error).code];
}

export function messageForCode(code: LocationErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
