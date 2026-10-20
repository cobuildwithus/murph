import { assertGameDevRoutesAllowed, requireGameMember } from "@/src/lib/game/http/auth";
import { withGameRuleErrors } from "@/src/lib/game/http/errors";
import { devStartNow } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  assertGameDevRoutesAllowed();
  const memberId = await requireGameMember(request);
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const game = await withGameRuleErrors(() => devStartNow(gameId, memberId));
  return jsonOk({ ok: true, game });
});
