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
import {
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
} from "@murphai/hosted-execution/routes";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "./internal-hosts.ts";
import { json, methodNotAllowed, notFound, readJsonObject, unauthorized } from "./json.ts";
import {
  requireRunnerActiveInvocationLease,
  requireRunnerActiveInvocationLeaseWriteHeaders,
  RunnerActiveInvocationLeaseError,
} from "./runner-outbound/active-lease.ts";
import {
  buildRunnerBrowserVaultRefreshAttemptId,
  readRunnerBrowserVaultRefreshSourceStateHash,
  RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
} from "./runner-outbound/browser-vault-refresh-authority.ts";
import { handleRunnerHeartbeatRequest } from "./runner-outbound/heartbeat.ts";
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
  proxyLeaseGeneration?: string | null;
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
    const authorizationError = requireRunnerInternalProxyAuthorization(
      request,
      url.hostname,
      internalWorkerProxyToken,
    );
    if (authorizationError) {
      return authorizationError;
    }

    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
    if (
      isRunnerBrowserVaultRefreshProxyContext(proxyContext)
      && !isAllowedBrowserVaultRefreshOutboundRequest({
        method: request.method,
        url,
      })
    ) {
      return unauthorized();
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
        request,
        url,
        userId,
      });
    }

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl) {
      return handleRunnerHeartbeatRequest({
        env,
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
    const ownsActiveLease = await writeRequestOwnsActiveInvocationLease({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    if (!ownsActiveLease) {
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
  const refreshSourceStateHash = readRunnerBrowserVaultRefreshSourceStateHash(input.request);
  const authorized = refreshSourceStateHash
    ? writeRequestOwnsBrowserVaultRefreshAuthority({
        proxyContext: input.proxyContext,
        sourceStateHash: refreshSourceStateHash,
      })
    : isRunnerBrowserVaultRefreshProxyContext(input.proxyContext)
      ? true
    : await writeRequestOwnsActiveInvocationLease({
        env: input.env,
        request: input.request,
        userId: input.userId,
      });
  if (!authorized) {
    return unauthorized();
  }

  const body = await readJsonObject(input.request, {
    limitBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES + 1024 * 1024,
  });
  if (!Object.hasOwn(body, "replica")) {
    throw new TypeError("Hosted browser-vault replica write request.replica is required.");
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
    expectedReplicaSourceHash: refreshSourceStateHash,
    replica: body.replica,
    userId: input.userId,
  });

  return json({ replicaRef });
}

function writeRequestOwnsBrowserVaultRefreshAuthority(input: {
  proxyContext: RunnerOutboundProxyContext;
  sourceStateHash: string;
}): boolean {
  return input.proxyContext.proxyAttemptId === buildRunnerBrowserVaultRefreshAttemptId(input.sourceStateHash)
    && input.proxyContext.proxyLeaseGeneration === RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION;
}

function isRunnerBrowserVaultRefreshProxyContext(
  proxyContext: RunnerOutboundProxyContext,
): boolean {
  return proxyContext.proxyLeaseGeneration === RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION
    && (
      proxyContext.proxyAttemptId === undefined
      || proxyContext.proxyAttemptId === null
      || proxyContext.proxyAttemptId.startsWith("browser-vault-refresh:")
    );
}

function isAllowedBrowserVaultRefreshOutboundRequest(input: {
  method: string;
  url: URL;
}): boolean {
  return (
    input.url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane
    && input.method === "POST"
    && input.url.pathname === HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH
  ) || (
    input.url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore
    && input.method === "POST"
    && input.url.pathname === "/replicas"
  );
}

async function writeRequestOwnsActiveInvocationLease(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<boolean> {
  try {
    requireRunnerActiveInvocationLeaseWriteHeaders(input.request);
    await requireRunnerActiveInvocationLease({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    return true;
  } catch (error) {
    if (error instanceof RunnerActiveInvocationLeaseError) {
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
