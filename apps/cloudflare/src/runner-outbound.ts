import { createHostedArtifactStore } from "./bundle-store.ts";
import { HostedEncryptedR2PayloadUnreadableError } from "./crypto.ts";
import { HostedBundleGarbageCollector } from "./bundle-gc.ts";
import type {
  HostedExecutionBundleRef,
  HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedWorkspaceSnapshotOrphanCandidate,
  HostedWorkspaceSnapshotUploadSession,
  WorkspaceSnapshotR2BucketLike,
  WorkspaceSnapshotR2ObjectLike,
} from "./workspace-snapshot-store.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
} from "./workspace-snapshot-store.ts";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  createHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_DIRECT_UPLOAD_WINDOW_MS,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId,
  unwrapHostedWorkspaceSnapshotV2DataKey,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedBrowserVaultReplicaRef,
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
  parseHostedWorkspaceSnapshotV2Ref,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  createHostedBrowserVaultReplicaStore,
  HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
  type HostedBrowserVaultReplicaOrphanCandidate,
} from "./browser-vault-store.ts";
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
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "./internal-hosts.ts";
import { json, jsonError, methodNotAllowed, notFound, readJsonObject, unauthorized } from "./json.ts";
import {
  readHostedRuntimeArtifactFetchTelemetry,
} from "./runner-outbound/headers.ts";
import {
  requireRunnerRuntimeWriteFenceHeaders,
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
  requireRunnerRuntimeWriteFenceWorkspaceWrite,
  writeRunnerRuntimeWriteFenceHeaders,
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
  resolveRunnerOutboundUserRunnerStub,
  requireRunnerOutboundUserStubMethod,
  type RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";
import {
  encodeHostedWorkspaceSnapshotSha256Base64,
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  buildHostedWorkspaceSnapshotRefFromUploadSession,
  readHostedWorkspaceSnapshotSha256ChecksumHex,
} from "./workspace-snapshot-store.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "./storage-paths.ts";
import {
  HOSTED_R2_CHECKSUM_MODE_ENABLED,
  HOSTED_R2_CHECKSUM_MODE_HEADER,
  createHostedR2PresignedDeleteUrl,
  createHostedR2PresignedGetUrl,
  createHostedR2PresignedHeadUrl,
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
  type HostedR2PresignEnvironment,
} from "./r2-presigned-url.ts";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";

export type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

const HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_EXPIRES_MS = 60 * 60 * 1000;
const HOSTED_WORKSPACE_SNAPSHOT_PRESIGNED_PUT_EXPIRES_SECONDS =
  HOSTED_WORKSPACE_SNAPSHOT_DIRECT_UPLOAD_WINDOW_MS / 1000;
const HOSTED_WORKSPACE_SNAPSHOT_PRESIGNED_PUT_UPLOAD_MAX_MS =
  HOSTED_WORKSPACE_SNAPSHOT_DIRECT_UPLOAD_WINDOW_MS;
const HOSTED_WORKSPACE_SNAPSHOT_PRESIGNED_GET_EXPIRES_SECONDS = 60 * 60;
const HOSTED_WORKSPACE_SNAPSHOT_PRESIGN_MIN_REMAINING_SECONDS = 30;
const HOSTED_RUNNER_DIAGNOSTIC_FINGERPRINT_BYTES = 12;
const hostedRunnerDiagnosticTextEncoder = new TextEncoder();
type HostedExecutionSnapshotRefValue = NonNullable<HostedExecutionSnapshotRef>;

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

    if (url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore) {
      if (url.pathname === "/workspace-snapshots/start") {
        if (request.method !== "POST") {
          return methodNotAllowed();
        }
        return handleRunnerWorkspaceSnapshotStartRequest({
          bucket: env.BUNDLES,
          env,
          environment,
          request,
          userId,
        });
      }

      const match = /^\/workspace-snapshots\/(?<snapshotId>[A-Za-z0-9][A-Za-z0-9._-]{0,127})(?<suffix>\/complete|\/data-key\/unwrap|\/heartbeat|\/presign-get|\/presign-put)?$/u.exec(
        url.pathname,
      );
      if (!match?.groups) {
        return notFound();
      }

      if (match.groups.suffix === "/complete") {
        if (request.method !== "POST") {
          return methodNotAllowed();
        }
        return handleRunnerWorkspaceSnapshotCompleteRequest({
          bucket: env.BUNDLES,
          env,
          environment,
          request,
          snapshotId: match.groups.snapshotId,
          userId,
        });
      }

      if (match.groups.suffix === "/heartbeat") {
        if (request.method !== "POST") {
          return methodNotAllowed();
        }
        return handleRunnerWorkspaceSnapshotHeartbeatRequest({
          env,
          request,
          snapshotId: match.groups.snapshotId,
          userId,
        });
      }

      if (match.groups.suffix === "/presign-put") {
        if (request.method !== "POST") {
          return methodNotAllowed();
        }
        return handleRunnerWorkspaceSnapshotPresignPutRequest({
          env,
          request,
          snapshotId: match.groups.snapshotId,
          userId,
        });
      }

      if (match.groups.suffix === "/presign-get") {
        if (request.method !== "POST") {
          return methodNotAllowed();
        }
        return handleRunnerWorkspaceSnapshotPresignGetRequest({
          env,
          request,
          snapshotId: match.groups.snapshotId,
          userId,
        });
      }

      if (match.groups.suffix === "/data-key/unwrap") {
        if (request.method !== "POST") {
          return methodNotAllowed();
        }
        return handleRunnerWorkspaceSnapshotDataKeyRequest({
          bucket: env.BUNDLES,
          env,
          environment,
          request,
          snapshotId: match.groups.snapshotId,
          userId,
        });
      }

      if (!match.groups.suffix && request.method === "DELETE") {
        return handleRunnerWorkspaceSnapshotAbortRequest({
          bucket: env.BUNDLES,
          env,
          request,
          snapshotId: match.groups.snapshotId,
          userId,
        });
      }

      return methodNotAllowed();
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
  const fetchTelemetry = input.request.method === "GET"
    ? readHostedRuntimeArtifactFetchTelemetry(input.request.headers)
    : null;
  const logDetails = {
    ...(fetchTelemetry
      ? {
          artifactFetchCorrelationId: fetchTelemetry.correlationId,
          artifactReadPurpose: fetchTelemetry.purpose,
        }
      : {}),
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
  const emitPhase = (
    message: string,
    details: Record<string, boolean | number | string | null> = {},
    level: "info" | "warn" = "info",
  ) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        ...details,
      },
      level,
      message,
      phase: "wake.running",
    });
  };

  const validationStartedAt = Date.now();
  emitPhase("Hosted runner artifact write fence validation started.");
  const ownsWriteFence = await writeRequestOwnsRuntimeWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  emitPhase(
    "Hosted runner artifact write fence validation completed.",
    {
      artifactAuthorized: ownsWriteFence,
      validationDurationMs: Date.now() - validationStartedAt,
    },
    ownsWriteFence ? "info" : "warn",
  );
  if (!ownsWriteFence) {
    emitCompleted({
      artifactAuthorized: false,
    }, 401);
    return unauthorized();
  }

  try {
    const cryptoStartedAt = Date.now();
    emitPhase("Hosted runner artifact crypto context started.");
    const crypto = await resolveRunnerOutboundUserCryptoContext({
      bucket: input.bucket,
      domain: "runtime",
      env: input.env,
      environment: input.environment,
      userId: input.userId,
    });
    emitPhase("Hosted runner artifact crypto context completed.", {
      cryptoContextDurationMs: Date.now() - cryptoStartedAt,
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

    const bodyReadStartedAt = Date.now();
    emitPhase("Hosted runner artifact request body read started.", {
      artifactAuthorized: true,
    });
    const bytes = new Uint8Array(await input.request.arrayBuffer());
    emitPhase("Hosted runner artifact request body read completed.", {
      artifactAuthorized: true,
      artifactByteLength: bytes.byteLength,
      bodyReadDurationMs: Date.now() - bodyReadStartedAt,
    });
    const writeStartedAt = Date.now();
    emitPhase("Hosted runner artifact write started.", {
      artifactAuthorized: true,
      artifactByteLength: bytes.byteLength,
    });
    await artifactStore.writeArtifact(input.sha256, bytes);
    emitPhase("Hosted runner artifact write completed.", {
      artifactAuthorized: true,
      artifactByteLength: bytes.byteLength,
      artifactWriteDurationMs: Date.now() - writeStartedAt,
    });
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
    if (
      input.request.method === "GET"
      && error instanceof HostedEncryptedR2PayloadUnreadableError
    ) {
      emitCompleted({
        artifactReadable: false,
      }, 422);
      return jsonError("Artifact is unreadable.", 422);
    }
    throw error;
  }
}

async function handleRunnerWorkspaceSnapshotStartRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  userId: string;
}): Promise<Response> {
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    return unauthorized();
  }

  const body = await readJsonObject(input.request, {
    limitBytes: 16 * 1024,
  });
  const reason = requireSnapshotDataKeyString(body.reason, "reason");
  if (reason !== "idle_shutdown") {
    return jsonError("Hosted workspace snapshot start reason must be idle_shutdown.", 400);
  }
  const expectedWorkspaceVersion = requireSnapshotDataKeyString(
    body.expectedWorkspaceVersion,
    "expectedWorkspaceVersion",
  );
  if (expectedWorkspaceVersion !== writeFence.workspaceVersion) {
    return jsonError("Hosted workspace snapshot start workspace version is stale.", 409);
  }

  const snapshotId = createHostedWorkspaceSnapshotId();
  const objectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId,
    userId: input.userId,
  });
  const aad = buildHostedWorkspaceSnapshotV2Aad({
    objectKey,
    snapshotId,
    userId: input.userId,
  });

  const cryptoContext = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    domain: "runtime",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const dataKey = createHostedWorkspaceSnapshotV2DataKey();
  const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
    aad,
    dataKey,
    rootKey: cryptoContext.rootKey,
    rootKeyId: cryptoContext.rootKeyId,
  });
  const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
  dataKey.fill(0);
  const ivBase64 = createHostedWorkspaceSnapshotIvBase64();
  const expiresAt = new Date(
    Date.now() + HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_EXPIRES_MS,
  ).toISOString();

  const session: HostedWorkspaceSnapshotUploadSession = {
    attemptId: writeFence.attemptId,
    createdAt: new Date().toISOString(),
    encryption: {
      aad,
      ivBase64,
      rootKeyId: cryptoContext.rootKeyId,
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey,
    },
    expectedWorkspaceVersion,
    expiresAt,
    leaseGeneration: writeFence.generation,
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
    snapshotId,
    userId: input.userId,
    workspaceVersion: writeFence.workspaceVersion,
  };
  const createdSession = await createWorkspaceSnapshotUploadSession({
    env: input.env,
    session,
    userId: input.userId,
  });
  if (!createdSession) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  return json({
    encryption: {
      aad,
      dataKeyBase64,
      ivBase64,
      rootKeyId: cryptoContext.rootKeyId,
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey,
    },
    expiresAt,
    limits: {
      maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      warnEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
    },
    objectKey,
    snapshotId,
  });
}

