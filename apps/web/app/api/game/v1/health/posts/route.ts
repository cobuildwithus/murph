import { clientUnits } from "@/src/lib/companion/client-info";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { createPostBody, readHealthBody } from "@/src/lib/health-wins/request";
import { createHealthPost } from "@/src/lib/health-wins/writes";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

// Route paintings run after the response under the shared four-minute art deadline.
export const maxDuration = 300;

export const POST = withHealthRoute(async (request, auth) => {
  return jsonOk(await createHealthPost(auth, await readHealthBody(request, createPostBody), clientUnits(request), request.signal));
});
