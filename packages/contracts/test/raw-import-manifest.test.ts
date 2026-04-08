import { describe, expect, it } from "vitest";

import { CONTRACT_SCHEMA_VERSION, ID_PREFIXES } from "../src/constants.ts";
import {
  rawAssetOwnerSchema,
  rawImportManifestSchema,
} from "../src/zod.ts";

const VALID_ULID = "0123456789ABCDEFGHJKMNPQRS";
const LEGACY_WORKOUT_IMPORT_ID = `wkimp_${VALID_ULID}`;

describe("raw import manifest schemas", () => {
  it("accepts owners that require or forbid partitions according to kind", () => {
    expect(
      rawAssetOwnerSchema.parse({
        kind: "device_batch",
        id: `${ID_PREFIXES.sample}_${VALID_ULID}`,
        partition: "oura",
      }),
    ).toEqual({
      kind: "device_batch",
      id: `${ID_PREFIXES.sample}_${VALID_ULID}`,
      partition: "oura",
    });

    expect(
      rawAssetOwnerSchema.parse({
        kind: "workout_batch",
        id: LEGACY_WORKOUT_IMPORT_ID,
        partition: "apple-health",
      }),
    ).toEqual({
      kind: "workout_batch",
      id: LEGACY_WORKOUT_IMPORT_ID,
      partition: "apple-health",
    });

    expect(
      rawAssetOwnerSchema.parse({
        kind: "document",
        id: `${ID_PREFIXES.sample}_${VALID_ULID}`,
      }),
    ).toEqual({
      kind: "document",
      id: `${ID_PREFIXES.sample}_${VALID_ULID}`,
    });
  });

  it("rejects invalid owner ids and partition placement", () => {
    expect(() =>
      rawAssetOwnerSchema.parse({
        kind: "device_batch",
        id: "bad-owner-id",
      }),
    ).toThrow(/Raw asset owner id must match/u);

    expect(() =>
      rawAssetOwnerSchema.parse({
        kind: "device_batch",
        id: `${ID_PREFIXES.sample}_${VALID_ULID}`,
      }),
    ).toThrow(/requires partition/u);

    expect(() =>
      rawAssetOwnerSchema.parse({
        kind: "document",
        id: `${ID_PREFIXES.sample}_${VALID_ULID}`,
        partition: "unexpected",
      }),
    ).toThrow(/must not include partition/u);
  });

  it("accepts valid raw import manifests and rejects invalid import ids", () => {
    expect(
      rawImportManifestSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
        importId: LEGACY_WORKOUT_IMPORT_ID,
        importKind: "workout_batch",
        importedAt: "2026-04-08T05:00:00.000Z",
        source: "apple-health",
        owner: {
          kind: "workout_batch",
          id: LEGACY_WORKOUT_IMPORT_ID,
          partition: "apple-health",
        },
        rawDirectory: "raw/workouts/2026/04/08",
        artifacts: [
          {
            role: "source",
            relativePath: "raw/workouts/2026/04/08/workout.json",
            originalFileName: "workout.json",
            mediaType: "application/json",
            byteSize: 512,
            sha256: "a".repeat(64),
          },
        ],
        provenance: {
          provider: "apple-health",
        },
      }),
    ).toMatchObject({
      importId: LEGACY_WORKOUT_IMPORT_ID,
      owner: {
        kind: "workout_batch",
      },
    });

    expect(() =>
      rawImportManifestSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
        importId: "not-a-valid-import-id",
        importKind: "workout_batch",
        importedAt: "2026-04-08T05:00:00.000Z",
        source: null,
        owner: {
          kind: "workout_batch",
          id: LEGACY_WORKOUT_IMPORT_ID,
          partition: "apple-health",
        },
        rawDirectory: "raw/workouts/2026/04/08",
        artifacts: [
          {
            role: "source",
            relativePath: "raw/workouts/2026/04/08/workout.json",
            originalFileName: "workout.json",
            mediaType: "application/json",
            byteSize: 512,
            sha256: "a".repeat(64),
          },
        ],
        provenance: {},
      }),
    ).toThrow(/Invalid raw import id/u);
  });
});
