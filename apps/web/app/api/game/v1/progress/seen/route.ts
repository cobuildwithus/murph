import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { requireGameMemberAuth, assertGameMemberAuthCurrentTx } from "@/src/lib/game/http/auth";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { parseSeenBody } from "@/src/lib/game/progress/contract";
import { seeMoments } from "@/src/lib/game/progress/view";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const raw = await readJsonObject(request, { limitBytes: 4096 }).catch(error => {
    if (error instanceof RequestInputError) throw invalidGameRequest("Send a JSON object.");
    throw error;
  });
  const { momentIds } = parseSeenBody(raw);
  await seeMoments(auth.member.id, momentIds, tx => assertGameMemberAuthCurrentTx(auth, tx));
  return jsonOk({ ok: true }, 200, { "Cache-Control": "private, no-store" });
}));
