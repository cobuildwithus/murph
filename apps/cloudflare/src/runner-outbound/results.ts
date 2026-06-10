import { parseHostedEmailSendRequest } from "@murphai/assistant-runtime/hosted-email";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
} from "../runner-email-route.ts";
import {
  isHostedRunnerProviderEffectPath,
  HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
} from "../runner-effects-contract.ts";

import { readHostedExecutionEnvironment } from "../env.ts";
import { json, jsonError, methodNotAllowed, notFound, readJsonObject, unauthorized } from "../json.ts";
import {
  HostedEmailSendValidationError,
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "../hosted-email.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
import {
  decodeRouteParam,
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import {
  handleRunnerProviderEffectsRequest,
} from "./provider-effects.ts";
import {
  handleRunnerGeneratedImageUploadRequest,
} from "./generated-images.ts";

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

  if (isHostedRunnerProviderEffectPath(input.url.pathname)) {
    return handleRunnerProviderEffectsRequest({
      env: input.env,
      pathname: input.url.pathname,
      request: input.request,
      userId: input.userId,
    });
  }

  if (input.url.pathname === HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH) {
    return handleRunnerGeneratedImageUploadRequest({
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

async function handleRunnerEmailMessageReadRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  rawMessageKey: string;
  userId: string;
}): Promise<Response> {
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    domain: "ingress",
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
    resolveKeyById: crypto.resolveKeyById,
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
    const ownsWriteFence = await requestOwnsRuntimeWriteFenceWrite({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    if (!ownsWriteFence) {
      return unauthorized();
    }

    const payload = await sendHostedEmailMessage({
      config: readHostedEmailConfig(asWorkerStringEnvironment(input.env)),
      emailBinding: input.env.HOSTED_EMAIL,
      fetchImpl: fetch,
      request: parseHostedEmailSendRequest(await readJsonObject(input.request)),
      userId: input.userId,
      webCallbackSigning: input.environment.webCallbackSigning,
      ...(input.environment.hostedWebAllowHttpHosts
        ? { webControlAllowHttpHosts: input.environment.hostedWebAllowHttpHosts }
        : {}),
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

async function requestOwnsRuntimeWriteFenceWrite(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<boolean> {
  try {
    await requireRunnerRuntimeWriteFenceWrite({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    return true;
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return false;
    }

    throw error;
  }
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
