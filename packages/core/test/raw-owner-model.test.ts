import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { CONTRACT_SCHEMA_VERSION } from "@murphai/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildRawImportManifest,
  initializeVault,
  parseRawImportManifest,
  resolveRawAssetDirectory,
  validateVault,
} from "../src/index.ts";
import { resolveVaultPath } from "../src/path-safety.ts";
import { prepareInlineRawArtifact, rawDirectoryMatchesOwner } from "../src/raw.ts";

const FIXED_TIME = "2026-04-08T10:15:00.000Z";
const FIXED_SHA256 = "a".repeat(64);
const createdVaultRoots: string[] = [];

async function createTempVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-raw-owner-"));
  createdVaultRoots.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    title: "Raw Owner Model Test Vault",
  });
  return vaultRoot;
}

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        recursive: true,
        force: true,
      })
    ),
  );
});

describe("raw owner model", () => {
  it("resolves owner-scoped directories for singleton and partitioned owners", () => {
    expect(
      resolveRawAssetDirectory({
        owner: {
          kind: "document",
          id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        },
        occurredAt: FIXED_TIME,
      }),
    ).toBe("raw/documents/2026/04/doc_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    expect(
      resolveRawAssetDirectory({
        owner: {
          kind: "workout_batch",
          id: "xfm_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          partition: "strong",
        },
        occurredAt: FIXED_TIME,
      }),
    ).toBe("raw/workouts/strong/2026/04/xfm_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  it("prefixes meal attachment file names by role inside the owner directory", () => {
    const artifact = prepareInlineRawArtifact({
      fileName: "IMG 1234.JPG",
      owner: {
        kind: "meal",
        id: "meal_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      },
      occurredAt: FIXED_TIME,
      role: "photo",
    });

    expect(artifact.relativePath).toBe(
      "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/photo-img-1234.jpg",
    );
    expect(artifact.mediaType).toBe("image/jpeg");
  });

  it("builds manifests against the same owner/path contract used by raw files", () => {
    const owner = {
      kind: "workout_batch" as const,
      id: "xfm_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      partition: "strong",
    };
    const rawDirectory = resolveRawAssetDirectory({
      owner,
      occurredAt: FIXED_TIME,
    });

    expect(rawDirectoryMatchesOwner(rawDirectory, owner)).toBe(true);
    expect(
      rawDirectoryMatchesOwner(rawDirectory, {
        ...owner,
        partition: "other",
      }),
    ).toBe(false);

    const manifest = buildRawImportManifest({
      importId: owner.id,
      importKind: "workout_batch",
      importedAt: FIXED_TIME,
      owner,
      rawDirectory,
      source: "strong",
      artifacts: [
        {
          role: "source",
          relativePath: `${rawDirectory}/workout.csv`,
          originalFileName: "workout.csv",
          mediaType: "text/csv",
          byteSize: 12,
          sha256: FIXED_SHA256,
        },
      ],
      provenance: {
        sourceFileName: "workout.csv",
      },
    });

    expect(manifest.owner).toEqual(owner);
    expect(manifest.rawDirectory).toBe(rawDirectory);

    expect(() =>
      buildRawImportManifest({
        importId: owner.id,
        importKind: "workout_batch",
        importedAt: FIXED_TIME,
        owner: {
          kind: "document",
          id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        },
        rawDirectory,
        source: "strong",
        artifacts: [
          {
            role: "source",
            relativePath: `${rawDirectory}/workout.csv`,
            originalFileName: "workout.csv",
            mediaType: "text/csv",
            byteSize: 12,
            sha256: FIXED_SHA256,
          },
        ],
        provenance: {
          sourceFileName: "workout.csv",
        },
      }),
    ).toThrow(/does not match owner/);
  });

  it("parses current raw import manifests without mutating their owner metadata", () => {
    const manifest = parseRawImportManifest({
      schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
      importId: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      importKind: "document",
      importedAt: FIXED_TIME,
      source: "manual",
      owner: {
        kind: "document",
        id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      },
      rawDirectory: "raw/documents/2026/04/doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      artifacts: [
        {
          role: "source",
          relativePath: "raw/documents/2026/04/doc_01ARZ3NDEKTSV4RRFFQ69G5FAV/report.pdf",
          originalFileName: "report.pdf",
          mediaType: "application/pdf",
          byteSize: 12,
          sha256: FIXED_SHA256,
        },
      ],
      provenance: {
        sourceFileName: "report.pdf",
      },
    });

    expect(manifest.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION.rawImportManifest);
    expect(manifest.owner).toEqual({
      kind: "document",
      id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
  });

  it("flags raw manifests whose owner does not match the raw directory layout", async () => {
    const vaultRoot = await createTempVault();
    const importId = "xfm_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const rawDirectory = resolveRawAssetDirectory({
      owner: {
        kind: "workout_batch",
        id: importId,
        partition: "strong",
      },
      occurredAt: FIXED_TIME,
    });
    const rawFile = `${rawDirectory}/workout.csv`;
    const manifestPath = `${rawDirectory}/manifest.json`;

    await mkdir(resolveVaultPath(vaultRoot, rawDirectory).absolutePath, {
      recursive: true,
    });
    await writeFile(resolveVaultPath(vaultRoot, rawFile).absolutePath, "date,exercise\n", "utf8");
    await writeFile(
      resolveVaultPath(vaultRoot, manifestPath).absolutePath,
      `${JSON.stringify(
        {
          schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
          importId,
          importKind: "workout_batch",
          importedAt: FIXED_TIME,
          source: "strong",
          owner: {
            kind: "document",
            id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          },
          rawDirectory,
          artifacts: [
            {
              role: "source",
              relativePath: rawFile,
              originalFileName: "workout.csv",
              mediaType: "text/csv",
              byteSize: 14,
              sha256: FIXED_SHA256,
            },
          ],
          provenance: {
            sourceFileName: "workout.csv",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await validateVault({ vaultRoot });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "RAW_MANIFEST_INVALID"
          && issue.path === manifestPath
          && issue.message.includes("does not match owner"),
      ),
    ).toBe(true);
  });

  it("rejects legacy v1 canonical raw manifests during validation", async () => {
    const vaultRoot = await createTempVault();
    const rawDirectory = "raw/documents/2026/04/doc_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const rawFile = `${rawDirectory}/report.pdf`;
    const manifestPath = `${rawDirectory}/manifest.json`;

    await mkdir(resolveVaultPath(vaultRoot, rawDirectory).absolutePath, {
      recursive: true,
    });
    await writeFile(resolveVaultPath(vaultRoot, rawFile).absolutePath, "pdf-bytes", "utf8");
    await writeFile(
      resolveVaultPath(vaultRoot, manifestPath).absolutePath,
      `${JSON.stringify(
        {
          schemaVersion: "murph.raw-import-manifest.v1",
          importId: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          importKind: "document",
          importedAt: FIXED_TIME,
          source: "manual",
          rawDirectory,
          artifacts: [
            {
              role: "source",
              relativePath: rawFile,
              originalFileName: "report.pdf",
              mediaType: "application/pdf",
              byteSize: 9,
              sha256: FIXED_SHA256,
            },
          ],
          provenance: {
            sourceFileName: "report.pdf",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await validateVault({ vaultRoot });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "RAW_MANIFEST_INVALID"
          && issue.path === manifestPath,
      ),
    ).toBe(true);
  });

  it("rejects legacy wkimp workout-batch manifests during parsing and validation", async () => {
    const vaultRoot = await createTempVault();
    const rawDirectory = "raw/workouts/strong/2026/04/wkimp_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const rawFile = `${rawDirectory}/workout.csv`;
    const manifestPath = `${rawDirectory}/manifest.json`;

    await mkdir(resolveVaultPath(vaultRoot, rawDirectory).absolutePath, {
      recursive: true,
    });
    await writeFile(resolveVaultPath(vaultRoot, rawFile).absolutePath, "date,exercise\n", "utf8");
    await writeFile(
      resolveVaultPath(vaultRoot, manifestPath).absolutePath,
      `${JSON.stringify(
        {
          schemaVersion: "murph.raw-import-manifest.v1",
          importId: "wkimp_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          importKind: "workout_batch",
          importedAt: FIXED_TIME,
          source: "strong",
          rawDirectory,
          artifacts: [
            {
              role: "source",
              relativePath: rawFile,
              originalFileName: "workout.csv",
              mediaType: "text/csv",
              byteSize: 14,
              sha256: FIXED_SHA256,
            },
          ],
          provenance: {
            sourceFileName: "workout.csv",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      readFile(resolveVaultPath(vaultRoot, manifestPath).absolutePath, "utf8").then((manifestText) =>
        parseRawImportManifest(JSON.parse(manifestText) as unknown),
      ),
    ).rejects.toThrow();
    const result = await validateVault({ vaultRoot });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "RAW_MANIFEST_INVALID"
          && issue.path === manifestPath,
      ),
    ).toBe(true);
  });
});
