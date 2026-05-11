import { createHostedArtifactStore } from "./bundle-store.ts";
import { createHostedBrowserVaultReplicaStore } from "./browser-vault-store.ts";
import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
} from "./browser-vault-limits.ts";
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
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./runner-outbound/write-fence.ts";
import { handleRunnerResultsRequest } from "./runner-outbound/results.ts";
import { handleRunnerWebControlRequest } from "./runner-outbound/web-control.ts";
import {
  requireRunnerInternalProxyAuthorization,
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";

export type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

export interface RunnerOutboundProxyContext {
  proxyAttemptId?: string | null;
  proxyExpiresAtMs?: number | null;
  proxyLeaseGeneration?: string | null;
  proxyScope?: "browser_vault_background" | "runtime";
  writeFenceAuthorized?: boolean;
}

export async function handleRunnerOutboundRequest(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  userId: string,
  internalWorkerProxyToken: string | null = null,
  proxyContext: RunnerOutboundProxyContext = {},
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (proxyContext.writeFenceAuthorized !== true) {
      const authorizationError = requireRunnerInternalProxyAuthorization(
        request,
        url.hostname,
        internalWorkerProxyToken,
      );
      if (authorizationError) {
        return authorizationError;
      }
    }
    if (runnerOutboundProxyContextIsExpired(proxyContext)) {
      return unauthorized();
    }

    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
    if (
      proxyContext.proxyScope === "browser_vault_background"
      && url.hostname !== CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore
      && url.hostname !== CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane
    ) {
      return notFound();
    }

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
        proxyContext,
        request,
        url,
        userId,
      });
    }

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore) {
      if (url.pathname !== "/replicas") {
        return notFound();
      }

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return handleRunnerBrowserVaultReplicaWriteRequest({
        bucket: env.BUNDLES,
        env,
        environment,
        proxyContext,
        request,
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

function runnerOutboundProxyContextIsExpired(proxyContext: RunnerOutboundProxyContext): boolean {
  return typeof proxyContext.proxyExpiresAtMs === "number"
    && Number.isFinite(proxyContext.proxyExpiresAtMs)
    && proxyContext.proxyExpiresAtMs <= Date.now();
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
  if (input.request.method === "PUT") {
    const ownsWriteFence = await writeRequestOwnsRuntimeWriteFence({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    if (!ownsWriteFence) {
      return unauthorized();
    }
  }

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

  const bytes = new Uint8Array(await input.request.arrayBuffer());
  await artifactStore.writeArtifact(input.sha256, bytes);
  return json({
    ok: true,
    sha256: input.sha256,
    size: bytes.byteLength,
  });
}

async function handleRunnerBrowserVaultReplicaWriteRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  proxyContext: RunnerOutboundProxyContext;
  request: Request;
  userId: string;
}): Promise<Response> {
  const authorized = await writeRequestOwnsRuntimeWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  }) || isBrowserVaultBackgroundProxy(input.proxyContext);
  if (!authorized) {
    return unauthorized();
  }

  const body = await readJsonObject(input.request, {
    limitBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES + 1024 * 1024,
  });
  if (!Object.hasOwn(body, "replica")) {
    throw new TypeError("Hosted browser-vault replica write request.replica is required.");
  }

  const expectedReplicaSourceHash = readOptionalExpectedReplicaSourceHash(body);
  if (input.proxyContext.proxyScope === "browser_vault_background" && !expectedReplicaSourceHash) {
    return unauthorized();
  }

  const crypto = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    domain: "runtime",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const replicaStore = createHostedBrowserVaultReplicaStore({
    bucket: input.bucket,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    userId: input.userId,
  });
  const replicaRef = await replicaStore.writeBrowserVaultReplica({
    expectedReplicaSourceHash,
    replica: body.replica,
    userId: input.userId,
  });

  return json({ replicaRef });
}

function isBrowserVaultBackgroundProxy(
  proxyContext: RunnerOutboundProxyContext,
): boolean {
  return proxyContext.proxyScope === "browser_vault_background";
}

function readOptionalExpectedReplicaSourceHash(body: Record<string, unknown>): string | null {
  if (!Object.hasOwn(body, "expectedReplicaSourceHash")) {
    return null;
  }

  const value = body.expectedReplicaSourceHash;
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Hosted browser-vault replica write request.expectedReplicaSourceHash must be a non-empty string.");
  }

  return value;
}

async function writeRequestOwnsRuntimeWriteFence(input: {
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