async function handleRunnerWorkspaceSnapshotHeartbeatRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  snapshotId: string;
  userId: string;
}): Promise<Response> {
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    return unauthorized();
  }
  const body = await readJsonObject(input.request, {
    limitBytes: 4 * 1024,
  });
  const requestedSnapshotId = requireSnapshotDataKeyString(body.snapshotId, "snapshotId");
  if (requestedSnapshotId !== input.snapshotId) {
    return jsonError("Hosted workspace snapshot heartbeat snapshotId does not match its route.", 400);
  }
  const alive = await heartbeatWorkspaceSnapshotUploadSession({
    attemptId: writeFence.attemptId,
    env: input.env,
    leaseGeneration: writeFence.generation,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (!alive) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }
  return json({ alive: true, ok: true });
}

async function handleRunnerWorkspaceSnapshotPresignPutRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  snapshotId: string;
  userId: string;
}): Promise<Response> {
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    return unauthorized();
  }

  const body = await readJsonObject(input.request, {
    limitBytes: 16 * 1024,
  });
  const requestedSnapshotId = requireSnapshotDataKeyString(body.snapshotId, "snapshotId");
  const requestedObjectKey = requireSnapshotDataKeyString(body.objectKey, "objectKey");
  const encryptedByteSize = requireSnapshotPositiveSafeInteger(
    body.encryptedByteSize,
    "encryptedByteSize",
  );
  const encryptedObjectSha256 = requireSnapshotSha256Hex(
    body.encryptedObjectSha256,
    "encryptedObjectSha256",
  );
  if (requestedSnapshotId !== input.snapshotId) {
    return jsonError("Hosted workspace snapshot presign snapshotId does not match its route.", 400);
  }
  if (encryptedByteSize >= HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES) {
    return jsonError("Hosted workspace snapshot exceeds the single-part size limit.", 413);
  }

  const session = await readWorkspaceSnapshotUploadSession({
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (!session) {
    return notFound();
  }
  const sessionExpiresAtMs = Date.parse(session.expiresAt);
  const nowMs = Date.now();
  if (
    !Number.isFinite(sessionExpiresAtMs)
    || sessionExpiresAtMs <= nowMs
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: null,
      deleteObject: false,
      env: input.env,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot upload session expired.", 410);
  }
  const remainingSessionSeconds = Math.floor((sessionExpiresAtMs - nowMs) / 1000);
  if (remainingSessionSeconds < HOSTED_WORKSPACE_SNAPSHOT_PRESIGN_MIN_REMAINING_SECONDS) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: null,
      deleteObject: false,
      env: input.env,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot upload session is too close to expiry.", 410);
  }
  if (
    session.attemptId !== writeFence.attemptId
    || session.leaseGeneration !== writeFence.generation
    || session.workspaceVersion !== writeFence.workspaceVersion
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: null,
      deleteObject: false,
      env: input.env,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }
  if (
    session.userId !== input.userId
    || session.snapshotId !== input.snapshotId
    || session.objectKey !== requestedObjectKey
    || session.encryption.aad.objectKey !== requestedObjectKey
    || session.encryption.aad.snapshotId !== input.snapshotId
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: null,
      deleteObject: false,
      env: input.env,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot presign target is outside the bound user namespace.", 403);
  }

  const presigned = await createHostedR2PresignedPutUrl({
    checksumSha256Base64: encodeHostedWorkspaceSnapshotSha256Base64(encryptedObjectSha256),
    contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(input.env)),
    expiresSeconds: Math.min(
      HOSTED_WORKSPACE_SNAPSHOT_PRESIGNED_PUT_EXPIRES_SECONDS,
      remainingSessionSeconds,
    ),
    key: requestedObjectKey,
    metadata: {
      encryptedsha256: encryptedObjectSha256,
      schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
      snapshotid: input.snapshotId,
    },
  });
  const drainUntil = new Date(
    Date.parse(presigned.expiresAt) + HOSTED_WORKSPACE_SNAPSHOT_PRESIGNED_PUT_UPLOAD_MAX_MS,
  ).toISOString();
  const remembered = await rememberWorkspaceSnapshotPresignedPut({
    drainUntil,
    env: input.env,
    expiresAt: presigned.expiresAt,
    session,
    userId: input.userId,
  });
  if (!remembered) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: { r2PutDrainRecorded: true },
    message: "Hosted workspace snapshot PUT was issued.",
    phase: "wake.running",
    userId: input.userId,
  });

  return json({
    expiresAt: presigned.expiresAt,
    putUrl: presigned.url,
  });
}

