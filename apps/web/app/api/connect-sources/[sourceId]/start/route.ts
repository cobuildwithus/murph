import {
  readConfiguredDeviceSyncConnectTargetConfigs,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { buildHostedDeviceConnectCompletionReturnTo } from "@/src/lib/device-sync/connect-completion-return";
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
    defaultReturnTo: buildHostedDeviceConnectCompletionReturnTo({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      source: "connect",
    }),
    request,
    target,
  }));
});

function resolveHostedConnectSourceTarget(sourceId: string) {
  const target = resolveConfiguredDeviceSyncConnectTargetBySourceId(
    readConfiguredDeviceSyncConnectTargetConfigs(process.env),
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
