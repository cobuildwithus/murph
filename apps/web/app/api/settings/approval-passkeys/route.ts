import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { readApprovalPasskeyState } from "@/src/lib/sensitive-actions/passkey-store";

import { isLegacyApprovalRepairEligible } from "@/src/lib/sensitive-actions/legacy-passkey-repair";

export const GET = withJsonError(async (request: Request) => {
  const session = await requireHostedAppSessionFromRequest(request);
  const state = await readApprovalPasskeyState({ memberId: session.member.id, prisma: getPrisma() });
  return jsonOk({
    legacyRepairAllowed: state.encrypted === null && await isLegacyApprovalRepairEligible(getPrisma(), session),
    configured: state.credentials.length > 0,
    legacyUserId: state.credentials.length === 0 ? session.privyUserId ?? null : null,
    initialEnrollmentAllowed: Boolean(session.authProof && !session.privyUserId && state.encrypted === null),
  });
});