async function handleRunnerWorkspaceSnapshotPresignGetRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  snapshotId: string;
  userId: string;
}): Promise<Response> {
  const startedAt = Date.now();
  const emitPresignGetDiagnostic = (
    message: string,
    level: "info" | "warn",
    details: HostedExecutionStructuredLogDetails,
  ) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        durationMs: Date.now() - startedAt,
        method: readHostedRunnerDiagnosticMethod(input.request.method),
        operation: "workspace_snapshot_presign_get",
        userIdPresent: input.userId.length > 0,
        ...details,
      },
      level,
      message,
      phase: "wake.running",
      userId: null,
    });
  };
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    emitPresignGetDiagnostic(
      "Hosted workspace snapshot presign GET rejected.",
      "warn",
      {
        rejectionReason: "write_fence_unavailable",
        workspaceVersionPresent: false,
      },
    );
    return unauthorized();
  }
  const body = await readJsonObject(input.request, {
    limitBytes: 16 * 1024,
  });
  const requestedSnapshotId = requireSnapshotDataKeyString(body.snapshotId, "snapshotId");
  const requestedObjectKey = requireSnapshotDataKeyString(body.objectKey, "objectKey");
  let requestedRef: ReturnType<typeof parseHostedWorkspaceSnapshotV2Ref>;
  try {
    requestedRef = parseHostedWorkspaceSnapshotV2Ref(
      body.ref,
      "Hosted workspace snapshot presign GET ref",
    );
  } catch {
    emitPresignGetDiagnostic(
      "Hosted workspace snapshot presign GET rejected.",
      "warn",
      {
        refParsed: false,
        rejectionReason: "invalid_ref",
        snapshotIdMatchesRoute: requestedSnapshotId === input.snapshotId,
        workspaceVersionPresent: writeFence.workspaceVersion.length > 0,
      },
    );
    return jsonError("Hosted workspace snapshot presign ref is invalid.", 400);
  }
  if (requestedSnapshotId !== input.snapshotId) {
    emitPresignGetDiagnostic(
      "Hosted workspace snapshot presign GET rejected.",
      "warn",
      {
        refParsed: true,
        rejectionReason: "snapshot_route_mismatch",
        snapshotIdMatchesRoute: false,
        workspaceVersionPresent: writeFence.workspaceVersion.length > 0,
      },
    );
    return jsonError("Hosted workspace snapshot presign snapshotId does not match its route.", 400);
  }
  const refUserMatchesBoundUser = requestedRef.userId === input.userId;
  const refSnapshotIdMatchesRoute = requestedRef.snapshotId === input.snapshotId;
  const refObjectKeyMatchesBody = requestedRef.objectKey === requestedObjectKey;
  const refAadUserMatchesBoundUser = requestedRef.encryption.aad.userId === input.userId;
  const refAadSnapshotIdMatchesRoute =
    requestedRef.encryption.aad.snapshotId === input.snapshotId;
  const refAadObjectKeyMatchesBody =
    requestedRef.encryption.aad.objectKey === requestedObjectKey;
  if (
    !refUserMatchesBoundUser
    || !refSnapshotIdMatchesRoute
    || !refObjectKeyMatchesBody
    || !refAadUserMatchesBoundUser
    || !refAadSnapshotIdMatchesRoute
    || !refAadObjectKeyMatchesBody
  ) {
    emitPresignGetDiagnostic(
      "Hosted workspace snapshot presign GET rejected.",
      "warn",
      {
        refAadObjectKeyMatchesBody,
        refAadSnapshotIdMatchesRoute,
        refAadUserMatchesBoundUser,
        refObjectKeyMatchesBody,
        refParsed: true,
        refSnapshotIdMatchesRoute,
        refUserMatchesBoundUser,
        rejectionReason: "ref_route_mismatch",
        snapshotIdMatchesRoute: true,
        workspaceVersionPresent: writeFence.workspaceVersion.length > 0,
      },
    );
    return jsonError("Hosted workspace snapshot presign ref does not match its route.", 403);
  }

  const expectedObjectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (requestedObjectKey !== expectedObjectKey) {
    emitPresignGetDiagnostic(
      "Hosted workspace snapshot presign GET rejected.",
      "warn",
      {
        objectKeyMatchesExpected: false,
        refParsed: true,
        rejectionReason: "object_key_namespace_mismatch",
        snapshotIdMatchesRoute: true,
        workspaceVersionPresent: writeFence.workspaceVersion.length > 0,
      },
    );
    return jsonError("Hosted workspace snapshot presign target is outside the bound user namespace.", 403);
  }

  const snapshotObjectStore = createWorkspaceSnapshotObjectStore({
    bucket: input.env.BUNDLES,
    env: input.env,
  });
  if (snapshotObjectStore.configurationError) {
    throw new Error(snapshotObjectStore.configurationError);
  }
  if (!snapshotObjectStore.head) {
    throw new Error("Hosted workspace snapshot presign GET requires object metadata support.");
  }
  if (!await snapshotObjectStore.head(requestedObjectKey)) {
    return notFound();
  }
  const presigned = await createHostedR2PresignedGetUrl({
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(input.env)),
    expiresSeconds: HOSTED_WORKSPACE_SNAPSHOT_PRESIGNED_GET_EXPIRES_SECONDS,
    key: requestedObjectKey,
  });
  emitPresignGetDiagnostic(
    "Hosted workspace snapshot presign GET completed.",
    "info",
    {
      objectKeyMatchesExpected: true,
      presignSucceeded: true,
      refParsed: true,
      snapshotIdMatchesRoute: true,
      workspaceVersionPresent: writeFence.workspaceVersion.length > 0,
    },
  );

  return json({
    expiresAt: presigned.expiresAt,
    getUrl: presigned.url,
  });
}

async function handleRunnerWorkspaceSnapshotDataKeyRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  snapshotId: string;
  userId: string;
}): Promise<Response> {
  const startedAt = Date.now();
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    return unauthorized();
  }

  const body = await readJsonObject(input.request, {
    limitBytes: 16 * 1024,
  });
  const logDetails = {
    method: readHostedRunnerDiagnosticMethod(input.request.method),
    operation: "workspace_snapshot_data_key_unwrap",
    userIdPresent: input.userId.length > 0,
    workspaceVersionPresent: writeFence.workspaceVersion.length > 0,
  } satisfies HostedExecutionStructuredLogDetails;
  const emitDataKeyDiagnostic = (
    message: string,
    level: "info" | "warn",
    details: HostedExecutionStructuredLogDetails,
  ) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        ...details,
      },
      level,
      message,
      phase: "wake.running",
      userId: null,
    });
  };
  const expectedObjectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId: input.snapshotId,
    userId: input.userId,
  });

  const cryptoContext = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.bucket,
    domain: "runtime",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const cryptoContextDetails = readWorkspaceSnapshotDataKeyCryptoContextLogDetails({
    cacheMaxAgeMs: cryptoContext.cacheMaxAgeMs,
    cryptoContextVersion: cryptoContext.cryptoContextVersion,
    fetchedAtMs: cryptoContext.fetchedAtMs,
  });

  const aad = readWorkspaceSnapshotAad(body.aad, "aad");
  const aadObjectKeyMatchesExpected = aad.objectKey === expectedObjectKey;
  const aadSnapshotIdMatchesRoute = aad.snapshotId === input.snapshotId;
  const aadUserMatchesBoundUser = aad.userId === input.userId;
  if (!aadObjectKeyMatchesExpected || !aadSnapshotIdMatchesRoute || !aadUserMatchesBoundUser) {
    emitDataKeyDiagnostic(
      "Hosted workspace snapshot data key unwrap rejected.",
      "warn",
      {
        ...cryptoContextDetails,
        aadMatchesExpected: false,
        aadObjectKeyMatchesExpected,
        aadSnapshotIdMatchesRoute,
        aadUserMatchesBoundUser,
      },
    );
    return jsonError("Hosted workspace snapshot AAD is outside the bound user namespace.", 403);
  }
  const wrappedDataKey = requireSnapshotDataKeyString(body.wrappedDataKey, "wrappedDataKey");
  const rootKeyId = requireSnapshotDataKeyString(body.rootKeyId, "rootKeyId");
  const wrappedRootMatchesBody =
    readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId(wrappedDataKey) === rootKeyId;
  if (!wrappedRootMatchesBody) {
    emitDataKeyDiagnostic(
      "Hosted workspace snapshot data key unwrap rejected.",
      "warn",
      {
        ...cryptoContextDetails,
        aadMatchesExpected: true,
        wrappedRootMatchesBody,
      },
    );
    return jsonError("Hosted workspace snapshot wrapped data key rootKeyId mismatch.", 400);
  }
  const rootKeyMatchesCryptoContext = rootKeyId === cryptoContext.rootKeyId;
  const rootResolutionStartedAt = Date.now();
  let rootKey: Uint8Array | null;
  try {
    rootKey = rootKeyMatchesCryptoContext
      ? cryptoContext.rootKey
      : await cryptoContext.resolveKeyById(rootKeyId);
  } catch (error) {
    const errorName = readHostedExecutionSafeErrorName(error);
    emitDataKeyDiagnostic(
      "Hosted workspace snapshot data key root resolution failed.",
      "warn",
      {
        ...cryptoContextDetails,
        aadMatchesExpected: true,
        errorCode: deriveHostedExecutionErrorCode(error),
        errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
        ...(errorName ? { errorName } : {}),
        rootKeyMatchesCryptoContext,
        rootLookupAttempted: !rootKeyMatchesCryptoContext,
        rootResolutionDurationMs: Date.now() - rootResolutionStartedAt,
        rootResolved: false,
        wrappedRootMatchesBody,
      },
    );
    throw error;
  }
  const rootResolutionDurationMs = Date.now() - rootResolutionStartedAt;
  if (!rootKey) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        ...(await buildWorkspaceSnapshotDataKeyRootUnavailableLogDetails({
          cryptoContextRootKeyId: cryptoContext.rootKeyId,
          env: input.env,
          rootKeyId,
          rootKeyMatchesCryptoContext,
          snapshotId: input.snapshotId,
        })),
        ...cryptoContextDetails,
        aadMatchesExpected: true,
        rootResolutionDurationMs,
        rootResolved: false,
        wrappedRootMatchesBody,
      },
      level: "warn",
      message: "Hosted workspace snapshot data key root unavailable.",
      phase: "wake.running",
      userId: null,
    });
    return notFound();
  }
  let dataKey: Uint8Array | null = null;
  const unwrapStartedAt = Date.now();
  try {
    dataKey = await unwrapHostedWorkspaceSnapshotV2DataKey({
      aad,
      rootKey,
      wrappedDataKey,
    });
    emitDataKeyDiagnostic(
      "Hosted workspace snapshot data key unwrap completed.",
      "info",
      {
        ...cryptoContextDetails,
        aadMatchesExpected: true,
        rootKeyMatchesCryptoContext,
        rootLookupAttempted: !rootKeyMatchesCryptoContext,
        rootResolutionDurationMs,
        rootResolved: true,
        unwrapDurationMs: Date.now() - unwrapStartedAt,
        unwrapSucceeded: true,
        wrappedRootMatchesBody,
      },
    );

    return json({
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
    });
  } catch (error) {
    const errorName = readHostedExecutionSafeErrorName(error);
    emitDataKeyDiagnostic(
      "Hosted workspace snapshot data key unwrap failed.",
      "warn",
      {
        ...cryptoContextDetails,
        aadMatchesExpected: true,
        errorCode: deriveHostedExecutionErrorCode(error),
        errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
        ...(errorName ? { errorName } : {}),
        rootKeyMatchesCryptoContext,
        rootLookupAttempted: !rootKeyMatchesCryptoContext,
        rootResolutionDurationMs,
        rootResolved: true,
        unwrapDurationMs: Date.now() - unwrapStartedAt,
        unwrapSucceeded: false,
        wrappedRootMatchesBody,
      },
    );
    throw error;
  } finally {
    dataKey?.fill(0);
  }
}

