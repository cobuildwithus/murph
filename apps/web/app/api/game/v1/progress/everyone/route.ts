import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { gameCommandError, invalidGameRequest } from "@/src/lib/game/http/errors";
import { withProgressJsonError } from "@/src/lib/game/progress/http";
import { runGameCommand } from "@/src/lib/game/service";
import { jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { withRetryableServerFailures } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = withProgressJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request), db = getPrisma();
  const profile = await db.gameProfile.findUnique({ where: { memberId: auth.member.id }, select: { everyoneJoinedAt: true } });
  await assertGameMemberAuthCurrentTx(auth, db);
  return jsonOk({ joined: profile?.everyoneJoinedAt != null });
});

export const PUT = withProgressJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const body = await readJsonObject(request, { limitBytes: 1024 });
  if (Object.keys(body).length !== 1 || typeof body.joined !== "boolean") throw invalidGameRequest("Choose whether to join Everyone.");
  return withRetryableServerFailures(async () => {
    const result = await runGameCommand({ actorMemberId: auth.member.id, command: { type: "setProfile", everyoneJoined: body.joined },
      beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) });
    if (!result.ok) throw gameCommandError(result.error, result.status);
    return jsonOk({ ok: true, joined: result.joined });
  });
});
