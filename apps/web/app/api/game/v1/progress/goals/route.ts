import { clientUnits } from "@/src/lib/companion/client-info";
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { parseGoalsQuery } from "@/src/lib/game/progress/contract";
import { readGoalContext } from "@/src/lib/game/progress/goal-context";
import { getPrisma } from "@/src/lib/prisma";
import { readGoals } from "@/src/lib/game/progress/goals";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";
import { progressEffect, withProgressJsonError } from "@/src/lib/game/progress/http";

export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const units = clientUnits(request);
  const query = parseGoalsQuery(Object.fromEntries(new URL(request.url).searchParams));
  return progressEffect(async () => {
    const context = await readGoalContext(auth, query.measure, request.signal);
    const goals = await readGoals(auth.member.id, query, units, context);
    await context.beforeMutationTx(getPrisma());
    return jsonOk(goals);
  });
}));
