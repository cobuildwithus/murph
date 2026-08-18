import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  HostedOpsMemberUsageResetNotFoundError,
  HostedOpsMemberUsageResetNoticeInFlightError,
  HostedOpsMemberUsageResetStaleError,
  resetHostedOpsMemberUsage,
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
  const memberId = readMemberId(body.memberId);

  if (body.operation === "runtime_recheck") {
    const runtimeRecheckStatus = await trySignalHostedRuntimeRecheck(memberId);
    return jsonOk({
      memberId,
      runtimeRecheckStatus,
    }, runtimeRecheckStatus === "accepted" ? 200 : 202);
  }

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
    if (error instanceof HostedOpsMemberUsageResetNotFoundError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_USAGE_RESET_NOT_FOUND",
        httpStatus: 404,
        message: error.message,
        retryable: false,
      });
    }
    if (error instanceof HostedOpsMemberUsageResetStaleError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_USAGE_RESET_STALE",
        httpStatus: 409,
        message: error.message,
        retryable: false,
      });
    }
    if (error instanceof HostedOpsMemberUsageResetNoticeInFlightError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_USAGE_RESET_NOTICE_IN_FLIGHT",
        details: { retryAt: error.retryAt.toISOString() },
        httpStatus: 409,
        message: error.message,
        retryable: true,
      });
    }
    throw error;
  }
});

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
