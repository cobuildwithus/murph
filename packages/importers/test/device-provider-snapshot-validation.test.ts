import { ZodError } from "zod";
import { describe, expect, it } from "vitest";

import {
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  prepareDeviceProviderSnapshotImport,
} from "@murphai/importers";

describe("prepareDeviceProviderSnapshotImport", () => {
  it("rejects malformed Oura collection fields instead of silently dropping them", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "oura",
        snapshot: {
          accountId: "oura-user",
          importedAt: "2026-04-08T00:00:00.000Z",
          workouts: {
            id: "workout-1",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects malformed WHOOP collection fields instead of silently dropping them", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "whoop",
        snapshot: {
          accountId: "whoop-user",
          importedAt: "2026-04-08T00:00:00.000Z",
          sleeps: {
            id: "sleep-1",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("still accepts valid array-based snapshots after enabling schema parsing", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "oura",
        snapshot: {
          accountId: "oura-user",
          importedAt: "2026-04-08T00:00:00.000Z",
          workouts: [],
        },
      }),
    ).resolves.toMatchObject({
      provider: "oura",
      accountId: "oura-user",
    });
  });

  it("still accepts valid WHOOP snapshots with numeric account ids", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "whoop",
        snapshot: {
          accountId: 101,
          importedAt: "2026-04-08T00:00:00.000Z",
          sleeps: [],
        },
      }),
    ).resolves.toMatchObject({
      provider: "whoop",
      accountId: "101",
    });
  });

  it("marks Oura and WHOOP snapshot parsers as schema-validated", () => {
    expect(OURA_DEVICE_PROVIDER_DESCRIPTOR.normalization.snapshotParser).toBe("schema");
    expect(WHOOP_DEVICE_PROVIDER_DESCRIPTOR.normalization.snapshotParser).toBe("schema");
  });
});
