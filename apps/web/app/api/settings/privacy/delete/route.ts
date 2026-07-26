import {
  deleteHostedAccountData,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  buildHostedAppSessionClearCookie,
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedAccountDeletionAvailable,
  HOSTED_ACCOUNT_DELETION_ENTRY_LOG_MESSAGE,
  HOSTED_ACCOUNT_DELETION_SAFE_TERMINAL_LOG_MESSAGE,
} from "@/src/lib/hosted-privacy/account-deletion-maintenance";
import { HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES } from "@/src/lib/hosted-privacy/account-data-shared";
import { getPrisma } from "@/src/lib/prisma";
import {
  buildSettingsSensitiveActionBinding,
  verifyAndConsumeSensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

// The migration runbook waits this full platform-enforced lifetime after its
// Vercel deployment threshold closes admission before relying on request logs.
export const maxDuration = 300;

export const POST = withJsonError(async (request: Request) => {
  // Deliberately contains no member, request, or authorization data. It is the
  // first handler action, so every marker-bearing invocation has one proof
  // anchor even when it spans the maintenance deployment.
  console.info(HOSTED_ACCOUNT_DELETION_ENTRY_LOG_MESSAGE);

  let deletionStarted = false;
  try {
    assertHostedOnboardingMutationOrigin(request);
    // Declined before the sensitive-action challenge is consumed, so a member
    // who retries after the window still holds an unspent authorization.
    assertHostedAccountDeletionAvailable();
    const prisma = getPrisma();
    const auth = await requireHostedAppSessionFromRequest(request);
    const body = await readJsonObject(request, {
      limitBytes: HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES,
    });
    const deletionRequest = parseHostedAccountDeletionRequest(body);

    await verifyAndConsumeSensitiveActionChallenge({
      authorization: body.authorization,
      bindingHash: buildSettingsSensitiveActionBinding({
        kind: "account.delete",
        memberId: auth.member.id,
        sessionId: auth.sessionId,
      }),
      kind: "account.delete",
      memberId: auth.member.id,
      prisma,
      privyUserId: auth.privyUserId,
    });

    // From this point onward, only the aggregate cleanup result may prove a
    // safe terminal disposition.
    deletionStarted = true;
    const result = await deleteHostedAccountData({
      exitFeedback: deletionRequest.exitFeedback,
      memberId: auth.member.id,
      prisma,
      request,
    });

    // `deleted` is true only after every hosted-member R2 and Durable Object
    // cleanup succeeds. False or ambiguous outcomes remain unmatched.
    if (result.cloudflare.deleted) {
      console.info(HOSTED_ACCOUNT_DELETION_SAFE_TERMINAL_LOG_MESSAGE);
    }

    const response = jsonOk({ ok: true, result });
    response.headers.append("Set-Cookie", buildHostedAppSessionClearCookie());
    return response;
  } catch (error) {
    if (!deletionStarted) {
      console.info(HOSTED_ACCOUNT_DELETION_SAFE_TERMINAL_LOG_MESSAGE);
    }
    throw error;
  }
});
