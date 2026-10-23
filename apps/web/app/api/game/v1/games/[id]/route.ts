import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { requireGameMember } from "@/src/lib/game/http/auth";
import { gameNotFound } from "@/src/lib/game/http/errors";
import { readGame } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  const memberId = await requireGameMember(request);
  const game = await readGame(await resolveDecodedRouteParam(context.params, "id"), memberId);
  if (!game) throw gameNotFound();
  return jsonOk({ ok: true, game });
});

export const DELETE = withJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  return respondToGameCommand(request, () => ({ gameId, type: "cancelInvite" }), { body: false });
});
