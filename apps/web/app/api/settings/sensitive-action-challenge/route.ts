import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
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
