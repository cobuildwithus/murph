import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

/** Report an invite before accepting it: who sent it, or the task and stake they wrote. */
export const POST = withJsonError(async (request: Request, context: { params: Promise<{ token: string }> }) => {
  const token = await resolveDecodedRouteParam(context.params, "token");
  return respondToGameCommand(request, (body) => ({ ...body, gameId: undefined, token, type: "report" }));
});
