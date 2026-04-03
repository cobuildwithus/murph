import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsResponse,
} from "@/src/lib/device-sync/settings-surface";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireHostedPrivyActiveRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireHostedPrivyActiveRequestAuthContext(request);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const { connections, providers } = await controlPlane.listConnections(auth.member.id);

  return jsonOk({
    generatedAt: new Date().toISOString(),
    ok: true,
    sources: buildHostedDeviceSyncSettingsSources({
      connections,
      providers,
    }),
  } satisfies HostedDeviceSyncSettingsResponse);
});
