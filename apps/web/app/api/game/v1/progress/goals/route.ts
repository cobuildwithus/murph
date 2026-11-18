import { clientUnits } from "@/src/lib/companion/client-info";
import { requireGameMemberAuth, assertGameMemberAuthCurrentTx } from "@/src/lib/game/http/auth";
import { parseGoalsQuery } from "@/src/lib/game/progress/contract";
import { readStepsGoals } from "@/src/lib/game/progress/health-reader";
import { readGoals } from "@/src/lib/game/progress/goals";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";
import { progressEffect, withProgressJsonError } from "@/src/lib/game/progress/http";

export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const units = clientUnits(request);
  const query = parseGoalsQuery(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await progressEffect(() => query.measure === "steps"
    ? readStepsGoals(auth, request.signal, query, units)
    : readGoals(auth.member.id, query, units, tx => assertGameMemberAuthCurrentTx(auth, tx))));
}));
