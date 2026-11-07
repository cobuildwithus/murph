import { companionPushRouteRegistrationSchema } from "@/src/lib/companion/push-route";
import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import * as z from "@murphai/contracts/zod-runtime";

const registrationSchema = companionPushRouteRegistrationSchema.extend({ gameReminders: z.boolean().optional() });

// Game players do not need paid assistant access. Reuse the companion's one
// address and its existing installation-scoped sign-out deletion.
export const POST = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const memberId = auth.member.id;
  const parsed = registrationSchema.safeParse(await readJsonObject(request, { limitBytes: 1_024 }));
  if (!parsed.success) throw invalidGameRequest("Invalid notification registration.");
  const data = { ...parsed.data, gameReminders: parsed.data.gameReminders === true, gameSessionId: auth.sessionId, updatedAt: new Date() };
  await getPrisma().$transaction(async (tx) => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await tx.companionPushRoute.upsert({
      where: { userId: memberId }, create: { userId: memberId, ...data }, update: data,
    });
  });
  return jsonOk({ ok: true });
});
