import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readHealthProfile } from "@/src/lib/health-wins/read";
import { healthMemberId, readHealthCursor, type HealthMemberContext } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (request, auth, context: HealthMemberContext) => {
  return jsonOk(await readHealthProfile(auth, await healthMemberId(context), readHealthCursor(request)));
});