function readWorkspaceSnapshotDataKeyCryptoContextLogDetails(input: {
  cacheMaxAgeMs: number;
  cryptoContextVersion: string | null;
  fetchedAtMs: number;
}): HostedExecutionStructuredLogDetails {
  const fetchedAgeMs = Number.isFinite(input.fetchedAtMs)
    ? Math.max(0, Date.now() - input.fetchedAtMs)
    : null;
  return {
    cryptoContextCacheMaxAgeMs: input.cacheMaxAgeMs,
    cryptoContextFetchedAgeMs: fetchedAgeMs,
    cryptoContextVersionPresent: input.cryptoContextVersion !== null,
  };
}

async function buildWorkspaceSnapshotDataKeyRootUnavailableLogDetails(input: {
  cryptoContextRootKeyId: string;
  env: RunnerOutboundEnvironmentSource;
  rootKeyId: string;
  rootKeyMatchesCryptoContext: boolean;
  snapshotId: string;
}): Promise<Record<string, boolean | string>> {
  const [
    snapshotFingerprint,
    rootKeyFingerprint,
    cryptoContextRootKeyFingerprint,
  ] = await Promise.all([
    createHostedRunnerDiagnosticFingerprint(input.env, `workspace-snapshot:${input.snapshotId}`),
    createHostedRunnerDiagnosticFingerprint(input.env, `runtime-root:${input.rootKeyId}`),
    createHostedRunnerDiagnosticFingerprint(
      input.env,
      `runtime-root:${input.cryptoContextRootKeyId}`,
    ),
  ]);

  return {
    cryptoContextRootKeyFingerprintPresent: cryptoContextRootKeyFingerprint !== null,
    diagnosticFingerprintKind:
      snapshotFingerprint || rootKeyFingerprint || cryptoContextRootKeyFingerprint
        ? "hmac-sha256-96"
        : "none",
    operation: "workspace_snapshot_data_key_unwrap",
    rootKeyFingerprintPresent: rootKeyFingerprint !== null,
    rootKeyMatchesCryptoContext: input.rootKeyMatchesCryptoContext,
    rootLookupAttempted: !input.rootKeyMatchesCryptoContext,
    snapshotFingerprintPresent: snapshotFingerprint !== null,
    ...(snapshotFingerprint ? { snapshotFingerprint } : {}),
    ...(rootKeyFingerprint ? { rootKeyFingerprint } : {}),
    ...(cryptoContextRootKeyFingerprint ? { cryptoContextRootKeyFingerprint } : {}),
  };
}

