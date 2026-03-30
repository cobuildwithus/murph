import type { HostedExecutionBundleRef } from "@murph/runtime-state";
import {
  HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
  buildHostedExecutionSharePayloadPath,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_PROXY_HOSTS,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  normalizeHostedExecutionBaseUrl,
  readHostedExecutionWebControlPlaneEnvironment,
  type HostedExecutionWebControlPlaneEnvironment,
} from "@murph/hosted-execution";
import {
  parseHostedExecutionSideEffectRecord,
  parseHostedExecutionSideEffects,
  type HostedEmailSendRequest,
  type HostedExecutionSideEffectRecord,
} from "@murph/assistant-runtime";
import { gatewayProjectionSnapshotSchema } from "murph/gateway-core";

import { createHostedArtifactStore } from "./bundle-store.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import type {
  HostedExecutionCommitPayload,
  HostedExecutionFinalizePayload,
} from "./execution-journal.ts";
import { json, readJsonObject } from "./json.ts";
import { createHostedExecutionSideEffectJournalStore } from "./outbox-delivery-journal.ts";
import {
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "./hosted-email.ts";
import type {
  WorkerCurrentBundleRefs,
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
      request,
      url,
      userId,
      webControlPlane,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.sharePack) {
    return handleRunnerSharePackRequest({
      env,
      request,
      url,
      userId,
      webControlPlane,
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.usage) {
    return handleRunnerUsageRecordRequest({
      env,
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

    if (request.method !== "GET" && request.method !== "PUT") {
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

  if (input.request.method === "GET") {
    const kindValue = input.url.searchParams.get("kind");
    const fingerprint = input.url.searchParams.get("fingerprint");

    if (!kindValue || !fingerprint) {
      return notFound();
    }

    const kind = requireSideEffectKind(kindValue);
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
  const savedRecord = await journalStore.write({
    record: nextRecord,
    userId: input.userId,
  });

  return json({
    effectId: savedRecord.effectId,
    record: savedRecord,
  });
}

async function handleRunnerDeviceSyncControlRequest(input: {
  env: RunnerOutboundEnvironmentSource;
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
    search: input.url.search,
    token: input.webControlPlane.internalToken,
    userId: input.userId,
    pathname: input.url.pathname,
  });
}

async function handleRunnerSharePackRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<Response> {
  if (input.request.method !== "GET") {
    return methodNotAllowed();
  }

  const match = /^\/api\/hosted-share\/internal\/(?<shareId>[^/]+)\/payload$/u.exec(input.url.pathname);
  if (!match) {
    return notFound();
  }

  const shareId = decodeRouteParam(match.groups?.shareId ?? "");
  if (input.url.pathname !== buildHostedExecutionSharePayloadPath(shareId, "").replace(/\?.*$/u, "")) {
    return notFound();
  }

  return forwardRunnerWebControlRequest({
    actualBaseUrl: resolveHostedRunnerWebControlBaseUrl(
      input.webControlPlane.shareBaseUrl,
      input.env,
      "HOSTED_SHARE_API_BASE_URL",
    ),
    method: "GET",
    search: input.url.search,
    token: input.webControlPlane.shareToken,
    userId: input.userId,
    pathname: input.url.pathname,
  });
}

async function handleRunnerUsageRecordRequest(input: {
  env: RunnerOutboundEnvironmentSource;
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

  const targetUrl = new URL(input.pathname, input.actualBaseUrl);
  targetUrl.search = input.search;
  return fetch(targetUrl, {
    body: input.body,
    headers: {
      authorization: `Bearer ${input.token}`,
      ...(input.body
        ? {
            "content-type": "application/json; charset=utf-8",
          }
        : {}),
      [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
    },
    method: input.method,
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
  currentBundleRefs: WorkerCurrentBundleRefs;
} {
  const bundles = requireRecord(payload.bundles, "bundles");
  const result = requireRecord(payload.result, "result");

  return {
    bundles: {
      agentState: readHostedBundleBase64Value(bundles.agentState, "bundles.agentState"),
      vault: readHostedBundleBase64Value(bundles.vault, "bundles.vault"),
    },
    currentBundleRefs: readCommittedBundleRefs(payload.currentBundleRefs),
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
  const bundles = requireRecord(payload.bundles, "bundles");

  return {
    bundles: {
      agentState: readHostedBundleBase64Value(bundles.agentState, "bundles.agentState"),
      vault: readHostedBundleBase64Value(bundles.vault, "bundles.vault"),
    },
    gatewayProjectionSnapshot:
      payload.gatewayProjectionSnapshot === undefined || payload.gatewayProjectionSnapshot === null
        ? null
        : gatewayProjectionSnapshotSchema.parse(payload.gatewayProjectionSnapshot),
  };
}

function readCommittedBundleRefs(value: unknown): WorkerCurrentBundleRefs {
  const record = requireRecord(value, "currentBundleRefs");

  return {
    agentState: readHostedBundleRef(record.agentState),
    vault: readHostedBundleRef(record.vault),
  };
}

function readHostedBundleRef(value: unknown): HostedExecutionBundleRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TypeError("Commit bundle refs must be objects or null.");
  }

  if (
    typeof value.hash !== "string"
    || typeof value.key !== "string"
    || typeof value.size !== "number"
    || typeof value.updatedAt !== "string"
  ) {
    throw new TypeError("Commit bundle refs must include hash, key, size, and updatedAt.");
  }

  return {
    hash: value.hash,
    key: value.key,
    size: value.size,
    updatedAt: value.updatedAt,
  };
}

function readHostedBundleBase64Value(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a base64 string or null.`);
  }

  return value;
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

function methodNotAllowed(): Response {
  return json({ error: "Method not allowed." }, 405);
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
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

  const extraHosts = readOptionalString(
    env.HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS,
    "HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS",
  );

  for (const hostEntry of (extraHosts ?? "").split(",")) {
    const normalizedHost = normalizeRunnerWebControlHost(hostEntry);

    if (normalizedHost) {
      allowedHosts.add(normalizedHost);
    }
  }

  return allowedHosts;
}

function normalizeRunnerWebControlHost(value: string): string | null {
  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0) {
    return null;
  }

  if (
    normalized.includes("://")
    || normalized.includes("/")
    || normalized.includes("?")
    || normalized.includes("#")
    || normalized.includes("@")
  ) {
    throw new TypeError(
      "HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS must contain comma-separated host[:port] entries.",
    );
  }

  return normalized;
}
