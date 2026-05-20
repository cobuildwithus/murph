import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsSource,
} from "@/src/lib/device-sync/settings-surface";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const [{ connection }, settings] = await Promise.all([
    controlPlane.getConnectionStatus(auth.member.id, connectionId),
    controlPlane.listConnections(auth.member.id),
  ]);
  const connections = settings.connections.some((entry) => entry.id === connection.id)
    ? settings.connections.map((entry) => entry.id === connection.id ? connection : entry)
    : [connection, ...settings.connections];
  const source = buildHostedDeviceSyncSettingsSources({
    connectionSources: settings.connectionSources,
    connections,
    providers: settings.providers,
  }).find((entry) => entry.connectionId === connection.id) ?? null;

  return jsonOk({
    generatedAt: new Date().toISOString(),
    ok: true,
    source,
  } satisfies {
    generatedAt: string;
    ok: true;
    source: HostedDeviceSyncSettingsSource | null;
  });
});
