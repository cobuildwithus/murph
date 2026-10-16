import { requireGameMember } from "@/src/lib/game/http/auth";
import { parseGameCommandRequest } from "@/src/lib/game/http/command-request";
import { gameCommandError } from "@/src/lib/game/http/errors";
import { assertCommandMediaUploaded } from "@/src/lib/game/http/media-routes";
import { runGameCommand } from "@/src/lib/game/service";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

const COMMAND_BODY_LIMIT_BYTES = 64 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireGameMember(request);
  const commandRequest = parseGameCommandRequest(
    await readJsonObject(request, { limitBytes: COMMAND_BODY_LIMIT_BYTES }),
    request.headers.get("idempotency-key"),
  );
  await assertCommandMediaUploaded(memberId, commandRequest.command);
  const result = await runGameCommand({ actorMemberId: memberId, request: commandRequest });
  if (!result.ok) throw gameCommandError(result.error, result.status);
  return jsonOk({ ok: true, game: result.game });
});
