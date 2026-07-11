import {
  readHostedExecutionControlClientIfConfigured,
} from "../hosted-execution/control";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export async function assertHostedLinqPersonalRuntimesIdle(
  memberIds: readonly string[],
): Promise<void> {
  const uniqueMemberIds = [...new Set(
    memberIds.map((memberId) => memberId.trim()).filter(Boolean),
  )];
  if (uniqueMemberIds.length === 0) {
    return;
  }

  const client = readHostedExecutionControlClientIfConfigured();
  if (!client) {
    throwHostedLinqGroupRuntimeStatusUnavailable();
  }

  for (const memberId of uniqueMemberIds) {
    let status: Awaited<ReturnType<typeof client.getRunnerStatus>>;
    try {
      status = await client.getRunnerStatus(memberId);
    } catch (error) {
      throw hostedOnboardingError({
        cause: error,
        code: "HOSTED_LINQ_GROUP_RUNTIME_STATUS_UNAVAILABLE",
        httpStatus: 503,
        message: "Personal runtime status is unavailable during Linq group isolation.",
        retryable: true,
      });
    }

    if (status.userId !== memberId) {
      throwHostedLinqGroupRuntimeStatusUnavailable();
    }
    if (status.inFlight) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_GROUP_PERSONAL_RUNTIME_IN_FLIGHT",
        httpStatus: 409,
        message: "Personal runtime is still processing this Linq chat transition.",
        retryable: true,
      });
    }
  }
}

function throwHostedLinqGroupRuntimeStatusUnavailable(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_GROUP_RUNTIME_STATUS_UNAVAILABLE",
    httpStatus: 503,
    message: "Personal runtime status is unavailable during Linq group isolation.",
    retryable: true,
  });
}
