import type { GameView } from "../contract";
import { jsonOk, readJsonObject } from "../../hosted-onboarding/http";
import { runGameCommand } from "../service";
import { assertGameMemberAuthCurrentTx, requireCurrentTermsFor, requireGameMemberAuth } from "./auth";
import { gameCommandError, withGameServiceFailures } from "./errors";
import { hasGameMultiplayer } from "./capability";

const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Every write route: the signed-in member, the size-capped JSON body folded
 * into one command with the path's ids, then the one write path, which
 * validates it. Path ids win over anything in the body. Every command is safe
 * to retry: it's keyed by its own ids or state. `answer` may add to the game
 * the command answers with, once it has been applied. The session is checked
 * again inside the write's transaction, and a failure past the body read is
 * ours, so the app keeps its copy and tries again.
 */
export async function respondToGameCommand(
  request: Request,
  command: (body: Record<string, unknown>) => Record<string, unknown>,
  options: {
    answer?: (game: GameView, input: { command: Record<string, unknown>; memberId: string }) => Promise<GameView>;
    body: boolean;
    limitBytes?: number;
    inviteToken?: string;
  } = { body: true },
): Promise<Response> {
  const auth = await withGameServiceFailures(() => requireGameMemberAuth(request, options.inviteToken));
  const memberId = auth.member.id;
  const body = options.body ? await readJsonObject(request, { limitBytes: options.limitBytes ?? BODY_LIMIT_BYTES }) : {};
  const built = command(body);
  return withGameServiceFailures(async () => {
    await requireCurrentTermsFor(memberId, built);
    const result = await runGameCommand({ actorMemberId: memberId, command: built, multiplayer: hasGameMultiplayer(request),
      beforeMutationTx: tx => assertGameMemberAuthCurrentTx(auth, tx) });
    if (!result.ok) throw gameCommandError(result.error, result.status);
    const game = result.game && options.answer ? await options.answer(result.game, { command: built, memberId }) : result.game;
    return jsonOk({ ok: true, game, ...(result.profile ? { profile: result.profile } : {}) });
  });
}
