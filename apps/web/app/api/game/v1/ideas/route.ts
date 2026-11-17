import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { requireGameMember } from "@/src/lib/game/http/auth";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { parseGameIdeasInput } from "@/src/lib/game/ideas/input";
import { suggestGameIdeas } from "@/src/lib/game/ideas/service";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireGameMember(request);
  const body = await readJsonObject(request, { limitBytes: 16 * 1024 }).catch(error => {
    // JSON parse messages can quote private input. Map them before route logging.
    if (error instanceof RequestInputError) throw invalidGameRequest("Send a JSON object.");
    throw error;
  });
  const input = parseGameIdeasInput(body);
  const ideas = await suggestGameIdeas(memberId, input);
  return jsonOk({ ok: true, ideas }, 200, { "Cache-Control": "private, no-store" });
});
