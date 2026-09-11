import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createHostedWebTestkitDeps } from "#hosted-web-testing";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  createHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import { collectHostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";

import { readHostedExecutionEnvironment } from "../../src/env.ts";
import { requireHostedUserCryptoContextFromEnvironment } from "../../src/hosted-crypto/runtime-user-crypto-context.ts";
import {
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
} from "../../src/r2-presigned-url.ts";
import { hostedWorkspaceSnapshotObjectKey } from "../../src/storage-paths.ts";
import { createEncryptedWorkspaceSnapshotFile } from "../../src/workspace-snapshot-local.ts";
import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

/** Seed bytes before the caller publishes its Web checkpoint, without starting a runtime lease. */
export async function uploadHostedLocalWorkspaceSnapshot(input: {
  environment: NodeJS.ProcessEnv;
  harness: Pick<HostedLocalDevHarness, "request" | "workerRuntimeEnv">;
  operatorHomeRoot: string;
  userId: string;
  vaultRoot: string;
}): Promise<HostedWorkspaceSnapshotV2Ref> {
  const source = input.harness.workerRuntimeEnv;
  if (!source) {
    throw new Error("Snapshot fixture requires the scenario's hosted-local Worker environment.");
  }
  const r2Environment = readHostedR2PresignEnvironment(source);
  if (!r2Environment.localEndpointAllowed || !r2Environment.controlEndpoint) {
    throw new Error("Snapshot fixture requires the hosted-local MinIO control endpoint.");
  }
  const environment = readHostedExecutionEnvironment(source);
  assertLoopbackUrl(environment.hostedWebBaseUrl);
  assertLoopbackUrl(r2Environment.controlEndpoint);
  // The runtime crypto route requires a workspace, but the checkpoint must
  // remain unpublished until its encrypted bytes and locator exist.
  const deps = await createHostedWebTestkitDeps(input.environment);
  try {
    await deps.hostedWorkspaceStore.ensureHostedWorkspace({
      prisma: deps.prisma,
      userId: input.userId,
    });
  } finally {
    await deps.prisma.$disconnect();
  }
  const cryptoContext = await requireHostedUserCryptoContextFromEnvironment({
    domain: "runtime",
    environment,
    reason: "hosted-local-snapshot-fixture",
    userId: input.userId,
  });
  const dataKey = createHostedWorkspaceSnapshotV2DataKey();
  const outputDir = await mkdtemp(path.join(tmpdir(), "hosted-local-snapshot-fixture-"));
  try {
    const snapshotId = `snapshot-${randomUUID()}`;
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: input.userId,
    });
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId: input.userId,
    });
    const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
      aad,
      dataKey,
      rootKey: cryptoContext.rootKey,
      rootKeyId: cryptoContext.rootKeyId,
    });
    const durableRoot = path.dirname(path.resolve(input.vaultRoot));
    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot,
      operatorHomeRoot: input.operatorHomeRoot,
      vaultRoot: input.vaultRoot,
    });
    const encrypted = await createEncryptedWorkspaceSnapshotFile({
      aad,
      archiveEntries: archivePlan.entries,
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot,
      ivBase64: randomBytes(12).toString("base64"),
      maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      outputDir,
    });
    const ref: HostedWorkspaceSnapshotV2Ref = {
      archive: {
        compression: encrypted.compression,
        encryptedByteSize: encrypted.encryptedByteSize,
        encryptedObjectSha256: encrypted.encryptedObjectSha256,
        fileCount: encrypted.fileCount,
        format: "tar",
        plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
        totalPlainBytes: encrypted.totalPlainBytes,
      },
      createdAt: new Date().toISOString(),
      encryption: {
        aad,
        ivBase64: encrypted.ivBase64,
        rootKeyId: cryptoContext.rootKeyId,
        scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
        wrappedDataKey,
      },
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
      userId: input.userId,
    };
    const metadata = {
      encryptedsha256: encrypted.encryptedObjectSha256,
      schema: ref.schema,
      snapshotid: snapshotId,
    };
    const checksum = Buffer.from(encrypted.encryptedObjectSha256, "hex").toString("base64");
    const put = await createHostedR2PresignedPutUrl({
      checksumSha256Base64: checksum,
      contentType: "application/octet-stream",
      environment: { ...r2Environment, endpoint: r2Environment.controlEndpoint },
      expiresSeconds: 300,
      key: objectKey,
      metadata,
    });
    const upload = await fetch(put.url, {
      body: new Blob([new Uint8Array(await readFile(encrypted.encryptedFilePath))]),
      headers: {
        "content-type": "application/octet-stream",
        "if-none-match": "*",
        "x-amz-checksum-sha256": checksum,
        ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value])),
      },
      method: "PUT",
      signal: AbortSignal.timeout(30_000),
    });
    if (!upload.ok) {
      throw new Error(`Snapshot fixture upload failed with HTTP ${upload.status}.`);
    }
    // MinIO holds the encrypted bytes. Wrangler's local R2 binding needs the
    // existing locator marker for the same committed-ref existence check.
    const locator = await input.harness.request(
      `/__test/users/${encodeURIComponent(input.userId)}/direct-r2-locator-marker`,
      {
        body: JSON.stringify({ objectKey, snapshotId }),
        headers: {
          "content-type": "application/json",
          [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
        },
        method: "POST",
      },
    );
    if (!locator.ok) {
      throw new Error(`Snapshot fixture locator failed with HTTP ${locator.status}.`);
    }
    return ref;
  } finally {
    dataKey.fill(0);
    cryptoContext.rootKey.fill(0);
    await rm(outputDir, { force: true, recursive: true });
  }
}

function assertLoopbackUrl(value: string): void {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username
    || url.password
  ) {
    throw new Error("Snapshot fixture requires loopback Web and object-store endpoints.");
  }
}

