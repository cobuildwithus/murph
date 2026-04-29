import {
  readHostedConsentStatus,
} from "@/src/lib/legal/consent";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuth(request, prisma);

  return jsonOk(await readHostedConsentStatus({
    memberId: auth.member.id,
    prisma,
  }));
});
