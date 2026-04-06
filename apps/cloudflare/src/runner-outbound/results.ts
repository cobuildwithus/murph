import type { HostedEmailSendRequest } from "@murphai/assistant-runtime";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedExecutionSideEffectRecord,
  parseHostedExecutionSideEffects,
  type HostedExecutionBundleRef,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";
import { gatewayProjectionSnapshotSchema } from "@murphai/gateway-core";

import { readHostedExecutionEnvironment } from "../env.ts";
import type { HostedExecutionCommitPayload } from "../execution-journal.ts";
import { json, methodNotAllowed, notFound, readJsonObject } from "../json.ts";
import {
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "../hosted-email.ts";
import {
  HostedExecutionSideEffectConflictError,
  createHostedExecutionSideEffectJournalStore,
} from "../side-effect-journal.ts";
import {
  decodeRouteParam,
  readOptionalString,
  requireNumber,
  requireRecord,
  requireRunnerOutboundUserStubMethod,
  requireString,
  resolveRunnerOutboundUserCryptoContext,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

export async function handleRunnerResultsRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  const commitMatch = /^\/events\/(?<eventId>[^/]+)\/commit$/u.exec(input.url.pathname);
  if (commitMatch?.groups) {
    if (input.request.method !== "POST") {
      return methodNotAllowed();
    }

    const eventId = decodeRouteParam(commitMatch.groups.eventId);
    return forwardRunnerCommit(input.userId, eventId, await readJsonObject(input.request), input.env);
  }

  const sideEffectMatch = /^\/(?:intents|effects)\/(?<effectId>[^/]+)$/u.exec(input.url.pathname);
  if (sideEffectMatch?.groups) {
    if (input.request.method !== "DELETE" && input.request.method !== "GET" && input.request.method !== "PUT") {
      return methodNotAllowed();
    }

    return handleRunnerSideEffectRequest({
      bucket: input.bucket,
      env: input.env,
      effectId: decodeRouteParam(sideEffectMatch.groups.effectId),
      environment: input.environment,
      request: input.request,
      url: input.url,
      userId: input.userId,
    });
  }

  if (input.url.pathname === HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH) {
    if (input.request.method !== "POST") {
      return methodNotAllowed();
    }

    return handleRunnerEmailSendRequest({
      bucket: input.bucket,
      env: input.env,
      environment: input.environment,
      request: input.request,
      userId: input.userId,
    });
  }

  const messageMatch = /^\/messages\/(?<rawMessageKey>[^/]+)$/u.exec(input.url.pathname);
  if (messageMatch?.groups) {
    if (input.request.method !== "GET") {
      return methodNotAllowed();
    }

    return handleRunnerEmailMessageReadRequest({
      bucket: input.bucket,
      env: input.env,
      environment: input.environment,
      rawMessageKey: decodeRouteParam(messageMatch.groups.rawMessageKey),
      userId: input.userId,
    });
  }

  return notFound();
}

async function handleRunnerEmailMessageReadRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  rawMessageKey: string;
  userId: string;
}): Promise<Response> {
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const payload = await readHostedEmailRawMessage({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    rawMessageKey: input.rawMessageKey,
    userId: input.userId,
  });

  if (!payload) {
    return notFound();
  }

  return new Response(copyBytesToArrayBuffer(payload), {
    headers: {
      "content-type": "message/rfc822",
    },
    status: 200,
  });
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
    key: input.environment.platformEnvelopeKey,
    keyId: input.environment.platformEnvelopeKeyId,
    keysById: input.environment.platformEnvelopeKeysById,
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

async function handleRunnerSideEffectRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  effectId: string;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    env: input.env,
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

function parseHostedExecutionCommitRequest(payload: Record<string, unknown>): HostedExecutionCommitPayload & {
  currentBundleRef: HostedExecutionBundleRef | null;
} {
  const result = requireRecord(payload.result, "result");

  return {
    bundle: parseHostedExecutionBundlePayload(payload.bundle, "bundle"),
    currentBundleRef: parseHostedExecutionBundleRef(payload.currentBundleRef, "currentBundleRef"),
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

function requireSideEffectKind(value: unknown): HostedExecutionSideEffectRecord["kind"] {
  const kind = requireString(value, "kind");

  if (kind !== "assistant.delivery") {
    throw new TypeError(`Unsupported hosted side-effect kind: ${kind}`);
  }

  return kind;
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
