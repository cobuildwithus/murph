import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
  isHostedOpsUsageResetAllOperationId,
  type HostedOpsMemberUsageResetAllBatchResponse,
  type HostedOpsMemberUsageResetAllCounts,
  type HostedOpsMemberUsageResetAllFailure,
  type HostedOpsMemberUsageResetAllWakeBatchResponse,
} from "@/src/lib/hosted-ops/member-usage-contract";
import {
  HostedOpsMemberUsageResetNotFoundError,
  HostedOpsMemberUsageResetNoticeInFlightError,
  HostedOpsMemberUsageResetStaleError,
  readHostedOpsMemberUsageResetAllBatch,
  readHostedOpsMemberUsageResetAllWakeBatch,
  resetHostedOpsMemberUsage,
  resetHostedOpsMemberUsageForResetAll,
} from "@/src/lib/hosted-ops/member-usage";
import {
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const REQUEST_BODY_LIMIT_BYTES = 2 * 1024;
const MEMBER_ID_MAX_LENGTH = 128;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_USAGE_RESET_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops usage reset request body is too large.",
  });

  if (body.operation === "runtime_recheck") {
    const memberId = readMemberId(body.memberId);
    const runtimeRecheckStatus = await trySignalHostedRuntimeRecheck(memberId);
    return jsonOk({
      memberId,
      runtimeRecheckStatus,
    }, runtimeRecheckStatus === "accepted" ? 200 : 202);
  }

  if (body.operation === "reset_all_batch") {
    readResetAllConfirmation(body.confirmation);
    return jsonOk(await resetEveryoneBatch({
      afterMemberId: readOptionalMemberId(body.afterMemberId),
      operationId: readResetAllOperationId(body.operationId),
    }));
  }

  if (body.operation === "recover_reset_all_wakes") {
    readResetAllConfirmation(body.confirmation);
    return jsonOk(await recoverResetEveryoneWakes({
      afterMemberId: readOptionalMemberId(body.afterMemberId),
      operationId: readResetAllOperationId(body.operationId),
    }));
  }

  const memberId = readMemberId(body.memberId);
  try {
    const result = await resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: readIsoDate(
        body.expectedPeriodUpdatedAt,
        "HOSTED_OPS_USAGE_RESET_EXPECTED_UPDATE_INVALID",
        "Refresh the usage table before resetting this row.",
      ),
      expectedUsageCreditLedgerVersion: readLedgerVersion(
        body.expectedUsageCreditLedgerVersion,
      ),
      memberId,
      periodStart: readIsoDate(
        body.periodStart,
        "HOSTED_OPS_USAGE_RESET_PERIOD_INVALID",
        "Refresh the usage table before resetting this row.",
      ),
    });

    const runtimeRecheckStatus = await trySignalHostedRuntimeRecheck(
      result.memberId,
      result.resetAt,
    );
    if (runtimeRecheckStatus === "pending") {
      return jsonOk({
        ...result,
        runtimeRecheckStatus: "pending",
      }, 202);
    }

    console.info("Hosted ops usage reset completed.", {
      noticeClaimReleased: result.noticeClaimReleased,
      outcome: result.outcome,
      resetMode: result.resetMode,
      runtimeRecheckStatus: "accepted",
      timestamp: result.resetAt,
      usageCreditGrantedUsdMicros: result.usageCreditGrantedUsdMicros,
    });
    return jsonOk({
      ...result,
      runtimeRecheckStatus: "accepted",
    });
  } catch (error) {
    throw mapSingleResetError(error);
  }
});

async function resetEveryoneBatch(input: {
  afterMemberId: string | null;
  operationId: string;
}): Promise<HostedOpsMemberUsageResetAllBatchResponse> {
  const batch = await readHostedOpsMemberUsageResetAllBatch({
    afterMemberId: input.afterMemberId,
  });
  const counts: HostedOpsMemberUsageResetAllCounts = {
    failed: 0,
    pendingWake: 0,
    processed: 0,
    reset: 0,
    skipped: 0,
    unchanged: 0,
  };
  let failure: HostedOpsMemberUsageResetAllFailure | null = null;
  let lastAcknowledgedCursor = input.afterMemberId;

  for (const memberId of batch.memberIds) {
    try {
      const result = await resetHostedOpsMemberUsageForResetAll({
        memberId,
        operationId: input.operationId,
      });
      counts.processed += 1;
      counts[result.outcome] += 1;
      lastAcknowledgedCursor = memberId;
      if (result.runtimeRecheckRequired) {
        const runtimeRecheckStatus = await trySignalHostedRuntimeRecheck(
          result.memberId,
          result.timestamp,
        );
        if (runtimeRecheckStatus === "pending") {
          counts.pendingWake += 1;
        }
      }
    } catch (error) {
      counts.failed += 1;
      failure = mapResetAllFailure(error, memberId);
      break;
    }
  }

  const done = failure === null && !batch.hasMore;
  const response = {
    counts,
    done,
    failure,
    lastAcknowledgedCursor,
  } satisfies HostedOpsMemberUsageResetAllBatchResponse;
  console.info("Hosted ops reset-everyone batch completed.", {
    counts,
    done,
    stoppedOnFailure: failure !== null,
  });
  return response;
}

