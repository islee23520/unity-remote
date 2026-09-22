export class UnityRemoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "UnityRemoteError";
  }

  toJSON(): { error: { code: string; message: string; details: Record<string, unknown>; statusCode: number } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        statusCode: this.statusCode
      }
    };
  }
}

export function errorFromUnknown(error: unknown): UnityRemoteError {
  if (error instanceof UnityRemoteError) {
    return error;
  }
  return new UnityRemoteError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}

const STATUS_BY_CODE: Record<string, number> = {
  OBJECT_NOT_FOUND: 404,
  PROPERTY_NOT_FOUND: 404,
  COMPONENT_NOT_FOUND: 404,
  SCENE_NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  PROJECT_MISMATCH: 409,
  UNITY_REPLACED: 409,
  PROPERTY_NOT_EDITABLE: 422,
  SCENE_NOT_SAVED: 422,
  INVALID_OBJECT_ID: 400,
  INVALID_REQUEST: 400,
  INVALID_REVISION: 400,
  INVALID_VALUE: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN_HOST: 403,
  FORBIDDEN_ORIGIN: 403,
  DISCONNECTED: 503,
  BROKER_UNAVAILABLE: 503,
  UNITY_TIMEOUT: 504,
  INVALID_UNITY_PAYLOAD: 502,
  UNITY_ERROR: 502,
  INTERNAL_ERROR: 500
};

export function statusForCode(code: string, statusCode?: number): number {
  if (statusCode !== undefined && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
    return statusCode;
  }
  return STATUS_BY_CODE[code] ?? 500;
}