async function createHostedRunnerDiagnosticFingerprint(
  env: RunnerOutboundEnvironmentSource,
  value: string,
): Promise<string | null> {
  const secret = env.HOSTED_LOG_FINGERPRINT_SECRET?.trim();
  if (!secret) {
    return null;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hostedRunnerDiagnosticTextEncoder.encode(secret),
      {
        hash: "SHA-256",
        name: "HMAC",
      },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      hostedRunnerDiagnosticTextEncoder.encode(value),
    ));
    return Array.from(signature.slice(0, HOSTED_RUNNER_DIAGNOSTIC_FINGERPRINT_BYTES))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function handleRunnerWorkspaceSnapshotAbortRequest(input: {
  bucket: WorkspaceSnapshotR2BucketLike;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  snapshotId: string;
  userId: string;
}): Promise<Response> {
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    return unauthorized();
  }

  const body = await readJsonObject(input.request, {
    limitBytes: 16 * 1024,
  });
  const requestedSnapshotId = requireSnapshotDataKeyString(body.snapshotId, "snapshotId");
  const requestedObjectKey = requireSnapshotDataKeyString(body.objectKey, "objectKey");
  if (requestedSnapshotId !== input.snapshotId) {
    return jsonError("Hosted workspace snapshot abort snapshotId does not match its route.", 400);
  }

  const session = await readWorkspaceSnapshotUploadSession({
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (!session) {
    return json({
      aborted: false,
      ok: true,
    });
  }

  if (
    session.userId !== input.userId
    || session.snapshotId !== input.snapshotId
    || session.objectKey !== requestedObjectKey
    || session.encryption.aad.objectKey !== requestedObjectKey
    || session.encryption.aad.snapshotId !== input.snapshotId
  ) {
    return jsonError("Hosted workspace snapshot abort target is outside the bound user namespace.", 403);
  }

  if (
    session.attemptId !== writeFence.attemptId
    || session.leaseGeneration !== writeFence.generation
    || session.workspaceVersion !== writeFence.workspaceVersion
  ) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  await retireWorkspaceSnapshotUploadSession({
    bucket: input.bucket,
    deleteObject: true,
    env: input.env,
    objectKey: session.objectKey,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });

  return json({
    aborted: true,
    ok: true,
  });
}

async function handleRunnerWorkspaceSnapshotCompleteRequest(input: {
  bucket: WorkspaceSnapshotR2BucketLike;
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  snapshotId: string;
  userId: string;
}): Promise<Response> {
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  if (!writeFence) {
    return unauthorized();
  }
  const body = await readJsonObject(input.request, {
    limitBytes: 64 * 1024,
  });
  const requestedSnapshotId = requireSnapshotDataKeyString(body.snapshotId, "snapshotId");
  const requestedObjectKey = requireSnapshotDataKeyString(body.objectKey, "objectKey");
  if (requestedSnapshotId !== input.snapshotId) {
    return jsonError("Hosted workspace snapshot complete snapshotId does not match its route.", 400);
  }
  const session = await readWorkspaceSnapshotUploadSession({
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (!session) {
    return notFound();
  }
  if (
    session.userId !== input.userId
    || session.snapshotId !== input.snapshotId
    || session.objectKey !== requestedObjectKey
    || session.encryption.aad.objectKey !== requestedObjectKey
    || session.encryption.aad.snapshotId !== input.snapshotId
  ) {
    return jsonError("Hosted workspace snapshot ref is outside the bound user namespace.", 403);
  }
  if (
    session.attemptId !== writeFence.attemptId
    || session.leaseGeneration !== writeFence.generation
    || session.workspaceVersion !== writeFence.workspaceVersion
  ) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }
  if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    const alreadyCurrentResponse = await completeExpiredCurrentWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      env: input.env,
      environment: input.environment,
      request: input.request,
      session,
      userId: input.userId,
    });
    if (alreadyCurrentResponse) {
      return alreadyCurrentResponse;
    }
    if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
      return jsonError("Hosted workspace snapshot upload session is stale.", 409);
    }
    try {
      await recordWorkspaceSnapshotObjectCleanup(input.env, {
        objectKey: session.objectKey,
        snapshotId: input.snapshotId,
        userId: input.userId,
      });
      await deleteWorkspaceSnapshotUploadSession({
        env: input.env,
        snapshotId: input.snapshotId,
        userId: input.userId,
      });
    } catch {
      return jsonError("Hosted workspace snapshot cleanup state is unavailable.", 503);
    }
    return jsonError("Hosted workspace snapshot upload session expired.", 410);
  }

  const snapshotRef = parseHostedWorkspaceSnapshotV2Ref(
    buildHostedWorkspaceSnapshotRefFromUploadSession({
      archive: body.archive,
      createdAt: session.createdAt,
      session,
    }),
    "Hosted workspace snapshot complete snapshotRef",
  );
  if (snapshotRef.archive.encryptedByteSize >= HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot exceeds the single-part size limit.", 413);
  }
  if (snapshotRef.archive.totalPlainBytes >= HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot exceeds the total plain size limit.", 413);
  }
  const snapshotObjectStore = createWorkspaceSnapshotObjectStore({
    bucket: input.bucket,
    env: input.env,
  });
  if (snapshotObjectStore.configurationError) {
    return jsonError(snapshotObjectStore.configurationError, 503);
  }
  if (!snapshotObjectStore.head) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot object metadata is unavailable.", 503);
  }
  const object = await snapshotObjectStore.head(snapshotRef.objectKey);
  if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }
  if (!object) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: false,
      env: input.env,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return notFound();
  }
  if (!Number.isSafeInteger(object.size)) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot object size is unavailable.", 503);
  }
  if (object.size !== snapshotRef.archive.encryptedByteSize) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot object size does not match its ref.", 409);
  }
  const objectEncryptedSha256 = readWorkspaceSnapshotObjectMetadata(
    object.customMetadata,
    "encryptedsha256",
  );
  const headChecksumSha256 = readHostedWorkspaceSnapshotSha256ChecksumHex(object.checksums?.sha256);
  if (
    headChecksumSha256 !== snapshotRef.archive.encryptedObjectSha256
    || objectEncryptedSha256 !== snapshotRef.archive.encryptedObjectSha256
    || readWorkspaceSnapshotObjectMetadata(object.customMetadata, "schema")
      !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA
    || readWorkspaceSnapshotObjectMetadata(object.customMetadata, "snapshotid")
      !== snapshotRef.snapshotId
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot object metadata does not match its ref.", 409);
  }
  const checkpointRequest = parseHostedWorkspaceCheckpointRequest({
    ...readWorkspaceSnapshotCompleteCheckpointRequest(body.checkpointRequest),
    snapshotRef,
  });
  if (checkpointRequest.reason !== "idle_shutdown") {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError(
      "Hosted workspace snapshot checkpoint reason must be idle_shutdown.",
      400,
    );
  }
  if (
    checkpointRequest.attemptId !== writeFence.attemptId
    || checkpointRequest.leaseGeneration !== writeFence.generation
    || checkpointRequest.expectedWorkspaceVersion !== writeFence.workspaceVersion
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot checkpoint write fence is stale.", 409);
  }

  const retireAfterAmbiguousCheckpoint = async (): Promise<Response | null> => {
    if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
      return jsonError("Hosted workspace snapshot upload session is stale.", 409);
    }
    try {
      await retireAmbiguousWorkspaceSnapshotUploadSession({
        env: input.env,
        session,
        snapshotRef,
        snapshotId: input.snapshotId,
        userId: input.userId,
      });
      return null;
    } catch {
      return jsonError("Hosted workspace snapshot cleanup state is unavailable.", 503);
    }
  };

  let preCheckpointReplacedSnapshotRef: HostedExecutionSnapshotRefValue | null = null;
  try {
    const preCheckpointWorkspace = await readCurrentHostedWorkspace({
      environment: input.environment,
      fetchImpl: fetch,
      userId: input.userId,
    });
    preCheckpointReplacedSnapshotRef = preCheckpointWorkspace?.snapshotRef ?? null;
  } catch {
    return jsonError("Hosted workspace snapshot current state is unavailable.", 502);
  }
  if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }
  if (
    preCheckpointReplacedSnapshotRef
    && !isReplacementRefSameAsSnapshotRef(preCheckpointReplacedSnapshotRef, snapshotRef)
    && !session.replacedSnapshotRef
  ) {
    try {
      const remembered = await rememberReplacedWorkspaceSnapshotCleanupInUploadSession({
        env: input.env,
        replacedSnapshotRef: preCheckpointReplacedSnapshotRef,
        session,
        userId: input.userId,
      });
      if (!remembered) {
        return jsonError("Hosted workspace snapshot upload session is stale.", 409);
      }
      if (!await requestOwnsWorkspaceSnapshotSession(input, session)) {
        return jsonError("Hosted workspace snapshot upload session is stale.", 409);
      }
      session.replacedSnapshotRef = preCheckpointReplacedSnapshotRef;
    } catch {
      return jsonError("Hosted workspace replaced snapshot cleanup state is unavailable.", 503);
    }
  }

  let checkpointResponse: Response;
  try {
    checkpointResponse = await fetchHostedExecutionWorkspaceSnapshotCheckpoint({
      checkpointRequest,
      environment: input.environment,
      fetchImpl: fetch,
      userId: input.userId,
    });
  } catch {
    const cleanupResponse = await retireAfterAmbiguousCheckpoint();
    if (cleanupResponse) {
      return cleanupResponse;
    }
    return jsonError("Hosted workspace snapshot checkpoint failed.", 502);
  }
  if (!checkpointResponse.ok) {
    const cleanupResponse = await retireAfterAmbiguousCheckpoint();
    if (cleanupResponse) {
      return cleanupResponse;
    }
    return jsonError("Hosted workspace snapshot checkpoint failed.", checkpointResponse.status);
  }
  let checkpoint: ReturnType<typeof parseHostedWorkspaceCheckpointResponse>;
  try {
    checkpoint = parseHostedWorkspaceCheckpointResponse(await checkpointResponse.json());
  } catch {
    const cleanupResponse = await retireAfterAmbiguousCheckpoint();
    if (cleanupResponse) {
      return cleanupResponse;
    }
    return jsonError("Hosted workspace snapshot checkpoint response is invalid.", 502);
  }
  if (checkpoint.workspace.userId !== input.userId) {
    const cleanupResponse = await retireAfterAmbiguousCheckpoint();
    if (cleanupResponse) {
      return cleanupResponse;
    }
    return jsonError("Hosted workspace snapshot checkpoint user mismatch.", 502);
  }
  if (!checkpoint.checkpointed) {
    const cleanupRetryResponse = await completeAlreadyCheckpointedWorkspaceSnapshotResponse({
      attemptId: writeFence.attemptId,
      checkpoint,
      env: input.env,
      leaseGeneration: writeFence.generation,
      session,
      snapshotRef,
      userId: input.userId,
    });
    if (cleanupRetryResponse) {
      return cleanupRetryResponse;
    }
    if (checkpoint.checkpointConflictReason !== "foreground_pending") {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          checkpointConflictReason: checkpoint.checkpointConflictReason ?? "unknown",
          checkpointWorkspaceVersion: checkpoint.workspace.version,
          expectedWorkspaceVersion: checkpointRequest.expectedWorkspaceVersion,
          method: "POST",
          operation: "workspace_snapshot_complete",
        },
        level: "warn",
        message: "Hosted workspace snapshot checkpoint CAS conflict.",
        phase: "wake.running",
      });
    }
    const cleanupResponse = await retireAfterAmbiguousCheckpoint();
    if (cleanupResponse) {
      return cleanupResponse;
    }
    if (checkpoint.checkpointConflictReason === "foreground_pending") {
      return json({
        checkpoint,
        ok: true,
        snapshotRef,
      });
    }
    return jsonError("Hosted workspace snapshot checkpoint CAS failed.", 409);
  }

  const checkpointSnapshotRef = checkpoint.workspace.snapshotRef;
  if (
    !isHostedWorkspaceSnapshotV2Ref(checkpointSnapshotRef)
    || !hostedWorkspaceSnapshotV2RefsMatch(checkpointSnapshotRef, snapshotRef)
  ) {
    const cleanupResponse = await retireAfterAmbiguousCheckpoint();
    if (cleanupResponse) {
      return cleanupResponse;
    }
    return jsonError("Hosted workspace snapshot checkpoint ref mismatch.", 502);
  }

  await completeWorkspaceSnapshotUploadSessionHandoffBestEffort({
    attemptId: writeFence.attemptId,
    env: input.env,
    leaseGeneration: writeFence.generation,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });

  return json({
    checkpoint,
    ok: true,
    snapshotRef,
  });
}

