import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingRawBodyText, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedLinqProductionCanaryOutcome } from "@/src/lib/hosted-onboarding/linq-production-canary-outcome";
import { requireHostedLinqProductionCanaryResetRequest } from "@/src/lib/hosted-onboarding/linq-production-canary-reset";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireHostedLinqProductionCanaryResetRequest(request);
  if (new URL(request.url).search) throwInvalidRequest();
  const body = await readHostedOnboardingRawBodyText(request, {
    limitBytes: 1,
    tooLargeErrorCode: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_BODY_INVALID",
    tooLargeErrorMessage: "The production canary outcome body must be empty.",
  });
  if (body.length > 0) throwInvalidRequest();
  const outcome = await readHostedLinqProductionCanaryOutcome({ prisma: getPrisma() });
  return jsonOk({ ok: true, outcome });
});

function throwInvalidRequest(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_REQUEST_INVALID",
    httpStatus: 400,
    message: "The production canary outcome does not accept inputs.",
  });
}
