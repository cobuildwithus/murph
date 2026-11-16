import { requireGameMemberAuth, assertGameMemberAuthCurrentTx } from "@/src/lib/game/http/auth";
import { readProgress } from "@/src/lib/game/progress/view";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";
import { progressEffect, withProgressJsonError } from "@/src/lib/game/progress/http";

export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const view = await progressEffect(() => readProgress(auth.member.id, tx => assertGameMemberAuthCurrentTx(auth, tx)));
  return jsonOk(view, 200, { "Cache-Control": "private, no-store" });
}));
