import { withProgressReadTiming, type ProgressReadTiming } from "@/src/lib/game/progress/read-timing";
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { clientUnits } from "@/src/lib/companion/client-info";
import { parseFriendsQuery } from "@/src/lib/game/progress/contract";
import { readProgressEveryone } from "@/src/lib/game/progress/everyone";
import { readProgressFriends } from "@/src/lib/game/progress/friends-reader";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const GET = withProgressReadTiming("/api/game/v1/progress/friends", withJsonError(async (request: Request, timing: ProgressReadTiming) => {
  const auth = await timing.measure("auth", () => requireGameMemberAuth(request));
  const query = parseFriendsQuery(Object.fromEntries(new URL(request.url).searchParams));
  timing.selectPill(query.measure);
  timing.selectScope(query.scope ?? "friends");
  const read = query.scope === "everyone" ? readProgressEveryone : readProgressFriends;
  const view = await read(auth, query, request.signal, clientUnits(request), timing);
  return timing.measure("render", () => jsonOk(view, 200, { "Cache-Control": "private, no-store" }));
}));
