import {
  readHostedConsentStatus,
} from "@/src/lib/legal/consent";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);

  return jsonOk(await readHostedConsentStatus({
    memberId: auth.member.id,
    prisma,
  }));
});
