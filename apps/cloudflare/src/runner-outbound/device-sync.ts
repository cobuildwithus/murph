import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
} from "@murphai/device-syncd/hosted-runtime";

import { readHostedExecutionEnvironment } from "../env.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import { json, methodNotAllowed, notFound, readJsonObject } from "../json.ts";
import {
  decodeRouteParam,
  requireRunnerOutboundHostedWebControlConfig,
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

export async function handleRunnerDeviceSyncControlRequest(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  const connectLinkMatch = /^\/api\/internal\/device-sync\/providers\/(?<provider>[^/]+)\/connect-link$/u.exec(
    input.url.pathname,
  );

  if (connectLinkMatch?.groups) {
    if (input.request.method !== "POST") {
      return methodNotAllowed();
    }

    return forwardRunnerDeviceSyncConnectLinkRequest({
      callbackSigning: input.environment.webCallbackSigning,
      env: input.env,
      provider: decodeRouteParam(connectLinkMatch.groups.provider),
      userId: input.userId,
    });
  }

  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  if (
    input.url.pathname !== HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    && input.url.pathname !== HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH
  ) {
    return notFound();
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);

  if (input.url.pathname === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH) {
    return json(
      await requireRunnerOutboundUserStubMethod(stub, "getDeviceSyncRuntimeSnapshot")({
        request: parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
          await readJsonObject(input.request),
          input.userId,
        ),
      }),
    );
  }

  return json(
    await requireRunnerOutboundUserStubMethod(stub, "applyDeviceSyncRuntimeUpdates")({
      request: parseRunnerHostedExecutionDeviceSyncRuntimeApplyRequest(
        await readJsonObject(input.request),
        input.userId,
      ),
    }),
  );
}

async function forwardRunnerDeviceSyncConnectLinkRequest(input: {
  callbackSigning: ReturnType<typeof readHostedExecutionEnvironment>["webCallbackSigning"];
  env: RunnerOutboundEnvironmentSource;
  provider: string;
  userId: string;
}): Promise<Response> {
  const config = requireRunnerOutboundHostedWebControlConfig(input.env);
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: config.baseUrl,
    boundUserId: input.userId,
    callbackSigning: input.callbackSigning,
    method: "POST",
    path: buildHostedExecutionDeviceSyncConnectLinkPath(input.provider),
    timeoutMs: null,
  });

  return new Response(await response.text(), {
    headers: {
      "Cache-Control": response.headers.get("Cache-Control") ?? "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
    status: response.status,
  });
}

function parseRunnerHostedExecutionDeviceSyncRuntimeApplyRequest(
  value: Record<string, unknown>,
  trustedUserId: string,
) {
  const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest(value, trustedUserId);

  for (const update of parsed.updates) {
    if (update.seed !== undefined) {
      throw new TypeError("Runner device-sync runtime apply requests must not include seeded connections.");
    }
  }

  return parsed;
}
