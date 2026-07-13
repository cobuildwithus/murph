import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyRoute } from "@/src/lib/hosted-onboarding/privy-completion-route";
import {
  readHostedPrivyAuthIntentFromRequest,
  verifyHostedPrivyAuthIntent,
  verifyHostedPrivyAuthenticationProof,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";

export const POST = withJsonError(async (request: Request) => completeHostedPrivyRoute({
  request,
  resolveAuthContext: ({ inviteCode, request: completionRequest }) => verifyHostedPrivyAuthIntent({
    intent: readHostedPrivyAuthIntentFromRequest(completionRequest),
    inviteCode,
  }),
  resolveAuthProof: ({ authContext, verifiedPrivyUser }) => verifyHostedPrivyAuthenticationProof({
    intent: authContext,
    verifiedPrivyUser,
  }),
  timingStep: "hosted-onboarding.route.privy-complete-v2",
}));
