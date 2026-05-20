import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { abortHostedInvitePhoneCode } from "@/src/lib/hosted-onboarding/invite-service";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");
  const body = await readJsonObject(request);
  const sendAttemptId = readRequiredSendAttemptId(body.sendAttemptId);

  return jsonOk(await abortHostedInvitePhoneCode({
    inviteCode,
    sendAttemptId,
  }));
});

function readRequiredSendAttemptId(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidSendAttemptIdError();
  }

  const normalized = value.trim();
  if (!normalized) {
    throw invalidSendAttemptIdError();
  }

  return normalized;
}

function invalidSendAttemptIdError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_INVITE_SEND_ATTEMPT_ID_REQUIRED",
    message: "A send attempt id is required to cancel this code.",
    httpStatus: 400,
  });
}
