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
  readHostedRunnerDiagnosticMethod,
  readHostedRunnerInternalHostKind,
  readHostedRunnerInternalOperation,
} from "./runner-outbound/diagnostics.ts";
import {
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";

export type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

export async function handleRunnerOutboundRequest(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<Response> {
  try {
    const url = new URL(request.url);

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
        hostKind: safeUrl ? readRunnerOutboundHostKind(safeUrl.hostname) : "invalid_url",
        method: readHostedRunnerDiagnosticMethod(request.method),
        operation: safeUrl ? readRunnerOutboundOperation(safeUrl, request.method) : "invalid_url",
        userIdPresent: userId.length > 0,
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

function readRunnerOutboundHostKind(hostname: string): string {
  const kind = readHostedRunnerInternalHostKind(hostname);
  return kind === "unknown_internal_host" ? "unknown_host" : kind;
}

function readRunnerOutboundOperation(url: URL, method: string): string {
  const operation = readHostedRunnerInternalOperation({
    hostname: url.hostname,
    method,
    pathname: url.pathname,
  });
  return operation === "unknown_internal_operation" ? "unknown_operation" : operation;
}

async function handleRunnerArtifactRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  sha256: string;
  userId: string;
}): Promise<Response> {
  const startedAt = Date.now();
  const method = readHostedRunnerDiagnosticMethod(input.request.method);
  const operation = input.request.method === "PUT" ? "artifact_upload" : "artifact_fetch";
  const logDetails = {
    method,
    operation,
    userIdPresent: input.userId.length > 0,
  };
  const emitCompleted = (
    details: Record<string, boolean | number | string | null>,
    responseStatus: number,
  ) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        responseStatus,
        ...details,
      },
      level: responseStatus >= 400 ? "warn" : "info",
      message: "Hosted runner artifact request completed.",
      phase: "wake.running",
    });
  };

  if (input.request.method === "PUT") {
    const ownsWriteFence = await writeRequestOwnsRuntimeWriteFence({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    if (!ownsWriteFence) {
      emitCompleted({
        artifactAuthorized: false,
      }, 401);
      return unauthorized();
    }
  }

  try {
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
        emitCompleted({
          artifactFound: false,
        }, 404);
        return notFound();
      }

      emitCompleted({
        artifactByteLength: bytes.byteLength,
        artifactFound: true,
      }, 200);
      return new Response(copyBytesToArrayBuffer(bytes), {
        headers: {
          "content-type": "application/octet-stream",
        },
        status: 200,
      });
    }

    const bytes = new Uint8Array(await input.request.arrayBuffer());
    await artifactStore.writeArtifact(input.sha256, bytes);
    emitCompleted({
      artifactAuthorized: true,
      artifactByteLength: bytes.byteLength,
    }, 200);
    return json({
      ok: true,
      sha256: input.sha256,
      size: bytes.byteLength,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        errorCode: deriveHostedExecutionErrorCode(error),
        errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
        ...(readHostedExecutionSafeErrorName(error)
          ? { errorName: readHostedExecutionSafeErrorName(error) }
          : {}),
      },
      level: "warn",
      message: "Hosted runner artifact request failed.",
      phase: "wake.running",
    });
    throw error;
  }
}

async function handleRunnerBrowserVaultReplicaWriteRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  userId: string;
}): Promise<Response> {
  const authorized = await writeRequestOwnsRuntimeWriteFence({
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
    expectedReplicaSourceHash: null,
    replica: body.replica,
    userId: input.userId,
  });

  return json({ replicaRef });
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
