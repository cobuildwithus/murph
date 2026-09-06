import { getPrisma } from "@/src/lib/prisma";
import { assertBrowserVaultMemberAuthority } from "@/src/lib/browser-vault/authority";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export function assertCompanionEnvironmentIdentity(request: Request, identity: string) {
  if (request.headers.get("x-murph-companion-identity") !== identity) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_IDENTITY_CHANGED",
      httpStatus: 409,
      message: "Your session changed. Reopen the environment interview.",
    });
  }
}

export async function requireEnvironmentRequestAuth(request: Request) {
  if (request.headers.has("authorization")) {
    const auth = await requireActivePrivyMemberAuthFromBearerToken(request);
    assertCompanionEnvironmentIdentity(request, auth.identity.userId);
    await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: getPrisma() });
    return auth;
  }
  if (request.method !== "GET") assertHostedOnboardingMutationOrigin(request);
  return requireActiveHostedAppSessionFromRequest(request);
}
