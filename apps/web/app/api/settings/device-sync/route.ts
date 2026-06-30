import {
  buildHostedDeviceSyncSettingsSurfaceResponse,
} from "@/src/lib/device-sync/sidebar-status-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedAppSessionFromRequest(request);

  return jsonOk(await buildHostedDeviceSyncSettingsSurfaceResponse({
    memberId: auth.member.id,
  }));
});
