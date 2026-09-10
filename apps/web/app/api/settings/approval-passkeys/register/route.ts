import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { registerApprovalPasskey } from "@/src/lib/sensitive-actions/passkey-enrollment";
import { parseApprovalPasskeyRegistration, readApprovalPasskeyRequest } from "@/src/lib/sensitive-actions/passkey-http";

export const POST = withJsonError(async (request: Request) => {
  const { body, prisma, session } = await readApprovalPasskeyRequest(request);
  await registerApprovalPasskey({
    authorization: body.authorization, prisma, request,
    response: parseApprovalPasskeyRegistration(body.response), session,
  });
  return jsonOk({ registered: true });
});
