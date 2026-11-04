import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const DELETE = withJsonError(async (request: Request, context: { params: Promise<{ id: string; replyId: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const replyId = await resolveDecodedRouteParam(context.params, "replyId");
  return respondToGameCommand(request, () => ({ type: "deleteReply", gameId, replyId }), { body: false });
});
