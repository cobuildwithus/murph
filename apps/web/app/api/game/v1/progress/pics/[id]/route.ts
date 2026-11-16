import { z } from 'zod';
import { RequestInputError } from '@murphai/hosted-execution/request-input';
import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from '@/src/lib/game/http/auth';
import { jsonOk, withJsonError } from '@/src/lib/hosted-onboarding/http';
import { deleteProgressPic, readProgressPic } from '@/src/lib/game/progress/pics';
import { progressEffect } from '@/src/lib/game/progress/http';

type Context = { params: Promise<{ id: string }> };
function picId(value: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new RequestInputError('Invalid picture identity.');
  return parsed.data;
}

export const GET = withJsonError(async (request: Request, context: Context) => {
  const auth = await requireGameMemberAuth(request), id = picId((await context.params).id);
  return progressEffect(async () => new Response(new Uint8Array(await readProgressPic(auth.member.id, id)), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }));
});

export const DELETE = withJsonError(async (request: Request, context: Context) => {
  const auth = await requireGameMemberAuth(request), id = picId((await context.params).id);
  await progressEffect(() => deleteProgressPic(auth.member.id, id, tx => assertGameMemberAuthCurrentTx(auth, tx)));
  return jsonOk({ ok: true }, 200, { 'Cache-Control': 'private, no-store' });
});
