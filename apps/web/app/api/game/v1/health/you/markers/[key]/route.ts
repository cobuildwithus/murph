import * as z from "@murphai/contracts/zod-runtime";
import { gameNotFound } from "@/src/lib/game/http/errors";
import { assertHealthYouEnabled } from "@/src/lib/health-wins/flag";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readPrivateYou } from "@/src/lib/health-you/read";

export const GET = withHealthRoute(async (request, auth, context: { params: Promise<{ key: string }> }) => {
  assertHealthYouEnabled(auth.member.id);
  const key = z
    .string()
    .regex(/^[a-z0-9-]{1,96}$/)
    .safeParse((await context.params).key);
  if (!key.success) throw gameNotFound();
  return Response.json(await readPrivateYou(auth, "marker", request.signal, key.data));
});
