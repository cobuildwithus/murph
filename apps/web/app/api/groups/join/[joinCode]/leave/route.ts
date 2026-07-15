import { leaveHostedGroupMemberTx } from "@/src/lib/hosted-groups/group-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ joinCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const joinCode = await resolveDecodedRouteParam(context.params, "joinCode");

  const prisma = getPrisma();
  const result = await prisma.$transaction(
    async (tx) => leaveHostedGroupMemberTx({
      joinCode,
      memberId: auth.member.id,
      now: new Date(),
      tx,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  if (result.kind === "group_not_found") {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_LINK_NOT_FOUND",
      httpStatus: 404,
      message: "This group link is no longer valid.",
    });
  }
  if (result.kind === "owner_cannot_leave") {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_OWNER_CANNOT_LEAVE",
      httpStatus: 409,
      message: "The group owner cannot leave this group.",
    });
  }

  await signalVaultShareCleanupRuntimesBestEffort({
    requestSignal: request.signal,
    signals: result.vaultShareCleanupSignals,
  });

  return jsonOk({ ok: true, status: result.kind });
});

async function signalVaultShareCleanupRuntimesBestEffort(input: {
  requestSignal?: AbortSignal;
  signals: readonly { mailboxItemId: string; memberId: string }[];
}): Promise<void> {
  const deadlineMs = createHostedPostCommitDeadline(undefined);
  await Promise.all(input.signals.map(async (signal) => {
    try {
      await waitForHostedPostCommitOperation({
        deadlineMs,
        operation: (abortSignal) => signalHostedMailboxAppendRuntime({
          abortSignal,
          expectedUserId: signal.memberId,
          mailboxItemId: signal.mailboxItemId,
        }),
        signal: input.requestSignal,
      });
    } catch {
      // Revocation and durable cleanup work already committed transactionally.
    }
  }));
}
