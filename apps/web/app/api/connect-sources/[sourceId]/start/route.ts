import { normalizeDeviceSyncConnectTargetKey } from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { buildHostedDeviceConnectCompletionReturnTo } from "@/src/lib/device-sync/connect-completion-return";
import {
  resolveHostedConnectSourceTarget,
  startHostedDeviceSyncConnection,
  type HostedConnectSourceTargetSelector,
} from "@/src/lib/device-sync/hosted-connect-start";
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
  const selector = await readHostedConnectSourceTargetSelector(request);
  const target = resolveHostedConnectSourceTarget(sourceId, selector);

  const started = await startHostedDeviceSyncConnection({
    defaultReturnTo: buildHostedDeviceConnectCompletionReturnTo({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      source: "connect",
    }),
    request,
    target,
  });
  const response = jsonOk({
    authorizationUrl: started.authorizationUrl,
  });
  response.headers.append("Set-Cookie", started.callbackProofCookie);
  return response;
});

async function readHostedConnectSourceTargetSelector(
  request: Request,
): Promise<HostedConnectSourceTargetSelector | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  const body = await request.clone().json().catch(() => null);
  if (!isRecord(body)) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_SOURCE_SELECTOR_INVALID",
      httpStatus: 400,
      message: "Hosted device connect source selector is invalid.",
      retryable: false,
    });
  }

  const selector = {
    connectTarget: normalizeDeviceSyncConnectTargetKey(readOptionalString(body.connectTarget) ?? ""),
    provider: normalizeDeviceSyncConnectTargetKey(readOptionalString(body.provider) ?? ""),
    sourceProviderSlug: normalizeDeviceSyncConnectTargetKey(readOptionalString(body.sourceProviderSlug) ?? ""),
  };

  return selector.connectTarget || selector.provider || selector.sourceProviderSlug
    ? selector
    : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
