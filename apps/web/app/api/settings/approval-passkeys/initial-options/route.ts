import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { createInitialApprovalPasskeyRegistrationOptions } from "@/src/lib/sensitive-actions/passkey-enrollment";
import { readApprovalPasskeyRequest } from "@/src/lib/sensitive-actions/passkey-http";

export const POST = withJsonError(async (request: Request) => {
  const { prisma, session } = await readApprovalPasskeyRequest(request);
  return jsonOk(await createInitialApprovalPasskeyRegistrationOptions({ prisma, session }));
});
