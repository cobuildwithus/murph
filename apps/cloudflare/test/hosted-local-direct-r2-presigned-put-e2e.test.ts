import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  HOSTED_R2_CHECKSUM_MODE_ENABLED,
  HOSTED_R2_CHECKSUM_MODE_HEADER,
  createHostedR2PresignedDeleteUrl,
  createHostedR2PresignedHeadUrl,
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
  type HostedR2PresignEnvironment,
} from "../src/r2-presigned-url.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const directR2PresignedPutDefaultBytes = 150 * 1024 * 1024;
const directR2PresignedPutTimeoutMs = 420_000;
const directR2ContentType = "application/octet-stream";
const directR2SignedHeaders =
  "content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-meta-encryptedsha256;x-amz-meta-schema;x-amz-meta-snapshotid";
const userId = `member_direct_r2_${randomUUID()}`;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local direct R2 presigned PUT e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_DEV_SKIP_RUNNER_SMOKE: "1",
        MURPH_DEV_SKIP_WEB: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-direct-r2-presigned-put-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted direct R2 presigned PUT e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it("direct_r2_presigned_put_uses_hosted_local_minio", async () => {
    const activeScenario = requireScenario();
    const environment = readHostedLocalR2ControlEnvironment(activeScenario);
    const payload = createDeterministicPayload(readDirectR2PresignedPutByteLength());
    const snapshotId = `snapshot-${randomUUID()}`;
    const objectKey = `direct-r2-presigned-put/${userId}/${randomUUID()}.bin`;
    const negativeMissingMetadataObjectKey =
      `direct-r2-presigned-put/${userId}/${randomUUID()}-missing-metadata.bin`;
    const negativeChangedMetadataObjectKey =
      `direct-r2-presigned-put/${userId}/${randomUUID()}-changed-metadata.bin`;
    const negativeMissingChecksumObjectKey =
      `direct-r2-presigned-put/${userId}/${randomUUID()}-missing-checksum.bin`;
    const negativeWrongBodyObjectKey =
      `direct-r2-presigned-put/${userId}/${randomUUID()}-wrong-body.bin`;
    const metadata = {
      encryptedsha256: payload.sha256Hex,
      schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
      snapshotid: snapshotId,
    };
    const requestHeaders = buildPresignedPutHeaders({
      metadata,
      sha256Base64: payload.sha256Base64,
    });

    expect(requestHeaders).toMatchObject({
      "content-type": directR2ContentType,
      "if-none-match": "*",
      "x-amz-checksum-sha256": payload.sha256Base64,
      "x-amz-meta-encryptedsha256": payload.sha256Hex,
      "x-amz-meta-schema": HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
      "x-amz-meta-snapshotid": snapshotId,
    });

    try {
      const putUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: objectKey,
        metadata,
      });
      expect(new URL(putUrl.url).searchParams.get("X-Amz-SignedHeaders")).toBe(
        directR2SignedHeaders,
      );
      const putResponse = await putPresignedObject({
        headers: requestHeaders,
        payload: payload.bytes,
        url: putUrl.url,
      });

      expect(putResponse.status).toBeGreaterThanOrEqual(200);
      expect(putResponse.status).toBeLessThan(300);

      const headUrl = await createHostedR2PresignedHeadUrl({
        checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
        environment,
        expiresSeconds: 300,
        key: objectKey,
      });
      const headResponse = await fetch(headUrl.url, {
        headers: {
          [HOSTED_R2_CHECKSUM_MODE_HEADER]: HOSTED_R2_CHECKSUM_MODE_ENABLED,
        },
        method: "HEAD",
        signal: AbortSignal.timeout(directR2PresignedPutTimeoutMs),
      });

      expect(headResponse.status).toBe(200);
      expect(headResponse.headers.get("content-length")).toBe(String(payload.bytes.byteLength));
      expect(headResponse.headers.get("content-type")).toContain(directR2ContentType);
      expect(headResponse.headers.get("x-amz-checksum-sha256")).toBe(payload.sha256Base64);
      expect(headResponse.headers.get("x-amz-meta-encryptedsha256")).toBe(payload.sha256Hex);
      expect(headResponse.headers.get("x-amz-meta-schema")).toBe(HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA);
      expect(headResponse.headers.get("x-amz-meta-snapshotid")).toBe(snapshotId);

      const missingMetadataPutUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: negativeMissingMetadataObjectKey,
        metadata,
      });

      const missingMetadataResponse = await putPresignedObject({
        headers: buildPresignedPutHeaders({
          metadata: {
            encryptedsha256: payload.sha256Hex,
            schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
          },
          sha256Base64: payload.sha256Base64,
        }),
        payload: payload.bytes,
        url: missingMetadataPutUrl.url,
      });
      expect(missingMetadataResponse.ok).toBe(false);

      const changedMetadataPutUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: negativeChangedMetadataObjectKey,
        metadata,
      });
      const changedMetadataResponse = await putPresignedObject({
        headers: buildPresignedPutHeaders({
          metadata: {
            ...metadata,
            snapshotid: `${snapshotId}-changed`,
          },
          sha256Base64: payload.sha256Base64,
        }),
        payload: payload.bytes,
        url: changedMetadataPutUrl.url,
      });
      expect(changedMetadataResponse.ok).toBe(false);

      const missingChecksumPutUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: negativeMissingChecksumObjectKey,
        metadata,
      });
      const missingChecksumResponse = await putPresignedObject({
        headers: buildPresignedPutHeaders({
          metadata,
          sha256Base64: null,
        }),
        payload: payload.bytes,
        url: missingChecksumPutUrl.url,
      });
      expect(missingChecksumResponse.ok).toBe(false);

      const wrongBodyPutUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: negativeWrongBodyObjectKey,
        metadata,
      });
      const wrongBodyBytes = payload.bytes.slice(0);
      new Uint8Array(wrongBodyBytes)[0] ^= 0xff;
      const wrongBodyResponse = await putPresignedObject({
        headers: requestHeaders,
        payload: wrongBodyBytes,
        url: wrongBodyPutUrl.url,
      });
      expect(wrongBodyResponse.ok).toBe(false);

      for (const negativeObjectKey of [
        negativeMissingMetadataObjectKey,
        negativeChangedMetadataObjectKey,
        negativeMissingChecksumObjectKey,
        negativeWrongBodyObjectKey,
      ]) {
        const negativeHeadUrl = await createHostedR2PresignedHeadUrl({
          environment,
          expiresSeconds: 300,
          key: negativeObjectKey,
        });
        const negativeHeadResponse = await fetch(negativeHeadUrl.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(directR2PresignedPutTimeoutMs),
        });
        expect(negativeHeadResponse.status).toBe(404);
      }
    } finally {
      await deletePresignedObjectBestEffort(environment, objectKey);
      await deletePresignedObjectBestEffort(environment, negativeMissingMetadataObjectKey);
      await deletePresignedObjectBestEffort(environment, negativeChangedMetadataObjectKey);
      await deletePresignedObjectBestEffort(environment, negativeMissingChecksumObjectKey);
      await deletePresignedObjectBestEffort(environment, negativeWrongBodyObjectKey);
    }
  }, directR2PresignedPutTimeoutMs);
});

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }
  return scenario;
}

