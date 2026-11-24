import { assertGameMemberAuthCurrentTx, requireGameMemberAuth } from "@/src/lib/game/http/auth";
import * as z from "@murphai/contracts/zod-runtime";
import { gameCommandError, invalidGameRequest, withGameRuleErrors } from "@/src/lib/game/http/errors";
import { editGameReminders, readSessionGameReminders, runGameCommand } from "@/src/lib/game/service";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  return jsonOk({ ok: true, ...await readSessionGameReminders(auth.member.id, auth.sessionId, tx => assertGameMemberAuthCurrentTx(auth, tx)) });
});

export const PUT = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const body = await readJsonObject(request, { limitBytes: 64 * 1024 });
  const result = await runGameCommand({ actorMemberId: auth.member.id, reminderSessionId: auth.sessionId, command: { ...body, type: "setReminders" },
    beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) });
  if (!result.ok) throw gameCommandError(result.error, result.status);
  return jsonOk({ ok: true, ...result.reminders });
});

const minutes = z.number().int().min(0).max(1439);
const gameId = z.string().min(1).max(128);
const change = z.union([
  z.strictObject({ push: z.boolean() }), z.strictObject({ text: z.boolean() }), z.strictObject({ minutes }),
  z.strictObject({ gameId, on: z.boolean() }), z.strictObject({ gameId, minutes: minutes.nullable() }),
]);

export const PATCH = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const parsed = change.safeParse(await readJsonObject(request, { limitBytes: 4096 }));
  if (!parsed.success) throw invalidGameRequest("Choose one reminder setting to change.");
  const edit = parsed.data;
  const settings = await withGameRuleErrors(() => editGameReminders({
    actorMemberId: auth.member.id, beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx),
  }, edit, "gameId" in edit ? [edit.gameId] : undefined));
  return jsonOk({ ok: true, ...settings });
});
