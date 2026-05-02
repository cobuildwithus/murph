import {
  type HostedConsentLaunchScope,
  grantHostedOptionalFeatureConsent,
  parseHostedConsentAcceptRequest,
  recordHostedLaunchRequiredConsent,
} from "@/src/lib/legal/consent";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { getPrisma } from "@/src/lib/prisma";

function isLaunchScope(scope: string): scope is HostedConsentLaunchScope {
  return scope === "launch.legal" || scope === "launch.health-data";
}

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request);
  const consent = parseHostedConsentAcceptRequest(body);
  const status = isLaunchScope(consent.scope)
    ? await recordHostedLaunchRequiredConsent({
        acceptedDocumentVersions: consent.acceptedDocumentVersions,
        memberId: auth.member.id,
        prisma,
        scope: consent.scope,
        source: consent.source,
      })
    : await grantHostedOptionalFeatureConsent({
        acceptedDocumentVersions: consent.acceptedDocumentVersions,
        memberId: auth.member.id,
        prisma,
        scope: consent.scope,
        source: consent.source,
      });

  return jsonOk(status);
});
