import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingRawBodyText,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  requireHostedLinqProductionCanaryResetRequest,
  resetHostedLinqProductionCanary,
} from "@/src/lib/hosted-onboarding/linq-production-canary-reset";
import { getPrisma } from "@/src/lib/prisma";

export const maxDuration = 300;

export const POST = withJsonError(async (request: Request) => {
  const phoneNumber = requireHostedLinqProductionCanaryResetRequest(request);
  if (new URL(request.url).search) {
    throwInvalidProductionCanaryResetRequest();
  }
  const body = await readHostedOnboardingRawBodyText(request, {
    limitBytes: 1,
    tooLargeErrorCode: "HOSTED_LINQ_PRODUCTION_CANARY_RESET_BODY_INVALID",
    tooLargeErrorMessage: "The production canary reset body must be empty.",
  });
  if (body.length > 0) {
    throwInvalidProductionCanaryResetRequest();
  }

  const reset = await resetHostedLinqProductionCanary({
    phoneNumber,
    prisma: getPrisma(),
    request,
  });
  return jsonOk({ ok: true, reset });
});

function throwInvalidProductionCanaryResetRequest(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PRODUCTION_CANARY_RESET_REQUEST_INVALID",
    httpStatus: 400,
    message: "The production canary reset does not accept inputs.",
  });
}
