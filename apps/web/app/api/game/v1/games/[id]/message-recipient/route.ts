import type { GameMessageRecipientView } from "@/src/lib/game/contract";
import { requireGameMember } from "@/src/lib/game/http/auth";
import { gameNotFound } from "@/src/lib/game/http/errors";
import { readGameMessageRecipient } from "@/src/lib/game/message-recipient";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

/** Message on a live pair game: `{ ok, phone }`, the other player's number or null. */
export const GET = withJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const memberId = await requireGameMember(request);
  const phone = await readGameMessageRecipient(await resolveDecodedRouteParam(context.params, "id"), memberId);
  if (phone === undefined) throw gameNotFound();
  return jsonOk({ ok: true, phone } satisfies GameMessageRecipientView);
});
