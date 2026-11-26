import { clientUnits } from "@/src/lib/companion/client-info";
import { assertHealthRecordEnabled } from "@/src/lib/health-wins/flag";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { previewRecordedActivity } from "@/src/lib/health-wins/recorded-activities";
import { previewActivityBody, readHealthBody } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const POST = withHealthRoute(async (request, auth) => {
  assertHealthRecordEnabled(auth.member.id);
  const { activity } = await readHealthBody(request, previewActivityBody);
  return jsonOk(await previewRecordedActivity(auth, activity, clientUnits(request)));
});
