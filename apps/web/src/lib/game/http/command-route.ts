import { jsonOk, readJsonObject } from "../../hosted-onboarding/http";
import { runGameCommand } from "../service";
import { requireGameMember } from "./auth";
import { gameCommandError } from "./errors";

const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Every write route: the signed-in member, the size-capped JSON body folded
 * into one command with the path's ids, then the one write path, which
 * validates it. Path ids win over anything in the body. Every command is safe
 * to retry: it's keyed by its own ids or state.
 */
export async function respondToGameCommand(
  request: Request,
  command: (body: Record<string, unknown>) => Record<string, unknown>,
  options: { body: boolean; inviteToken?: string } = { body: true },
): Promise<Response> {
  const memberId = await requireGameMember(request, options.inviteToken);
  const body = options.body ? await readJsonObject(request, { limitBytes: BODY_LIMIT_BYTES }) : {};
  const result = await runGameCommand({ actorMemberId: memberId, command: command(body) });
  if (!result.ok) throw gameCommandError(result.error, result.status);
  return jsonOk({ ok: true, game: result.game, ...(result.profile ? { profile: result.profile } : {}) });
}
