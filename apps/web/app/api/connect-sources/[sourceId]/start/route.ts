import {
  listConfiguredDeviceSyncReconnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
  readConfiguredDeviceSyncConnectTargetConfigs,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
  type DeviceSyncConnectTarget,
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
  const selector = await readHostedConnectSourceTargetSelector(request);
  const target = resolveHostedConnectSourceTarget(sourceId, selector);

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

type HostedConnectSourceTargetSelector = {
  connectTarget: string | null;
  provider: string | null;
  sourceProviderSlug: string | null;
};

function resolveHostedConnectSourceTarget(
  sourceId: string,
  selector: HostedConnectSourceTargetSelector | null,
) {
  const configs = readHostedConnectSourceTargetConfigs();
  const target = selector && isSpecificHostedConnectSourceTargetSelector(selector)
    ? resolveSelectedHostedConnectSourceTarget(
        listConfiguredDeviceSyncReconnectTargets(configs),
        sourceId,
        selector,
      )
    : resolvePreferredHostedConnectSourceTarget(configs, sourceId, selector);

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

function isSpecificHostedConnectSourceTargetSelector(
  selector: HostedConnectSourceTargetSelector,
): boolean {
  return Boolean(selector.provider || selector.sourceProviderSlug);
}

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

function resolveSelectedHostedConnectSourceTarget(
  targets: readonly DeviceSyncConnectTarget[],
  sourceId: string,
  selector: HostedConnectSourceTargetSelector,
): DeviceSyncConnectTarget | null {
  const requestedSourceId = normalizeDeviceConnectSourceId(sourceId);
  if (!requestedSourceId) {
    return null;
  }

  return targets.find((target) =>
    target.connectSourceId === requestedSourceId
    && (!selector.provider || selector.provider === target.provider)
    && (!selector.connectTarget || selector.connectTarget === target.connectTarget)
    && (
      !selector.sourceProviderSlug
      || selector.sourceProviderSlug === (target.sourceProviderSlug ?? null)
    )
  ) ?? null;
}

function resolvePreferredHostedConnectSourceTarget(
  configs: Parameters<typeof resolveConfiguredDeviceSyncConnectTargetBySourceId>[0],
  sourceId: string,
  selector: HostedConnectSourceTargetSelector | null,
): DeviceSyncConnectTarget | null {
  const target = resolveConfiguredDeviceSyncConnectTargetBySourceId(
    configs,
    sourceId,
  );

  if (!target || (selector?.connectTarget && selector.connectTarget !== target.connectTarget)) {
    return null;
  }

  return target;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readHostedConnectSourceTargetConfigs() {
  try {
    return readConfiguredDeviceSyncConnectTargetConfigs(process.env);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw deviceSyncError({
        cause: {
          errorObservabilityClass: "configuration",
          errorPhase: "connect_target_config",
        },
        code: "HOSTED_DEVICE_CONNECT_SOURCE_CONFIGURATION_UNAVAILABLE",
        httpStatus: 503,
        message: "Hosted device connect source configuration is temporarily unavailable.",
        retryable: true,
      });
    }

    throw error;
  }
}
