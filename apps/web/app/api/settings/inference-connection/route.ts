import {
  requireHostedInferenceRevision,
} from "@murphai/hosted-execution/assistant-inference";

import {
  parseHostedInferenceConnectionCandidate,
} from "@/src/lib/hosted-inference/connection-policy";
import {
  deleteHostedInferenceConnection,
  readHostedInferenceConnectionView,
  replaceHostedInferenceConnection,
  requirePersonalHostedInferenceMember,
} from "@/src/lib/hosted-inference/connection-store";
import {
  requireHostedCustomInferenceEnabled,
  requireHostedInferenceProtocolEnabled,
} from "@/src/lib/hosted-inference/feature";
import {
  mapHostedInferenceConnectionError,
} from "@/src/lib/hosted-inference/route-helpers";
import {
  scheduleHostedInferenceRuntimeWake,
} from "@/src/lib/hosted-inference/runtime-wake";
import {
  verifyHostedInferenceConnectionCandidate,
} from "@/src/lib/hosted-inference/verification-client";
import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedOnboardingMutationOrigin,
} from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_INFERENCE_CONNECTION_BODY_LIMIT_BYTES = 16 * 1024;

export const GET = withJsonError(async (request: Request) => {
  requireHostedCustomInferenceEnabled();
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  try {
    return jsonOk({
      connection: await readHostedInferenceConnectionView({
        memberId: auth.member.id,
      }),
    });
  } catch (error) {
    throw mapHostedInferenceConnectionError(error);
  }
});

export const PUT = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  requireHostedCustomInferenceEnabled();
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readBody(request);
  requireExactKeys(body, [
    "auth",
    "contextWindowTokens",
    "endpointUrl",
    "expectedRevision",
    "model",
    "protocol",
    "supportsImages",
  ]);
  const expectedRevision = parseExpectedRevision(body.expectedRevision, true);
  const candidate = parseHostedInferenceConnectionCandidate({
    auth: body.auth,
    contextWindowTokens: body.contextWindowTokens,
    endpointUrl: body.endpointUrl,
    model: body.model,
    protocol: body.protocol,
    supportsImages: body.supportsImages,
  });
  requireHostedInferenceProtocolEnabled(candidate.protocol);
  const prisma = getPrisma();

  try {
    await requirePersonalHostedInferenceMember({
      memberId: auth.member.id,
      prisma,
    });
    await verifyHostedInferenceConnectionCandidate({
      candidate,
      memberId: auth.member.id,
    });
    const connection = await replaceHostedInferenceConnection({
      candidate,
      expectedRevision,
      memberId: auth.member.id,
      prisma,
    });
    scheduleHostedInferenceRuntimeWake(auth.member.id);
    return jsonOk({ connection });
  } catch (error) {
    throw mapHostedInferenceConnectionError(error);
  }
});

export const DELETE = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  requireHostedCustomInferenceEnabled();
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readBody(request);
  requireExactKeys(body, ["expectedRevision"]);
  const expectedRevision = parseExpectedRevision(
    body.expectedRevision,
    false,
  );
  if (expectedRevision === null) {
    throw invalidExpectedRevision();
  }

  try {
    const result = await deleteHostedInferenceConnection({
      expectedRevision,
      memberId: auth.member.id,
    });
    if (result.selected) {
      scheduleHostedInferenceRuntimeWake(auth.member.id);
    }
    return jsonOk(result);
  } catch (error) {
    throw mapHostedInferenceConnectionError(error);
  }
});

async function readBody(request: Request): Promise<Record<string, unknown>> {
  return await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_INFERENCE_CONNECTION_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_INFERENCE_CONNECTION_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Custom inference connection request is too large.",
  });
}

function parseExpectedRevision(
  value: unknown,
  allowNull: boolean,
): number | null {
  if (allowNull && value === null) return null;
  try {
    return requireHostedInferenceRevision(value);
  } catch {
    throw invalidExpectedRevision();
  }
}

function invalidExpectedRevision() {
  return hostedOnboardingError({
    code: "HOSTED_INFERENCE_REVISION_INVALID",
    httpStatus: 400,
    message: "The custom inference revision is invalid.",
  });
}

function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  const expectedKeys = new Set(expected);
  if (
    Object.keys(record).length !== expectedKeys.size
    || Object.keys(record).some((key) => !expectedKeys.has(key))
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_CONNECTION_INVALID_REQUEST",
      httpStatus: 400,
      message: "Custom inference connection request is invalid.",
    });
  }
}
