import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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
const directR2MetadataSchema = "murph.direct-r2-presigned-put.e2e";
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
    const objectKey = `direct-r2-presigned-put/${userId}/${randomUUID()}.bin`;
    const negativeObjectKey = `direct-r2-presigned-put/${userId}/${randomUUID()}-negative.bin`;
    const metadata = {
      payloadsha256: payload.sha256Hex,
      schema: directR2MetadataSchema,
      testid: userId,
    };

    try {
      const putUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: objectKey,
        metadata,
      });
      const putResponse = await putPresignedObject({
        metadata,
        payload: payload.bytes,
        sha256Base64: payload.sha256Base64,
        url: putUrl.url,
      });

      expect(putResponse.status).toBeGreaterThanOrEqual(200);
      expect(putResponse.status).toBeLessThan(300);

      const headUrl = await createHostedR2PresignedHeadUrl({
        environment,
        expiresSeconds: 300,
        key: objectKey,
      });
      const headResponse = await fetch(headUrl.url, {
        method: "HEAD",
        signal: AbortSignal.timeout(directR2PresignedPutTimeoutMs),
      });

      expect(headResponse.status).toBe(200);
      expect(headResponse.headers.get("content-length")).toBe(String(payload.bytes.byteLength));
      expect(headResponse.headers.get("content-type")).toContain(directR2ContentType);
      expect(headResponse.headers.get("x-amz-meta-payloadsha256")).toBe(payload.sha256Hex);
      expect(headResponse.headers.get("x-amz-meta-schema")).toBe(directR2MetadataSchema);
      expect(headResponse.headers.get("x-amz-meta-testid")).toBe(userId);

      const negativePutUrl = await createHostedR2PresignedPutUrl({
        checksumSha256Base64: payload.sha256Base64,
        contentType: directR2ContentType,
        environment,
        expiresSeconds: 300,
        key: negativeObjectKey,
        metadata,
      });

      const missingMetadataResponse = await putPresignedObject({
        metadata: {
          payloadsha256: payload.sha256Hex,
          schema: directR2MetadataSchema,
        },
        payload: payload.bytes,
        sha256Base64: payload.sha256Base64,
        url: negativePutUrl.url,
      });
      expect(missingMetadataResponse.ok).toBe(false);

      const changedMetadataResponse = await putPresignedObject({
        metadata: {
          ...metadata,
          testid: `${userId}-changed`,
        },
        payload: payload.bytes,
        sha256Base64: payload.sha256Base64,
        url: negativePutUrl.url,
      });
      expect(changedMetadataResponse.ok).toBe(false);

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
    } finally {
      await deletePresignedObjectBestEffort(environment, objectKey);
      await deletePresignedObjectBestEffort(environment, negativeObjectKey);
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

async function putPresignedObject(input: {
  metadata: Readonly<Record<string, string>>;
  payload: ArrayBuffer;
  sha256Base64: string;
  url: string;
}): Promise<Response> {
  return await fetch(input.url, {
    body: input.payload,
    headers: {
      "content-type": directR2ContentType,
      "if-none-match": "*",
      "x-amz-checksum-sha256": input.sha256Base64,
      ...Object.fromEntries(
        Object.entries(input.metadata)
          .map(([key, value]) => [`x-amz-meta-${key}`, value]),
      ),
    },
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
