import { parseHostedEmailSendRequest } from "@murphai/assistant-runtime/hosted-email";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  isHostedExecutionRunPhase,
  type HostedExecutionRunPhase,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
} from "@murphai/hosted-execution/routes";

import { readHostedExecutionEnvironment } from "../env.ts";
import { json, jsonError, methodNotAllowed, notFound, readJsonObject } from "../json.ts";
import {
  HostedEmailSendValidationError,
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "../hosted-email.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import {
  readNullableString,
  requireRecord,
  requireString,
} from "./codec.ts";
import {
  decodeRouteParam,
  resolveRunnerOutboundUserCryptoContext,
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
  try {
    const payload = await sendHostedEmailMessage({
      bucket: input.bucket,
      config: readHostedEmailConfig(asWorkerStringEnvironment(input.env)),
      emailBinding: input.env.HOSTED_EMAIL,
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
  } catch (error) {
    if (
      error instanceof HostedEmailSendValidationError
      || error instanceof SyntaxError
      || error instanceof TypeError
    ) {
      return jsonError(error.message, 400);
    }

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
  const level = readNullableString(value.level, "level");
  const phase = readNullableString(value.phase, "phase");

  return {
    details: detailsValue,
    eventId: readNullableString(value.eventId, "eventId"),
    level: level === "error" || level === "info" || level === "warn" ? level : null,
    message: requireString(value.message, "message"),
    phase: isHostedExecutionRunPhase(phase) ? phase : null,
    runId: readNullableString(value.runId, "runId"),
  };
}

function readOptionalObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireRecord(value, "details");
}
