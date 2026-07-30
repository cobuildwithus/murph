import {
  isHostedAssistantProductModel,
  isHostedAssistantProvider,
  type HostedAssistantProductModel,
  type HostedAssistantProvider,
} from "@murphai/hosted-execution/assistant-model";
import { after } from "next/server";

import { getPrisma } from "@/src/lib/prisma";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  updateHostedMemberAssistantConfigurationTx,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";
import {
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

const ASSISTANT_MODEL_REQUEST_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: ASSISTANT_MODEL_REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "ASSISTANT_MODEL_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Assistant model request body is too large.",
  });
  const configuration = parseAssistantModelRequestBody(body);
  const prisma = getPrisma();
  const result = await prisma.$transaction(
    async (tx) => updateHostedMemberAssistantConfigurationTx({
      memberId: auth.member.id,
      prisma: tx,
      ...(configuration.model === undefined
        ? {}
        : { model: configuration.model }),
      ...(configuration.provider === undefined
        ? {}
        : { provider: configuration.provider }),
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );
  if (result.effectiveProviderUpdated) {
    scheduleHostedProviderChange(auth.member.id);
  }

  return jsonOk({
    dormantSolPreference: result.dormantSolPreference,
    model: result.model,
    ok: true,
    provider: result.provider,
    solAvailable: result.solAvailable,
    updated: result.updated,
  });
});

function parseAssistantModelRequestBody(
  body: Record<string, unknown>,
): {
  model?: HostedAssistantProductModel;
  provider?: HostedAssistantProvider;
} {
  const keys = Object.keys(body);
  if (
    keys.length === 0
    || keys.some((key) => key !== "model" && key !== "provider")
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_INVALID_REQUEST",
      httpStatus: 400,
      message: "Assistant model request must contain a model, a provider, or both.",
    });
  }

  if (
    body.model !== undefined
    && !isHostedAssistantProductModel(body.model)
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_INVALID_MODEL",
      httpStatus: 400,
      message: "Choose a valid assistant model.",
    });
  }
  if (body.provider !== undefined && !isHostedAssistantProvider(body.provider)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_INVALID_PROVIDER",
      httpStatus: 400,
      message: "Choose a valid assistant provider.",
    });
  }

  return {
    ...(body.model === undefined ? {} : { model: body.model }),
    ...(body.provider === undefined ? {} : { provider: body.provider }),
  };
}

function scheduleHostedProviderChange(userId: string): void {
  const task = async () => {
    const deadlineMs = createHostedPostCommitDeadline(undefined);
    try {
      await waitForHostedPostCommitOperation({
        deadlineMs,
        operation: (abortSignal) =>
          signalHostedRuntimeRecheckRuntime({
            abortSignal,
            userId,
          }),
      });
    } catch {
      // The durable preference remains authoritative. A later invocation and
      // the provider-entry gate still revalidate it if this wake is unavailable.
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
