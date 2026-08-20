import { ZodError } from "@murphai/contracts/zod-runtime";
import { describe, expect, it } from "vitest";

import {
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  prepareDeviceProviderSnapshotImport,
} from "@murphai/importers";

describe("prepareDeviceProviderSnapshotImport", () => {
  it("accepts snapshots when optional ingest metadata fields are omitted", async () => {
    await expect(
      prepareDeviceProviderSnapshotImport({
        provider: "whoop",
        snapshot: {
          accountId: "whoop-user",
          importedAt: "2026-04-08T00:00:00.000Z",
          recoveries: [],
          sleeps: [],
          workouts: [],
        },
      }),
    ).resolves.toMatchObject({
      provider: "whoop",
      accountId: "whoop-user",
    });
  });

  it("preserves schema issue details as the cause when top-level input validation fails", async () => {
    try {
      await prepareDeviceProviderSnapshotImport({
        snapshot: {},
      });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe("provider must be a string");
      expect((error as Error).cause).toBeInstanceOf(ZodError);
      expect(((error as Error).cause as ZodError).issues[0]).toMatchObject({
        message: "provider must be a string",
        path: ["provider"],
      });
    }
  });

  it("rejects malformed complete source-day authority", async () => {
    const snapshot = {
      accountId: "whoop-user",
      importedAt: "2026-04-08T00:00:00.000Z",
      recoveries: [],
      sleeps: [],
      workouts: [],
    };

    await expect(prepareDeviceProviderSnapshotImport({
      completeSourceDay: {
        connectionId: "connection-test",
        dayKey: "2026-02-30",
        resources: ["stress_level"],
        revisionAt: "2026-04-08T00:00:00.000Z",
        timeZone: "UTC",
      },
      provider: "whoop",
      snapshot,
    })).rejects.toBeInstanceOf(TypeError);
    await expect(prepareDeviceProviderSnapshotImport({
      completeSourceDay: {
        connectionId: "connection-test",
        dayKey: "2026-04-08",
        resources: ["stress_level"],
        revisionAt: "2026-04-08T00:00:00",
        timeZone: "UTC",
      },
      provider: "whoop",
      snapshot,
    })).rejects.toBeInstanceOf(TypeError);
  });

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
