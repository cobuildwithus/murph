import { createHostedArtifactStore } from "./bundle-store.ts";
import type {
  HostedWorkspaceSnapshotUploadSession,
  WorkspaceSnapshotR2BucketLike,
} from "./workspace-snapshot-store.ts";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  createHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId,
  unwrapHostedWorkspaceSnapshotV2DataKey,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Aad,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";
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
import { json, jsonError, methodNotAllowed, notFound, readJsonObject, unauthorized } from "./json.ts";
import {
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
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  buildHostedWorkspaceSnapshotRefFromUploadSession,
} from "./workspace-snapshot-store.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "./storage-paths.ts";
import {
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
} from "./r2-presigned-url.ts";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";

export type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

const HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_EXPIRES_MS = 60 * 60 * 1000;

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

      const match = /^\/workspace-snapshots\/(?<snapshotId>[A-Za-z0-9][A-Za-z0-9._-]{0,127})(?<suffix>\/complete|\/data-key\/unwrap|\/presign-put)?$/u.exec(
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

      if (match.groups.suffix || request.method !== "GET") {
        return methodNotAllowed();
      }

      return handleRunnerWorkspaceSnapshotReadRequest({
        bucket: env.BUNDLES,
        env,
        request,
        snapshotId: match.groups.snapshotId,
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

  if (input.request.method === "PUT") {
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
  await createWorkspaceSnapshotUploadSession({
    env: input.env,
    session,
    userId: input.userId,
  });

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
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: null,
      deleteObject: false,
      env: input.env,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot upload session expired.", 410);
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
    contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(input.env)),
    key: requestedObjectKey,
    metadata: {
      encryptedsha256: encryptedObjectSha256,
      schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
      snapshotid: input.snapshotId,
    },
  });

  return json({
    expiresAt: presigned.expiresAt,
    putUrl: presigned.url,
  });
}

