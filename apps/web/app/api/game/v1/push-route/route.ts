import { companionPushRouteRegistrationSchema } from "@/src/lib/companion/push-route";
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { assertHostedNativeMemberAuthCurrentTx } from "@/src/lib/better-auth/native-auth";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

// Game players do not need paid assistant access. Reuse the companion's one
// address and its existing installation-scoped sign-out deletion.
export const POST = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const memberId = auth.member.id;
  const parsed = companionPushRouteRegistrationSchema.safeParse(await readJsonObject(request, { limitBytes: 1_024 }));
  if (!parsed.success) throw invalidGameRequest("Invalid notification registration.");
  const data = { ...parsed.data, gameSessionId: auth.sessionId, updatedAt: new Date() };
  await getPrisma().$transaction(async (tx) => {
    await assertHostedNativeMemberAuthCurrentTx(auth, tx);
    await tx.companionPushRoute.upsert({
      where: { userId: memberId }, create: { userId: memberId, ...data }, update: data,
    });
  });
  return jsonOk({ ok: true });
});
