import { requireGameMember } from "@/src/lib/game/http/auth";
import { readPairBoard } from "@/src/lib/game/board";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const GET = withJsonError(async (request: Request, context: { params: Promise<{ memberId: string }> }) => {
  const viewerId = await requireGameMember(request);
  const board = await readPairBoard(viewerId, await resolveDecodedRouteParam(context.params, "memberId"));
  return jsonOk({ board }, 200, { "Cache-Control": "private, no-store" });
});
