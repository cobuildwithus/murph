import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { parseSharePhoto } from '@/src/lib/game/progress/contract';
import { progressEffect, withProgressJsonError } from '@/src/lib/game/progress/http';
import { readProgressJpeg } from '@/src/lib/game/progress/jpeg';
import { putSharePhoto, readSharePhoto } from '@/src/lib/game/progress/share-photo';
import { runWithHostedDomainRootUnwrapCache } from '@/src/lib/hosted-crypto/domain-root-unwrap-cache';
import { jsonOk, readJsonObject } from '@/src/lib/hosted-onboarding/http';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** The medal photo the Settings row and the photo step show. */
export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  return progressEffect(async () => new Response(new Uint8Array(await readSharePhoto(auth.member.id)), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }));
}));

/** The pick: { from: 'profile' }, { from: 'post', entryId }, or the JPEG itself. */
export const PUT = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const isJpeg = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'image/jpeg';
  const source = isJpeg ? { from: 'bytes' as const, bytes: await readProgressJpeg(request) }
    : parseSharePhoto(await readJsonObject(request, { limitBytes: 512 }));
  await progressEffect(() => putSharePhoto(auth.member.id, source, tx => assertGameMemberAuthCurrentTx(auth, tx)));
  return jsonOk({ ok: true });
}));
