import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const ticketId = await resolveDecodedRouteParam(context.params, "id");
  return respondToGameCommand(request, () => ({ ticketId, type: "redeem" }), { body: false });
});
