import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  // The path names the game; a token in the body never redirects it to an invite.
  return respondToGameCommand(request, (body) => ({ ...body, gameId, token: undefined, type: "report" }));
});
