import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readHostedAccountSettingsPageSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { getPrisma } from "@/src/lib/prisma";

import { projectCompanionContactMethods } from "./contact-methods";

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const { member } = await requireHostedMemberAuthFromBearerToken(request, prisma);
  const snapshot = await readHostedAccountSettingsPageSnapshot({ memberId: member.id, prisma });
  return jsonOk(projectCompanionContactMethods(snapshot));
});
