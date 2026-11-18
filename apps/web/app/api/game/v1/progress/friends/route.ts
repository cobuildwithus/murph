import { withProgressReadTiming, type ProgressReadTiming } from "@/src/lib/game/progress/read-timing";
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { clientUnits } from "@/src/lib/companion/client-info";
import { parseFriendsQuery } from "@/src/lib/game/progress/contract";
import { readProgressFriends } from "@/src/lib/game/progress/friends-reader";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const GET = withProgressReadTiming("/api/game/v1/progress/friends", withJsonError(async (request: Request, timing: ProgressReadTiming) => {
  const auth = await timing.measure("auth", () => requireGameMemberAuth(request));
  const query = parseFriendsQuery(Object.fromEntries(new URL(request.url).searchParams));
  timing.selectPill(query.measure);
  const view = await readProgressFriends(auth, query, request.signal, clientUnits(request), timing);
  return timing.measure("render", () => jsonOk(view, 200, { "Cache-Control": "private, no-store" }));
}));
