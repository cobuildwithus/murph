import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const DELETE = withJsonError(async (
  request: Request,
  context: { params: Promise<{ entryId: string; id: string }> },
) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const entryId = await resolveDecodedRouteParam(context.params, "entryId");
  return respondToGameCommand(request, () => ({ entryId, gameId, type: "withdraw" }), { body: false });
});
