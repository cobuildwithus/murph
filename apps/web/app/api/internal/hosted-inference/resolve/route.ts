import {
  requireHostedInferenceRevision,
} from "@murphai/hosted-execution/assistant-inference";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readSelectedHostedInferenceConnection,
} from "@/src/lib/hosted-inference/connection-store";
import {
  projectHostedInferenceRuntimeTarget,
} from "@/src/lib/hosted-inference/runtime-target";
import {
  requireHostedInferenceProtocolEnabled,
} from "@/src/lib/hosted-inference/feature";
import {
  readActiveHostedMemberAccess,
} from "@/src/lib/hosted-onboarding/member-access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_INFERENCE_RESOLVE_CALLBACK_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_INFERENCE_RESOLVE_CALLBACK_BODY_LIMIT_BYTES,
  });
  const expectedRevision = readExpectedRevision(request);
  const prisma = getPrisma();
  if (!(await readActiveHostedMemberAccess({ memberId, prisma }))) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Active Murph access is required to use custom inference.",
    });
  }
  const connection = await readSelectedHostedInferenceConnection({
    expectedRevision,
    memberId,
    prisma,
  });
  if (!connection) {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_CONNECTION_NOT_SELECTED",
      httpStatus: 409,
      message: "No custom inference connection is selected.",
    });
  }
  requireHostedInferenceProtocolEnabled(connection.protocol);

  return jsonOk(projectHostedInferenceRuntimeTarget(connection));
});

function readExpectedRevision(request: Request): number {
  const raw = new URL(request.url).searchParams.get("revision");
  if (!raw || !/^[1-9][0-9]*$/u.test(raw)) {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_REVISION_INVALID",
      httpStatus: 400,
      message: "The custom inference revision is invalid.",
    });
  }
  const parsed = Number(raw);
  try {
    return requireHostedInferenceRevision(parsed);
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_REVISION_INVALID",
      httpStatus: 400,
      message: "The custom inference revision is invalid.",
    });
  }
}
