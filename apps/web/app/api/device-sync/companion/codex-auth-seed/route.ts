import {
  beginHostedCodexAuthAccessSeedAttempt,
  disconnectHostedCodexAuthAccessSeed,
  markHostedCodexAuthAccessSeedDisconnected,
  markHostedCodexAuthAccessSeedReady,
  markHostedCodexAuthAttemptError,
  readHostedCodexAuthCompanionView,
} from "@/src/lib/codex-auth/store";
import {
  parseHostedCodexAuthAccessSeedSubmission,
} from "@/src/lib/codex-auth/access-seed";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { signalHostedRuntimeRecheckRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { hostedOnboardingError, isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedOnboardingJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_CODEX_AUTH_ACCESS_SEED_BODY_LIMIT_BYTES = 16 * 1_024;
const HOSTED_CODEX_AUTH_ACCESS_SEED_FEATURE_FLAG =
  "MURPH_COMPANION_CHATGPT_AUTH_ENABLED";

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });

  return jsonOk(await readHostedCodexAuthCompanionView({
    memberId: auth.member.id,
    prisma,
  }));
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedCodexAuthAccessSeedFeatureEnabled();

  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const now = new Date();
  const seed = parseHostedCodexAuthAccessSeedSubmission(
    await readHostedCodexAuthAccessSeedBody(request),
    now,
  );
  const attempt = await beginHostedCodexAuthAccessSeedAttempt({
    memberId: auth.member.id,
    prisma,
    seed,
  });

  try {
    await signalHostedRuntimeRecheckRuntime({
      prisma,
      userId: auth.member.id,
    });
  } catch {
    await markHostedCodexAuthAttemptError({
      attemptId: attempt.attemptId,
      memberId: auth.member.id,
      prisma,
    });
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE",
      httpStatus: 503,
      message: "Could not connect ChatGPT right now.",
      retryable: true,
    });
  }

  const view = await markHostedCodexAuthAccessSeedReady({
    attemptId: attempt.attemptId,
    memberId: auth.member.id,
    prisma,
  });
  if (view?.connectionVersion !== attempt.attemptId || view.state !== "connected") {
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_ACCESS_SEED_SUPERSEDED",
      httpStatus: 409,
      message: "ChatGPT connection changed while it was being saved.",
      retryable: true,
    });
  }
  return jsonOk(view, 202);
});

export const DELETE = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma);
  await assertEmptyHostedCodexAuthAccessSeedRequest(request);
  const attempt = await disconnectHostedCodexAuthAccessSeed({
    memberId: auth.member.id,
    prisma,
  });

  try {
    await signalHostedRuntimeRecheckRuntime({
      prisma,
      userId: auth.member.id,
    });
  } catch (error) {
    if (!isExpectedInactiveRuntimeRecheck(error)) {
      throw hostedOnboardingError({
        code: "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE",
        httpStatus: 503,
        message: "ChatGPT access was removed, but Murph could not refresh the runtime right now.",
        retryable: true,
      });
    }
  }

  const view = await markHostedCodexAuthAccessSeedDisconnected({
    attemptId: attempt.attemptId,
    memberId: auth.member.id,
    prisma,
  });
  if (view?.connectionVersion !== attempt.attemptId || view.state !== "off") {
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_DISCONNECT_SUPERSEDED",
      httpStatus: 409,
      message: "ChatGPT connection changed while it was being removed.",
      retryable: true,
    });
  }
  return jsonOk(view, 202);
});

function assertHostedCodexAuthAccessSeedFeatureEnabled(): void {
  if (process.env[HOSTED_CODEX_AUTH_ACCESS_SEED_FEATURE_FLAG] !== "1") {
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_ACCESS_SEED_DISABLED",
      httpStatus: 404,
      message: "ChatGPT connection is not available.",
    });
  }
}

async function readHostedCodexAuthAccessSeedBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    return await readHostedOnboardingJsonObject(request, {
      limitBytes: HOSTED_CODEX_AUTH_ACCESS_SEED_BODY_LIMIT_BYTES,
      tooLargeErrorCode: "HOSTED_CODEX_AUTH_ACCESS_SEED_BODY_TOO_LARGE",
      tooLargeErrorMessage: "ChatGPT credential request body is too large.",
    });
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw hostedOnboardingError({
        code: "HOSTED_CODEX_AUTH_ACCESS_SEED_INVALID",
        httpStatus: 400,
        message: "ChatGPT credential is invalid.",
      });
    }
    throw error;
  }
}

async function assertEmptyHostedCodexAuthAccessSeedRequest(request: Request): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readOptionalJsonObject(request, {
      limitBytes: HOSTED_CODEX_AUTH_ACCESS_SEED_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "HOSTED_CODEX_AUTH_ACCESS_SEED_BODY_TOO_LARGE",
        httpStatus: 413,
        message: "ChatGPT credential request body is too large.",
      });
    }
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw hostedOnboardingError({
        code: "HOSTED_CODEX_AUTH_ACCESS_SEED_INVALID",
        httpStatus: 400,
        message: "ChatGPT disconnect request is invalid.",
      });
    }
    throw error;
  }
  if (Object.keys(body).length !== 0) {
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_ACCESS_SEED_INVALID",
      httpStatus: 400,
      message: "ChatGPT disconnect request must be empty.",
    });
  }
}

function isExpectedInactiveRuntimeRecheck(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.code === "HOSTED_RUNTIME_USER_INACTIVE"
    && !error.retryable;
}
