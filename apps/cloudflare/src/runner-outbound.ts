import { createHostedArtifactStore } from "./bundle-store.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  summarizeHostedExecutionError,
} from "@murphai/hosted-execution";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "./internal-hosts.ts";
import { json, methodNotAllowed, notFound, readJsonObject, unauthorized } from "./json.ts";
import { handleRunnerHeartbeatRequest } from "./runner-outbound/heartbeat.ts";
import { handleRunnerResultsRequest } from "./runner-outbound/results.ts";
import { handleRunnerWebControlRequest } from "./runner-outbound/web-control.ts";
import {
  requireRunnerInternalProxyAuthorization,
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserCryptoContext,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";

export type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

export async function handleRunnerOutboundRequest(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  userId: string,
  internalWorkerProxyToken: string | null = null,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const authorizationError = requireRunnerInternalProxyAuthorization(
      request,
      url.hostname,
      internalWorkerProxyToken,
    );
    if (authorizationError) {
      return authorizationError;
    }

    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort) {
      return handleRunnerResultsRequest({
        bucket: env.BUNDLES,
        env,
        environment,
        request,
        url,
        userId,
      });
    }

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane) {
      return handleRunnerWebControlRequest({
        env,
        environment,
        request,
        url,
        userId,
      });
    }

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl) {
      return handleRunnerHeartbeatRequest({
        env,
        request,
        url,
        userId,
      });
    }

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore) {
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

    return notFound();
  } catch (error) {
    const safeUrl = safeRunnerOutboundRequestUrl(request.url);
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        method: request.method,
        path: safeUrl?.pathname ?? null,
        urlHost: safeUrl?.hostname ?? null,
        userId,
      },
      error,
      message: "Hosted runner outbound request failed.",
      phase: "wake.running",
    });

    const details = buildHostedExecutionSafeErrorDetails(error);
    const errorName = readHostedExecutionSafeErrorName(error);

    return json({
      code: deriveHostedExecutionErrorCode(error),
      error: summarizeHostedExecutionError(error),
      ...(details ? { details } : {}),
      ...(errorName ? { errorName } : {}),
    }, 500);
  }
}

function safeRunnerOutboundRequestUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
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
    domain: "runtime",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const artifactStore = createHostedArtifactStore({
    bucket: input.bucket,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    resolveKeyById: crypto.resolveKeyById,
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

  const ownsActiveLease = await artifactWriteRequestOwnsActiveInvocationLease({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!ownsActiveLease) {
    return unauthorized();
  }

  const bytes = new Uint8Array(await input.request.arrayBuffer());
  await artifactStore.writeArtifact(input.sha256, bytes);
  return json({
    ok: true,
    sha256: input.sha256,
    size: bytes.byteLength,
  });
}

async function artifactWriteRequestOwnsActiveInvocationLease(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<boolean> {
  const attemptId = input.request.headers.get("x-hosted-runtime-attempt-id");
  const leaseGeneration = input.request.headers.get("x-hosted-runtime-lease-generation");
  const workspaceVersion = input.request.headers.get("x-hosted-runtime-workspace-version");
  if (!attemptId || !leaseGeneration || !workspaceVersion) {
    return false;
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const ownsActiveInvocationLease = requireRunnerOutboundUserStubMethod(
    stub,
    "ownsActiveInvocationLease",
  );
  return await ownsActiveInvocationLease({
    attemptId,
    leaseGeneration,
    userId: input.userId,
    workspaceVersion,
  });
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
