import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { parseStoryQuery } from '@/src/lib/game/progress/contract';
import { healthAuthority } from '@/src/lib/game/progress/health-reader';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { readTownStory } from '@/src/lib/game/progress/place-story';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';
import { jsonOk } from '@/src/lib/hosted-onboarding/http';

export const runtime = 'nodejs';

/** The back of a passed town's postcard: written on the first ask, then the same for everyone. */
export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const query = parseStoryQuery(Object.fromEntries(new URL(request.url).searchParams));
  // A Steps town is on the Steps route, which holds the same authority as the rest of Steps.
  const authority = query.measure === 'steps' ? healthAuthority(auth) : (tx: Parameters<typeof assertGameMemberAuthCurrentTx>[1]) => assertGameMemberAuthCurrentTx(auth, tx);
  return jsonOk(await progressEffect('read_story', () => readTownStory(auth.member.id, query, authority)));
}));
