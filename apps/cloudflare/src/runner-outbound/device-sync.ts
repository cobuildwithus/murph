import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  fetchHostedExecutionWebControlPlaneResponse,
  type HostedExecutionDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest,
} from "@murphai/hosted-execution";

import { readHostedExecutionEnvironment } from "../env.ts";
import { json, methodNotAllowed, notFound, readJsonObject } from "../json.ts";
import {
  decodeRouteParam,
  readNullableIsoOrStringField,
  readNullableIsoTimestamp,
  readNullablePositiveInteger,
  readNullableString,
  requireArray,
  requireBoolean,
  requirePositiveInteger,
  requireRecord,
  requireRunnerOutboundHostedWebControlConfig,
  requireRunnerOutboundUserStubMethod,
  requireString,
  requireStringArray,
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
      env: input.env,
      provider: decodeRouteParam(connectLinkMatch.groups.provider),
      signingSecret: input.environment.webInternalSigningSecret,
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
        request: parseHostedDeviceSyncRuntimeSnapshotRequest(
          await readJsonObject(input.request),
          input.userId,
        ),
      }),
    );
  }

  return json(
    await requireRunnerOutboundUserStubMethod(stub, "applyDeviceSyncRuntimeUpdates")({
      request: parseHostedDeviceSyncRuntimeApplyRequest(await readJsonObject(input.request), input.userId),
    }),
  );
}

async function forwardRunnerDeviceSyncConnectLinkRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  provider: string;
  signingSecret: string;
  userId: string;
}): Promise<Response> {
  const config = requireRunnerOutboundHostedWebControlConfig(input.env);
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: config.baseUrl,
    boundUserId: input.userId,
    method: "POST",
    path: buildHostedExecutionDeviceSyncConnectLinkPath(input.provider),
    signingSecret: input.signingSecret,
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

function parseHostedDeviceSyncRuntimeSnapshotRequest(
  value: Record<string, unknown>,
  trustedUserId: string,
): HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  return {
    ...(value.connectionId === undefined
      ? {}
      : { connectionId: readNullableString(value.connectionId, "connectionId") }),
    ...(value.provider === undefined
      ? {}
      : { provider: readNullableString(value.provider, "provider") }),
    userId: resolveTrustedUserId(value.userId, trustedUserId),
  };
}

function parseHostedDeviceSyncRuntimeApplyRequest(
  value: Record<string, unknown>,
  trustedUserId: string,
): HostedExecutionDeviceSyncRuntimeApplyRequest {
  const updates = requireArray(value.updates, "updates").map((entry, index) =>
    parseHostedDeviceSyncRuntimeConnectionUpdate(entry, index)
  );
  assertUniqueDeviceSyncConnectionIds(updates);

  return {
    ...(value.occurredAt === undefined
      ? {}
      : { occurredAt: readNullableIsoTimestamp(value.occurredAt, "occurredAt") }),
    updates,
    userId: resolveTrustedUserId(value.userId, trustedUserId),
  };
}

function resolveTrustedUserId(value: unknown, trustedUserId: string): string {
  if (value !== undefined && value !== trustedUserId) {
    throw new TypeError("userId must match the authenticated hosted execution user.");
  }

  return trustedUserId;
}

function parseHostedDeviceSyncRuntimeConnectionUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  const record = requireRecord(value, `updates[${index}]`);

  return {
    connectionId: requireString(record.connectionId, `updates[${index}].connectionId`),
    ...(record.connection === undefined
      ? {}
      : { connection: parseHostedDeviceSyncRuntimeConnectionStateUpdate(record.connection, index) }),
    ...(record.localState === undefined
      ? {}
      : { localState: parseHostedDeviceSyncRuntimeLocalStateUpdate(record.localState, index) }),
    ...(record.observedUpdatedAt === undefined
      ? {}
      : { observedUpdatedAt: readNullableIsoTimestamp(record.observedUpdatedAt, `updates[${index}].observedUpdatedAt`) }),
    ...(record.observedTokenVersion === undefined
      ? {}
      : { observedTokenVersion: readNullablePositiveInteger(record.observedTokenVersion, `updates[${index}].observedTokenVersion`) }),
    ...(record.tokenBundle === undefined
      ? {}
      : { tokenBundle: parseHostedDeviceSyncRuntimeTokenBundle(record.tokenBundle, `updates[${index}].tokenBundle`) }),
  };
}

function parseHostedDeviceSyncRuntimeConnectionStateUpdate(
  value: unknown,
  index: number,
): NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["connection"]> {
  const record = requireRecord(value, `updates[${index}].connection`);
  const result: NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["connection"]> = {};

  if (Object.prototype.hasOwnProperty.call(record, "displayName")) {
    result.displayName = readNullableString(record.displayName, `updates[${index}].connection.displayName`);
  }
  if (Object.prototype.hasOwnProperty.call(record, "metadata")) {
    result.metadata = requireRecord(record.metadata, `updates[${index}].connection.metadata`);
  }
  if (Object.prototype.hasOwnProperty.call(record, "scopes")) {
    result.scopes = requireStringArray(record.scopes, `updates[${index}].connection.scopes`);
  }
  if (Object.prototype.hasOwnProperty.call(record, "status")) {
    const status = requireString(record.status, `updates[${index}].connection.status`);
    if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
      throw new TypeError(`updates[${index}].connection.status is invalid.`);
    }
    result.status = status;
  }

  return result;
}

function parseHostedDeviceSyncRuntimeLocalStateUpdate(
  value: unknown,
  index: number,
): NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["localState"]> {
  const record = requireRecord(value, `updates[${index}].localState`);
  const result: NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["localState"]> = {};

  if (Object.prototype.hasOwnProperty.call(record, "clearError")) {
    result.clearError = requireBoolean(record.clearError, `updates[${index}].localState.clearError`);
  }

  for (const field of [
    "lastErrorCode",
    "lastErrorMessage",
    "lastSyncCompletedAt",
    "lastSyncErrorAt",
    "lastSyncStartedAt",
    "lastWebhookAt",
    "nextReconcileAt",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      result[field] = readNullableIsoOrStringField(record[field], `updates[${index}].localState.${field}`);
    }
  }

  return result;
}

function parseHostedDeviceSyncRuntimeTokenBundle(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionUpdate["tokenBundle"] {
  if (value === null) {
    return null;
  }

  const record = requireRecord(value, label);
  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requirePositiveInteger(record.tokenVersion, `${label}.tokenVersion`),
  };
}

function assertUniqueDeviceSyncConnectionIds(
  updates: readonly HostedExecutionDeviceSyncRuntimeConnectionUpdate[],
): void {
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.connectionId)) {
      throw new TypeError("updates must not contain duplicate connectionIds.");
    }
    seen.add(update.connectionId);
  }
}
