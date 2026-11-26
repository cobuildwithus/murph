import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { assertHealthRecordEnabled } from "@/src/lib/health-wins/flag";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { saveRecordedActivity } from "@/src/lib/health-wins/recorded-activities";
import { type HealthIdContext, healthRowId, readHealthBody, saveActivityBody } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const PUT = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  assertHealthRecordEnabled(auth.member.id);
  const id = await healthRowId(context);
  const { activity } = await readHealthBody(request, saveActivityBody);
  if (activity.route) assertHealthRecordEnabled(auth.member.id, "route");
  if (activity.id !== id) throw invalidGameRequest("Use the activity ID from the recording.");
  return jsonOk(await saveRecordedActivity(auth, activity));
});
