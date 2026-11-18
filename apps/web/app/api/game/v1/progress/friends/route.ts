import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { clientUnits } from "@/src/lib/companion/client-info";
import { parseFriendsQuery } from "@/src/lib/game/progress/contract";
import { readProgressFriends } from "@/src/lib/game/progress/friends-reader";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const GET = withJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const query = parseFriendsQuery(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await readProgressFriends(auth, query, request.signal, clientUnits(request)), 200, { "Cache-Control": "private, no-store" });
}));
