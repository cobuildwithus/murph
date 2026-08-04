import { after } from "next/server";

import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  parseHostedConsentRevokeRequest,
  readHostedConsentStatus,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  cleanupWithdrawnHostedHealthDataConsent,
  reconcileHostedHealthDataRuntimeConsent,
  withdrawHostedHealthDataConsent,
} from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const cleanupRequest = request.clone();
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request);
  const consent = parseHostedConsentRevokeRequest(body);

  if (consent.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE) {
    await withdrawHostedHealthDataConsent({
      memberId: auth.member.id,
      prisma,
      source: consent.source,
    });
    const runtimeConsent = await reconcileHostedHealthDataRuntimeConsent({
      memberId: auth.member.id,
    });
    const status = await readHostedConsentStatus({
      memberId: auth.member.id,
      prisma,
    });
    if (runtimeConsent.consentState === "revoked") {
      after(() =>
        cleanupWithdrawnHostedHealthDataConsent({
          memberId: auth.member.id,
          prisma,
          request: cleanupRequest,
        })
      );
    }
    return jsonOk(status);
  }

  return jsonOk(await revokeHostedConsentScope({
    memberId: auth.member.id,
    prisma,
    scope: consent.scope,
    source: consent.source,
  }));
});