async function retireAmbiguousWorkspaceSnapshotUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  session: HostedWorkspaceSnapshotUploadSession;
  snapshotId: string;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  userId: string;
}): Promise<void> {
  await recordWorkspaceSnapshotObjectCleanup(input.env, {
    objectKey: input.snapshotRef.objectKey,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });

  const replacedSnapshotRef = input.session.replacedSnapshotRef ?? null;
  if (replacedSnapshotRef) {
    const replacedSnapshotRecorded = await recordReplacedWorkspaceSnapshotOrphanCandidate({
      env: input.env,
      replacedSnapshotRef,
      snapshotRef: input.snapshotRef,
    });
    if (!replacedSnapshotRecorded) {
      throw new Error("Hosted workspace replaced snapshot orphan recording is unavailable.");
    }
  }

  await deleteWorkspaceSnapshotUploadSession({
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
}

async function recordWorkspaceSnapshotObjectCleanup(
  env: RunnerOutboundEnvironmentSource,
  input: {
    objectKey: string;
    snapshotId: string;
    userId: string;
  },
): Promise<void> {
  const recorded = await recordWorkspaceSnapshotOrphanCandidate(env, {
    createdAt: new Date().toISOString(),
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (!recorded) {
    throw new Error("Hosted workspace snapshot orphan recording is unavailable.");
  }
}

function isReplacementRefSameAsSnapshotRef(
  replacedSnapshotRef: HostedExecutionSnapshotRefValue,
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
): boolean {
  return isHostedWorkspaceSnapshotV2Ref(replacedSnapshotRef)
    && hostedWorkspaceSnapshotV2RefsMatch(replacedSnapshotRef, snapshotRef);
}

async function deleteReplacedWorkspaceSnapshotRef(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  replacedSnapshotRef: HostedExecutionSnapshotRefValue;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}): Promise<boolean> {
  const replacedSnapshotRef = input.replacedSnapshotRef;
  if (isHostedWorkspaceSnapshotV2Ref(replacedSnapshotRef)) {
    if (
      hostedWorkspaceSnapshotV2RefsMatch(replacedSnapshotRef, input.snapshotRef)
      || !(await isHostedWorkspaceSnapshotV2RefOwnedByUser({
        snapshotRef: replacedSnapshotRef,
        userId: input.snapshotRef.userId,
      }))
    ) {
      return true;
    }
    const deleted = await deleteWorkspaceSnapshotObjectBestEffort({
      bucket: input.bucket,
      env: input.env,
      objectKey: replacedSnapshotRef.objectKey,
    });
    if (deleted) {
      return true;
    }
    const orphanRecorded = await recordWorkspaceSnapshotOrphanCandidate(input.env, {
      createdAt: new Date().toISOString(),
      objectKey: replacedSnapshotRef.objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: replacedSnapshotRef.snapshotId,
      userId: replacedSnapshotRef.userId,
    }).catch(() => false);
    return orphanRecorded;
  }

  const deleted = await deleteReplacedLegacyWorkspaceSnapshotBundles({
    env: input.env,
    environment: input.environment,
    replacedSnapshotRef,
    userId: input.snapshotRef.userId,
  }).then(
    () => true,
    () => false,
  );
  if (deleted) {
    return true;
  }
  const orphanRecorded = await recordWorkspaceSnapshotOrphanCandidate(input.env, {
    createdAt: new Date().toISOString(),
    kind: "legacy_workspace_snapshot",
    schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
    snapshotId: `legacy-${input.snapshotRef.snapshotId}`,
    snapshotRef: replacedSnapshotRef,
    userId: input.snapshotRef.userId,
  }).catch(() => false);
  return orphanRecorded;
}

async function recordReplacedWorkspaceSnapshotOrphanCandidate(input: {
  env: RunnerOutboundEnvironmentSource;
  replacedSnapshotRef: HostedExecutionSnapshotRefValue;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}): Promise<boolean> {
  const replacedSnapshotRef = input.replacedSnapshotRef;
  if (isHostedWorkspaceSnapshotV2Ref(replacedSnapshotRef)) {
    if (
      hostedWorkspaceSnapshotV2RefsMatch(replacedSnapshotRef, input.snapshotRef)
      || !(await isHostedWorkspaceSnapshotV2RefOwnedByUser({
        snapshotRef: replacedSnapshotRef,
        userId: input.snapshotRef.userId,
      }))
    ) {
      return true;
    }
    return await recordWorkspaceSnapshotOrphanCandidate(input.env, {
      createdAt: new Date().toISOString(),
      objectKey: replacedSnapshotRef.objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: replacedSnapshotRef.snapshotId,
      userId: replacedSnapshotRef.userId,
    });
  }

  return await recordWorkspaceSnapshotOrphanCandidate(input.env, {
    createdAt: new Date().toISOString(),
    kind: "legacy_workspace_snapshot",
    schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
    snapshotId: `legacy-${input.snapshotRef.snapshotId}`,
    snapshotRef: replacedSnapshotRef,
    userId: input.snapshotRef.userId,
  });
}

async function completeAlreadyCheckpointedWorkspaceSnapshotResponse(input: {
  attemptId: string;
  checkpoint: ReturnType<typeof parseHostedWorkspaceCheckpointResponse>;
  env: RunnerOutboundEnvironmentSource;
  leaseGeneration: string;
  session: HostedWorkspaceSnapshotUploadSession;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  userId: string;
}): Promise<Response | null> {
  const currentSnapshotRef = input.checkpoint.workspace.snapshotRef;
  if (
    !isHostedWorkspaceSnapshotV2Ref(currentSnapshotRef) ||
    !hostedWorkspaceSnapshotV2RefsMatch(currentSnapshotRef, input.snapshotRef)
  ) {
    return null;
  }
  const replacedSnapshotRef = input.session.replacedSnapshotRef ?? null;
  await completeWorkspaceSnapshotUploadSessionHandoffBestEffort({
    attemptId: input.attemptId,
    env: input.env,
    leaseGeneration: input.leaseGeneration,
    snapshotId: input.session.snapshotId,
    userId: input.userId,
  });

  return json({
    checkpoint: {
      checkpointed: true,
      ...(replacedSnapshotRef ? { replacedSnapshotRef } : {}),
      workspace: {
        ...input.checkpoint.workspace,
        snapshotRef: input.snapshotRef,
      },
    },
    ok: true,
    snapshotRef: input.snapshotRef,
  });
}

async function completeExpiredCurrentWorkspaceSnapshotUploadSession(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  session: HostedWorkspaceSnapshotUploadSession;
  userId: string;
}): Promise<Response | null> {
  let currentWorkspace: HostedWorkspaceState | null;
  try {
    currentWorkspace = await readCurrentHostedWorkspace({
      environment: input.environment,
      fetchImpl: fetch,
      userId: input.userId,
    });
  } catch {
    return jsonError("Hosted workspace snapshot current state is unavailable.", 502);
  }

  const currentSnapshotRef = currentWorkspace?.snapshotRef ?? null;
  if (
    !currentWorkspace
    || !isHostedWorkspaceSnapshotV2Ref(currentSnapshotRef)
    || currentSnapshotRef.snapshotId !== input.session.snapshotId
    || currentSnapshotRef.objectKey !== input.session.objectKey
    || !(await isHostedWorkspaceSnapshotV2RefOwnedByUser({
      snapshotRef: currentSnapshotRef,
      userId: input.userId,
    }))
  ) {
    return null;
  }

  if (
    !/^[0-9]+$/u.test(currentWorkspace.version)
    || !/^[0-9]+$/u.test(input.session.workspaceVersion)
    || BigInt(currentWorkspace.version) <= BigInt(input.session.workspaceVersion)
  ) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  if (!await requestOwnsWorkspaceSnapshotSession(input, input.session)) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  const replacedSnapshotRef = input.session.replacedSnapshotRef ?? null;
  if (replacedSnapshotRef) {
    const replacedSnapshotCleanupSucceeded = await deleteReplacedWorkspaceSnapshotRef({
      bucket: input.bucket,
      env: input.env,
      environment: input.environment,
      replacedSnapshotRef,
      snapshotRef: currentSnapshotRef,
    });
    if (!replacedSnapshotCleanupSucceeded) {
      return jsonError("Hosted workspace replaced snapshot cleanup failed.", 503);
    }
  }

  if (!await requestOwnsWorkspaceSnapshotSession(input, input.session)) {
    return jsonError("Hosted workspace snapshot upload session is stale.", 409);
  }

  await retireWorkspaceSnapshotUploadSession({
    bucket: input.bucket,
    deleteObject: false,
    env: input.env,
    objectKey: currentSnapshotRef.objectKey,
    snapshotId: currentSnapshotRef.snapshotId,
    userId: input.userId,
  }).catch(() => undefined);

  return json({
    checkpoint: {
      checkpointed: true,
      ...(replacedSnapshotRef ? { replacedSnapshotRef } : {}),
      workspace: currentWorkspace,
    },
    ok: true,
    snapshotRef: currentSnapshotRef,
  });
}

async function rememberReplacedWorkspaceSnapshotCleanupInUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  replacedSnapshotRef: HostedExecutionSnapshotRefValue;
  session: HostedWorkspaceSnapshotUploadSession;
  userId: string;
}): Promise<boolean> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "rememberHostedWorkspaceSnapshotReplacedRef",
  );
  return await stub.rememberHostedWorkspaceSnapshotReplacedRef({
    expectedSession: input.session,
    replacedSnapshotRef: input.replacedSnapshotRef,
  });
}

async function rememberWorkspaceSnapshotPresignedPut(input: {
  drainUntil: string;
  env: RunnerOutboundEnvironmentSource;
  expiresAt: string;
  session: HostedWorkspaceSnapshotUploadSession;
  userId: string;
}): Promise<HostedWorkspaceSnapshotUploadSession | null> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "rememberHostedWorkspaceSnapshotPresignedPut",
  );
  return await stub.rememberHostedWorkspaceSnapshotPresignedPut({
    drainUntil: input.drainUntil,
    expectedSession: input.session,
    expiresAt: input.expiresAt,
  });
}

