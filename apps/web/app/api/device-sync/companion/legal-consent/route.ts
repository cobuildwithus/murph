import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedOnboardingJsonObject,
} from "@/src/lib/hosted-onboarding/http";
import { requirePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import {
  type HostedConsentLaunchScope,
  parseHostedConsentAcceptRequest,
  readHostedConsentStatus,
  recordHostedLaunchRequiredConsent,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

const COMPANION_CONSENT_BODY_MAX_BYTES = 8 * 1024;

function isLaunchScope(scope: string): scope is HostedConsentLaunchScope {
  return scope === "launch.legal" || scope === "launch.health-data";
}

// Native consent recovery uses the same persisted grants and current document
// registry as the hosted Web surface. Privy bearer auth deliberately has no
// cookie fallback and no active-subscription gate: a signed-in member must be
// able to review and accept legal terms before protected product access resumes.
export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma);

  return jsonOk(await readHostedConsentStatus({
    memberId: auth.member.id,
    prisma,
  }));
});

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma);
  const consent = parseHostedConsentAcceptRequest(
    await readHostedOnboardingJsonObject(request, {
      limitBytes: COMPANION_CONSENT_BODY_MAX_BYTES,
      tooLargeErrorCode: "CONSENT_REQUEST_TOO_LARGE",
      tooLargeErrorMessage: "The consent request is too large.",
    }),
  );

  if (!isLaunchScope(consent.scope)) {
    throw hostedOnboardingError({
      code: "CONSENT_SCOPE_NOT_ALLOWED",
      httpStatus: 400,
      message: "The companion app can accept launch consent only.",
    });
  }

  return jsonOk(await recordHostedLaunchRequiredConsent({
    acceptedDocumentVersions: consent.acceptedDocumentVersions,
    memberId: auth.member.id,
    prisma,
    scope: consent.scope,
    source: "ios-companion",
  }));
});