function readHostedLocalR2ControlEnvironment(
  activeScenario: HostedLocalFullStackScenario,
): HostedR2PresignEnvironment {
  const workerEnv = activeScenario.harness.workerRuntimeEnv ?? activeScenario.runtimeEnv;
  const environment = readHostedR2PresignEnvironment(workerEnv);
  if (!environment.localEndpointAllowed || !environment.controlEndpoint) {
    throw new Error("Hosted local direct R2 test requires MinIO control presign environment.");
  }
  return {
    ...environment,
    endpoint: environment.controlEndpoint,
  };
}

function createDeterministicPayload(byteLength: number): {
  bytes: ArrayBuffer;
  sha256Base64: string;
  sha256Hex: string;
} {
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = index & 0xff;
  }
  const sha256 = createHash("sha256").update(bytes).digest();
  return {
    bytes: bytes.buffer,
    sha256Base64: sha256.toString("base64"),
    sha256Hex: sha256.toString("hex"),
  };
}

function buildPresignedPutHeaders(input: {
  metadata: Readonly<Record<string, string>>;
  sha256Base64: string | null;
}): Record<string, string> {
  return {
    "content-type": directR2ContentType,
    "if-none-match": "*",
    ...(input.sha256Base64 === null ? {} : {
      "x-amz-checksum-sha256": input.sha256Base64,
    }),
    ...Object.fromEntries(
      Object.entries(input.metadata)
        .map(([key, value]) => [`x-amz-meta-${key}`, value]),
    ),
  };
}

async function putPresignedObject(input: {
  headers: HeadersInit;
  payload: ArrayBuffer;
  url: string;
}): Promise<Response> {
  return await fetch(input.url, {
    body: input.payload,
    headers: input.headers,
    method: "PUT",
    signal: AbortSignal.timeout(directR2PresignedPutTimeoutMs),
  });
}

async function deletePresignedObjectBestEffort(
  environment: HostedR2PresignEnvironment,
  key: string,
): Promise<void> {
  const deleteUrl = await createHostedR2PresignedDeleteUrl({
    environment,
    expiresSeconds: 300,
    key,
  });
  const response = await fetch(deleteUrl.url, {
    method: "DELETE",
    signal: AbortSignal.timeout(directR2PresignedPutTimeoutMs),
  }).catch(() => null);
  if (response && !response.ok && response.status !== 404) {
    throw new Error(`Hosted local direct R2 cleanup failed with HTTP ${response.status}.`);
  }
}

function readDirectR2PresignedPutByteLength(): number {
  const raw = process.env.MURPH_E2E_DIRECT_R2_PRESIGNED_PUT_BYTES?.trim();
  if (!raw) {
    return directR2PresignedPutDefaultBytes;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("MURPH_E2E_DIRECT_R2_PRESIGNED_PUT_BYTES must be a positive integer.");
  }
  return parsed;
}
