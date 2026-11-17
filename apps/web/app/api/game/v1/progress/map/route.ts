import { clientUnits } from "@/src/lib/companion/client-info";
import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { gameNotFound } from '@/src/lib/game/http/errors';
import { parseMapQuery } from '@/src/lib/game/progress/contract';
import { assertBrowserVaultMemberAuthority } from '@/src/lib/browser-vault/authority';
import { readProgressStepsRoute } from '@/src/lib/game/progress/health-reader';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { renderRouteMap, resolveRoute } from '@/src/lib/game/progress/mapbox';
import { routeView } from '@/src/lib/game/progress/routes';
import { cumulativePoints, readGameSeries } from '@/src/lib/game/progress/series';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';
import { hostedOnboardingError } from '@/src/lib/hosted-onboarding/errors';
import { getPrisma } from '@/src/lib/prisma';

export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const units = clientUnits(request);
  const query = parseMapQuery(Object.fromEntries(new URL(request.url).searchParams));
  return progressEffect(async () => {
    let polyline: string, progress: number;
    if ('from' in query) {
      polyline = (await resolveRoute(query.from, query.to)).polyline;
      progress = 0;
    } else if (query.measure === 'steps') {
      ({ polyline, progress } = await readProgressStepsRoute(auth, request.signal));
    } else {
      const snapshot = await readGameSeries(auth.member.id, new Date());
      if (snapshot.incomplete) throw hostedOnboardingError({ code: 'PROGRESS_INCOMPLETE', httpStatus: 503,
        retryable: true, message: 'Progress could not load completely. Try again.' });
      const measure = snapshot.measures.find(measure => measure.id === query.measure);
      const state = snapshot.states.get(query.measure);
      if (!measure || !state?.legs?.length) throw gameNotFound();
      polyline = state.legs.at(-1)!.polyline;
      progress = routeView(measure.id, state, cumulativePoints(measure.amounts), snapshot.awards, units)!.progress;
    }
    await getPrisma().$transaction(async tx => {
      await assertGameMemberAuthCurrentTx(auth, tx);
      if ('measure' in query && query.measure === 'steps') await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
    });
    return renderRouteMap({ polyline, progress, size: query.size });
  });
}));
