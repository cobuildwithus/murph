import { requireGameMember } from "@/src/lib/game/http/auth";
import { gameNotFound } from "@/src/lib/game/http/errors";
import { readGameReplyAudio } from "@/src/lib/game/service";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const GET = withJsonError(async (request: Request, context: { params: Promise<{ id: string; replyId: string }> }) => {
  const memberId = await requireGameMember(request);
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const replyId = await resolveDecodedRouteParam(context.params, "replyId");
  const bytes = await readGameReplyAudio(gameId, replyId, memberId);
  if (!bytes) throw gameNotFound();
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "audio/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
