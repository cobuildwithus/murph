import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { gameCommandError } from "@/src/lib/game/http/errors";
import { readGameReminders, runGameCommand } from "@/src/lib/game/service";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  return jsonOk({ ok: true, ...await readGameReminders(auth.member.id) });
});

export const PUT = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const body = await readJsonObject(request, { limitBytes: 64 * 1024 });
  const result = await runGameCommand({ actorMemberId: auth.member.id, command: { ...body, type: "setReminders" },
    beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) });
  if (!result.ok) throw gameCommandError(result.error, result.status);
  return jsonOk({ ok: true, ...result.reminders });
});
