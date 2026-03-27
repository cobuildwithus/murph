export interface DeviceSyncErrorOptions {
  code: string;
  message: string;
  retryable?: boolean;
  httpStatus?: number;
  accountStatus?: "reauthorization_required" | "disconnected" | null;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class DeviceSyncError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly accountStatus: "reauthorization_required" | "disconnected" | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: DeviceSyncErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DeviceSyncError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? 500;
    this.accountStatus = options.accountStatus ?? null;
    this.details = options.details;
  }
}

export function deviceSyncError(options: DeviceSyncErrorOptions): DeviceSyncError {
  return new DeviceSyncError(options);
}

export function isDeviceSyncError(error: unknown): error is DeviceSyncError {
  return error instanceof DeviceSyncError;
}

export function formatDeviceSyncStartupError(error: unknown): string {
  if (isDeviceSyncError(error)) {
    return `${error.name} ${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
