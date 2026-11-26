import { decideHealthActivityKind } from "@/src/lib/health-wins/activity-kind";
import { admitActivityName } from "@/src/lib/health-wins/activity-name";
import { assertHealthRecordEnabled } from "@/src/lib/health-wins/flag";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { activityKindBody, readHealthBody } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const POST = withHealthRoute(async (request, auth) => {
  const memberId = auth.member.id;
  const record = assertHealthRecordEnabled(memberId);
  const body = await readHealthBody(request, activityKindBody);
  const name = admitActivityName(body.name, "choice");
  return jsonOk(await decideHealthActivityKind({ name, memberId, routeEnabled: record.route, signal: request.signal }));
});
