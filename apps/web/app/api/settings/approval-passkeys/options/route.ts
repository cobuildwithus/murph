import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { createApprovalPasskeyRegistrationOptions } from "@/src/lib/sensitive-actions/passkey-enrollment";
import { readApprovalPasskeyRequest } from "@/src/lib/sensitive-actions/passkey-http";

export const POST = withJsonError(async (request: Request) => {
  const { body, prisma, session } = await readApprovalPasskeyRequest(request);
  return jsonOk(await createApprovalPasskeyRegistrationOptions({ authorization: body.authorization, prisma, session }));
});
