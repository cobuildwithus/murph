import {
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/provider-configs";
import {
  listConfiguredDeviceSyncPublicProviderDescriptors,
} from "@murphai/device-syncd/public-provider-descriptors";

import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/http";
import { resolveHostedDeviceSyncPublicBaseUrl } from "@/src/lib/device-sync/public-base-url";

export const GET = withJsonError(async (request: Request) => {
  const env = readHostedDeviceSyncEnvironment(process.env);

  return jsonOk({
    ok: true,
    providers: listConfiguredDeviceSyncPublicProviderDescriptors(
      readConfiguredDeviceSyncProviderConfigs(process.env),
      { publicBaseUrl: resolveHostedDeviceSyncPublicBaseUrl(request, env).baseUrl },
    ),
  });
});
