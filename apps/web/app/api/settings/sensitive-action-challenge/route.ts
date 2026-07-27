import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { assertHostedAccountDeletionAvailable } from "@/src/lib/hosted-privacy/account-deletion-maintenance";
import {
  buildSettingsSensitiveActionBinding,
  createSensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";
import { isSettingsSensitiveActionKind } from "@/src/lib/sensitive-actions/shared";
import { getPrisma } from "@/src/lib/prisma";

const SENSITIVE_ACTION_CHALLENGE_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, {
    limitBytes: SENSITIVE_ACTION_CHALLENGE_BODY_LIMIT_BYTES,
  });

  if (!isSettingsSensitiveActionKind(body.kind)) {
    throw hostedOnboardingError({
      code: "SENSITIVE_ACTION_KIND_INVALID",
      httpStatus: 400,
      message: "Sensitive action kind is invalid.",
    });
  }

  // Decline the deletion window here, before the member is asked to approve
  // anything. The delete route keeps the same guard as the effect boundary,
  // but this is where the member finds out, with the dialog still open and no
  // passkey prompt or browser-vault teardown behind them.
  if (body.kind === "account.delete") {
    assertHostedAccountDeletionAvailable();
  }

  return jsonOk(await createSensitiveActionChallenge({
    bindingHash: buildSettingsSensitiveActionBinding({
      kind: body.kind,
      memberId: auth.member.id,
      sessionId: auth.sessionId,
    }),
    kind: body.kind,
    memberId: auth.member.id,
    prisma,
  }));
});
