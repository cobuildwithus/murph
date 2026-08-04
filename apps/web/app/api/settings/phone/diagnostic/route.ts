import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { logHostedOnboardingDiagnostic } from "@/src/lib/hosted-onboarding/logging";
import { parseHostedPhoneLinkDiagnosticPayload } from "@/src/lib/hosted-onboarding/phone-link-diagnostic-contract";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const body = await readOptionalJsonObject(request, { limitBytes: 2_048 });
  const diagnostic = parseHostedPhoneLinkDiagnosticPayload(body);

  if (!diagnostic) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_LINK_DIAGNOSTIC_INVALID",
      httpStatus: 400,
      message: "Invalid phone-link diagnostic event.",
    });
  }

  logHostedOnboardingDiagnostic("privy-phone-link-client", { ...diagnostic });

  return jsonOk({ ok: true });
});