async function handleRunnerWorkspaceSnapshotReadRequest(input: {
  bucket: WorkspaceSnapshotR2BucketLike;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  snapshotId: string;
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
  if (!input.bucket.get) {
    return notFound();
  }

  const objectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  const object = await input.bucket.get(objectKey);
  if (!object) {
    return notFound();
  }
  if (object.body) {
    const headers = new Headers({
      "content-type": "application/octet-stream",
    });
    const objectSize = object.size;
    if (typeof objectSize === "number" && Number.isSafeInteger(objectSize) && objectSize >= 0) {
      headers.set("content-length", String(objectSize));
    }
    return new Response(object.body, {
      headers,
    });
  }

  return jsonError("Hosted workspace snapshot object stream is unavailable.", 503);
}

async function handleRunnerWorkspaceSnapshotDataKeyRequest(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  snapshotId: string;
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
    limitBytes: 16 * 1024,
  });
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

  const aad = readWorkspaceSnapshotAad(body.aad, "aad");
  if (
    aad.objectKey !== expectedObjectKey
    || aad.snapshotId !== input.snapshotId
    || aad.userId !== input.userId
  ) {
    return jsonError("Hosted workspace snapshot AAD is outside the bound user namespace.", 403);
  }
  const wrappedDataKey = requireSnapshotDataKeyString(body.wrappedDataKey, "wrappedDataKey");
  const rootKeyId = requireSnapshotDataKeyString(body.rootKeyId, "rootKeyId");
  if (readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId(wrappedDataKey) !== rootKeyId) {
    return jsonError("Hosted workspace snapshot wrapped data key rootKeyId mismatch.", 400);
  }
  const rootKey = rootKeyId === cryptoContext.rootKeyId
    ? cryptoContext.rootKey
    : await cryptoContext.resolveKeyById(rootKeyId);
  if (!rootKey) {
    return notFound();
  }
  const dataKey = await unwrapHostedWorkspaceSnapshotV2DataKey({
    aad,
    rootKey,
    wrappedDataKey,
  });

  return json({
    dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
  });
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
    Date.parse(session.expiresAt) > Date.now()
    && (
      session.attemptId !== writeFence.attemptId
      || session.leaseGeneration !== writeFence.generation
      || session.workspaceVersion !== writeFence.workspaceVersion
    )
  ) {
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
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: session.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot upload session expired.", 410);
  }
  if (
    session.attemptId !== writeFence.attemptId
    || session.leaseGeneration !== writeFence.generation
    || session.workspaceVersion !== writeFence.workspaceVersion
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: session.objectKey,
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
      bucket: input.bucket,
      deleteObject: true,
      env: input.env,
      objectKey: session.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot ref is outside the bound user namespace.", 403);
  }
  const snapshotRef = parseHostedWorkspaceSnapshotV2Ref(
    buildHostedWorkspaceSnapshotRefFromUploadSession({
      archive: body.archive,
      createdAt: new Date().toISOString(),
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
  if (!input.bucket.head) {
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
  const object = await input.bucket.head(snapshotRef.objectKey);
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
  if (
    readWorkspaceSnapshotObjectMetadata(object.customMetadata, "encryptedsha256")
      !== snapshotRef.archive.encryptedObjectSha256
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
    return jsonError("Hosted workspace snapshot checkpoint reason must be idle_shutdown.", 400);
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
  const checkpointResponse = await fetchHostedExecutionWorkspaceSnapshotCheckpoint({
    checkpointRequest,
    environment: input.environment,
    fetchImpl: fetch,
    userId: input.userId,
  });
  if (!checkpointResponse.ok) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: false,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot checkpoint failed.", checkpointResponse.status);
  }
  const checkpoint = parseHostedWorkspaceCheckpointResponse(await checkpointResponse.json());
  if (checkpoint.workspace.userId !== input.userId) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: false,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot checkpoint user mismatch.", 502);
  }
  if (!checkpoint.checkpointed) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: false,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot checkpoint CAS failed.", 409);
  }

  const checkpointSnapshotRef = checkpoint.workspace.snapshotRef;
  if (
    !isHostedWorkspaceSnapshotV2Ref(checkpointSnapshotRef)
    || checkpointSnapshotRef.snapshotId !== snapshotRef.snapshotId
    || checkpointSnapshotRef.objectKey !== snapshotRef.objectKey
    || checkpointSnapshotRef.archive.encryptedByteSize !== snapshotRef.archive.encryptedByteSize
    || checkpointSnapshotRef.archive.encryptedObjectSha256 !== snapshotRef.archive.encryptedObjectSha256
  ) {
    await retireWorkspaceSnapshotUploadSession({
      bucket: input.bucket,
      deleteObject: false,
      env: input.env,
      objectKey: snapshotRef.objectKey,
      snapshotId: input.snapshotId,
      userId: input.userId,
    });
    return jsonError("Hosted workspace snapshot checkpoint ref mismatch.", 502);
  }

  await retireWorkspaceSnapshotUploadSession({
    bucket: input.bucket,
    deleteObject: false,
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });

  return json({
    checkpoint,
    ok: true,
    snapshotRef,
  });
}

async function retireWorkspaceSnapshotUploadSession(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  deleteObject: boolean;
  env: RunnerOutboundEnvironmentSource;
  objectKey?: string;
  snapshotId: string;
  userId: string;
}): Promise<void> {
  await deleteWorkspaceSnapshotUploadSession({
    env: input.env,
    snapshotId: input.snapshotId,
    userId: input.userId,
  });
  if (input.deleteObject && input.objectKey) {
    await deleteWorkspaceSnapshotObjectBestEffort({
      bucket: input.bucket,
      objectKey: input.objectKey,
    });
  }
}

async function deleteWorkspaceSnapshotObjectBestEffort(input: {
  bucket: WorkspaceSnapshotR2BucketLike | null;
  objectKey: string;
}): Promise<void> {
  if (!input.bucket?.delete) {
    return;
  }
  try {
    await input.bucket.delete(input.objectKey);
  } catch {
    // The critical durability outcome is the checkpoint CAS. Failed object
    // cleanup is retried by later owner cleanup instead of changing the
    // complete-route result.
  }
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

async function requireWorkspaceSnapshotWriteFence(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}) {
  try {
    return await requireRunnerRuntimeWriteFenceWorkspaceWrite({
      ...input,
      validateWorkspaceVersion: true,
    });
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return null;
    }
    throw error;
  }
}

async function createWorkspaceSnapshotUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  session: HostedWorkspaceSnapshotUploadSession;
  userId: string;
}): Promise<HostedWorkspaceSnapshotUploadSession> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const createSession = requireRunnerOutboundUserStubMethod(
    stub,
    "createHostedWorkspaceSnapshotUploadSession",
  );
  return await createSession(input.session);
}

async function readWorkspaceSnapshotUploadSession(input: {
  env: RunnerOutboundEnvironmentSource;
  snapshotId: string;
  userId: string;
}): Promise<HostedWorkspaceSnapshotUploadSession | null> {
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const readSession = requireRunnerOutboundUserStubMethod(
    stub,
    "readHostedWorkspaceSnapshotUploadSession",
  );
  return await readSession({
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
  const deleteSession = requireRunnerOutboundUserStubMethod(
    stub,
    "deleteHostedWorkspaceSnapshotUploadSession",
  );
  await deleteSession({
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
