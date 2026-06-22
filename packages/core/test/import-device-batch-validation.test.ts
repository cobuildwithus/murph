import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importDeviceBatch, initializeVault } from "@murphai/core";
import { importDeviceBatch as importDeviceBatchWithoutPublicLock } from "../src/mutations.ts";

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

const VALID_DEVICE_EVIDENCE_PART = {
  role: "provider-snapshot",
  fileName: "snapshot.json",
  content: {
    ok: true,
  },
};

function invalidTestValue<T>(value: unknown): T {
  return value as T;
}

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
        events: invalidTestValue<typeof VALID_DEVICE_EVENT[]>({ kind: "observation" }),
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
        samples: invalidTestValue<typeof VALID_DEVICE_SAMPLE[]>({ stream: "heart_rate" }),
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_DEVICE_SAMPLES",
    });
  });

  it("rejects non-array evidenceParts instead of silently dropping them", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: [VALID_DEVICE_EVENT],
        evidenceParts: invalidTestValue<typeof VALID_DEVICE_EVIDENCE_PART[]>({ role: "provider-snapshot" }),
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_DEVICE_EVIDENCE_PARTS",
    });
  });

  it("rejects device events that still use deprecated relatedIds", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: invalidTestValue<typeof VALID_DEVICE_EVENT[]>([
          {
            ...VALID_DEVICE_EVENT,
            relatedIds: ["evt_01JRV2E6E2H6A0A0N0D0H0B0C2"],
          },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_INPUT",
    });
  });

  it("rejects device event fields that try to override canonical event identity", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: invalidTestValue<typeof VALID_DEVICE_EVENT[]>([
          {
            ...VALID_DEVICE_EVENT,
            fields: {
              ...VALID_DEVICE_EVENT.fields,
              id: "evt_01JRV2E6E2H6A0A0N0D0H0B0C2",
              lifecycle: {
                revision: 999,
              },
            },
          },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_EVENT_FIELDS",
      details: {
        field: "id",
        index: 0,
      },
    });
  });

  it("rejects device event fields that try to spoof canonical attachments", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatch({
        vaultRoot,
        provider: "oura",
        events: invalidTestValue<typeof VALID_DEVICE_EVENT[]>([
          {
            ...VALID_DEVICE_EVENT,
            fields: {
              ...VALID_DEVICE_EVENT.fields,
              attachments: [
                {
                  raw: {
                    relativePath: "raw/provider/snapshot.json",
                  },
                },
              ],
            },
          },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_EVENT_FIELDS",
      details: {
        field: "attachments",
        index: 0,
      },
    });
  });

  it("requires the public canonical write-lock wrapper before planning JSONL appends", async () => {
    const vaultRoot = await createTestVaultRoot();

    await expect(
      importDeviceBatchWithoutPublicLock({
        vaultRoot,
        provider: "oura",
        events: [VALID_DEVICE_EVENT],
      }),
    ).rejects.toMatchObject({
      code: "CANONICAL_WRITE_LOCK_REQUIRED",
    });
  });
});
