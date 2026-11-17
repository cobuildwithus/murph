import { after } from "next/server";

import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  PROGRESS_SHARE_CONSENT_SCOPE,
  parseHostedConsentRevokeRequest,
  readHostedConsentStatus,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { assertHostedAppSessionCurrentTx, requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { decideProgressShareConsent } from "@/src/lib/game/progress/share-consent";
import { progressEffect } from "@/src/lib/game/progress/http";
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

  if (consent.scope === PROGRESS_SHARE_CONSENT_SCOPE) {
    await progressEffect(() => decideProgressShareConsent({ memberId: auth.member.id, decision: 'deny', prisma,
      beforeMutationTx: tx => assertHostedAppSessionCurrentTx({ memberId: auth.member.id, prisma: tx,
        request, sessionId: auth.sessionId, authProof: auth.authProof }) }));
    return jsonOk(await readHostedConsentStatus({ memberId: auth.member.id, prisma }));
  }

  if (consent.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE) {
    await withdrawHostedHealthDataConsent({
      memberId: auth.member.id,
      prisma,
      source: consent.source,
    });
    after(() => cleanupWithdrawnHostedHealthDataConsent({
      memberId: auth.member.id,
      prisma,
      request: cleanupRequest,
    }));
    await reconcileHostedHealthDataRuntimeConsent({ memberId: auth.member.id });
    const status = await readHostedConsentStatus({ memberId: auth.member.id, prisma });
    return jsonOk(status);
  }

  return jsonOk(await revokeHostedConsentScope({
    memberId: auth.member.id,
    prisma,
    scope: consent.scope,
    source: consent.source,
  }));
});
