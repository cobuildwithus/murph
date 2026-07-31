import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  parseHostedConsentRevokeRequest,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { withdrawHostedHealthDataConsent } from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const cleanupRequest = request.clone();
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request);
  const consent = parseHostedConsentRevokeRequest(body);

  if (consent.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE) {
    return jsonOk(await withdrawHostedHealthDataConsent({
      memberId: auth.member.id,
      prisma,
      request: cleanupRequest,
      source: consent.source,
    }));
  }

  return jsonOk(await revokeHostedConsentScope({
    memberId: auth.member.id,
    prisma,
    scope: consent.scope,
    source: consent.source,
  }));
});
