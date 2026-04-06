import {
  HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_PROXY_HOSTS,
  type HostedExecutionAiUsageRecordRequest,
} from "@murphai/hosted-execution";

import { createHostedArtifactStore } from "./bundle-store.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import { json, methodNotAllowed, notFound, readJsonObject } from "./json.ts";
import { createHostedPendingUsageStore } from "./usage-store.ts";
import { handleRunnerDeviceSyncControlRequest } from "./runner-outbound/device-sync.ts";
import { handleRunnerResultsRequest } from "./runner-outbound/results.ts";
import {
  requireArray,
  requireRecord,
  requireRunnerInternalProxyAuthorization,
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";

export type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

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

  if (url.hostname === HOSTED_EXECUTION_CALLBACK_HOSTS.results) {
    return handleRunnerResultsRequest({
      bucket: env.BUNDLES,
      env,
      environment,
      request,
      url,
      userId,
    });
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
      env,
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
    });
  }

  if (url.hostname === HOSTED_EXECUTION_PROXY_HOSTS.usage) {
    return handleRunnerUsageRecordRequest({
      bucket: env.BUNDLES,
      env,
      environment,
      request,
      url,
      userId,
    });
  }

  return notFound();
}

async function handleRunnerArtifactRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  sha256: string;
  userId: string;
}): Promise<Response> {
  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    env: input.env,
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

async function handleRunnerUsageRecordRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
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
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const result = await createHostedPendingUsageStore({
    bucket: input.bucket,
    dirtyKey: input.environment.platformEnvelopeKey,
    dirtyKeyId: input.environment.platformEnvelopeKeyId,
    dirtyKeysById: input.environment.platformEnvelopeKeysById,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  }).appendUsage({
    usage: payload.usage,
    userId: input.userId,
  });

  return json(result);
}

function parseHostedAiUsageRecordRequest(
  value: Record<string, unknown>,
): HostedExecutionAiUsageRecordRequest & { usage: readonly Record<string, unknown>[] } {
  return {
    usage: requireArray(value.usage, "usage").map((entry, index) =>
      requireRecord(entry, `usage[${index}]`)
    ),
  };
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
