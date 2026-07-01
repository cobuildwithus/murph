import { deviceSyncError } from "@murphai/device-syncd/errors";

import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";
import { resolveHostedDeviceSyncPublicBaseUrl } from "@/src/lib/device-sync/public-base-url";
import { buildHostedDeviceSyncSettingsSurfaceResponse } from "@/src/lib/device-sync/sidebar-status-service";
import {
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
  const env = readHostedDeviceSyncEnvironment(process.env);
  const publicBaseUrl = resolveHostedDeviceSyncPublicBaseUrl(request, env).baseUrl;
  const settings = await buildHostedDeviceSyncSettingsSurfaceResponse({
    memberId: auth.member.id,
    publicBaseUrl,
  });
  const source = settings.sources.find((entry) => entry.connectionId === connectionId) ?? null;

  if (!source) {
    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }

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
