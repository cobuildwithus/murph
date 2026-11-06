import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

type Context = { params: Promise<{ memberId: string }> };

export const PUT = withJsonError(async (request: Request, context: Context) => {
  const memberId = await resolveDecodedRouteParam(context.params, "memberId");
  return respondToGameCommand(request, () => ({ memberId, type: "block" }), { body: false });
});

export const DELETE = withJsonError(async (request: Request, context: Context) => {
  const memberId = await resolveDecodedRouteParam(context.params, "memberId");
  return respondToGameCommand(request, () => ({ memberId, type: "unblock" }), { body: false });
});