async function deleteReplacedLegacyWorkspaceSnapshotBundles(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  replacedSnapshotRef: HostedExecutionSnapshotRefValue;
  userId: string;
}): Promise<void> {
  const bundleRefs = collectLegacyWorkspaceSnapshotBundleRefs(input.replacedSnapshotRef);
  if (bundleRefs.length === 0) {
    return;
  }
  const cryptoContext = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.env.BUNDLES,
    domain: "runtime",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const garbageCollector = new HostedBundleGarbageCollector(
    input.env.BUNDLES,
    cryptoContext.rootKey,
    cryptoContext.rootKeyId,
    cryptoContext.keysById,
  );

  await Promise.all(bundleRefs.map(async (previousBundleRef) => {
    await garbageCollector.cleanupBundleTransition({
      nextBundleRef: null,
      previousBundleRef,
      userId: input.userId,
    });
  }));
}

async function recordWorkspaceSnapshotOrphanCandidate(
  env: RunnerOutboundEnvironmentSource,
  candidate: HostedWorkspaceSnapshotOrphanCandidate,
): Promise<boolean> {
  const stub = await resolveRunnerOutboundUserRunnerStub(env, candidate.userId);
  if (typeof stub.recordHostedWorkspaceSnapshotOrphanCandidate !== "function") {
    return false;
  }
  await stub.recordHostedWorkspaceSnapshotOrphanCandidate(candidate);
  return true;
}

async function recordBrowserVaultReplicaOrphanCandidate(
  env: RunnerOutboundEnvironmentSource,
  candidate: HostedBrowserVaultReplicaOrphanCandidate,
): Promise<void> {
  const stub = await resolveRunnerOutboundUserRunnerStub(env, candidate.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "recordHostedBrowserVaultReplicaOrphanCandidate",
  );
  await stub.recordHostedBrowserVaultReplicaOrphanCandidate(candidate);
}

function collectLegacyWorkspaceSnapshotBundleRefs(
  snapshotRef: HostedExecutionSnapshotRef,
): HostedExecutionBundleRef[] {
  const refs: HostedExecutionBundleRef[] = [];
  const candidates = [
    readHostedExecutionSnapshotBaseRef(snapshotRef),
    readHostedExecutionSnapshotHotRef(snapshotRef),
    readHostedExecutionSnapshotDeltaRef(snapshotRef),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (refs.some((existing) => existing.key === candidate.key)) {
      continue;
    }
    refs.push(candidate);
  }
  return refs;
}

async function isHostedWorkspaceSnapshotV2RefOwnedByUser(input: {
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  userId: string;
}): Promise<boolean> {
  const aad = input.snapshotRef.encryption.aad;
  if (
    input.snapshotRef.userId !== input.userId
    || aad.userId !== input.userId
    || aad.snapshotId !== input.snapshotRef.snapshotId
    || aad.objectKey !== input.snapshotRef.objectKey
  ) {
    return false;
  }
  const expectedObjectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId: input.snapshotRef.snapshotId,
    userId: input.userId,
  });
  return input.snapshotRef.objectKey === expectedObjectKey;
}

function hostedWorkspaceSnapshotV2RefsMatch(
  left: HostedWorkspaceSnapshotV2Ref,
  right: HostedWorkspaceSnapshotV2Ref,
): boolean {
  return left.schema === right.schema
    && left.upload === right.upload
    && left.userId === right.userId
    && left.snapshotId === right.snapshotId
    && left.objectKey === right.objectKey
    && left.createdAt === right.createdAt
    && left.archive.format === right.archive.format
    && left.archive.compression === right.archive.compression
    && left.archive.fileCount === right.archive.fileCount
    && left.archive.totalPlainBytes === right.archive.totalPlainBytes
    && left.archive.plaintextArchiveSha256 === right.archive.plaintextArchiveSha256
    && left.archive.encryptedObjectSha256 === right.archive.encryptedObjectSha256
    && left.archive.encryptedByteSize === right.archive.encryptedByteSize
    && left.encryption.scheme === right.encryption.scheme
    && left.encryption.rootKeyId === right.encryption.rootKeyId
    && left.encryption.wrappedDataKey === right.encryption.wrappedDataKey
    && left.encryption.ivBase64 === right.encryption.ivBase64
    && left.encryption.aad.purpose === right.encryption.aad.purpose
    && left.encryption.aad.schema === right.encryption.aad.schema
    && left.encryption.aad.userId === right.encryption.aad.userId
    && left.encryption.aad.snapshotId === right.encryption.aad.snapshotId
    && left.encryption.aad.objectKey === right.encryption.aad.objectKey;
}

async function retireWorkspaceSnapshotUploadSession(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  deleteObject: boolean;
  env: RunnerOutboundEnvironmentSource;
  objectKey?: string;
  snapshotId: string;
  userId: string;
}): Promise<void> {
  if (input.deleteObject && input.objectKey) {
    const deleted = await deleteWorkspaceSnapshotObjectBestEffort({
      bucket: input.bucket,
      env: input.env,
      objectKey: input.objectKey,
    });
    if (!deleted) {
      const retained = await recordWorkspaceSnapshotOrphanCandidate(input.env, {
        createdAt: new Date().toISOString(),
        objectKey: input.objectKey,
        schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
        snapshotId: input.snapshotId,
        userId: input.userId,
      }).catch(() => false);
      if (!retained) {
        throw new Error("Hosted workspace snapshot object cleanup could not be retained.");
      }
    }
  }
  await deleteWorkspaceSnapshotUploadSession({
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
}

async function deleteWorkspaceSnapshotObjectBestEffort(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  env: RunnerOutboundEnvironmentSource;
  objectKey: string;
}): Promise<boolean> {
  const snapshotObjectStore = createWorkspaceSnapshotObjectStore({
    bucket: input.bucket,
    env: input.env,
  });
  if (!snapshotObjectStore.delete) {
    return false;
  }
  try {
    await snapshotObjectStore.delete(input.objectKey);
    return true;
  } catch {
    return false;
  }
}

function createWorkspaceSnapshotObjectStore(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  env: RunnerOutboundEnvironmentSource;
}): {
  configurationError?: string;
  delete?: (key: string) => Promise<void>;
  head?: (key: string) => Promise<WorkspaceSnapshotR2ObjectLike | null>;
} {
  const localS3Environment = readWorkspaceSnapshotLocalS3Environment(input.env);
  if (localS3Environment === "missing-control-endpoint") {
    return {
      configurationError:
        "Hosted workspace snapshot local S3 control endpoint is required when local R2 presign endpoint mode is enabled.",
    };
  }
  if (localS3Environment) {
    return {
      delete: async (key: string): Promise<void> => {
        await deleteWorkspaceSnapshotLocalS3Object({
          environment: localS3Environment,
          key,
        });
      },
      head: async (key: string): Promise<WorkspaceSnapshotR2ObjectLike | null> => {
        return await headWorkspaceSnapshotLocalS3Object({
          environment: localS3Environment,
          key,
        });
      },
    };
  }

  return {
    ...(input.bucket?.delete ? { delete: input.bucket.delete.bind(input.bucket) } : {}),
    ...(input.bucket?.head ? { head: input.bucket.head.bind(input.bucket) } : {}),
  };
}

function readWorkspaceSnapshotLocalS3Environment(
  env: RunnerOutboundEnvironmentSource,
): HostedR2PresignEnvironment | "missing-control-endpoint" | null {
  const stringEnv = asWorkerStringEnvironment(env);
  if (stringEnv.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT?.trim() !== "1") {
    return null;
  }
  const environment = readHostedR2PresignEnvironment(stringEnv);
  if (!environment.controlEndpoint) {
    return "missing-control-endpoint";
  }
  return {
    ...environment,
    endpoint: environment.controlEndpoint,
  };
}

async function headWorkspaceSnapshotLocalS3Object(input: {
  environment: HostedR2PresignEnvironment;
  key: string;
}): Promise<WorkspaceSnapshotR2ObjectLike | null> {
  const presigned = await createHostedR2PresignedHeadUrl({
    checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
    environment: input.environment,
    expiresSeconds: 60,
    key: input.key,
  });
  const response = await fetch(presigned.url, {
    headers: {
      [HOSTED_R2_CHECKSUM_MODE_HEADER]: HOSTED_R2_CHECKSUM_MODE_ENABLED,
    },
    method: "HEAD",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Hosted workspace snapshot local S3 HEAD failed with HTTP ${response.status}.`);
  }

  const customMetadata = readWorkspaceSnapshotLocalS3CustomMetadata(response.headers);
  return {
    checksums: {
      sha256: response.headers.get("x-amz-checksum-sha256") ?? undefined,
    },
    customMetadata,
    key: input.key,
    size: readWorkspaceSnapshotLocalS3ContentLength(response.headers),
  };
}

async function deleteWorkspaceSnapshotLocalS3Object(input: {
  environment: HostedR2PresignEnvironment;
  key: string;
}): Promise<void> {
  const presigned = await createHostedR2PresignedDeleteUrl({
    environment: input.environment,
    expiresSeconds: 60,
    key: input.key,
  });
  const response = await fetch(presigned.url, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Hosted workspace snapshot local S3 DELETE failed with HTTP ${response.status}.`);
  }
}

