import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { isGameBoardEnabled, savePairBoardSharing } from "@/src/lib/game/board";
import { BOARD_METRICS } from "@/src/lib/game/board-numbers";
import { gameNotFound, invalidGameRequest, withGameServiceFailures } from "@/src/lib/game/http/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const PUT = withJsonError(async (request: Request, context: { params: Promise<{ memberId: string }> }) => {
  const auth = await withGameServiceFailures(() => requireGameMemberAuth(request));
  if (!isGameBoardEnabled()) throw gameNotFound();
  const body = await readOptionalJsonObject(request, { limitBytes: 2_048 });
  if (body.expectedMembershipId !== null && (typeof body.expectedMembershipId !== "string"
    || !body.expectedMembershipId.trim() || body.expectedMembershipId.length > 200)) throw invalidGameRequest("Include the membership you last read, or null to join.");
  if (!Array.isArray(body.numbers) || body.numbers.length > 4 || body.numbers.some(value =>
    !BOARD_METRICS.some(metric => metric === value))) throw invalidGameRequest("Choose numbers from this board.");
  const requested = body.numbers;
  const numbers = BOARD_METRICS.filter(metric => requested.includes(metric));
  const expectedMembershipId = body.expectedMembershipId;
  const otherId = await resolveDecodedRouteParam(context.params, "memberId");
  const board = await withGameServiceFailures(() => savePairBoardSharing(auth.member.id, otherId,
    { expectedMembershipId, numbers,
      beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) }, request.signal));
  return jsonOk({ board }, 200, { "Cache-Control": "private, no-store" });
});
