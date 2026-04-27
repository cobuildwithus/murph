import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { buildHostedDeviceSyncSettingsSources } from "@/src/lib/device-sync/settings-surface";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  summarizeSidebarDeviceSyncStatus,
  type SidebarDeviceSyncStatusResponse,
} from "@/src/lib/device-sync/sidebar-status";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActivePrivyMemberAuth(request);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const { connections, providers } = await controlPlane.listConnections(auth.member.id);
  const sources = buildHostedDeviceSyncSettingsSources({
    connections,
    providers,
  });

  return jsonOk({
    generatedAt: new Date().toISOString(),
    ok: true,
    status: summarizeSidebarDeviceSyncStatus(sources),
  } satisfies SidebarDeviceSyncStatusResponse);
});
