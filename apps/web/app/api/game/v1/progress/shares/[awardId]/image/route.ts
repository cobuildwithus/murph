import { clientUnits } from '@/src/lib/companion/client-info';
import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { readProgressShareImage, shareNotFound } from '@/src/lib/game/progress/shares';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';

export const maxDuration = 300;
export const runtime = 'nodejs';
type Context = { params: Promise<{ awardId: string }> };
export const GET = withProgressJsonError(async (request: Request, context: Context) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request), { awardId } = await context.params;
  if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(awardId)) throw shareNotFound();
  return progressEffect('read_share_image', async () => {
    const bytes = await readProgressShareImage({ memberId: auth.member.id, awardId, units: clientUnits(request),
      beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) });
    try { return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' } }); }
    finally { bytes.fill(0); }
  });
}));
