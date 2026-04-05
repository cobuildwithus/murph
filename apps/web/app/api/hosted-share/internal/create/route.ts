import { assertContract, sharePackSchema } from "@murphai/contracts";

import { requireHostedWebInternalSignedRequest } from "@/src/lib/hosted-execution/internal";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError, readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { createHostedShareLink } from "@/src/lib/hosted-share/service";

export const POST = withJsonError(async (request: Request) => {
  const body = await readJsonObject(request);
  const senderMemberId = typeof body.senderMemberId === "string"
    ? body.senderMemberId.trim()
    : "";

  if (!senderMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_SENDER_REQUIRED",
      message: "senderMemberId is required for hosted share creation.",
      httpStatus: 400,
    });
  }

  const boundUserId = await requireHostedWebInternalSignedRequest(request);

  if (boundUserId !== senderMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_UNAUTHORIZED",
      message: "Unauthorized hosted share request.",
      httpStatus: 401,
    });
  }

  return jsonOk(
    await createHostedShareLink({
      pack: assertContract(sharePackSchema, body.pack, "share pack"),
      senderMemberId,
      recipientPhoneNumber: typeof body.recipientPhoneNumber === "string" ? body.recipientPhoneNumber : null,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      expiresInHours: typeof body.expiresInHours === "number" ? body.expiresInHours : undefined,
    }),
  );
});
