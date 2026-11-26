import { readHealthHides } from "@/src/lib/health-wins/hides";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (_request, auth) => {
  return jsonOk(await readHealthHides(auth));
});
