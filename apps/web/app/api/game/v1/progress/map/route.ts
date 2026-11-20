import { clientUnits } from "@/src/lib/companion/client-info";
import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { gameNotFound } from '@/src/lib/game/http/errors';
import { parseMapQuery } from '@/src/lib/game/progress/contract';
import { assertBrowserVaultMemberAuthority } from '@/src/lib/browser-vault/authority';
import { readProgressStepsRoute } from '@/src/lib/game/progress/health-reader';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { renderRouteMap, resolveRouteGeometry } from '@/src/lib/game/progress/mapbox';
import { readArtBytes } from '@/src/lib/game/progress/place-art';
import { drawRouteOnPainting, mapKey } from '@/src/lib/game/progress/place-art-make';
import { mapProgress } from '@/src/lib/game/progress/route-geometry';
import { mapVersion } from '@/src/lib/game/progress/route-progress';
import { routeView } from '@/src/lib/game/progress/routes';
import { cumulativePoints } from '@/src/lib/game/progress/series';
import { readOwnSeries } from '@/src/lib/game/progress/vault-runs';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';
import { getPrisma } from '@/src/lib/prisma';

export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const units = clientUnits(request);
  const query = parseMapQuery(Object.fromEntries(new URL(request.url).searchParams));
  return progressEffect('read_map', async () => {
    let polyline: string, progress: number;
    if ('from' in query) {
      // A preview's picture needs only the road, not its towns.
      polyline = (await resolveRouteGeometry(query.from, query.to)).polyline;
      progress = 0;
    } else if (query.measure === 'steps') {
      ({ polyline, progress } = await readProgressStepsRoute(auth, request.signal));
    } else {
      const snapshot = await readOwnSeries(auth.member.id, new Date());
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
    // Drawn as far along as the link's version says, so one link is one picture.
    progress = mapProgress(progress);
    // The painted map, when one is ready, with today's line drawn on it; else the plain map. A link
    // made before any painting stays the plain map, so the app's state and its picture agree.
    const plainLink = 'v' in query && query.v === mapVersion(polyline, progress);
    const painted = plainLink ? null : await readArtBytes(mapKey(polyline, query.size))
      .then(painting => painting && drawRouteOnPainting(painting, polyline, progress, query.size)).catch(() => null);
    if (painted) return new Response(new Uint8Array(painted), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    return renderRouteMap({ polyline, progress, size: query.size });
  });
}));
