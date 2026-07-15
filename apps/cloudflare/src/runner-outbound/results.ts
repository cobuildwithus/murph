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
  HostedEmailPreProviderError,
  HostedEmailSendValidationError,
  readHostedEmailConfig,
  readHostedEmailRawMessage,
  sendHostedEmailMessage,
} from "../hosted-email.ts";
import {
  createHostedMealPhotoStore,
  deleteHostedMealPhotoObject,
  HOSTED_MEAL_PHOTO_CONTENT_TYPE,
} from "../meal-photo-store.ts";
import {
  matchHostedExecutionRunnerMealPhotoPath,
} from "../runner-meal-photo-route.ts";
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

  const mealPhotoKey = matchHostedExecutionRunnerMealPhotoPath(input.url.pathname);
  if (mealPhotoKey) {
    if (input.request.method !== "GET" && input.request.method !== "DELETE") {
      return methodNotAllowed();
    }

    return handleRunnerMealPhotoRequest({
      bucket: input.bucket,
      env: input.env,
      environment: input.environment,
      mealPhotoKey,
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
      request: input.request,
      userId: input.userId,
    });
  }

  return notFound();
}

async function handleRunnerMealPhotoRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  mealPhotoKey: string;
  request: Request;
  userId: string;
}): Promise<Response> {
  if (!await requestOwnsRuntimeWriteFenceWrite(input)) {
    return unauthorized();
  }

  if (input.request.method === "DELETE") {
    await deleteHostedMealPhotoObject({
      bucket: input.bucket,
      mealPhotoKey: input.mealPhotoKey,
      userId: input.userId,
    });
    return new Response(null, { status: 204 });
  }

  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    domain: "ingress",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const store = createHostedMealPhotoStore({
    bucket: input.bucket,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    userId: input.userId,
  });

  const payload = await store.readMealPhoto(input.mealPhotoKey);
  if (!payload) {
    return notFound();
  }
  return new Response(copyBytesToArrayBuffer(payload), {
    headers: {
      "cache-control": "no-store",
      "content-type": HOSTED_MEAL_PHOTO_CONTENT_TYPE,
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}

async function handleRunnerEmailMessageReadRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  rawMessageKey: string;
  request: Request;
  userId: string;
}): Promise<Response> {
  if (!await requestOwnsRuntimeWriteFenceWrite(input)) {
    return unauthorized();
  }

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
      return json({
        code: "ASSISTANT_EMAIL_PROVIDER_AUTHORITY_REJECTED",
        deliveryMayHaveSucceeded: false,
        error: "Hosted email provider authority was rejected.",
        retryable: true,
      }, 401);
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
      delivery: payload.delivery ?? null,
      fanoutRecipientMemberIds: payload.fanoutRecipientMemberIds ?? null,
      ok: true,
      target: payload.target,
    });
  } catch (error) {
    if (
      error instanceof HostedEmailSendValidationError
      || error instanceof SyntaxError
      || error instanceof TypeError
    ) {
      return json({
        code: "ASSISTANT_EMAIL_REQUEST_INVALID",
        deliveryMayHaveSucceeded: false,
        error: error.message,
        retryable: false,
      }, 400);
    }
    if (error instanceof HostedEmailPreProviderError) {
      return json({
        code: error.code,
        deliveryMayHaveSucceeded: error.deliveryMayHaveSucceeded,
        error: error.message,
        retryable: error.retryable,
      }, 503);
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
