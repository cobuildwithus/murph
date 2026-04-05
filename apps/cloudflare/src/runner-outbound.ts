import {
  HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_PROXY_HOSTS,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  fetchHostedExecutionWebControlPlaneResponse,
  normalizeHostedExecutionBaseUrl,
  parseHostedExecutionBundlePayloads,
  parseHostedExecutionBundleRefsRecord,
  parseHostedExecutionSideEffectRecord,
  parseHostedExecutionSideEffects,
  type HostedExecutionAiUsageRecordRequest,
  type HostedExecutionBundleRefs,
  type HostedExecutionDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";
import type { HostedEmailSendRequest } from "@murphai/assistant-runtime";
import { gatewayProjectionSnapshotSchema } from "@murphai/gateway-core";

import { createHostedArtifactStore } from "./bundle-store.ts";
import { createHostedDeviceSyncRuntimeStore } from "./device-sync-runtime-store.ts";
import { createHostedPendingUsageStore } from "./usage-store.ts";
import { createHostedUserKeyStore } from "./user-key-store.js";
import { readHostedExecutionEnvironment } from "./env.ts";
import type {
  HostedExecutionCommitPayload,
  HostedExecutionFinalizePayload,
} from "./execution-journal.ts";
import { json, methodNotAllowed, notFound, readJsonObject } from "./json.ts";
import {
  HostedExecutionSideEffectConflictError,
  createHostedExecutionSideEffectJournalStore,
} from "./outbox-delivery-journal.ts";
import {
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "./hosted-email.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "./worker-contracts.ts";

type RunnerOutboundUserRunnerStubLike = WorkerUserRunnerStubLike;

export interface RunnerOutboundEnvironmentSource extends WorkerEnvironmentContract {}

const RUNNER_INTERNAL_PROXY_HOSTNAMES = new Set<string>([
  HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts,
  HOSTED_EXECUTION_CALLBACK_HOSTS.commit,
  HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
  HOSTED_EXECUTION_CALLBACK_HOSTS.email,
  HOSTED_EXECUTION_CALLBACK_HOSTS.sideEffects,
  HOSTED_EXECUTION_PROXY_HOSTS.usage,
]);

export async function handleRunnerOutboundRequest(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  userId: string,
  internalWorkerProxyToken: string | null = null,
): Promise<Response> {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const url = new URL(request.url);
  const authorizationError = requireRunnerInternalProxyAuthorization(
    request,
    url.hostname,
    internalWorkerProxyToken,
  );
  if (authorizationError) {
    return authorizationError;
  }

  if (url.hostname === HOSTED_EXECUTION_CALLBACK_HOSTS.commit) {
    const match = /^\/events\/(?<eventId>[^/]+)\/(?<action>commit|finalize)$/u.exec(url.pathname);
    if (!match?.groups) {
      return notFound();
    }

    if (request.method !== "POST") {
      return methodNotAllowed();
    }

    const eventId = decodeRouteParam(match.groups.eventId);
    return match.groups.action === "commit"
      ? forwardRunnerCommit(userId, eventId, await readJsonObject(request), env)
      : forwardRunnerFinalize(userId, eventId, await readJsonObject(request), env);
  }

  if (url.hostname === HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts) {
    const match = /^\/objects\/(?<sha256>[a-f0-9]{64})$/u.exec(url.pathname);
    if (!match?.groups) {
      return notFound();
    }

    if (request.method !== "GET" && request.method !== "PUT") {
      return methodNotAllowed();
    }

    return handleRunnerArtifactRequest({
      bucket: env.BUNDLES,
      environment,
      request,
      sha256: match.groups.sha256,
      userId,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.deviceSync) {
    return handleRunnerDeviceSyncControlRequest({
      bucket: env.BUNDLES,
      env,
      environment,
      request,
      url,
      userId,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.usage) {
    return handleRunnerUsageRecordRequest({
      bucket: env.BUNDLES,
      environment,
      request,
      url,
      userId,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_CALLBACK_HOSTS.sideEffects) {
    const match = /^\/(?:intents|effects)\/(?<effectId>[^/]+)$/u.exec(url.pathname);
    if (!match?.groups) {
      return notFound();
    }

    if (request.method !== "DELETE" && request.method !== "GET" && request.method !== "PUT") {
      return methodNotAllowed();
    }

    return handleRunnerSideEffectRequest({
      bucket: env.BUNDLES,
      effectId: decodeRouteParam(match.groups.effectId),
      environment,
      request,
      url,
      userId,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_CALLBACK_HOSTS.email) {
    if (url.pathname === "/send") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return handleRunnerEmailSendRequest({
        bucket: env.BUNDLES,
        env,
        environment,
        request,
        userId,
      });
    }

    const match = /^\/messages\/(?<rawMessageKey>[^/]+)$/u.exec(url.pathname);
    if (!match?.groups) {
      return notFound();
    }

    if (request.method !== "GET") {
      return methodNotAllowed();
    }

    return handleRunnerEmailMessageReadRequest({
      bucket: env.BUNDLES,
      environment,
      rawMessageKey: decodeRouteParam(match.groups.rawMessageKey),
      userId,
    });
  }

  return notFound();
}
async function handleRunnerEmailMessageReadRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  rawMessageKey: string;
  userId: string;
}): Promise<Response> {
  const payload = await readHostedEmailRawMessage({
    bucket: input.bucket,
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    keysById: input.environment.bundleEncryptionKeysById,
    rawMessageKey: input.rawMessageKey,
    userId: input.userId,
  });

  if (!payload) {
    return notFound();
  }

  return new Response(
    copyBytesToArrayBuffer(payload),
    {
      headers: {
        "content-type": "message/rfc822",
      },
      status: 200,
    },
  );
}

async function handleRunnerEmailSendRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  userId: string;
}): Promise<Response> {
  const payload = await sendHostedEmailMessage({
    bucket: input.bucket,
    config: readHostedEmailConfig(
      input.env as unknown as Readonly<Record<string, string | undefined>>,
    ),
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    keysById: input.environment.bundleEncryptionKeysById,
    request: parseHostedEmailSendRequest(await readJsonObject(input.request)),
    userId: input.userId,
  });

  return json({
    ok: true,
    target: payload.target,
  });
}

function parseHostedEmailSendRequest(value: Record<string, unknown>): HostedEmailSendRequest {
  const targetKind = value.targetKind;
  if (targetKind !== "explicit" && targetKind !== "participant" && targetKind !== "thread") {
    throw new TypeError("targetKind must be explicit, participant, or thread.");
  }

  return {
    identityId: readOptionalString(value.identityId, "identityId"),
    message: requireString(value.message, "message"),
    target: requireString(value.target, "target"),
    targetKind,
  };
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function forwardRunnerCommit(
  userId: string,
  eventId: string,
  payload: Record<string, unknown>,
  env: RunnerOutboundEnvironmentSource,
): Promise<Response> {
  const stub = await resolveRunnerOutboundUserRunnerStub(env, userId);
  return json({
    committed: await stub.commit({
      eventId,
      payload: parseHostedExecutionCommitRequest(payload),
    }),
    ok: true,
  });
}

async function forwardRunnerFinalize(
  userId: string,
  eventId: string,
  payload: Record<string, unknown>,
  env: RunnerOutboundEnvironmentSource,
): Promise<Response> {
  const stub = await resolveRunnerOutboundUserRunnerStub(env, userId);
  return json({
    finalized: await stub.finalizeCommit({
      eventId,
      payload: parseHostedExecutionFinalizeRequest(payload),
    }),
    ok: true,
  });
}

async function handleRunnerArtifactRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  sha256: string;
  userId: string;
}): Promise<Response> {
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.userId,
  });
  const artifactStore = createHostedArtifactStore({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    userId: input.userId,
  });

  if (input.request.method === "GET") {
    const bytes = await artifactStore.readArtifact(input.sha256);

    if (!bytes) {
      return notFound();
    }

    return new Response(copyBytesToArrayBuffer(bytes), {
      headers: {
        "content-type": "application/octet-stream",
      },
      status: 200,
    });
  }

  const bytes = new Uint8Array(await input.request.arrayBuffer());
  await artifactStore.writeArtifact(input.sha256, bytes);
  return json({
    ok: true,
    sha256: input.sha256,
    size: bytes.byteLength,
  });
}

async function handleRunnerSideEffectRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  effectId: string;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.userId,
  });
  const journalStore = createHostedExecutionSideEffectJournalStore({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  });

  try {
    if (input.request.method === "GET" || input.request.method === "DELETE") {
      const kindValue = input.url.searchParams.get("kind");
      const fingerprint = input.url.searchParams.get("fingerprint");

      if (!kindValue || !fingerprint) {
        return notFound();
      }

      const kind = requireSideEffectKind(kindValue);

      if (input.request.method === "DELETE") {
        await journalStore.deletePrepared({
          effectId: input.effectId,
          fingerprint,
          kind,
          userId: input.userId,
        });

        return json({
          effectId: input.effectId,
          ok: true,
        });
      }

      const record = await journalStore.read({
        effectId: input.effectId,
        fingerprint,
        kind,
        userId: input.userId,
      });

      return json({
        effectId: record?.effectId ?? input.effectId,
        record: record ?? null,
      });
    }

    const nextRecord = parseHostedExecutionSideEffectRecord(await readJsonObject(input.request));
    if (nextRecord.effectId !== input.effectId) {
      return json({
        error: `effectId mismatch: expected ${input.effectId}, received ${nextRecord.effectId}.`,
      }, 400);
    }

    if (nextRecord.intentId !== input.effectId) {
      return json({
        error: `intentId mismatch: expected ${input.effectId}, received ${nextRecord.intentId}.`,
      }, 400);
    }

    const savedRecord = await journalStore.write({
      record: nextRecord,
      userId: input.userId,
    });

    return json({
      effectId: savedRecord.effectId,
      record: savedRecord,
    });
  } catch (error) {
    if (error instanceof HostedExecutionSideEffectConflictError) {
      return json({
        error: error.message,
      }, 409);
    }

    throw error;
  }
}

async function handleRunnerDeviceSyncControlRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
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
      signingSecret: input.environment.controlSigningSecret,
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

  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.userId,
  });
  const store = createHostedDeviceSyncRuntimeStore({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  });

  if (input.url.pathname === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH) {
    return json(
      await store.readSnapshot(
        parseHostedDeviceSyncRuntimeSnapshotRequest(await readJsonObject(input.request), input.userId),
      ),
    );
  }

  return json(
    await store.applyUpdates(
      parseHostedDeviceSyncRuntimeApplyRequest(await readJsonObject(input.request), input.userId),
    ),
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


async function handleRunnerUsageRecordRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST" || input.url.pathname !== HOSTED_EXECUTION_AI_USAGE_RECORD_PATH) {
    return input.url.pathname === HOSTED_EXECUTION_AI_USAGE_RECORD_PATH
      ? methodNotAllowed()
      : notFound();
  }

  const payload = parseHostedAiUsageRecordRequest(await readJsonObject(input.request));
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.userId,
  });
  const result = await createHostedPendingUsageStore({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  }).appendUsage({
    usage: payload.usage,
    userId: input.userId,
  });

  return json(result);
}

async function resolveRunnerOutboundUserCryptoContext(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}) {
  return createHostedUserKeyStore({
    automationRecipientKeyId: input.environment.automationRecipientKeyId,
    automationRecipientPrivateKey: input.environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: input.environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: input.environment.automationRecipientPublicKey,
    bucket: input.bucket,
    envelopeEncryptionKey: input.environment.bundleEncryptionKey,
    envelopeEncryptionKeyId: input.environment.bundleEncryptionKeyId,
    envelopeEncryptionKeysById: input.environment.bundleEncryptionKeysById,
  }).ensureUserCryptoContext(input.userId);
}

