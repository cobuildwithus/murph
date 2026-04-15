import { parseHostedEmailSendRequest } from "@murphai/assistant-runtime/hosted-email";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  isHostedExecutionRunPhase,
  type HostedExecutionRunPhase,
} from "@murphai/hosted-execution";
import {
  parseHostedAssistantDeliveryRecord,
} from "@murphai/hosted-execution/side-effects";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
} from "@murphai/hosted-execution/routes";

import { readHostedExecutionEnvironment } from "../env.ts";
import { json, methodNotAllowed, notFound, readJsonObject } from "../json.ts";
import {
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "../hosted-email.ts";
import {
  HostedAssistantDeliveryConflictError,
  createHostedAssistantDeliveryJournalStore,
} from "../side-effect-journal.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import {
  decodeRouteParam,
  readOptionalString,
  requireRecord,
  requireString,
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const HOSTED_EXECUTION_RUNNER_CONTAINER_DEBUG_PATH = "/debug/container-stage";

export async function handleRunnerResultsRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  const sideEffectMatch = /^\/effects\/(?<effectId>[^/]+)$/u.exec(input.url.pathname);
  if (sideEffectMatch?.groups) {
    if (input.request.method !== "DELETE" && input.request.method !== "GET" && input.request.method !== "PUT") {
      return methodNotAllowed();
    }

    return handleRunnerAssistantDeliveryRequest({
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

  if (input.url.pathname === HOSTED_EXECUTION_RUNNER_CONTAINER_DEBUG_PATH) {
    if (input.request.method !== "POST") {
      return methodNotAllowed();
    }

    return handleRunnerContainerDebugRequest({
      request: input.request,
      userId: input.userId,
    });
  }

  return notFound();
}

async function handleRunnerContainerDebugRequest(input: {
  request: Request;
  userId: string;
}): Promise<Response> {
  const payload = parseRunnerContainerDebugRequest(
    await readJsonObject(input.request),
  );
  emitHostedExecutionStructuredLog({
    component: "container-debug",
    details: {
      ...(payload.details ?? {}),
      ...(payload.eventId ? { eventId: payload.eventId } : {}),
      ...(payload.runId ? { runId: payload.runId } : {}),
      userId: input.userId,
    },
    level: payload.level ?? "info",
    message: payload.message,
    phase: payload.phase ?? "dispatch.running",
    userId: input.userId,
  });

  return json({
    ok: true,
  });
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
    config: readHostedEmailConfig(asWorkerStringEnvironment(input.env)),
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

async function handleRunnerAssistantDeliveryRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  effectId: string;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      effectId: input.effectId,
      fingerprintPresent: input.url.searchParams.has("fingerprint"),
      journalMethod: input.request.method,
      userId: input.userId,
    },
    message: "Hosted runner side-effect journal request received.",
    phase: "dispatch.running",
    userId: input.userId,
  });
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const journalStore = createHostedAssistantDeliveryJournalStore({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  });

  try {
    if (input.request.method === "GET" || input.request.method === "DELETE") {
      const fingerprint = input.url.searchParams.get("fingerprint");

      if (input.request.method === "DELETE") {
        await journalStore.deletePrepared({
          effectId: input.effectId,
          fingerprint,
          userId: input.userId,
        });

        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            effectId: input.effectId,
            fingerprintPresent: fingerprint !== null,
            journalMethod: input.request.method,
            outcome: "deleted",
            userId: input.userId,
          },
          message: "Hosted runner side-effect journal request succeeded.",
          phase: "dispatch.running",
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
        userId: input.userId,
      });

      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          effectId: input.effectId,
          fingerprintPresent: fingerprint !== null,
          journalMethod: input.request.method,
          outcome: record ? "record" : "empty",
          recordState: record?.state ?? null,
          userId: input.userId,
        },
        message: "Hosted runner side-effect journal request succeeded.",
        phase: "dispatch.running",
        userId: input.userId,
      });

      return json({
        effectId: record?.effectId ?? input.effectId,
        record: record ?? null,
      });
    }

    const nextRecord = parseHostedAssistantDeliveryRecord(await readJsonObject(input.request));
    if (nextRecord.effectId !== input.effectId) {
      return json({
        error: `effectId mismatch: expected ${input.effectId}, received ${nextRecord.effectId}.`,
      }, 400);
    }

    const savedRecord = await journalStore.write({
      record: nextRecord,
      userId: input.userId,
    });

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        effectId: savedRecord.effectId,
        fingerprintPresent: true,
        journalMethod: input.request.method,
        outcome: "written",
        recordState: savedRecord.state,
        userId: input.userId,
      },
      message: "Hosted runner side-effect journal request succeeded.",
      phase: "dispatch.running",
      userId: input.userId,
    });

    return json({
      effectId: savedRecord.effectId,
      record: savedRecord,
    });
  } catch (error) {
    if (error instanceof HostedAssistantDeliveryConflictError) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          effectId: input.effectId,
          fingerprintPresent: input.url.searchParams.has("fingerprint"),
          journalMethod: input.request.method,
          userId: input.userId,
        },
        error,
        level: "warn",
        message: "Hosted runner side-effect journal request conflicted.",
        phase: "dispatch.running",
        userId: input.userId,
      });
      return json({
        error: error.message,
      }, 409);
    }

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        effectId: input.effectId,
        fingerprintPresent: input.url.searchParams.has("fingerprint"),
        journalMethod: input.request.method,
        userId: input.userId,
      },
      error,
      level: "warn",
      message: "Hosted runner side-effect journal request failed.",
      phase: "dispatch.running",
      userId: input.userId,
    });
    throw error;
  }
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseRunnerContainerDebugRequest(value: Record<string, unknown>): {
  details: Record<string, unknown> | null;
  eventId: string | null;
  level: "error" | "info" | "warn" | null;
  message: string;
  phase: HostedExecutionRunPhase | null;
  runId: string | null;
} {
  const detailsValue = readOptionalObject(value.details);
  const level = readOptionalString(value.level, "level");
  const phase = readOptionalString(value.phase, "phase");

  return {
    details: detailsValue,
    eventId: readOptionalString(value.eventId, "eventId"),
    level: level === "error" || level === "info" || level === "warn" ? level : null,
    message: requireString(value.message, "message"),
    phase: isHostedExecutionRunPhase(phase) ? phase : null,
    runId: readOptionalString(value.runId, "runId"),
  };
}

function readOptionalObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireRecord(value, "details");
}
