import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsSource,
} from "@/src/lib/device-sync/settings-surface";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireHostedPrivyActiveRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const auth = await requireHostedPrivyActiveRequestAuthContext(request);
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const [{ connection }, { providers }] = await Promise.all([
    controlPlane.getConnectionStatus(auth.member.id, connectionId),
    controlPlane.listConnections(auth.member.id),
  ]);

  return jsonOk({
    generatedAt: new Date().toISOString(),
    ok: true,
    source: buildHostedDeviceSyncSettingsSources({
      connections: [connection],
      providers,
    })[0] ?? null,
  } satisfies {
    generatedAt: string;
    ok: true;
    source: HostedDeviceSyncSettingsSource | null;
  });
});