function readWorkspaceSnapshotLocalS3ContentLength(headers: Headers): number | undefined {
  const contentLength = headers.get("content-length");
  if (!contentLength) {
    return undefined;
  }
  const normalized = contentLength.trim();
  if (!/^(0|[1-9][0-9]*)$/u.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readWorkspaceSnapshotLocalS3CustomMetadata(headers: Headers): Record<string, string> {
  const metadata: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.startsWith("x-amz-meta-")) {
      metadata[normalizedKey.slice("x-amz-meta-".length)] = value;
    }
  });
  return metadata;
}

function readWorkspaceSnapshotCompleteCheckpointRequest(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot complete checkpointRequest must be an object.");
  }
  return value as Record<string, unknown>;
}

function readWorkspaceSnapshotObjectMetadata(
  metadata: Record<string, string> | undefined,
  key: string,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const normalizedKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(metadata)) {
    if (candidateKey.toLowerCase() === normalizedKey) {
      return value;
    }
  }
  return undefined;
}

async function fetchHostedExecutionWorkspaceSnapshotCheckpoint(input: {
  checkpointRequest: ReturnType<typeof parseHostedWorkspaceCheckpointRequest>;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  fetchImpl: typeof fetch;
  userId: string;
}): Promise<Response> {
  const body = JSON.stringify(input.checkpointRequest);
  const headers = new Headers();
  writeRunnerRuntimeWriteFenceHeaders(headers, {
    attemptId: input.checkpointRequest.attemptId,
    leaseGeneration: input.checkpointRequest.leaseGeneration,
    workspaceVersion: input.checkpointRequest.expectedWorkspaceVersion,
  });
  return await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
      : {}),
    baseUrl: input.environment.hostedWebBaseUrl,
    body,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    fetchImpl: input.fetchImpl,
    headers,
    method: "POST",
    path: HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
    timeoutMs: input.environment.webControlTimeoutMs,
  });
}

async function readCurrentHostedWorkspace(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  fetchImpl: typeof fetch;
  userId: string;
}): Promise<HostedWorkspaceState | null> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
      : {}),
    baseUrl: input.environment.hostedWebBaseUrl,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    fetchImpl: input.fetchImpl,
    method: "GET",
    path: HOSTED_RUNTIME_WORKSPACE_PATH,
    timeoutMs: input.environment.webControlTimeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Hosted workspace read failed with HTTP ${response.status}.`);
  }
  const workspaceRead = parseHostedWorkspaceReadResponse(await response.json());
  if (workspaceRead.workspace && workspaceRead.workspace.userId !== input.userId) {
    throw new Error("Hosted workspace read user mismatch.");
  }
  return workspaceRead.workspace ?? null;
}

function readWorkspaceSnapshotAad(value: unknown, label: string): HostedWorkspaceSnapshotV2Aad {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const purpose = requireSnapshotDataKeyString(record.purpose, `${label}.purpose`);
  const schema = requireSnapshotDataKeyString(record.schema, `${label}.schema`);
  if (purpose !== HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE) {
    throw new TypeError(`${label}.purpose must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE}.`);
  }
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA}.`);
  }

  return {
    objectKey: requireSnapshotDataKeyString(record.objectKey, `${label}.objectKey`),
    purpose,
    schema,
    snapshotId: requireSnapshotDataKeyString(record.snapshotId, `${label}.snapshotId`),
    userId: requireSnapshotDataKeyString(record.userId, `${label}.userId`),
  };
}

function requireSnapshotDataKeyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Hosted workspace snapshot ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireSnapshotPositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Hosted workspace snapshot ${label} must be a positive safe integer.`);
  }
  return value;
}

function requireSnapshotSha256Hex(value: unknown, label: string): string {
  const text = requireSnapshotDataKeyString(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw new TypeError(`Hosted workspace snapshot ${label} must be a lowercase sha256 hex digest.`);
  }
  return text;
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
  const replacedReplicaRef = parseHostedBrowserVaultReplicaRef(
    body.replacedReplicaRef,
    "Hosted browser-vault replica write request.replacedReplicaRef",
  );

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
  if (replacedReplicaRef) {
    await recordBrowserVaultReplicaOrphanCandidate(input.env, {
      createdAt: new Date().toISOString(),
      objectKey: replacedReplicaRef.objectKey,
      schema: HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
      userId: input.userId,
    });
  }
  const replicaRef = await replicaStore.writeBrowserVaultReplica({
    beforeWrite: async (plannedReplicaRef) => {
      await recordBrowserVaultReplicaOrphanCandidate(input.env, {
        createdAt: new Date().toISOString(),
        objectKey: plannedReplicaRef.objectKey,
        schema: HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
        userId: input.userId,
      });
    },
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

async function requireWorkspaceSnapshotWriteFence(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}) {
  try {
    return await requireRunnerRuntimeWriteFenceWorkspaceWrite(input);
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return null;
    }
    throw error;
  }
}

async function requestOwnsWorkspaceSnapshotSession(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}, session: HostedWorkspaceSnapshotUploadSession): Promise<boolean> {
  const writeFence = await requireWorkspaceSnapshotWriteFence({
    env: input.env,
    request: input.request,
    userId: input.userId,
  });
  return writeFence !== null
    && session.attemptId === writeFence.attemptId
    && session.leaseGeneration === writeFence.generation
    && session.workspaceVersion === writeFence.workspaceVersion;
}

async function createWorkspaceSnapshotUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  session: HostedWorkspaceSnapshotUploadSession;
  userId: string;
}): Promise<HostedWorkspaceSnapshotUploadSession | null> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "createHostedWorkspaceSnapshotUploadSession",
  );
  return await stub.createHostedWorkspaceSnapshotUploadSession(input.session);
}

async function heartbeatWorkspaceSnapshotUploadSession(input: {
  attemptId: string;
  env: RunnerOutboundEnvironmentSource;
  leaseGeneration: string;
  snapshotId: string;
  userId: string;
}): Promise<boolean> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "heartbeatHostedWorkspaceSnapshotUploadSession",
  );
  return await stub.heartbeatHostedWorkspaceSnapshotUploadSession({
    attemptId: input.attemptId,
    leaseGeneration: input.leaseGeneration,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
}

async function completeWorkspaceSnapshotUploadSessionHandoff(input: {
  attemptId: string;
  env: RunnerOutboundEnvironmentSource;
  leaseGeneration: string;
  snapshotId: string;
  userId: string;
}): Promise<boolean> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "completeHostedWorkspaceSnapshotUploadSession",
  );
  return await stub.completeHostedWorkspaceSnapshotUploadSession({
    attemptId: input.attemptId,
    leaseGeneration: input.leaseGeneration,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
}

async function completeWorkspaceSnapshotUploadSessionHandoffBestEffort(input: {
  attemptId: string;
  env: RunnerOutboundEnvironmentSource;
  leaseGeneration: string;
  snapshotId: string;
  userId: string;
}): Promise<void> {
  try {
    if (await completeWorkspaceSnapshotUploadSessionHandoff(input)) {
      return;
    }
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: { checkpointHandoffCompletionRecorded: false },
      level: "warn",
      message: "Hosted workspace snapshot handoff completion marker was stale.",
      phase: "checkpoint",
      userId: input.userId,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: { checkpointHandoffCompletionRecorded: false },
      error,
      level: "warn",
      message: "Hosted workspace snapshot handoff completion marker failed.",
      phase: "checkpoint",
      userId: input.userId,
    });
  }
}

async function readWorkspaceSnapshotUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  snapshotId: string;
  userId: string;
}): Promise<HostedWorkspaceSnapshotUploadSession | null> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "readHostedWorkspaceSnapshotUploadSession",
  );
  return await stub.readHostedWorkspaceSnapshotUploadSession({
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
}

async function deleteWorkspaceSnapshotUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  snapshotId: string;
  userId: string;
}): Promise<void> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(
    stub,
    "deleteHostedWorkspaceSnapshotUploadSession",
  );
  await stub.deleteHostedWorkspaceSnapshotUploadSession({
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
}

function createHostedWorkspaceSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `snapshot_${crypto.randomUUID()}`;
  }
  return `snapshot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function createHostedWorkspaceSnapshotIvBase64(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(12)));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
