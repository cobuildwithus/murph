import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importDeviceBatch, initializeVault } from "@murphai/core";

const createdVaultRoots: string[] = [];

const VALID_OCCURRED_AT = "2026-04-08T00:00:00.000Z";
const VALID_RECORDED_AT = "2026-04-08T00:15:00.000Z";

const VALID_DEVICE_EVENT = {
  kind: "observation",
  occurredAt: VALID_OCCURRED_AT,
  title: "Test observation",
  fields: {
    metric: "steps",
    value: 1,
    unit: "count",
  },
};

const VALID_DEVICE_SAMPLE = {
  stream: "heart_rate",
  unit: "bpm",
  sample: {
    recordedAt: VALID_RECORDED_AT,
    value: 60,
  },
};

const VALID_DEVICE_RAW_ARTIFACT = {
  role: "provider-snapshot",
  fileName: "snapshot.json",
  content: {
    ok: true,
  },
};

async function createTestVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-core-device-batch-"));
  createdVaultRoots.push(vaultRoot);
  await initializeVault({ vaultRoot });
  return vaultRoot;
}

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) => rm(vaultRoot, { recursive: true, force: true })),
  );
});

describe("importDeviceBatch", () => {
  it("rejects non-array events instead of silently dropping them", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: { kind: "observation" } as unknown as typeof VALID_DEVICE_EVENT[],
        samples: [VALID_DEVICE_SAMPLE],
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_DEVICE_EVENTS",
    });
  });

  it("rejects non-array samples instead of silently dropping them", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: [VALID_DEVICE_EVENT],
        samples: { stream: "heart_rate" } as unknown as typeof VALID_DEVICE_SAMPLE[],
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_DEVICE_SAMPLES",
    });
  });

  it("rejects non-array rawArtifacts instead of silently dropping them", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: [VALID_DEVICE_EVENT],
        rawArtifacts: { role: "provider-snapshot" } as unknown as typeof VALID_DEVICE_RAW_ARTIFACT[],
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_DEVICE_RAW_ARTIFACTS",
    });
  });
});
