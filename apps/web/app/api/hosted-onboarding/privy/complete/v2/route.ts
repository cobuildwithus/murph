import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyRoute } from "@/src/lib/hosted-onboarding/privy-completion-route";
import {
  readHostedPrivyAuthIntentFromRequest,
  verifyHostedPrivyAuthIntent,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";

export const POST = withJsonError(async (request: Request) => completeHostedPrivyRoute({
  request,
  resolveAuthIntent: ({ inviteCode, request: completionRequest }) => verifyHostedPrivyAuthIntent({
    intent: readHostedPrivyAuthIntentFromRequest(completionRequest),
    inviteCode,
  }),
  timingStep: "hosted-onboarding.route.privy-complete-v2",
}));
