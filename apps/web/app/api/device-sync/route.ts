import {
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/provider-configs";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  listConfiguredDeviceSyncPublicProviderDescriptors,
} from "@murphai/device-syncd/public-provider-descriptors";

import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/http";

export const GET = withJsonError(async (request: Request) => {
  const env = readHostedDeviceSyncEnvironment(process.env);

  return jsonOk({
    ok: true,
    providers: listConfiguredDeviceSyncPublicProviderDescriptors(
      readConfiguredDeviceSyncProviderConfigs(process.env),
      { publicBaseUrl: resolveHostedDeviceSyncRootPublicBaseUrl(request, env) },
    ),
  });
});

function resolveHostedDeviceSyncRootPublicBaseUrl(
  request: Request,
  env: ReturnType<typeof readHostedDeviceSyncEnvironment>,
): string {
  if (env.publicBaseUrl) {
    return env.publicBaseUrl.replace(/\/+$/u, "");
  }

  if (env.isProduction) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_PUBLIC_BASE_URL_REQUIRED",
      message:
        "Hosted device-sync public callback and webhook routes require DEVICE_SYNC_PUBLIC_BASE_URL or a canonical hosted public URL in production.",
      retryable: false,
      httpStatus: 500,
    });
  }

  return `${new URL(request.url).origin}/api/device-sync`;
}