async function recoverResetEveryoneWakes(input: {
  afterMemberId: string | null;
  operationId: string;
}): Promise<HostedOpsMemberUsageResetAllWakeBatchResponse> {
  const batch = await readHostedOpsMemberUsageResetAllWakeBatch({
    afterMemberId: input.afterMemberId,
    operationId: input.operationId,
  });
  let lastAcknowledgedCursor = input.afterMemberId;
  let pendingWake = 0;

  for (const receipt of batch.receipts) {
    const runtimeRecheckStatus = await trySignalHostedRuntimeRecheck(
      receipt.memberId,
      receipt.timestamp,
    );
    if (runtimeRecheckStatus === "pending") {
      pendingWake += 1;
    }
    lastAcknowledgedCursor = receipt.memberId;
  }

  const response = {
    attempted: batch.receipts.length,
    done: !batch.hasMore,
    lastAcknowledgedCursor,
    pendingWake,
  } satisfies HostedOpsMemberUsageResetAllWakeBatchResponse;
  console.info("Hosted ops reset-everyone wake batch completed.", {
    attempted: response.attempted,
    done: response.done,
    pendingWake: response.pendingWake,
  });
  return response;
}

async function trySignalHostedRuntimeRecheck(
  memberId: string,
  timestamp = new Date().toISOString(),
): Promise<"accepted" | "pending"> {
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: createHostedPostCommitDeadline(undefined),
      operation: (abortSignal) => signalHostedRuntimeRecheckRuntime({
        abortSignal,
        userId: memberId,
      }),
    });
    return "accepted";
  } catch (error) {
    console.error("Hosted ops runtime recheck failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      timestamp,
    });
    return "pending";
  }
}

function mapSingleResetError(error: unknown): Error {
  if (error instanceof HostedOpsMemberUsageResetNotFoundError) {
    return hostedOnboardingError({
      code: "HOSTED_OPS_USAGE_RESET_NOT_FOUND",
      httpStatus: 404,
      message: error.message,
      retryable: false,
    });
  }
  if (error instanceof HostedOpsMemberUsageResetStaleError) {
    return hostedOnboardingError({
      code: "HOSTED_OPS_USAGE_RESET_STALE",
      httpStatus: 409,
      message: error.message,
      retryable: false,
    });
  }
  if (error instanceof HostedOpsMemberUsageResetNoticeInFlightError) {
    return hostedOnboardingError({
      code: "HOSTED_OPS_USAGE_RESET_NOTICE_IN_FLIGHT",
      details: { retryAt: error.retryAt.toISOString() },
      httpStatus: 409,
      message: error.message,
      retryable: true,
    });
  }
  return error instanceof Error ? error : new Error("Hosted ops usage reset failed.");
}

function mapResetAllFailure(
  error: unknown,
  memberId: string,
): HostedOpsMemberUsageResetAllFailure {
  if (error instanceof HostedOpsMemberUsageResetNoticeInFlightError) {
    return {
      code: "HOSTED_OPS_USAGE_RESET_NOTICE_IN_FLIGHT",
      memberId,
      message:
        "A usage-limit notice is currently being sent. Retry from the last acknowledged member after that dispatch settles.",
      retryable: true,
    };
  }
  if (error instanceof HostedOpsMemberUsageResetStaleError) {
    return {
      code: "HOSTED_OPS_USAGE_RESET_STALE",
      memberId,
      message:
        "Usage changed while this batch was processing. Retry from the last acknowledged member.",
      retryable: true,
    };
  }
  if (error instanceof HostedOpsMemberUsageResetNotFoundError) {
    return {
      code: "HOSTED_OPS_USAGE_RESET_NOT_FOUND",
      memberId,
      message:
        "The member changed while this batch was processing. Retry from the last acknowledged member.",
      retryable: true,
    };
  }
  return {
    code: "HOSTED_OPS_USAGE_RESET_ALL_FAILED",
    memberId,
    message:
      "This batch stopped before the next member was acknowledged. Resume from the last acknowledged cursor.",
    retryable: true,
  };
}

function readResetAllConfirmation(value: unknown): void {
  if (value === HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION_INVALID",
    httpStatus: 400,
    message: `Type ${HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION} to continue.`,
    retryable: false,
  });
}

function readResetAllOperationId(value: unknown): string {
  if (isHostedOpsUsageResetAllOperationId(value)) {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_USAGE_RESET_ALL_OPERATION_ID_INVALID",
    httpStatus: 400,
    message: "Restart Reset everyone from the confirmation dialog.",
    retryable: false,
  });
}

function readOptionalMemberId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readMemberId(value);
}

function readMemberId(value: unknown): string {
  const memberId = typeof value === "string" ? value.trim() : "";
  if (
    memberId.length > 0
    && memberId.length <= MEMBER_ID_MAX_LENGTH
    && /^hbm_[A-Za-z0-9_-]+$/u.test(memberId)
  ) {
    return memberId;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_USAGE_RESET_MEMBER_ID_INVALID",
    httpStatus: 400,
    message: "Select a valid hosted member or container.",
    retryable: false,
  });
}

function readIsoDate(
  value: unknown,
  code: string,
  message: string,
): Date {
  if (typeof value === "string" && value.length <= 64) {
    const date = new Date(value);
    if (
      Number.isFinite(date.getTime())
      && date.toISOString() === value
    ) {
      return date;
    }
  }
  throw hostedOnboardingError({
    code,
    httpStatus: 400,
    message,
    retryable: false,
  });
}

function readLedgerVersion(value: unknown): bigint {
  if (typeof value === "string" && /^[0-9]{1,30}$/u.test(value)) {
    return BigInt(value);
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_USAGE_RESET_LEDGER_VERSION_INVALID",
    httpStatus: 400,
    message: "Refresh the usage table before resetting this row.",
    retryable: false,
  });
}
