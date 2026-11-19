import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { gameNotFound } from '@/src/lib/game/http/errors';
import { parsePicUploadQuery, type PicUploadResponse } from '@/src/lib/game/progress/contract';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { readProgressJpeg } from '@/src/lib/game/progress/jpeg';
import { picturePin, putProgressPic } from '@/src/lib/game/progress/pics';
import { cumulativePoints } from '@/src/lib/game/progress/series';
import { readOwnSeries } from '@/src/lib/game/progress/vault-runs';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';
import { hostedOnboardingError } from '@/src/lib/hosted-onboarding/errors';
import { jsonOk } from '@/src/lib/hosted-onboarding/http';
import { getPrisma } from '@/src/lib/prisma';

export const POST = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const input = parsePicUploadQuery(Object.fromEntries(new URL(request.url).searchParams));
  const bytes = await readProgressJpeg(request);
  return progressEffect('upload_picture', async () => {
    const memberId = auth.member.id;
    const [snapshot, profile] = await Promise.all([
      progressEffect('read_picture_series', () => readOwnSeries(memberId, new Date())),
      progressEffect('read_picture_profile', () => getPrisma().gameProfile.findUniqueOrThrow({ where: { memberId }, select: { timeZone: true } })),
    ]);
    if (snapshot.incomplete) throw hostedOnboardingError({ code: 'PROGRESS_INCOMPLETE', httpStatus: 503,
      retryable: true, message: 'Progress could not load completely. Try again.' });
    const measure = snapshot.measures.find(measure => measure.id === input.measureId);
    if (!measure) throw gameNotFound();
    await putProgressPic(memberId, input, bytes, tx => assertGameMemberAuthCurrentTx(auth, tx));
    const response: PicUploadResponse = { ok: true, pic: picturePin({ id: input.id, takenAt: new Date(input.takenAt) },
      cumulativePoints(measure.amounts), profile.timeZone) };
    return jsonOk(response);
  });
}));
