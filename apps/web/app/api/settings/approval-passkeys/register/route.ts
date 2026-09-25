import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { registerApprovalPasskey } from "@/src/lib/sensitive-actions/passkey-enrollment";
import { parseApprovalPasskeyRegistration, readApprovalPasskeyRequest } from "@/src/lib/sensitive-actions/passkey-http";

import { legacyApprovalRepairRequest } from "@/src/lib/sensitive-actions/legacy-passkey-repair-request";

export const POST = withJsonError(async (request: Request) => {
  const { body, prisma, session } = await readApprovalPasskeyRequest(request);
  if (body.legacyRepairToken !== undefined) return legacyApprovalRepairRequest(request, "register", { body, prisma, session });
  await registerApprovalPasskey({
    authorization: body.authorization, initialToken: body.initialToken, prisma, request,
    response: parseApprovalPasskeyRegistration(body.response), session,
  });
  return jsonOk({ registered: true });
});
