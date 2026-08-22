export const HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION = "RESET EVERYONE";
const HOSTED_OPS_USAGE_RESET_ALL_OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isHostedOpsUsageResetAllOperationId(
  value: unknown,
): value is string {
  return typeof value === "string"
    && HOSTED_OPS_USAGE_RESET_ALL_OPERATION_ID_PATTERN.test(value);
}

export interface HostedOpsMemberUsageResetAllCounts {
  failed: number;
  pendingWake: number;
  processed: number;
  reset: number;
  skipped: number;
  unchanged: number;
}

export interface HostedOpsMemberUsageResetAllFailure {
  code: string;
  memberId: string;
  message: string;
  retryable: boolean;
}

export interface HostedOpsMemberUsageResetAllBatchResponse {
  counts: HostedOpsMemberUsageResetAllCounts;
  done: boolean;
  failure: HostedOpsMemberUsageResetAllFailure | null;
  lastAcknowledgedCursor: string | null;
}

export interface HostedOpsMemberUsageResetAllWakeBatchResponse {
  attempted: number;
  done: boolean;
  lastAcknowledgedCursor: string | null;
  pendingWake: number;
}
