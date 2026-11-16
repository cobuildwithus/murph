import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { parseGoalsQuery } from "@/src/lib/game/progress/contract";
import { readGoals } from "@/src/lib/game/progress/goals";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const query = parseGoalsQuery(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await readGoals(auth.member.id, query), 200, { "Cache-Control": "private, no-store" });
}));
