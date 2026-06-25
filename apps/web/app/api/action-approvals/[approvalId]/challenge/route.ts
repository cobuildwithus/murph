import {
  issueHostedActionApprovalChallenge,
  requireHostedActionApprovalId,
} from "@/src/lib/action-approvals";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const approvalId = requireHostedActionApprovalId(
    await resolveDecodedRouteParam(context.params, "approvalId"),
  );

  return jsonOk(await issueHostedActionApprovalChallenge({
    approvalId,
    memberId: session.member.id,
    prisma: getPrisma(),
    sessionId: session.sessionId,
  }));
});
