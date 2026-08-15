import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { importWithMocks } from "./mock-import.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_SRC_DIR = path.resolve(TEST_DIR, "../src");
const LOWER_OWNER_VALUE_IMPORT_PATTERN =
  /^\s*import(?!\s+type\b)[\s\S]*?from ['"]@murphai\/(?:core|query|importers|runtime-state)(?:\/[^'"]+)?['"]/mu;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.doUnmock("../src/runtime-import.js");
  vi.doUnmock("../src/runtime-import.ts");
  vi.doUnmock("../src/usecases/integrated-services.ts");
});

describe("public loader seams", () => {
  it("keeps public seams free of lower-owner value imports", async () => {
    const sourceChecks = [
      "index.ts",
      "vault-services.ts",
      "preferences.ts",
      "helpers.ts",
      "workouts.ts",
      "usecases/shared.ts",
      "usecases/vault-usecase-helpers.ts",
      "usecases/workout-format.ts",
      "usecases/workout-import.ts",
      "usecases/workout-measurement.ts",
    ];

    for (const relativePath of sourceChecks) {
      const source = await readFile(path.join(PACKAGE_SRC_DIR, relativePath), "utf8");
      expect(source).not.toMatch(LOWER_OWNER_VALUE_IMPORT_PATTERN);
    }

    const vaultServicesSource = await readFile(
      path.join(PACKAGE_SRC_DIR, "vault-services.ts"),
      "utf8",
    );
    expect(vaultServicesSource).toContain('import("./usecases/integrated-services.js")');
    expect(vaultServicesSource).not.toContain('} from "./usecases/integrated-services.js"');
  });

  it("loads integrated services only when an integrated method is invoked", async () => {
    let integratedLoads = 0;
    const initMock = vi.fn(async () => ({ ok: true }));
    const vaultServicesModule = await importWithMocks<
      typeof import("../src/vault-services.ts")
    >("../src/vault-services.ts", {
      "../src/usecases/integrated-services.ts": () => {
        integratedLoads += 1;
        return {
          createIntegratedVaultServices() {
            return {
              core: {
                init: initMock,
              },
              importers: {},
              query: {},
            };
          },
        };
      },
    });

    expect(integratedLoads).toBe(0);

    const unwired = vaultServicesModule.createUnwiredVaultServices();
    expect(integratedLoads).toBe(0);

    await expect(unwired.core.init({ vault: "./vault", requestId: null })).rejects.toMatchObject({
      code: "not_implemented",
    });
    expect(integratedLoads).toBe(0);

    const integrated = vaultServicesModule.createIntegratedVaultServices();
    expect(integratedLoads).toBe(0);

    await expect(
      integrated.core.init({ vault: "./vault", requestId: null }),
    ).resolves.toEqual({ ok: true });
    expect(integratedLoads).toBe(1);
    expect(initMock).toHaveBeenCalledWith({ vault: "./vault", requestId: null });
  });

  it("retries failed integrated loads and keeps importer/query proxies lazy", async () => {
    const importDocumentMock = vi.fn(
      async (input: { file: string; vault: string; requestId: string | null }) => ({
        imported: true,
        file: input.file,
        vault: input.vault,
      }),
    );
    const showVaultMock = vi.fn(
      async (input: { vault: string; requestId: string | null }) => ({
        vault: input.vault,
      }),
    );
    const createIntegratedVaultServicesMock = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("loader exploded");
      })
      .mockImplementation(() => ({
        core: {},
        importers: {
          importDocument: importDocumentMock,
        },
        query: {
          showVault: showVaultMock,
        },
      }));
    const vaultServicesModule = await importWithMocks<
      typeof import("../src/vault-services.ts")
    >("../src/vault-services.ts", {
      "../src/usecases/integrated-services.ts": () => ({
        createIntegratedVaultServices: createIntegratedVaultServicesMock,
      }),
    });

    const integrated = vaultServicesModule.createIntegratedVaultServices();

    await expect(
      integrated.importers.importDocument({
        vault: "./vault",
        requestId: null,
        file: "document.md",
      }),
    ).rejects.toThrow("loader exploded");
    expect(createIntegratedVaultServicesMock).toHaveBeenCalledTimes(1);
    expect(importDocumentMock).not.toHaveBeenCalled();
    expect(showVaultMock).not.toHaveBeenCalled();

    await expect(
      integrated.importers.importDocument({
        vault: "./vault",
        requestId: null,
        file: "document.md",
      }),
    ).resolves.toMatchObject({
      imported: true,
      file: "document.md",
      vault: "./vault",
    });
    expect(createIntegratedVaultServicesMock).toHaveBeenCalledTimes(2);
    expect(importDocumentMock).toHaveBeenCalledWith({
      vault: "./vault",
      requestId: null,
      file: "document.md",
    });

    await expect(
      integrated.query.showVault({
        vault: "./vault",
        requestId: null,
      }),
    ).resolves.toMatchObject({
      vault: "./vault",
    });
    expect(createIntegratedVaultServicesMock).toHaveBeenCalledTimes(2);
    expect(showVaultMock).toHaveBeenCalledWith({
      vault: "./vault",
      requestId: null,
    });
  });

  it("keeps helper and preference seams behind the runtime loader", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "vault-usecases-loader-"));
    const manifestRelativePath = "raw/documents/2026/04/doc_loader/manifest.json";
    const manifestAbsolutePath = path.join(vaultRoot, manifestRelativePath);
    await mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
    await writeFile(
      manifestAbsolutePath,
      JSON.stringify({
        importId: "xfm_loader",
      }),
      "utf8",
    );

    const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
      if (specifier !== "@murphai/core") {
        throw new Error(`Unexpected loader specifier ${specifier}`);
      }

      return {
        parseRawImportManifest: (manifest: Record<string, unknown>) => ({
          ...manifest,
          artifacts: [],
          importKind: "document",
          importedAt: "2026-04-23T00:00:00Z",
          owner: {
            kind: "document",
            id: "doc_loader",
          },
          provenance: {},
          rawDirectory: "raw/documents/2026/04/doc_loader",
          source: "manual",
        }),
        readPreferencesDocument: async () => ({
          sourcePath: "bank/preferences.md",
          updatedAt: "2026-04-23T00:00:00Z",
          wearablePreferences: {
            desiredProviders: ["oura"],
          },
        }),
        updateAssistantPreferences: async () => ({
          updated: true,
          document: {
            assistant: {
              personality: {
                humor: 0,
              },
            },
            sourcePath: "bank/preferences.json",
            updatedAt: "2026-07-10T12:00:00Z",
            wearablePreferences: {
              desiredProviders: ["oura"],
            },
          },
        }),
        resolveVaultPathOnDisk: async (inputVaultRoot: string, relativePath: string) => ({
          absolutePath: path.join(inputVaultRoot, relativePath),
        }),
      };
    });

    const helpersModule = await importWithMocks<typeof import("../src/helpers.ts")>(
      "../src/helpers.ts",
      {
        "../src/runtime-import.ts": () => ({
          loadRuntimeModule: loadRuntimeModuleMock,
        }),
      },
    );
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(0);

    await expect(
      helpersModule.readRawImportManifest(vaultRoot, manifestRelativePath),
    ).resolves.toMatchObject({
      importId: "xfm_loader",
    });
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(2);

    await expect(
      helpersModule.resolveVaultRelativePath(vaultRoot, "journal/2026-04-23.md"),
    ).resolves.toBe(path.join(vaultRoot, "journal/2026-04-23.md"));
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(3);

    const preferencesModule = await importWithMocks<typeof import("../src/preferences.ts")>(
      "../src/preferences.ts",
      {
        "../src/runtime-import.ts": () => ({
          loadRuntimeModule: loadRuntimeModuleMock,
        }),
      },
    );
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(3);

    await expect(preferencesModule.showWearablePreferences(vaultRoot)).resolves.toMatchObject({
      vault: vaultRoot,
      wearablePreferences: {
        desiredProviders: ["oura"],
      },
    });
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(4);

    await expect(
      preferencesModule.setAssistantPersonalitySetting({
        vault: vaultRoot,
        setting: "humor",
        value: 0,
      }),
    ).resolves.toMatchObject({
      updated: true,
      settings: {
        humor: { value: 0, source: "custom" },
        push: { value: 3, source: "default" },
        detail: { value: 5, source: "default" },
      },
    });
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(5);
  });

  it("keeps workout subpath exports behind the runtime loader", async () => {
    const csvDir = await mkdtemp(path.join(tmpdir(), "vault-workout-loader-"));
    const csvFile = path.join(csvDir, "workout.csv");
    await writeFile(
      csvFile,
      [
        "workout name,date,exercise name,weight,reps",
        "Push Day,2026-04-23,Bench Press,225,5",
      ].join("\n"),
      "utf8",
    );

    const loadVaultMock = vi.fn(async () => ({
      metadata: { timezone: "America/Chicago" },
    }));
    const planWorkoutCsvImportMock = vi.fn(() => ({
      source: "strong",
      detectedSource: "strong",
      delimiter: ",",
      timeZone: "America/Chicago",
      weightUnit: null,
      distanceUnit: null,
      headers: ["workout name", "date", "exercise name", "weight", "reps"],
      rowCount: 1,
      repairedRowCount: 0,
      ignoredRowCount: 0,
      skippedRowCount: 0,
      skipReasons: [],
      estimatedWorkouts: 1,
      requiresWeightUnit: false,
      requiresDistanceUnit: false,
      importable: true,
      warnings: [],
      sessions: [],
    }));
    const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
      switch (specifier) {
        case "@murphai/core":
          return {
            listWorkoutFormats: async () => [],
            readWorkoutFormat: async () => {
              throw new Error("readWorkoutFormat should not be called in this test");
            },
            upsertWorkoutFormat: async () => ({
              created: true,
              record: {
                workoutFormatId: "wfmt_loader",
                slug: "push-day",
                title: "Push Day",
                relativePath: "bank/workouts/push-day.md",
                markdown: null,
                status: "active",
                summary: null,
                activityType: "strength-training",
                durationMinutes: 45,
                distanceKm: null,
                template: {
                  exercises: [],
                },
                tags: [],
                note: null,
                templateText: "Bench 5x5",
              },
            }),
            readPreferencesDocument: async () => ({
              sourcePath: "bank/preferences.md",
              updatedAt: "2026-04-23T00:00:00Z",
              workoutUnitPreferences: {
                weight: "lb",
                bodyMeasurement: "in",
              },
            }),
            loadVault: loadVaultMock,
          };
        case "@murphai/importers":
          return {
            planWorkoutCsvImport: planWorkoutCsvImportMock,
          };
        case "@murphai/runtime-state":
          return {
            generateUlid: () => "01_loader",
          };
        default:
          throw new Error(`Unexpected loader specifier ${specifier}`);
      }
    });

    const workoutsModule = await importWithMocks<typeof import("../src/workouts.ts")>(
      "../src/workouts.ts",
      {
        "../src/runtime-import.ts": () => ({
          loadRuntimeModule: loadRuntimeModuleMock,
        }),
      },
    );

    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(0);

    await expect(
      workoutsModule.showWorkoutUnitPreferences("./vault"),
    ).resolves.toMatchObject({
      unitPreferences: {
        weight: "lb",
        bodyMeasurement: "in",
      },
    });
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(1);
    expect(loadRuntimeModuleMock).toHaveBeenLastCalledWith("@murphai/core");

    await expect(
      workoutsModule.saveWorkoutFormat({
        vault: "./vault",
        name: "Push Day",
        text: "Bench 5x5",
        durationMinutes: 45,
      }),
    ).resolves.toMatchObject({
      created: true,
      slug: "push-day",
    });
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(2);
    expect(loadRuntimeModuleMock).toHaveBeenLastCalledWith("@murphai/core");

    const inspection = await workoutsModule.inspectWorkoutCsvImport({
      vault: "./vault",
      file: csvFile,
    });
    expect(inspection).toMatchObject({
      sourceFile: csvFile,
      importable: true,
    });
    expect(inspection).not.toHaveProperty("headers");
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(4);
    expect(loadRuntimeModuleMock).toHaveBeenLastCalledWith("@murphai/importers");
    expect(loadVaultMock).toHaveBeenCalledWith({ vaultRoot: "./vault" });
    expect(planWorkoutCsvImportMock).toHaveBeenCalledWith(expect.objectContaining({
      timeZone: "America/Chicago",
    }));
  });
});
