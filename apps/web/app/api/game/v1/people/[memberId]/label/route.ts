import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const PUT = withJsonError(async (request: Request, context: { params: Promise<{ memberId: string }> }) => {
  const memberId = await resolveDecodedRouteParam(context.params, "memberId");
  return respondToGameCommand(request, (body) => ({ ...body, memberId, type: "setLabel" }));
});
