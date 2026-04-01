import { assertContract, sharePackSchema } from "@murphai/contracts";

import { createHostedShareLink, requireHostedShareInternalToken } from "@/src/lib/hosted-share/service";
import { jsonOk, withJsonError, readJsonObject } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
    requireHostedShareInternalToken(request);
    const body = await readJsonObject(request);
    return jsonOk(
      await createHostedShareLink({
        pack: assertContract(sharePackSchema, body.pack, "share pack"),
        senderMemberId: typeof body.senderMemberId === "string" ? body.senderMemberId : null,
        recipientPhoneNumber: typeof body.recipientPhoneNumber === "string" ? body.recipientPhoneNumber : null,
        inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
        expiresInHours: typeof body.expiresInHours === "number" ? body.expiresInHours : undefined,
      }),
    );
});
