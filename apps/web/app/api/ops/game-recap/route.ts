import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { requestGameRecapRegeneration } from "@/src/lib/game/recap-regeneration";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";

export const POST = withJsonError(async (request: Request) => {
  const session = await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 1024, tooLargeErrorCode: "GAME_RECAP_REQUEST_TOO_LARGE", tooLargeErrorMessage: "Name one game and regeneration id.",
  });
  if (Object.keys(body).some((key) => !["gameId", "regenerationId", "execute"].includes(key))
    || typeof body.gameId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/u.test(body.gameId)
    || typeof body.regenerationId !== "string" || !/^[A-Za-z0-9_-]{8,32}$/u.test(body.regenerationId)
    || (body.execute !== undefined && typeof body.execute !== "boolean")) {
    throw hostedOnboardingError({ code: "GAME_RECAP_INPUT_INVALID", httpStatus: 400, message: "Name one game and a stable 8–32 character regeneration id; execute must be a boolean." });
  }
  return jsonOk(await requestGameRecapRegeneration({ gameId: body.gameId, regenerationId: body.regenerationId,
    execute: body.execute === true, operatorMemberId: session.member.id }));
});
