import { deviceSyncError } from "../errors.ts";
export {
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "../config/junction-config.ts";
export type { JunctionDeviceSyncProviderConfig } from "../config/provider-types.ts";

export function parseJunctionDiagnosticRequestedTimestamp(
  value: string | null | undefined,
  field: "windowEnd" | "windowStart",
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  const timestamp = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  if (timestamp && /^\d{4}-/u.test(timestamp)
    && timestamp >= "0001-01-01T00:00:00.000Z" && timestamp <= "9998-12-31T23:59:59.999Z") {
    return timestamp;
  }

  throw deviceSyncError({
    code: "JUNCTION_DIAGNOSTIC_WINDOW_INVALID",
    message: `Junction diagnostic ${field} must be a valid ISO timestamp.`,
    httpStatus: 400,
    retryable: false,
  });
}
