import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { parseShareConsent } from '@/src/lib/game/progress/contract';
import { decideProgressShareConsent } from '@/src/lib/game/progress/share-consent';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { jsonOk, readJsonObject } from '@/src/lib/hosted-onboarding/http';
import { getPrisma } from '@/src/lib/prisma';

export const maxDuration = 300;
export const PUT = withProgressJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const { decision } = parseShareConsent(await readJsonObject(request, { limitBytes: 256 }));
  return jsonOk(await progressEffect(() => decideProgressShareConsent({ memberId: auth.member.id, decision, prisma: getPrisma(),
    beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) })));
});
