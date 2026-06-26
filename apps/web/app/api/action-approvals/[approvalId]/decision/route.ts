import type { SensitiveActionAuthorization } from "@/src/lib/sensitive-actions/shared";

import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import {
  buildHostedActionApprovalBinding,
  decideHostedActionApprovalTx,
  requireHostedActionApprovalId,
  requirePendingHostedActionApproval,
} from "@/src/lib/action-approvals";
import type { HostedActionApprovalDecisionResponse } from "@/src/lib/action-approvals-shared";
import { signalHostedRuntimeRecheckRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import { verifySensitiveActionChallenge } from "@/src/lib/sensitive-actions/server";

const ACTION_APPROVAL_DECISION_BODY_LIMIT_BYTES = 4 * 1024;
const APPROVED_REPLY_BODY = "I approved the secure request.";
const DENIED_REPLY_BODY = "I denied the secure request.";

type ActionApprovalDecision =
  | {
      authorization: SensitiveActionAuthorization | unknown;
      decision: "approved";
    }
  | {
      decision: "denied";
    };

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const approvalId = requireHostedActionApprovalId(
    await resolveDecodedRouteParam(context.params, "approvalId"),
  );
  const decision = parseActionApprovalDecision(await readJsonObject(request, {
    limitBytes: ACTION_APPROVAL_DECISION_BODY_LIMIT_BYTES,
  }));
  const prisma = getPrisma();
  const now = new Date();
  const approval = await requirePendingHostedActionApproval({
    approvalId,
    memberId: session.member.id,
    now,
    prisma,
  });

  const view = decision.decision === "approved"
    ? await approveHostedAction({
        approval,
        authorization: decision.authorization,
        memberId: session.member.id,
        now,
        prisma,
        privyUserId: session.privyUserId,
        sessionId: session.sessionId,
      })
    : await prisma.$transaction((tx) =>
        decideHostedActionApprovalTx({
          approval,
          decision: "denied",
          memberId: session.member.id,
          now,
          tx,
        }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  // The decision is canonical in Postgres. This signal only wakes the caller sooner;
  // redirecting back to Murph remains the user-visible fallback.
  await signalHostedRuntimeRecheckRuntime({
    userId: session.member.id,
  }).catch(() => undefined);

  const contactOption = approval.returnContactKind === null
    ? null
    : await resolveHostedMurphContactOption({
        message: {
          body: decision.decision === "approved"
            ? APPROVED_REPLY_BODY
            : DENIED_REPLY_BODY,
        },
        preferredKind: approval.returnContactKind,
      });
  const response: HostedActionApprovalDecisionResponse = {
    ...view,
    redirectTo: contactOption?.href ?? null,
  };

  return jsonOk(response);
});

async function approveHostedAction(input: {
  approval: Awaited<ReturnType<typeof requirePendingHostedActionApproval>>;
  authorization: SensitiveActionAuthorization | unknown;
  memberId: string;
  now: Date;
  prisma: ReturnType<typeof getPrisma>;
  privyUserId: string;
  sessionId: string;
}) {
  const challenge = await verifySensitiveActionChallenge({
    authorization: input.authorization,
    bindingHash: buildHostedActionApprovalBinding({
      actionHash: input.approval.actionHash,
      actionId: input.approval.actionId,
      approvalId: input.approval.approvalId,
      memberId: input.memberId,
      sessionId: input.sessionId,
    }),
    kind: "assistant.action.approve",
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
    privyUserId: input.privyUserId,
  });

  return input.prisma.$transaction((tx) =>
    decideHostedActionApprovalTx({
      approval: input.approval,
      challenge,
      decision: "approved",
      memberId: input.memberId,
      now: input.now,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function parseActionApprovalDecision(
  body: Record<string, unknown>,
): ActionApprovalDecision {
  const decision = body.decision;

  if (decision === "denied") {
    assertExactDecisionKeys(body, ["decision"]);
    return { decision };
  }
  if (decision === "approved") {
    assertExactDecisionKeys(body, ["authorization", "decision"]);
    if (!("authorization" in body)) {
      throw invalidDecision();
    }
    return {
      authorization: body.authorization,
      decision,
    };
  }

  throw invalidDecision();
}

function assertExactDecisionKeys(
  body: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw invalidDecision();
  }
}

function invalidDecision() {
  return hostedOnboardingError({
    code: "ACTION_APPROVAL_DECISION_INVALID",
    httpStatus: 400,
    message: "Secure approval decision is invalid.",
  });
}
