import {
  HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
  buildHostedExecutionSharePayloadPath,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_PROXY_HOSTS,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  fetchHostedExecutionWebControlPlaneResponse,
  normalizeHostedExecutionBaseUrl,
  parseHostedExecutionBundlePayloads,
  parseHostedExecutionBundleRefsRecord,
  parseHostedExecutionSideEffectRecord,
  parseHostedExecutionSideEffects,
  readHostedExecutionWebControlPlaneEnvironment,
  type HostedExecutionBundleRefs,
  type HostedExecutionSideEffectRecord,
  type HostedExecutionWebControlPlaneEnvironment,
} from "@murphai/hosted-execution";
import type { HostedEmailSendRequest } from "@murphai/assistant-runtime";
import { gatewayProjectionSnapshotSchema } from "@murphai/gateway-core";

import { createHostedArtifactStore } from "./bundle-store.ts";
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
  HOSTED_EXECUTION_PROXY_HOSTS.sharePack,
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
  const webControlPlane = readHostedExecutionWebControlPlaneEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
    {
      allowHttpLocalhost: true,
    },
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
      env,
      environment,
      request,
      url,
      userId,
      webControlPlane,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.sharePack) {
    return handleRunnerSharePackRequest({
      env,
      environment,
      request,
      url,
      userId,
      webControlPlane,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.usage) {
    return handleRunnerUsageRecordRequest({
      env,
      environment,
      request,
      url,
      userId,
      webControlPlane,
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
  const artifactStore = createHostedArtifactStore({
    bucket: input.bucket,
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    keysById: input.environment.bundleEncryptionKeysById,
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
  const journalStore = createHostedExecutionSideEffectJournalStore({
    bucket: input.bucket,
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    keysById: input.environment.bundleEncryptionKeysById,
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
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  if (
    input.url.pathname !== HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    && input.url.pathname !== HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH
  ) {
    return notFound();
  }

  const payload = {
    ...await readJsonObject(input.request),
    userId: input.userId,
  };

  return forwardRunnerWebControlRequest({
    actualBaseUrl: resolveHostedRunnerWebControlBaseUrl(
      input.webControlPlane.deviceSyncRuntimeBaseUrl,
      input.env,
      "HOSTED_DEVICE_SYNC_CONTROL_BASE_URL",
    ),
    body: JSON.stringify(payload),
    method: "POST",
    pathname: input.url.pathname,
    search: input.url.search,
    timeoutMs: input.environment.runnerTimeoutMs,
    token: input.webControlPlane.internalToken,
    userId: input.userId,
  });
}

async function handleRunnerSharePackRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  const match = /^\/api\/hosted-share\/internal\/(?<shareId>[^/]+)\/payload$/u.exec(input.url.pathname);
  if (!match) {
    return notFound();
  }

  const shareId = decodeRouteParam(match.groups?.shareId ?? "");
  if (input.url.pathname !== buildHostedExecutionSharePayloadPath(shareId)) {
    return notFound();
  }
  if (input.url.search) {
    return notFound();
  }
  const payload = parseHostedSharePackRequest(await readJsonObject(input.request));

  return forwardRunnerWebControlRequest({
    actualBaseUrl: resolveHostedRunnerWebControlBaseUrl(
      input.webControlPlane.shareBaseUrl,
      input.env,
      "HOSTED_SHARE_API_BASE_URL",
    ),
    body: JSON.stringify(payload),
    method: "POST",
    pathname: input.url.pathname,
    search: "",
    timeoutMs: input.environment.runnerTimeoutMs,
    token: input.webControlPlane.shareToken,
    userId: input.userId,
  });
}

async function handleRunnerUsageRecordRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<Response> {
  if (input.request.method !== "POST" || input.url.pathname !== HOSTED_EXECUTION_AI_USAGE_RECORD_PATH) {
    return input.url.pathname === HOSTED_EXECUTION_AI_USAGE_RECORD_PATH
      ? methodNotAllowed()
      : notFound();
  }

  return forwardRunnerWebControlRequest({
    actualBaseUrl: resolveHostedRunnerWebControlBaseUrl(
      input.webControlPlane.usageBaseUrl ?? null,
      input.env,
      "HOSTED_AI_USAGE_BASE_URL",
    ),
    body: JSON.stringify(await readJsonObject(input.request)),
    method: "POST",
    pathname: input.url.pathname,
    search: input.url.search,
    timeoutMs: input.environment.runnerTimeoutMs,
    token: input.webControlPlane.internalToken,
    userId: input.userId,
  });
}

async function forwardRunnerWebControlRequest(input: {
  actualBaseUrl: string | null;
  body?: string;
  method: "GET" | "POST";
  pathname: string;
  search: string;
  timeoutMs: number | null;
  token: string | null;
  userId: string;
}): Promise<Response> {
  if (!input.actualBaseUrl) {
    return json({
      error: "Hosted web control base URL is not configured.",
    }, 503);
  }

  if (!input.token) {
    return json({
      error: "Hosted web control token is not configured.",
    }, 503);
  }

  return fetchHostedExecutionWebControlPlaneResponse({
    authorizationToken: input.token,
    baseUrl: input.actualBaseUrl,
    body: input.body,
    boundUserId: input.userId,
    method: input.method,
    path: input.pathname,
    search: input.search,
    timeoutMs: input.timeoutMs,
  });
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

function parseHostedSharePackRequest(payload: Record<string, unknown>): {
  shareCode: string;
} {
  return {
    shareCode: requireString(payload.shareCode, "shareCode"),
  };
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

  if (request.headers.get(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER) !== expectedToken) {
    return json({
      error: "Unauthorized",
    }, 401);
  }

  return null;
}

function resolveHostedRunnerWebControlBaseUrl(
  value: string | null,
  env: RunnerOutboundEnvironmentSource,
  label: string,
): string | null {
  if (!value) {
    return null;
  }

  const actualHost = new URL(value).host.toLowerCase();
  const allowedHosts = readAllowedRunnerWebControlHosts(env);

  if (!allowedHosts.has(actualHost)) {
    throw new TypeError(`${label} host is not allowlisted.`);
  }

  return value;
}

function normalizeBaseUrl(value: string | null): string | null {
  return normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
  });
}

function readAllowedRunnerWebControlHosts(
  env: RunnerOutboundEnvironmentSource,
): Set<string> {
  const allowedHosts = new Set<string>();
  const sharedBaseUrl = normalizeBaseUrl(
    readOptionalString(env.HOSTED_WEB_BASE_URL, "HOSTED_WEB_BASE_URL"),
  );

  if (sharedBaseUrl) {
    allowedHosts.add(new URL(sharedBaseUrl).host.toLowerCase());
  }

  return allowedHosts;
}
