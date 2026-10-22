import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const DELETE = withJsonError(async (request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const proposalId = await resolveDecodedRouteParam(context.params, "proposalId");
  return respondToGameCommand(request, () => ({ gameId, proposalId, type: "respondChange", decision: "cancel" }), { body: false });
});
