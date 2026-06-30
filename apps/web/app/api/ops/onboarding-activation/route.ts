import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { activateHostedOpsOnboardingFromInvite } from "@/src/lib/hosted-ops/onboarding-activation";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_ONBOARDING_ACTIVATION_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_ONBOARDING_ACTIVATION_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_ONBOARDING_ACTIVATION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops onboarding activation request body is too large.",
  });

  return jsonOk(await activateHostedOpsOnboardingFromInvite({
    inviteCodeOrUrl: readRequiredStringField(
      body,
      "inviteCodeOrUrl",
      "HOSTED_OPS_ONBOARDING_ACTIVATION_INVITE_REQUIRED",
      "Enter a hosted invite code or join URL.",
    ),
  }));
});

function readRequiredStringField(
  body: Record<string, unknown>,
  key: string,
  code: string,
  message: string,
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message,
      retryable: false,
    });
  }

  return value;
}
