import { clientUnits } from "@/src/lib/companion/client-info";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readWinsRefresh } from "@/src/lib/health-wins/request";
import { readHealthWins } from "@/src/lib/health-wins/wins";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (request, auth) => {
  return jsonOk(await readHealthWins(auth, { signal: request.signal, refresh: readWinsRefresh(request), units: clientUnits(request) }));
});
