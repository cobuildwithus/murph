import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readHealthPayoffs } from "@/src/lib/health-wins/payoff";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (request, auth) => {
  return jsonOk(await readHealthPayoffs(auth, request.signal));
});
