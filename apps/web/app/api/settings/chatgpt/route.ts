import {
  beginHostedCodexAuthAttempt,
  markHostedCodexAuthAttemptError,
  readHostedCodexAuthConnectionView,
} from "@/src/lib/codex-auth/store";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  requireActiveHostedAppSessionFromRequest,
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_CODEX_AUTH_REQUEST_BODY_LIMIT_BYTES = 1_024;

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireHostedAppSessionFromRequest(request);
  return jsonOk(await readHostedCodexAuthConnectionView({
    memberId: auth.member.id,
  }));
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await assertEmptyHostedCodexAuthRequest(request);
  const prisma = getPrisma();
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const attempt = await beginHostedCodexAuthAttempt({
    action: "connect",
    memberId: auth.member.id,
    prisma,
  });
  await signalHostedCodexAuthAttempt({
    action: "connect",
    attemptId: attempt.attemptId,
    mailboxItemId: attempt.mailboxItemId,
    memberId: auth.member.id,
  });
  return jsonOk(attempt.view);
});

export const DELETE = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await assertEmptyHostedCodexAuthRequest(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const attempt = await beginHostedCodexAuthAttempt({
    action: "disconnect",
    memberId: auth.member.id,
  });
  await signalHostedCodexAuthAttempt({
    action: "disconnect",
    attemptId: attempt.attemptId,
    mailboxItemId: attempt.mailboxItemId,
    memberId: auth.member.id,
  });
  return jsonOk(attempt.view);
});

async function signalHostedCodexAuthAttempt(input: {
  action: "connect" | "disconnect";
  attemptId: string | null;
  mailboxItemId: string | null;
  memberId: string;
}): Promise<void> {
  if (!input.attemptId || !input.mailboxItemId) {
    return;
  }

  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.memberId,
      mailboxItemId: input.mailboxItemId,
    });
  } catch {
    await markHostedCodexAuthAttemptError({
      attemptId: input.attemptId,
      memberId: input.memberId,
    });
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE",
      httpStatus: 503,
      message: input.action === "disconnect"
        ? "Could not disconnect ChatGPT right now."
        : "Could not start ChatGPT connection right now.",
      retryable: true,
    });
  }
}

async function assertEmptyHostedCodexAuthRequest(request: Request): Promise<void> {
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_CODEX_AUTH_REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_CODEX_AUTH_BODY_TOO_LARGE",
    tooLargeErrorMessage: "ChatGPT connection request body is too large.",
  });
  if (Object.keys(body).length > 0) {
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_INVALID_REQUEST",
      httpStatus: 400,
      message: "ChatGPT connection request must be empty.",
    });
  }
}
