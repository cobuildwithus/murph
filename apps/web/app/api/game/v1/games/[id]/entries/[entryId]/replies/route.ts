import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ id: string; entryId: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const entryId = await resolveDecodedRouteParam(context.params, "entryId");
  return respondToGameCommand(request, body => ({ ...body, type: "replyToPost", gameId, entryId }), { body: true, limitBytes: 600 * 1024 });
});
