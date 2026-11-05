import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { gameCommandError } from "@/src/lib/game/http/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const DELETE = withJsonError(async (request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const proposalId = await resolveDecodedRouteParam(context.params, "proposalId");
  return respondToGameCommand(request, () => ({ gameId, proposalId, type: "respondChange", decision: "cancel" }), { body: false });
});

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const proposalId = await resolveDecodedRouteParam(context.params, "proposalId");
  return respondToGameCommand(request, body => {
    if (body.decision !== "approve" && body.decision !== "decline") throw gameCommandError({ code: "INVALID_REQUEST", message: "Choose approve or decline.", retryable: false }, 400);
    return { gameId, proposalId, type: "respondChange", decision: body.decision };
  });
});
