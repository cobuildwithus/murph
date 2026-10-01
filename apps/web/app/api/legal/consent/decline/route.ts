import { recordHostedLaunchConsentDecline } from "@/src/lib/legal/consent";
import {
  requireHostedAppSessionFromRequest,
  revokeHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);

  const [, clearCookies] = await Promise.all([
    recordHostedLaunchConsentDecline({
      memberId: auth.member.id,
      prisma: getPrisma(),
      sessionId: auth.sessionId,
      source: "homepage-auth-dialog",
    }).catch(() => undefined),
    revokeHostedAppSessionFromRequest({
      reason: "consent_declined",
      request,
    }),
  ]);
  const response = jsonOk({ ok: true });
  for (const cookie of clearCookies) response.headers.append("Set-Cookie", cookie);
  return response;
});
