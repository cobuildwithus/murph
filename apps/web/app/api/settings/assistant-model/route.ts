import {
  isHostedAssistantProductModel,
  type HostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";

import { getPrisma } from "@/src/lib/prisma";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  updateHostedMemberAssistantModelPreferenceTx,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
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
  const model = parseAssistantModelRequestBody(body);
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => (
    updateHostedMemberAssistantModelPreferenceTx({
      memberId: auth.member.id,
      model,
      prisma: tx,
    })
  ), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return jsonOk({
    dormantSolPreference: result.dormantSolPreference,
    model: result.model,
    ok: true,
    solAvailable: result.solAvailable,
    updated: result.updated,
  });
});

function parseAssistantModelRequestBody(
  body: Record<string, unknown>,
): HostedAssistantProductModel {
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "model") {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_INVALID_REQUEST",
      httpStatus: 400,
      message: "Assistant model request must contain only a model.",
    });
  }

  if (!isHostedAssistantProductModel(body.model)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_MODEL_INVALID_MODEL",
      httpStatus: 400,
      message: "Choose a valid assistant model.",
    });
  }

  return body.model;
}
