import type { HostedExecutionBundleRef } from "@murph/runtime-state";
import {
  parseHostedExecutionSideEffectRecord,
  parseHostedExecutionSideEffects,
  type HostedExecutionSideEffectRecord,
} from "@murph/assistant-runtime";

import { readHostedExecutionEnvironment } from "./env.ts";
import type {
  HostedExecutionCommitPayload,
  HostedExecutionCommittedResult,
  HostedExecutionFinalizePayload,
} from "./execution-journal.ts";
import { json, readJsonObject } from "./json.ts";
import { createHostedExecutionSideEffectJournalStore } from "./outbox-delivery-journal.ts";
import {
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "./hosted-email.ts";

interface RunnerOutboundUserRunnerStubLike {
  bootstrapUser?(userId: string): Promise<{ userId: string }>;
  commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
    userId: string;
  }): Promise<HostedExecutionCommittedResult>;
  finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
    userId: string;
  }): Promise<HostedExecutionCommittedResult>;
}

interface RunnerOutboundDurableObjectNamespaceLike {
  getByName(name: string): RunnerOutboundUserRunnerStubLike;
}

export interface RunnerOutboundEnvironmentSource extends Readonly<Record<string, unknown>> {
  BUNDLES: import("./bundle-store.ts").R2BucketLike;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS?: string;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID?: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_SIGNING_SECRET?: string;
  HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET?: string;
  HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID?: string;
  HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL?: string;
  HOSTED_EMAIL_CLOUDFLARE_API_TOKEN?: string;
  HOSTED_EMAIL_DEFAULT_SUBJECT?: string;
  HOSTED_EMAIL_DOMAIN?: string;
  HOSTED_EMAIL_FROM_ADDRESS?: string;
  HOSTED_EMAIL_LOCAL_PART?: string;
  HOSTED_EMAIL_SIGNING_SECRET?: string;
  USER_RUNNER: RunnerOutboundDurableObjectNamespaceLike;
}

export async function handleRunnerOutboundRequest(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<Response> {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const url = new URL(request.url);

  if (url.hostname === "commit.worker") {
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

  if (url.hostname === "outbox.worker" || url.hostname === "side-effects.worker") {
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

  if (url.hostname === "email.worker") {
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

function parseHostedEmailSendRequest(value: Record<string, unknown>): {
  identityId: string | null;
  message: string;
  target: string;
  targetKind: "explicit" | "participant" | "thread";
} {
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
      userId,
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
      userId,
    }),
    ok: true,
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
  const savedRecord = await journalStore.write({
    record: nextRecord,
    userId: input.userId,
  });

  return json({
    effectId: savedRecord.effectId,
    record: savedRecord,
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
  currentBundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
} {
  const bundles = requireRecord(payload.bundles, "bundles");
  const result = requireRecord(payload.result, "result");

  return {
    bundles: {
      agentState: readHostedBundleBase64Value(bundles.agentState, "bundles.agentState"),
      vault: readHostedBundleBase64Value(bundles.vault, "bundles.vault"),
    },
    currentBundleRefs: readCommittedBundleRefs(payload.currentBundleRefs),
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
  };
}

function readCommittedBundleRefs(value: unknown): {
  agentState: HostedExecutionBundleRef | null;
  vault: HostedExecutionBundleRef | null;
} {
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

function methodNotAllowed(): Response {
  return json({ error: "Method not allowed." }, 405);
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}
