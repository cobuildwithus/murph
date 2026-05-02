import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsResponse,
} from "@/src/lib/device-sync/settings-surface";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const { connectionSources, connections, providers } = await controlPlane.listConnections(auth.member.id);

  return jsonOk({
    generatedAt: new Date().toISOString(),
    ok: true,
    sources: buildHostedDeviceSyncSettingsSources({
      connectionSources,
      connections,
      providers,
    }),
  } satisfies HostedDeviceSyncSettingsResponse);
});
