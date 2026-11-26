import { setHealthHide } from "@/src/lib/health-wins/hides";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { healthMemberId, type HealthMemberContext } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const PUT = withHealthRoute(async (_request, auth, context: HealthMemberContext) => {
  return jsonOk(await setHealthHide(auth, await healthMemberId(context), true));
});
export const DELETE = withHealthRoute(async (_request, auth, context: HealthMemberContext) => {
  return jsonOk(await setHealthHide(auth, await healthMemberId(context), false));
});