async function resolveRunnerOutboundUserRunnerStub(
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<RunnerOutboundUserRunnerStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  try {
    await stub.bootstrapUser?.(userId);
  } catch (error) {
    if (
      !(error instanceof TypeError)
      || !error.message.includes('does not implement "bootstrapUser"')
    ) {
      throw error;
    }
  }
  return stub;
}

function requireRunnerOutboundHostedWebControlConfig(
  env: RunnerOutboundEnvironmentSource,
): { baseUrl: string } {
  const baseUrl = normalizeHostedExecutionBaseUrl(
    typeof env.HOSTED_WEB_BASE_URL === "string" ? env.HOSTED_WEB_BASE_URL : null,
  );

  if (!baseUrl) {
    throw new TypeError("HOSTED_WEB_BASE_URL must be configured for hosted device connect-link proxying.");
  }

  return {
    baseUrl,
  };
}

function parseHostedExecutionCommitRequest(payload: Record<string, unknown>): HostedExecutionCommitPayload & {
  currentBundleRefs: HostedExecutionBundleRefs;
} {
  const result = requireRecord(payload.result, "result");

  return {
    bundles: parseHostedExecutionBundlePayloads(payload.bundles, "bundles"),
    currentBundleRefs: parseHostedExecutionBundleRefsRecord(
      payload.currentBundleRefs,
      "currentBundleRefs",
    ),
    gatewayProjectionSnapshot:
      payload.gatewayProjectionSnapshot === undefined || payload.gatewayProjectionSnapshot === null
        ? null
        : gatewayProjectionSnapshotSchema.parse(payload.gatewayProjectionSnapshot),
    result: {
      eventsHandled: requireNumber(result.eventsHandled, "result.eventsHandled"),
      nextWakeAt: readOptionalString(result.nextWakeAt, "result.nextWakeAt"),
      summary: requireString(result.summary, "result.summary"),
    },
    sideEffects: parseHostedExecutionSideEffects(payload.sideEffects),
  };
}

