import { assertGameDevRoutesAllowed, requireGameMember } from "@/src/lib/game/http/auth";
import { invalidGameRequest, withGameRuleErrors } from "@/src/lib/game/http/errors";
import { GAME_DEV_ADVANCE_MAX_DAYS } from "@/src/lib/game/rules";
import { devAdvanceDays } from "@/src/lib/game/service";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  assertGameDevRoutesAllowed();
  const memberId = await requireGameMember(request);
  const { days = 1 } = await readOptionalJsonObject(request, { limitBytes: 1024 });
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > GAME_DEV_ADVANCE_MAX_DAYS) {
    throw invalidGameRequest(`days must be a whole number from 1 to ${GAME_DEV_ADVANCE_MAX_DAYS}.`);
  }
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const game = await withGameRuleErrors(() => devAdvanceDays(gameId, memberId, days));
  return jsonOk({ ok: true, game });
});
