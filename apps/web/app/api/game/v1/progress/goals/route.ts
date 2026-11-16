import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { parseGoalsQuery } from "@/src/lib/game/progress/contract";
import { readGoals } from "@/src/lib/game/progress/goals";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";
import { progressEffect, withProgressJsonError } from "@/src/lib/game/progress/http";

export const GET = withProgressJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const query = parseGoalsQuery(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await progressEffect(() => readGoals(auth.member.id, query)));
}));
