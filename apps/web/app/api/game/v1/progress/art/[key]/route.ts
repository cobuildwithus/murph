import { requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { gameNotFound } from '@/src/lib/game/http/errors';
import { areaFrameFromKey } from '@/src/lib/game/progress/area-art';
import { readArtBytes } from '@/src/lib/game/progress/place-art';
import { withJsonError } from '@/src/lib/hosted-onboarding/http';

/** Shared place art. Its key is versioned and its bytes never change once ready. */
export const GET = withJsonError(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  await requireGameMemberAuth(request);
  const { key } = await context.params;
  if (!/^(?:poster|map):v1:[A-Za-z0-9._:-]{1,200}$/u.test(key) && !areaFrameFromKey(key)) throw gameNotFound();
  const bytes = await readArtBytes(key);
  if (!bytes) throw gameNotFound();
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
});
