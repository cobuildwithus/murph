import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { requireActiveHostedAppSessionFromRequest } from
  "@/src/lib/hosted-onboarding/app-session";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";
import { assertHostedOnboardingMutationOrigin } from
  "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from
  "@/src/lib/hosted-onboarding/entitlement";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  completeHostedInitialOnboardingTx,
  parseHostedInitialOnboardingCompletionRequest,
} from "@/src/lib/hosted-onboarding/initial-onboarding";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from
  "@/src/lib/hosted-onboarding/shared";

const INITIAL_ONBOARDING_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const completion = parseHostedInitialOnboardingCompletionRequest(
    await readHostedOnboardingJsonObject(request, {
      limitBytes: INITIAL_ONBOARDING_BODY_LIMIT_BYTES,
      tooLargeErrorCode: "INITIAL_ONBOARDING_BODY_TOO_LARGE",
      tooLargeErrorMessage: "Initial onboarding request body is too large.",
    }),
  );
  const prisma = getPrisma();
  const result = await prisma.$transaction(
    (tx) => completeHostedInitialOnboardingTx({
      memberId: auth.member.id,
      now: new Date(),
      prisma: tx,
      request: completion,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  if (result.dispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: result.dispatch.mailboxItemId,
    });
  }

  return jsonOk({
    completedNow: result.completedNow,
    preferences: result.preferences,
    status: result.status,
  });
});

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  const deadlineMs = createHostedPostCommitDeadline(undefined);
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs,
      operation: (abortSignal) => signalHostedMailboxAppendRuntime({
        ...input,
        abortSignal,
      }),
    });
  } catch {
    // Completion is durable even when the best-effort runtime wake is unavailable.
  }
}
