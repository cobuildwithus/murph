import {
  buildHostedDeviceSyncSettingsSurfaceResponse,
} from "@/src/lib/device-sync/sidebar-status-service";
import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";
import { resolveHostedDeviceSyncPublicBaseUrl } from "@/src/lib/device-sync/public-base-url";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const env = readHostedDeviceSyncEnvironment(process.env);
  const publicBaseUrl = resolveHostedDeviceSyncPublicBaseUrl(request, env).baseUrl;

  return jsonOk(await buildHostedDeviceSyncSettingsSurfaceResponse({
    memberId: auth.member.id,
    publicBaseUrl,
  }));
});
