import {
  parseHostedConsentRevokeRequest,
  revokeHostedOptionalFeatureConsent,
} from "@/src/lib/legal/consent";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request);
  const consent = parseHostedConsentRevokeRequest(body);

  return jsonOk(await revokeHostedOptionalFeatureConsent({
    memberId: auth.member.id,
    prisma,
    scope: consent.scope,
    source: consent.source,
  }));
});
