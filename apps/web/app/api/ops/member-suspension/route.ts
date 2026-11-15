import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { signalHostedRuntimeRecheckRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { createHostedPostCommitDeadline, waitForHostedPostCommitOperation } from "@/src/lib/hosted-onboarding/bounded-post-commit";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 2048,
    tooLargeErrorCode: "HOSTED_OPS_MEMBER_SUSPENSION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Member suspension request is too large.",
  });
  const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
  if (memberId.length > 128 || !/^hbm_[A-Za-z0-9_-]+$/u.test(memberId)
    || (body.operation !== "suspend" && body.operation !== "restore")) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_MEMBER_SUSPENSION_INVALID",
      httpStatus: 400,
      message: "Select a member and Suspend or Restore.",
    });
  }

  const suspended = body.operation === "suspend";
  const prisma = getPrisma();
  const changed = await prisma.hostedMember.updateMany({
    where: { id: memberId, threadContainer: { is: null }, suspendedAt: suspended ? null : { not: null } },
    data: { suspendedAt: suspended ? new Date() : null },
  });
  if (changed.count === 0 && !await prisma.hostedMember.findFirst({
    where: { id: memberId, threadContainer: { is: null } },
    select: { id: true },
  })) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_MEMBER_SUSPENSION_NOT_FOUND",
      httpStatus: 404,
      message: "Member not found.",
    });
  }

  // Repeating the operation retries this hint without changing its timestamp.
  // Reconciliation retains authority over already queued or warm work.
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: createHostedPostCommitDeadline(undefined),
      operation: (abortSignal) => signalHostedRuntimeRecheckRuntime({ userId: memberId, abortSignal }),
    });
    return jsonOk({ suspended, runtimeRecheckStatus: "accepted" });
  } catch {
    return jsonOk({ suspended, runtimeRecheckStatus: "pending" }, 202);
  }
});
