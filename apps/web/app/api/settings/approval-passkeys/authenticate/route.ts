import { buildHostedActionApprovalBinding } from "@/src/lib/action-approvals";
import { createHash } from "node:crypto";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { resolveHostedPublicOrigin } from "@/src/lib/hosted-web/public-url";
import { readApprovalPasskeyRequest } from "@/src/lib/sensitive-actions/passkey-http";
import { readApprovalPasskeyState } from "@/src/lib/sensitive-actions/passkey-store";
import { buildSensitiveActionMessage, buildSettingsSensitiveActionBinding } from "@/src/lib/sensitive-actions/server";
import { isSensitiveActionKind, isSensitiveActionToken, isSettingsSensitiveActionKind } from "@/src/lib/sensitive-actions/shared";
import { approvalPasskeyAuthenticationOptions } from "@/src/lib/sensitive-actions/webauthn";

export const POST = withJsonError(async (request: Request) => {
  const { body, prisma, session } = await readApprovalPasskeyRequest(request);
  if (!isSensitiveActionToken(body.token)) throw unavailable();
  const challenge = await prisma.hostedSensitiveActionChallenge.findUnique({
    where: { tokenHash: createHash("sha256").update(body.token).digest("hex") },
  });
  const origin = resolveHostedPublicOrigin();
  if (!challenge || challenge.memberId !== session.member.id || challenge.expiresAt <= new Date()
    || !isSensitiveActionKind(challenge.kind) || !origin) throw unavailable();
  const bindingHash = isSettingsSensitiveActionKind(challenge.kind)
    ? buildSettingsSensitiveActionBinding({ kind: challenge.kind, memberId: session.member.id, sessionId: session.sessionId })
    : challenge.approvalKey && challenge.actionId && challenge.actionHash && challenge.approvalStatus === "pending"
      ? buildHostedActionApprovalBinding({
          actionHash: challenge.actionHash, actionId: challenge.actionId,
          approvalId: challenge.approvalKey, memberId: session.member.id, sessionId: session.sessionId,
        })
      : null;
  if (bindingHash !== challenge.bindingHash) throw unavailable();
  const state = await readApprovalPasskeyState({ memberId: session.member.id, prisma });
  if (state.credentials.length === 0) return jsonOk({ method: "wallet" });
  return jsonOk({
    method: "passkey",
    options: await approvalPasskeyAuthenticationOptions({
      credentials: state.credentials,
      message: buildSensitiveActionMessage({
        bindingHash: challenge.bindingHash, expiresAt: challenge.expiresAt,
        kind: challenge.kind, origin, token: body.token,
      }),
      origin,
    }),
  });
});

function unavailable() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_UNAVAILABLE", httpStatus: 410,
    message: "This secure approval is expired or no longer available.",
  });
}
