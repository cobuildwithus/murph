import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedPrivyUserById } from "@/src/lib/hosted-onboarding/privy";
import {
  buildHostedPrivyEmailLinkIntentCookie,
  issueHostedPrivyEmailLinkIntent,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";
import { requireFreshActivePrivyMemberAuthForHostedAppSession } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const { freshPrivy } = await requireFreshActivePrivyMemberAuthForHostedAppSession(request);
  const verifiedPrivyUser = await readHostedPrivyUserById(freshPrivy.identity.userId);
  const response = jsonOk({ ok: true });
  response.headers.append("Set-Cookie", buildHostedPrivyEmailLinkIntentCookie(
    issueHostedPrivyEmailLinkIntent({
      memberId: freshPrivy.member.id,
      privyUserId: freshPrivy.identity.userId,
      verifiedPrivyUser,
    }),
  ));
  return response;
});
