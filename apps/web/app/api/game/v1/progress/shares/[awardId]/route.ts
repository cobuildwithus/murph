import { RequestInputError } from '@murphai/hosted-execution/request-input';
import { clientUnits } from '@/src/lib/companion/client-info';
import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { parseShareStart } from '@/src/lib/game/progress/contract';
import { readProgressShare, shareNotFound, startProgressShare } from '@/src/lib/game/progress/shares';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';
import { readRawBodyBuffer } from '@/src/lib/http';
import { jsonOk } from '@/src/lib/hosted-onboarding/http';

export const maxDuration = 300;
function parseJson(body: Buffer): unknown {
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new RequestInputError('Send an empty body or JSON.'); }
}
export const runtime = 'nodejs';
type Context = { params: Promise<{ awardId: string }> };

async function shareRequest(request: Request, context: Context) {
  const auth = await requireGameMemberAuth(request), { awardId } = await context.params;
  if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(awardId)) throw shareNotFound();
  return { memberId: auth.member.id, awardId, units: clientUnits(request),
    beforeMutationTx: (tx: Parameters<typeof assertGameMemberAuthCurrentTx>[1]) => assertGameMemberAuthCurrentTx(auth, tx) };
}

export const GET = withProgressJsonError(async (request: Request, context: Context) => runWithHostedDomainRootUnwrapCache(async () => {
  const input = await shareRequest(request, context);
  return jsonOk(await progressEffect(() => readProgressShare(input)));
}));

export const POST = withProgressJsonError(async (request: Request, context: Context) => runWithHostedDomainRootUnwrapCache(async () => {
  const input = await shareRequest(request, context);
  // Empty starts the first picture; { replaces } is Change photo.
  const body = await readRawBodyBuffer(request, { limitBytes: 256 });
  const replaces = body.length === 0 ? undefined : parseShareStart(parseJson(body)).replaces;
  const view = await progressEffect(() => startProgressShare(input, replaces));
  return jsonOk(view, view.presentation.state === 'generating' ? 202 : 200);
}));