function parseHostedExecutionFinalizeRequest(
  payload: Record<string, unknown>,
): HostedExecutionFinalizePayload {
  return {
    bundles: parseHostedExecutionBundlePayloads(payload.bundles, "bundles"),
    gatewayProjectionSnapshot:
      payload.gatewayProjectionSnapshot === undefined || payload.gatewayProjectionSnapshot === null
        ? null
        : gatewayProjectionSnapshotSchema.parse(payload.gatewayProjectionSnapshot),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

function readOptionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
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

function parseHostedAiUsageRecordRequest(
  value: Record<string, unknown>,
): HostedExecutionAiUsageRecordRequest {
  return {
    usage: requireArray(value.usage, "usage").map((entry, index) =>
      requireRecord(entry, `usage[${index}]`)
    ),
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

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireString(value, label).trim() || null;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function readNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requirePositiveInteger(value, label);
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  const normalized = readNullableString(value, label);
  if (normalized === null) {
    return null;
  }

  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return normalized;
}

function readNullableIsoOrStringField(value: unknown, label: string): string | null {
  const normalized = readNullableString(value, label);
  if (normalized === null) {
    return null;
  }

  if (label.endsWith("At") && !Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return normalized;
}
function requireSideEffectKind(value: unknown): HostedExecutionSideEffectRecord["kind"] {
  const kind = requireString(value, "kind");

  if (kind !== "assistant.delivery") {
    throw new TypeError(`Unsupported hosted side-effect kind: ${kind}`);
  }

  return kind;
}

function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

function requireRunnerInternalProxyAuthorization(
  request: Request,
  hostname: string,
  expectedToken: string | null,
): Response | null {
  if (!RUNNER_INTERNAL_PROXY_HOSTNAMES.has(hostname)) {
    return null;
  }

  if (!expectedToken) {
    return json({
      error: "Hosted runner outbound proxy token is not configured.",
    }, 503);
  }

  const providedToken = request.headers.get(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
  if (!providedToken || !timingSafeEquals(providedToken, expectedToken)) {
    return json({
      error: "Unauthorized",
    }, 401);
  }

  return null;
}
