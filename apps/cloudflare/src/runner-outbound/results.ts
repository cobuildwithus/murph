import { parseHostedEmailSendRequest } from "@murphai/assistant-runtime/hosted-email";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
  HOSTED_EXECUTION_RUNNER_MESSAGING_ACTIVITY_STOP_PATH,
  HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH,
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
  decodeRouteParam,
  resolveRunnerOutboundUserCryptoContext,
  resolveRunnerOutboundUserRunnerStub,
  requireRunnerOutboundUserStubMethod,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import { handleRunnerTurnInputRefreshRequest } from "./turn-input.ts";

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

  if (input.url.pathname === HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH) {
    if (input.request.method !== "POST") {
      return methodNotAllowed();
    }

    return handleRunnerTurnInputRefreshRequest({
      bucket: input.bucket,
      env: input.env,
      environment: input.environment,
      request: input.request,
      userId: input.userId,
    });
  }

  if (input.url.pathname === HOSTED_EXECUTION_RUNNER_MESSAGING_ACTIVITY_STOP_PATH) {
    if (input.request.method !== "POST") {
      return methodNotAllowed();
    }

    return handleRunnerMessagingActivityStopRequest({
      env: input.env,
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

async function handleRunnerMessagingActivityStopRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<Response> {
  let runId: string;
  let reason: string | null;
  try {
    const body = await readJsonObject(input.request);
    runId = readRequiredNonEmptyString(body.runId, "runId");
    reason = readOptionalNonEmptyString(body.reason, "reason");
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return jsonError(error.message, 400);
    }

    throw error;
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const stopActiveRunMessagingActivity = requireRunnerOutboundUserStubMethod(
    stub,
    "stopActiveRunMessagingActivity",
  );
  const result = await stopActiveRunMessagingActivity.call(stub, {
    ...(reason === null ? {} : { reason }),
    runId,
  });

  return json({
    ok: true,
    stopped: result.stopped === true,
  });
}

function readRequiredNonEmptyString(value: unknown, field: string): string {
  const normalized = readOptionalNonEmptyString(value, field);
  if (normalized === null) {
    throw new TypeError(`Hosted runner messaging activity stop request.${field} must be a non-empty string.`);
  }

  return normalized;
}

function readOptionalNonEmptyString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Hosted runner messaging activity stop request.${field} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`Hosted runner messaging activity stop request.${field} must be a non-empty string.`);
  }

  return normalized;
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
      config: readHostedEmailConfig(asWorkerStringEnvironment(input.env)),
      emailBinding: input.env.HOSTED_EMAIL,
      fetchImpl: fetch,
      request: parseHostedEmailSendRequest(await readJsonObject(input.request)),
      userId: input.userId,
      webCallbackSigning: input.environment.webCallbackSigning,
      webControlBaseUrl: input.environment.hostedWebBaseUrl,
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
