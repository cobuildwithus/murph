import {
  readConfiguredDeviceSyncProviderConfigs,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
} from "@murphai/device-syncd/config";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { startHostedDeviceSyncConnection } from "@/src/lib/device-sync/hosted-connect-start";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted connect source start routes only allow POST because starting a connection mutates server state.",
    },
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
  });
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) => {
  const sourceId = await resolveDecodedRouteParam(context.params, "sourceId");
  const target = resolveHostedConnectSourceTarget(sourceId);

  return jsonOk(await startHostedDeviceSyncConnection({
    defaultReturnTo: "/connect",
    request,
    target,
  }));
});

function resolveHostedConnectSourceTarget(sourceId: string) {
  const target = resolveConfiguredDeviceSyncConnectTargetBySourceId(
    readConfiguredDeviceSyncProviderConfigs(process.env),
    sourceId,
  );

  if (!target) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect source is not configured.",
      retryable: false,
    });
  }

  return target;
}
