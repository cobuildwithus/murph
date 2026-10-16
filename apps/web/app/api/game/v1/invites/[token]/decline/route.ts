import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (request: Request, context: { params: Promise<{ token: string }> }) => {
  const token = await resolveDecodedRouteParam(context.params, "token");
  return respondToGameCommand(request, () => ({ reason: "declined", token, type: "void" }), { body: false });
});
