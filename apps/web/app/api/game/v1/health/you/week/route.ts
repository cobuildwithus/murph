import { assertHealthYouEnabled } from "@/src/lib/health-wins/flag";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readPrivateYou } from "@/src/lib/health-you/read";

export const GET = withHealthRoute(async (request, auth) => {
  assertHealthYouEnabled(auth.member.id);
  return Response.json(await readPrivateYou(auth, "week", request.signal));
});
