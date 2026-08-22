import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  createVaultReadModel,
  type ProtocolSummary,
} from "@murphai/query";
import * as queryRuntime from "@murphai/query";

import {
  applyLimit,
  arrayOfStrings,
  asObject,
  compareByLatest,
  compareNullableDates,
  firstString,
  isJsonObject,
  readJsonObject,
  matchesDateRange,
  matchesOptionalString,
  nullableString,
  numberOrNull,
  toCommandListItem,
  toAuditCommandListItem,
  toCommandShowEntity,
  toOwnedEventCommandShowEntity,
  toSampleCommandListItem,
} from "../src/commands/query-record-command-helpers.ts";
import {
  addInterventionRecord,
  deleteInterventionRecord,
  editInterventionRecord,
} from "../src/usecases/intervention.ts";
import { computeClearedTopLevelFields, applyRecordPatch } from "../src/usecases/record-mutations.ts";
import {
  dailyFoodTimeSchema,
  buildDailyFoodCronExpression,
  buildDailyFoodCronJobName,
  buildDailyFoodCronPrompt,
  buildDailyFoodSchedule,
  renderAutoLoggedFoodMealNote,
  slugifyFoodLookup,
} from "../src/usecases/food-autolog.ts";
import {
  MAX_DURATION_MINUTES,
  inferDurationMinutes,
  validateDurationMinutes,
} from "../src/usecases/text-duration.ts";
import {
  asEntityEnvelope,
  asListEnvelope,
  assertNoReservedPayloadKeys,
  buildEntityLinks,
  buildScaffoldPayload,
  describeLookupConstraint,
  inferEntityKind,
  isQueryableRecordId,
  matchesGenericKindFilter,
  materializeExportPack,
  normalizeIssues,
  optionalStringArray,
  readRawImportManifest,
  recordPath,
  requirePayloadObjectField,
  toGenericListItem,
  toGenericShowEntity,
  toJournalLookupId,
} from "../src/usecases/shared.ts";
import {
  compactObject,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  mergeByRelativePath,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  normalizeStringArray,
  relativePathEntries,
  stringArray,
  uniqueStrings,
} from "../src/usecases/vault-usecase-helpers.ts";
import {
  parseFoodPayload,
  scaffoldFoodPayload,
  upsertFoodRecord,
} from "../src/usecases/food.ts";
import { createExplicitHealthQueryServices } from "../src/usecases/explicit-health-family-services.ts";
import type { QueryRuntimeModule } from "../src/usecases/types.ts";
import {
  parseProviderPayload,
  scaffoldEventPayload,
  scaffoldProviderPayload,
  upsertProviderRecord,
} from "../src/usecases/provider-event.ts";
import {
  parseRecipePayload,
  scaffoldRecipePayload,
  upsertRecipeRecord,
} from "../src/usecases/recipe.ts";
import { importWithMocks, mockActualModule } from "./mock-import.ts";
import * as helpersModule from "../src/helpers.ts";
import * as indexModule from "../src/index.ts";
import * as recordsModule from "../src/records.ts";
import * as runtimeModule from "../src/runtime.ts";
import * as testingModule from "../src/testing.ts";
import * as vaultServicesModule from "../src/vault-services.ts";
import * as workoutsModule from "../src/workouts.ts";

type QueryRecord = Parameters<typeof toCommandShowEntity>[0];
const FIXED_SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function sampleQueryRecord(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    entityId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    primaryLookupId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    lookupIds: ["evt_01JNV422Y2M5ZBV64ZP4N1DRB1"],
    family: "event",
    recordClass: "bank",
    kind: "note",
    status: "active",
    occurredAt: "2026-04-08T12:00:00.000Z",
    date: "2026-04-08",
    path: "bank/events/evt_01JNV422Y2M5ZBV64ZP4N1DRB1.md",
    title: "Daily note",
    body: "Recorded details.",
    attributes: {
      action: "updated",
      actor: "assistant",
      commandName: "review",
      summary: "Updated the record.",
      relatedIds: ["goal_01JNV422Y2M5ZBV64ZP4N1DRB1", "goal_01JNV422Y2M5ZBV64ZP4N1DRB1"],
      snapshotId: "profile_01JNV422Y2M5ZBV64ZP4N1DRB1",
    },
    frontmatter: null,
    links: [],
    relatedIds: ["goal_01JNV422Y2M5ZBV64ZP4N1DRB1"],
    stream: "stream-a",
    experimentSlug: "focus-sprint",
    tags: ["note"],
    ...overrides,
  };
}

function createRawImportManifest(input: {
  importId: string;
  importKind: "document" | "meal" | "workout_batch";
  ownerKind: "document" | "meal" | "workout";
  rawDirectory: string;
  relativePath: string;
  originalFileName: string;
  mediaType: string;
}) {
  return {
    schemaVersion: "murph.raw-import-manifest.v1",
    importId: input.importId,
    importKind: input.importKind,
    importedAt: "2026-04-08T12:00:00.000Z",
    source: "manual",
    owner: {
      kind: input.ownerKind,
      id: input.importId,
    },
    rawDirectory: input.rawDirectory,
    artifacts: [
      {
        role: "source",
        relativePath: input.relativePath,
        originalFileName: input.originalFileName,
        mediaType: input.mediaType,
        byteSize: 12,
        sha256: FIXED_SHA256,
      },
    ],
    provenance: {
      sourceFileName: input.originalFileName,
    },
  };
}

async function writeManifestFile(
  vaultRoot: string,
  manifestFile: string,
  manifest: Record<string, unknown>,
) {
  const manifestPath = path.join(vaultRoot, manifestFile);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function loadManifestReadUsecases(queryRuntime: {
  readVault: (vault: string) => Promise<unknown>;
  lookupEntityById: (readModel: unknown, lookup: string) => QueryRecord | null;
}) {
  const readOwnedEventRecord = vi.fn(async (input: { lookup: string; kind: string }) => {
    const readModel = await queryRuntime.readVault('./vault')
    const record = queryRuntime.lookupEntityById(readModel, input.lookup)
    if (!record || record.kind !== input.kind) {
      throw new VaultCliError('not_found', `No ${input.kind} found for "${input.lookup}".`)
    }
    return { event: record.attributes, ledgerFile: record.path, record }
  })
  const documentMeal = await importWithMocks<
    typeof import("../src/usecases/document-meal-read.ts")
  >("../src/usecases/document-meal-read.ts", {
    "../src/commands/query-record-command-helpers.ts": mockActualModule(
      "../src/commands/query-record-command-helpers.ts",
      (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => queryRuntime),
      }),
    ),
    "../src/usecases/exact-event-record.ts": () => ({
      readOwnedEventRecord,
    }),
  });
  const workoutRead = await importWithMocks<
    typeof import("../src/usecases/workout-read.ts")
  >("../src/usecases/workout-read.ts", {
    "../src/commands/query-record-command-helpers.ts": mockActualModule(
      "../src/commands/query-record-command-helpers.ts",
      (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => queryRuntime),
      }),
    ),
  });

  return { documentMeal, workoutRead };
}

function createCoreStub<T extends Record<string, unknown>>(overrides: T): T {
  return overrides;
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/runtime-import.ts");
  vi.doUnmock("../src/query-runtime.ts");
  vi.doUnmock("../src/commands/query-record-command-helpers.ts");
  vi.doUnmock("../src/usecases/event-record-mutations.ts");
  vi.doUnmock("../src/usecases/exact-event-record.ts");
  vi.doUnmock("../src/usecases/provider-event.ts");
});

describe("query record helpers", () => {
  test("map records to command list and show entities", () => {
    const record = sampleQueryRecord({
      family: "event",
      kind: "note",
      attributes: {
        action: "updated",
        actor: "assistant",
        commandName: "review",
        summary: "Updated the record.",
        relatedIds: ["goal_1", "goal_1"],
        snapshotId: "profile_1",
      },
      relatedIds: ["goal_1"],
    });

    assert.deepEqual(toCommandShowEntity(record), {
      id: record.entityId,
      kind: "note",
      title: "Daily note",
      occurredAt: "2026-04-08T12:00:00.000Z",
      path: "bank/events/evt_01JNV422Y2M5ZBV64ZP4N1DRB1.md",
      markdown: "Recorded details.",
      data: record.attributes,
      links: [
        { id: "goal_1", kind: "goal", queryable: true },
      ],
    });

    const providerListRecord = sampleQueryRecord({
      family: "provider",
      kind: "provider",
      title: "Hydration",
      body: "# Morning hydration\n\nHydration helps recovery.",
      attributes: {},
      relatedIds: [],
    });

    assert.deepEqual(toGenericListItem(providerListRecord), {
      id: providerListRecord.entityId,
      kind: "provider",
      title: "Hydration",
      occurredAt: "2026-04-08T12:00:00.000Z",
      path: "bank/events/evt_01JNV422Y2M5ZBV64ZP4N1DRB1.md",
      data: {},
      links: [],
      excerpt: "Morning hydration Hydration helps recovery.",
    });
    expect(toGenericListItem(providerListRecord)).not.toHaveProperty("markdown");

    assert.deepEqual(toOwnedEventCommandShowEntity(record), {
      id: record.entityId,
      kind: "note",
      title: "Daily note",
      occurredAt: "2026-04-08T12:00:00.000Z",
      path: "bank/events/evt_01JNV422Y2M5ZBV64ZP4N1DRB1.md",
      markdown: "Recorded details.",
      data: record.attributes,
      links: [],
    });

    assert.deepEqual(toSampleCommandListItem(record), {
      ...toCommandListItem(record),
      data: {
        action: "updated",
        actor: "assistant",
        commandName: "review",
        relatedIds: ["goal_1", "goal_1"],
        snapshotId: "profile_1",
        summary: "Updated the record.",
        status: "active",
        stream: "stream-a",
      },
      quality: "active",
      stream: "stream-a",
    });

    assert.deepEqual(toAuditCommandListItem(record), {
      ...toCommandListItem(record),
      action: "updated",
      actor: "assistant",
      status: "active",
      commandName: "review",
      summary: "Updated the record.",
    });

    assert.equal(matchesOptionalString("alpha", "alpha"), true);
    assert.equal(matchesOptionalString("alpha"), true);
    assert.equal(matchesDateRange("2026-04-08T12:00:00.000Z", "2026-04-01", "2026-04-30"), true);
    assert.equal(matchesDateRange("2026-03-30T12:00:00.000Z", "2026-04-01"), false);
    assert.equal(compareByLatest(sampleQueryRecord(), sampleQueryRecord({ entityId: "evt_b", occurredAt: "2026-04-07T12:00:00.000Z" })) < 0, true);
    assert.equal(compareNullableDates("2026-04-08", "2026-04-09") < 0, true);
    assert.deepEqual(applyLimit([1, 2, 3], 2), [1, 2]);
    assert.equal(isJsonObject({ ok: true }), true);
    assert.deepEqual(asObject({ ok: true }), { ok: true });
    assert.deepEqual(arrayOfStrings(["goal", "", 1, "sleep"]), ["goal", "sleep"]);
    assert.equal(firstString({ title: " Sleep " }, ["title"]), "Sleep");
    assert.equal(nullableString("  yes "), "yes");
    assert.equal(numberOrNull(12), 12);
    assert.equal(numberOrNull(Number.NaN), null);
  });

  test("readJsonObject fails closed on missing paths", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "vault-usecases-query-helpers-"));
    const jsonPath = path.join(tempDir, "payload.json");

    try {
      await writeFile(jsonPath, JSON.stringify({ hello: "world" }), "utf8");
      assert.deepEqual(await readJsonObject(jsonPath, "payload"), { hello: "world" });
      await assert.rejects(() => readJsonObject(path.join(tempDir, "missing.json"), "payload"), {
        code: "not_found",
        message: "payload is missing.",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("shared and vault helper functions", () => {
  test("preserve lookup semantics and export-pack validation", async () => {
    assert.deepEqual(normalizeIssues([{ message: "check", severity: "warning" }]), [
      {
        code: "validation_issue",
        path: "vault.json",
        message: "check",
        severity: "warning",
      },
    ]);
    assert.equal(inferEntityKind("goal_sleep"), "goal");
    assert.equal(inferEntityKind("current"), "core");
    assert.equal(inferEntityKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1"), "provider");
    assert.equal(isQueryableRecordId("goal_sleep"), true);
    assert.equal(isVaultQueryableRecordId("goal_sleep"), true);
    assert.equal(describeLookupConstraint("goal_sleep"), null);
    assert.equal(describeLookupConstraint("journal:2026-04-08"), null);
    assert.equal(toJournalLookupId("2026-04-08"), "journal:2026-04-08");

    assert.deepEqual(asEntityEnvelope("./vault", toGenericShowEntity(sampleQueryRecord()), "missing"), {
      vault: "./vault",
      entity: toGenericShowEntity(sampleQueryRecord()),
    });
    assert.deepEqual(asListEnvelope("./vault", { limit: 2, status: null }, [1, 2]), {
      vault: "./vault",
      filters: { limit: 2, status: null },
      items: [1, 2],
      count: 2,
      nextCursor: null,
    });

    assert.equal(recordPath({ relativePath: "bank/events/evt.md" }), "bank/events/evt.md");
    assert.equal(recordPath({ document: { relativePath: "raw/documents/doc.pdf" } }), "raw/documents/doc.pdf");
    assert.equal(recordPath({}), undefined);

    const scaffold = buildScaffoldPayload("goal");
    assert.equal(typeof scaffold, "object");
    assert.ok(scaffold && typeof scaffold === "object");
    assert.throws(() => buildScaffoldPayload("does-not-exist"), VaultCliError);
    assert.deepEqual(assertNoReservedPayloadKeys({ title: "ok" }), undefined);
    assert.throws(() => assertNoReservedPayloadKeys({ vault: "x" }), VaultCliError);
    assert.deepEqual(optionalStringArray([" alpha ", "beta"], "field"), ["alpha", "beta"]);
    assert.throws(() => optionalStringArray(["", "beta"], "field"), VaultCliError);
    assert.deepEqual(requirePayloadObjectField({ payload: { ok: true } }, "payload"), { ok: true });

    assert.deepEqual(
      buildEntityLinks({
        data: {
          relatedIds: ["goal_1", "goal_1", "prov_1"],
          sourceEventIds: ["evt_1"],
          snapshotId: "profile_1",
        },
      }),
      [
        { id: "goal_1", kind: "goal", queryable: true },
        { id: "prov_1", kind: "provider", queryable: true },
        { id: "evt_1", kind: "event", queryable: true },
        { id: "profile_1", kind: "entity", queryable: false },
      ],
    );

    const entity = sampleQueryRecord({
      family: "goal",
      kind: "goal",
      entityId: "goal_1",
      attributes: { relatedIds: ["goal_1"] },
      relatedIds: ["goal_1"],
    });
    assert.equal(toGenericShowEntity(entity).kind, "goal");
    assert.equal(toGenericListItem(entity).kind, "goal");
    assert.equal(
      Array.isArray(toGenericShowEntity(entity).links),
      true,
    );
    assert.equal(matchesGenericKindFilter(entity, "profile"), false);

    const tempDir = await mkdtemp(path.join(tmpdir(), "vault-usecases-export-pack-"));
    try {
      await materializeExportPack(tempDir, [
        { path: "nested/file.txt", contents: "hello" },
      ]);
      assert.equal(await readFile(path.join(tempDir, "nested/file.txt"), "utf8"), "hello");
      await assert.rejects(
        () => materializeExportPack(tempDir, [{ path: "../escape.txt", contents: "nope" }]),
        { code: "invalid_export_pack" },
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("normalize vault helper strings and paths", () => {
    assert.equal(inferVaultLinkKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1"), "entity");
    assert.equal(inferVaultLinkKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1", { includeProviderIds: true }), "provider");
    assert.equal(normalizeOptionalText("  hello  "), "hello");
    assert.equal(normalizeOptionalText("   "), null);
    assert.equal(normalizeIsoTimestamp("2026-04-08T12:00:00.000Z"), "2026-04-08T12:00:00.000Z");
    assert.equal(normalizeIsoTimestamp("2026-04-08"), null);
    assert.deepEqual(normalizeStringArray([" a ", "b", 1]), ["a", "b"]);
    assert.deepEqual(stringArray([" a ", "", "b"]), [" a ", "b"]);
    assert.deepEqual(uniqueStrings([" a ", "a", "b", " "]), [" a ", "a", "b", " "]);
    assert.deepEqual(mergeByRelativePath(
      [{ relativePath: "a.md", title: "old" }],
      [{ relativePath: "a.md", title: "new" }, { relativePath: "b.md", title: "other" }],
    ), [
      { relativePath: "a.md", title: "new" },
      { relativePath: "b.md", title: "other" },
    ]);
    assert.deepEqual(compactObject({ a: 1, b: undefined, c: null }), { a: 1, c: null });
    assert.deepEqual(relativePathEntries([{ relativePath: "x.md" }]), ["x.md"]);
  });
});

describe("record patching and duration helpers", () => {
  test("applyRecordPatch merges file, set, and clear edits", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "vault-usecases-record-patch-"));
    const patchPath = path.join(tempDir, "patch.json");

    try {
      await writeFile(patchPath, JSON.stringify({
        details: { summary: "updated", note: "keep" },
        extra: true,
      }), "utf8");

      const fromFilePatch = await applyRecordPatch({
        record: {
          title: "Original",
          details: { summary: "old", note: "old" },
          removed: "yes",
        },
        inputFile: `@${patchPath}`,
        set: ["title=Updated", "details.count=2", "details.flags.0=true"],
          clear: ["details.note"],
          patchLabel: "record payload",
      });
      assert.equal(fromFilePatch.record.title, "Updated");
      assert.deepEqual(fromFilePatch.record.details, {
        summary: "updated",
        count: 2,
        flags: [true],
      });
      assert.equal(fromFilePatch.record.extra, true);
      assert.equal(fromFilePatch.record.removed, "yes");
      assert.deepEqual([...fromFilePatch.clearedFields], []);
      assert.deepEqual([...fromFilePatch.touchedTopLevelFields].sort(), ["details", "extra", "title"]);

      const patched = await applyRecordPatch({
        record: {
          title: "Original",
          removed: "yes",
        },
        set: ["title=Updated"],
        clear: ["removed"],
        patchLabel: "record payload",
      });

      assert.deepEqual([...patched.clearedFields], ["removed"]);
      assert.deepEqual([...patched.touchedTopLevelFields].sort(), ["removed", "title"]);
      assert.deepEqual(computeClearedTopLevelFields({ title: "Original", removed: "yes" }, patched.record), new Set(["removed"]));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("duration helpers handle supported and ambiguous phrases", () => {
    assert.equal(inferDurationMinutes("half hour walk"), 30);
    assert.equal(inferDurationMinutes("1h 30m session"), 90);
    assert.equal(inferDurationMinutes("45 minutes"), 45);
    assert.equal(inferDurationMinutes("1 or 2 hours"), "ambiguous");
    assert.equal(inferDurationMinutes("no duration text"), null);
    assert.equal(validateDurationMinutes(1.2), 1);
    assert.equal(validateDurationMinutes(MAX_DURATION_MINUTES), MAX_DURATION_MINUTES);
    assert.throws(() => validateDurationMinutes(0), VaultCliError);
    assert.throws(() => validateDurationMinutes(MAX_DURATION_MINUTES + 1), VaultCliError);
  });

  test("food autolog helpers keep their output format stable", () => {
    assert.equal(dailyFoodTimeSchema.parse("07:05"), "07:05");
    assert.equal(slugifyFoodLookup("  Acai Bowl!  "), "acai-bowl");
    assert.equal(buildDailyFoodCronExpression("07:05"), "5 7 * * *");
    assert.deepEqual(buildDailyFoodSchedule("07:05"), {
      kind: "dailyLocal",
      localTime: "07:05",
    });
    assert.equal(buildDailyFoodCronJobName("acai-bowl"), "food-daily:acai-bowl");
    assert.equal(buildDailyFoodCronPrompt("Acai Bowl"), 'Auto-log recurring food "Acai Bowl" as a note-only meal.');
    assert.equal(
      renderAutoLoggedFoodMealNote({
        title: "Acai Bowl",
        summary: "Sweet and cold.",
        serving: "1 bowl",
        ingredients: ["açaí", "banana", "", 1, "granola"],
        note: "Keep it simple.",
      }),
      [
        "Acai Bowl",
        "Sweet and cold.",
        "Serving: 1 bowl",
        "Ingredients:\n- açaí\n- banana\n- granola",
        "Keep it simple.",
      ].join("\n\n"),
    );
  });
});

describe("public barrel exports", () => {
  test("keep the package-level barrels wired to the owning modules", () => {
    assert.equal(typeof indexModule.normalizeInputFileOption, "function");
    assert.equal(Object.hasOwn(helpersModule, "applyRecordPatch"), false);
    assert.equal(typeof recordsModule.scaffoldFoodPayload, "function");
    assert.deepEqual(recordsModule.scaffoldFoodPayload(), scaffoldFoodPayload());
    assert.equal(typeof testingModule.applyRecordPatch, "function");
    assert.equal(typeof vaultServicesModule.createIntegratedVaultServices, "function");
    assert.equal(typeof workoutsModule.resolveWorkoutCapture, "function");
    assert.equal(typeof runtimeModule.createRuntimeUnavailableError, "function");
  });
});

describe("record service seams", () => {
  test("document/meal exact reads use their canonical owner while lists use the query runtime", async () => {
    const queryRuntime = {
      readVault: vi.fn(async () => ({ vault: "./vault" })),
      lookupEntityById: vi.fn((_readModel: unknown, lookup: string) =>
        lookup === "doc_1"
          ? sampleQueryRecord({
              kind: "document",
              family: "event",
              entityId: "doc_1",
              primaryLookupId: "doc_1",
              path: "raw/documents/doc_1/document.md",
              attributes: { documentPath: "raw/documents/doc_1/manifest.json" },
            })
          : lookup === "meal_1"
            ? sampleQueryRecord({
                kind: "meal",
                family: "event",
                entityId: "meal_1",
                primaryLookupId: "meal_1",
                path: "raw/meals/meal_1/meal.md",
                attributes: {
                  documentPath: "raw/meals/meal_1/manifest.json",
                  nutrition: {
                    totals: {
                      calories: 620,
                      proteinGrams: 40,
                      carbsGrams: 48,
                      fatGrams: 26,
                      fiberGrams: 8,
                    },
                    provenance: {
                      source: "estimated",
                      confidence: "medium",
                    },
                  },
                },
              })
            : lookup === "meal_photo_1"
              ? sampleQueryRecord({
                  kind: "meal",
                  family: "event",
                  entityId: "meal_1",
                  primaryLookupId: "meal_1",
                  path: "raw/meals/meal_1/meal.md",
                  attributes: {
                    documentPath: "raw/meals/meal_1/manifest.json",
                  },
                })
            : null,
      ),
      listEntities: vi.fn(() => [
        sampleQueryRecord({
          kind: "document",
          family: "event",
          entityId: "doc_1",
          primaryLookupId: "doc_1",
          path: "raw/documents/doc_1/document.md",
          attributes: { documentPath: "raw/documents/doc_1/manifest.json" },
        }),
      ]),
    };
    const editEventRecord = vi.fn(async (input: { lookup: string }) => ({
      lookupId: input.lookup,
      record: queryRuntime.lookupEntityById({}, input.lookup)!,
    }));
    const deleteEventRecord = vi.fn(async () => ({ lookupId: "meal_1", deleted: true }));
    const readOwnedEventRecord = vi.fn(async (input: { lookup: string; kind: string }) => {
      const readModel = await queryRuntime.readVault();
      const record = queryRuntime.lookupEntityById(readModel, input.lookup);
      if (!record || record.kind !== input.kind) {
        throw new VaultCliError('not_found', `No ${input.kind} found for "${input.lookup}".`)
      }
      return { event: record.attributes, ledgerFile: record.path, record };
    });

    const documentMeal = await importWithMocks<
      typeof import("../src/usecases/document-meal-read.ts")
    >("../src/usecases/document-meal-read.ts", {
      "../src/commands/query-record-command-helpers.ts": mockActualModule(
        "../src/commands/query-record-command-helpers.ts",
        (actual) => ({
          ...actual,
          loadQueryRuntime: vi.fn(async () => queryRuntime),
        }),
      ),
      "../src/usecases/event-record-mutations.ts": () => ({
        editEventRecord,
        deleteEventRecord,
      }),
      "../src/usecases/exact-event-record.ts": () => ({
        readOwnedEventRecord,
      }),
    });

    const shownDocument = await documentMeal.showDocumentRecord("./vault", "doc_1");
    assert.equal(shownDocument.vault, "./vault");
    assert.equal(shownDocument.entity.id, "doc_1");
    assert.equal(shownDocument.entity.kind, "document");
    const listedDocuments = await documentMeal.listDocumentRecords({
      vault: "./vault",
      from: "2026-04-01",
      to: "2026-04-30",
    });
    assert.deepEqual(listedDocuments, {
      vault: "./vault",
      filters: {
        kind: "document",
        from: "2026-04-01",
        to: "2026-04-30",
        limit: 10,
      },
      count: 1,
      nextCursor: null,
      items: [
        {
          id: "doc_1",
          kind: "document",
          title: "Daily note",
          occurredAt: "2026-04-08T12:00:00.000Z",
          path: "raw/documents/doc_1/document.md",
          excerpt: "Recorded details.",
          data: {
            documentPath: "raw/documents/doc_1/manifest.json",
          },
          links: [],
        },
      ],
    });
    const editedDocument = await documentMeal.editDocumentRecord({
      vault: "./vault",
      lookup: "doc_1",
      set: ["title=Updated"],
    });
    assert.equal(editedDocument.vault, "./vault");
    assert.equal(editedDocument.entity.id, "doc_1");
    const shownMeal = await documentMeal.showMealRecord("./vault", "meal_1");
    assert.equal(shownMeal.entity.id, "meal_1");
    await assert.rejects(
      () => documentMeal.showMealRecord("./vault", "meal_photo_1"),
      (error: unknown) => {
        const errorObject = asObject(error);
        return error instanceof Error &&
          errorObject?.code === "not_found" &&
          error.message === 'No meal found for "meal_photo_1".';
      },
    );
    assert.deepEqual(shownMeal.entity.data.nutrition, {
      totals: {
        calories: 620,
        proteinGrams: 40,
        carbsGrams: 48,
        fatGrams: 26,
        fiberGrams: 8,
      },
      provenance: {
        source: "estimated",
        confidence: "medium",
      },
    });
    const editedMeal = await documentMeal.editMealRecord({
      vault: "./vault",
      lookup: "meal_1",
      set: ["note=Updated meal note"],
    });
    assert.equal(editedMeal.entity.id, "meal_1");
    assert.deepEqual(editedMeal.entity.data.nutrition, {
      totals: {
        calories: 620,
        proteinGrams: 40,
        carbsGrams: 48,
        fatGrams: 26,
        fiberGrams: 8,
      },
      provenance: {
        source: "estimated",
        confidence: "medium",
      },
    });
    assert.deepEqual(await documentMeal.deleteMealRecord({ vault: "./vault", lookup: "meal_1" }), {
      lookupId: "meal_1",
      deleted: true,
    });

    assert.equal(editEventRecord.mock.calls.length, 2);
    assert.equal(deleteEventRecord.mock.calls.length, 1);
  });

  test("event mutations require the requested id to identify the event directly", async () => {
    const queryRuntime = {
      readVault: vi.fn(async () => ({ vault: "./vault" })),
      lookupEntityById: vi.fn((_readModel: unknown, lookup: string) =>
        lookup === "media_1"
          ? sampleQueryRecord({
              kind: "activity_session",
              family: "event",
              entityId: "evt_1",
              primaryLookupId: "evt_1",
              lookupIds: ["evt_1", "media_1"],
              path: "ledger/events/2026/2026-03.jsonl",
              attributes: {
                id: "evt_1",
                kind: "activity_session",
                title: "Ride",
                occurredAt: "2026-03-12T12:00:00.000Z",
              },
            })
          : null,
      ),
    };
    const upsertEvent = vi.fn();
    const deleteEvent = vi.fn();
    const eventMutations = await importWithMocks<
      typeof import("../src/usecases/event-record-mutations.ts")
    >("../src/usecases/event-record-mutations.ts", {
      "../src/query-runtime.ts": mockActualModule("../src/query-runtime.ts", (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => queryRuntime),
      })),
      "../src/runtime-import.ts": mockActualModule("../src/runtime-import.ts", (actual) => ({
        ...actual,
        loadRuntimeModule: vi.fn(async () => ({
          upsertEvent,
          deleteEvent,
        })),
      })),
    });

    await assert.rejects(
      () =>
        eventMutations.editEventRecord({
          vault: "./vault",
          lookup: "media_1",
          entityLabel: "event",
          set: ["title=Updated"],
        }),
      (error: unknown) =>
        error instanceof Error &&
        asObject(error)?.code === "not_found" &&
        error.message === 'No event found for "media_1".',
    );
    await assert.rejects(
      () =>
        eventMutations.deleteEventRecord({
          vault: "./vault",
          lookup: "media_1",
          entityLabel: "event",
        }),
      (error: unknown) =>
        error instanceof Error &&
        asObject(error)?.code === "not_found" &&
        error.message === 'No event found for "media_1".',
    );
    assert.equal(upsertEvent.mock.calls.length, 0);
    assert.equal(deleteEvent.mock.calls.length, 0);
  });

  test("document and workout manifest reads resolve vault-owned manifests through the shared path-safe seam", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "vault-usecases-manifest-read-"));
    const documentId = "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const workoutEventId = "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const workoutImportId = "xfm_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const documentManifestFile = `raw/documents/2026/04/${documentId}/manifest.json`;
    const workoutManifestFile = `raw/workouts/2026/04/${workoutEventId}/manifest.json`;

    try {
      await writeManifestFile(
        vaultRoot,
        documentManifestFile,
        createRawImportManifest({
          importId: documentId,
          importKind: "document",
          ownerKind: "document",
          rawDirectory: `raw/documents/2026/04/${documentId}`,
          relativePath: `raw/documents/2026/04/${documentId}/report.pdf`,
          originalFileName: "report.pdf",
          mediaType: "application/pdf",
        }),
      );
      await writeManifestFile(
        vaultRoot,
        workoutManifestFile,
        createRawImportManifest({
          importId: workoutImportId,
          importKind: "workout_batch",
          ownerKind: "workout",
          rawDirectory: `raw/workouts/2026/04/${workoutEventId}`,
          relativePath: `raw/workouts/2026/04/${workoutEventId}/workout.csv`,
          originalFileName: "workout.csv",
          mediaType: "text/csv",
        }),
      );

      const queryRuntime = {
        readVault: vi.fn(async () => ({ vault: vaultRoot })),
        lookupEntityById: vi.fn((_readModel: unknown, lookup: string) =>
          lookup === documentId
            ? sampleQueryRecord({
                kind: "document",
                family: "event",
                entityId: documentId,
                primaryLookupId: documentId,
                path: `raw/documents/${documentId}/document.md`,
                attributes: { documentPath: documentManifestFile },
              })
            : lookup === workoutEventId
              ? sampleQueryRecord({
                  kind: "activity_session",
                  family: "event",
                  entityId: workoutEventId,
                  primaryLookupId: workoutEventId,
                  path: `bank/events/${workoutEventId}.md`,
                  attributes: {
                    rawRefs: [`raw/workouts/2026/04/${workoutEventId}/workout.csv`],
                  },
                })
              : null,
        ),
      };
      const { documentMeal, workoutRead } = await loadManifestReadUsecases(queryRuntime);

      const shownDocumentManifest = await documentMeal.showDocumentManifest(vaultRoot, documentId);
      assert.equal(shownDocumentManifest.manifestFile, documentManifestFile);
      assert.equal(shownDocumentManifest.manifest.importId, documentId);

      const shownWorkoutManifest = await workoutRead.showWorkoutManifest(vaultRoot, workoutEventId);
      assert.equal(shownWorkoutManifest.manifestFile, workoutManifestFile);
      assert.equal(shownWorkoutManifest.manifest.importKind, "workout_batch");
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("document and workout manifest reads fail closed when canonical path attributes escape the vault root", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "vault-usecases-manifest-escape-"));

    try {
      const queryRuntime = {
        readVault: vi.fn(async () => ({ vault: vaultRoot })),
        lookupEntityById: vi.fn((_readModel: unknown, lookup: string) =>
          lookup === "doc_escape"
            ? sampleQueryRecord({
                kind: "document",
                family: "event",
                entityId: "doc_escape",
                primaryLookupId: "doc_escape",
                path: "raw/documents/doc_escape/document.md",
                attributes: { documentPath: "../outside/manifest.json" },
              })
            : lookup === "evt_escape"
              ? sampleQueryRecord({
                  kind: "activity_session",
                  family: "event",
                  entityId: "evt_escape",
                  primaryLookupId: "evt_escape",
                  path: "bank/events/evt_escape.md",
                  attributes: {
                    rawRefs: ["../outside/workout.csv"],
                  },
                })
              : null,
        ),
      };
      const { documentMeal, workoutRead } = await loadManifestReadUsecases(queryRuntime);

      await assert.rejects(
        () => documentMeal.showDocumentManifest(vaultRoot, "doc_escape"),
        {
          name: "VaultCliError",
          code: "invalid_path",
          message: 'Vault-relative path "../outside/manifest.json" escapes the selected vault root.',
        },
      );
      await assert.rejects(
        () => workoutRead.showWorkoutManifest(vaultRoot, "evt_escape"),
        {
          name: "VaultCliError",
          code: "invalid_path",
          message: 'Vault-relative path "../outside/workout.csv" escapes the selected vault root.',
        },
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("shared raw import manifest reader preserves missing and invalid manifest errors", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "vault-usecases-manifest-errors-"));
    const invalidJsonManifestFile = "raw/documents/2026/04/doc_invalid_json/manifest.json";
    const arrayManifestFile = "raw/documents/2026/04/doc_array/manifest.json";
    const schemaMismatchManifestFile = "raw/documents/2026/04/doc_schema/manifest.json";

    try {
      await writeManifestFile(vaultRoot, invalidJsonManifestFile, {
        schemaVersion: "murph.raw-import-manifest.v1",
      });
      await writeFile(
        path.join(vaultRoot, invalidJsonManifestFile),
        "{\n",
        "utf8",
      );

      await mkdir(path.dirname(path.join(vaultRoot, arrayManifestFile)), { recursive: true });
      await writeFile(
        path.join(vaultRoot, arrayManifestFile),
        `${JSON.stringify(["not", "an", "object"], null, 2)}\n`,
        "utf8",
      );

      await writeManifestFile(vaultRoot, schemaMismatchManifestFile, {
        schemaVersion: "murph.raw-import-manifest.v1",
        importId: "doc_schema",
      });

      await assert.rejects(
        () => readRawImportManifest(vaultRoot, "raw/documents/2026/04/doc_missing/manifest.json"),
        {
          name: "VaultCliError",
          code: "manifest_missing",
          message: 'Manifest file "raw/documents/2026/04/doc_missing/manifest.json" is missing from the vault.',
        },
      );

      await assert.rejects(
        () => readRawImportManifest(vaultRoot, invalidJsonManifestFile),
        {
          name: "VaultCliError",
          code: "manifest_invalid",
          message: `Manifest file "${invalidJsonManifestFile}" is not valid JSON.`,
        },
      );

      await assert.rejects(
        () => readRawImportManifest(vaultRoot, arrayManifestFile),
        {
          name: "VaultCliError",
          code: "manifest_invalid",
          message: `Manifest file "${arrayManifestFile}" must contain a JSON object.`,
        },
      );

      await assert.rejects(
        () => readRawImportManifest(vaultRoot, schemaMismatchManifestFile),
        {
          name: "VaultCliError",
          code: "manifest_invalid",
          message: `Manifest file "${schemaMismatchManifestFile}" does not match the raw import manifest contract.`,
        },
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("provider, recipe, and food persistence seams use the runtime module", async () => {
    const providerCore = {
      upsertProvider: vi.fn(async () => ({
        providerId: "prov_1",
        relativePath: "providers/prov_1.md",
        created: true,
      })),
    };
    const foodCore = {
      upsertFood: vi.fn(async () => ({
        created: true,
        record: { foodId: "food_1", relativePath: "foods/food_1.md" },
      })),
      readFood: vi.fn(async () => ({
        foodId: "food_1",
        slug: "regular-acai-bowl",
        title: "Regular Acai Bowl",
        status: "active",
        nutrition: {
          perServing: {
            calories: 540,
            proteinGrams: 11,
            carbsGrams: 68,
            fatGrams: 24,
            fiberGrams: 11,
          },
          provenance: {
            source: "estimated",
            confidence: "medium",
            sourceDetail: "Neighborhood menu plus standard granola serving.",
          },
        },
        relativePath: "foods/food_1.md",
        markdown: "# Food",
      })),
      listFoods: vi.fn(async () => [
        {
          foodId: "food_1",
          slug: "regular-acai-bowl",
          title: "Regular Acai Bowl",
          status: "active",
          nutrition: {
            perServing: {
              calories: 540,
              proteinGrams: 11,
              carbsGrams: 68,
              fatGrams: 24,
              fiberGrams: 11,
            },
            provenance: {
              source: "estimated",
              confidence: "medium",
              sourceDetail: "Neighborhood menu plus standard granola serving.",
            },
          },
          relativePath: "foods/food_1.md",
          markdown: "# Food",
        },
      ]),
    };
    const recipeCore = {
      upsertRecipe: vi.fn(async () => ({
        created: true,
        record: { recipeId: "rcp_1", relativePath: "recipes/rcp_1.md" },
      })),
      readRecipe: vi.fn(async () => ({
        recipeId: "rcp_1",
        slug: "sheet-pan-salmon-bowls",
        title: "Sheet Pan Salmon Bowls",
        status: "saved",
        relativePath: "recipes/rcp_1.md",
        markdown: "# Recipe",
      })),
      listRecipes: vi.fn(async () => []),
    };

    const provider = await importWithMocks<typeof import("../src/usecases/provider-event.ts")>(
      "../src/usecases/provider-event.ts",
      {
        "../src/runtime-import.ts": mockActualModule(
          "../src/runtime-import.ts",
          (actual) => ({
            ...actual,
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") {
                return providerCore;
              }
              throw new Error(`Unexpected specifier: ${specifier}`);
            }),
          }),
        ),
      },
    );
    assert.deepEqual(await provider.upsertProviderRecord({
      vault: "./vault",
      payload: provider.scaffoldProviderPayload(),
    }), {
      vault: "./vault",
      providerId: "prov_1",
      lookupId: "prov_1",
      path: "providers/prov_1.md",
      created: true,
    });
    assert.equal(provider.parseProviderPayload(provider.scaffoldProviderPayload()).title, "Primary Care Clinic");
    assert.equal(provider.scaffoldEventPayload("note").kind, "note");

    const food = await importWithMocks<typeof import("../src/usecases/food.ts")>(
      "../src/usecases/food.ts",
      {
        "../src/runtime-import.ts": mockActualModule("../src/runtime-import.ts", (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") {
              return foodCore;
            }
            throw new Error(`Unexpected specifier: ${specifier}`);
          }),
        })),
      },
    );
    assert.deepEqual(await food.upsertFoodRecord({
      vault: "./vault",
      payload: food.scaffoldFoodPayload(),
    }), {
      vault: "./vault",
      foodId: "food_1",
      lookupId: "food_1",
      path: "foods/food_1.md",
      created: true,
    });
    assert.equal(typeof food.scaffoldFoodPayload, "function");
    const shownFood = await food.showFoodRecord("./vault", "food_1");
    assert.deepEqual(shownFood.entity.data.nutrition, {
      perServing: {
        calories: 540,
        proteinGrams: 11,
        carbsGrams: 68,
        fatGrams: 24,
        fiberGrams: 11,
      },
      provenance: {
        source: "estimated",
        confidence: "medium",
        sourceDetail: "Neighborhood menu plus standard granola serving.",
      },
    });
    const listedFoods = await food.listFoodRecords({
      vault: "./vault",
      limit: 10,
    });
    assert.deepEqual(listedFoods.items[0]?.data.nutrition, {
      perServing: {
        calories: 540,
        proteinGrams: 11,
        carbsGrams: 68,
        fatGrams: 24,
        fiberGrams: 11,
      },
      provenance: {
        source: "estimated",
        confidence: "medium",
        sourceDetail: "Neighborhood menu plus standard granola serving.",
      },
    });

    const recipe = await importWithMocks<typeof import("../src/usecases/recipe.ts")>(
      "../src/usecases/recipe.ts",
      {
        "../src/runtime-import.ts": mockActualModule("../src/runtime-import.ts", (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") {
              return recipeCore;
            }
            throw new Error(`Unexpected specifier: ${specifier}`);
          }),
        })),
      },
    );
    assert.deepEqual(await recipe.upsertRecipeRecord({
      vault: "./vault",
      payload: recipe.scaffoldRecipePayload(),
    }), {
      vault: "./vault",
      recipeId: "rcp_1",
      lookupId: "rcp_1",
      path: "recipes/rcp_1.md",
      created: true,
    });
    assert.equal(recipe.parseRecipePayload(recipe.scaffoldRecipePayload()).title, "Sheet Pan Salmon Bowls");
  });

  test("food edit clearing attached regimens does not preserve related regimen links", async () => {
    const foodCore = {
      upsertFood: vi.fn(async (_input: Record<string, unknown>) => ({
        created: false,
        record: {
          foodId: "food_01JNV44P4R5SWC90K2AHXQJQYT",
          relativePath: "foods/regular-acai-bowl.md",
        },
      })),
      readFood: vi.fn(async () => ({
        foodId: "food_01JNV44P4R5SWC90K2AHXQJQYT",
        slug: "regular-acai-bowl",
        title: "Regular Acai Bowl",
        status: "active",
        attachedRegimenIds: ["reg_01JNV422Y2M5ZBV64ZP4N1DRB1"],
        links: [{ type: "related_regimen", targetId: "reg_01JNV422Y2M5ZBV64ZP4N1DRB1" }],
        relativePath: "foods/food_1.md",
        markdown: "# Food",
      })),
    };

    const food = await importWithMocks<typeof import("../src/usecases/food.ts")>(
      "../src/usecases/food.ts",
      {
        "../src/runtime-import.ts": mockActualModule("../src/runtime-import.ts", (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") {
              return foodCore;
            }
            throw new Error(`Unexpected specifier: ${specifier}`);
          }),
        })),
      },
    );

    await food.editFoodRecord({
      vault: "./vault",
      lookup: "food_01JNV44P4R5SWC90K2AHXQJQYT",
      clear: ["attachedRegimenIds"],
    });

    expect(foodCore.upsertFood).toHaveBeenCalledWith(
      expect.objectContaining({
        attachedRegimenIds: [],
      }),
    );
    const upsertInput = foodCore.upsertFood.mock.calls[0]?.[0];
    assert.ok(upsertInput);
    expect(upsertInput).not.toHaveProperty("links");
  });

  test("private protocol listing filters by Health Commons protocol references", async () => {
    const query = {
      ...queryRuntime,
      readVault: vi.fn(async () =>
        createVaultReadModel({
          vaultRoot: "./vault",
          entities: [],
        })
      ),
      listProtocolSummaries: vi.fn((): ProtocolSummary[] => [
        {
          id: "protocol_1",
          slug: "sauna-private",
          title: "Sauna Private",
          status: "active",
          commonsProtocolRef: {
            key: "hc:protocol/finnish-sauna",
            pageRevisionId: "sha256:1",
            runSpecRevisionId: "sha256:2",
          },
          effectiveSpec: null,
          effectiveSpecHash: null,
          path: "bank/protocols/sauna.md",
          protocolRevisionId: null,
          summary: null,
          tags: [],
          updatedAt: null,
        },
        {
          id: "protocol_2",
          slug: "sleep-private",
          title: "Sleep Private",
          status: "active",
          commonsProtocolRef: {
            key: "hc:protocol/sleep-extension",
            pageRevisionId: "sha256:3",
            runSpecRevisionId: "sha256:4",
          },
          effectiveSpec: null,
          effectiveSpecHash: null,
          path: "bank/protocols/sleep.md",
          protocolRevisionId: null,
          summary: null,
          tags: [],
          updatedAt: null,
        },
      ]),
    } satisfies QueryRuntimeModule;
    const services = createExplicitHealthQueryServices(async () => ({
      query,
    }));

    const result = await services.listPrivateProtocols({
      vault: "./vault",
      commonsProtocol: "finnish-sauna",
      limit: 10,
      requestId: null,
    });

    expect(result.filters).toEqual({
      commonsProtocol: "finnish-sauna",
      limit: 10,
    });
    expect(result.protocols.map((protocol) => protocol.protocolId)).toEqual([
      "protocol_1",
    ]);
  });

  test("intervention and experiment journal services keep their event and journal wiring stable", async () => {
    const eventUpsert = vi.fn(async () => ({
      eventId: "evt_1",
      lookupId: "evt_1",
      ledgerFile: "events/evt_1.md",
      created: true,
    }));
    const eventDelete = vi.fn(async () => ({ deleted: true }));
    const eventShow = vi.fn(async () => ({
      vault: "./vault",
      entity: {
        id: "evt_1",
        kind: "intervention_session",
        title: "Edited",
        occurredAt: null,
        path: "events/evt_1.md",
        markdown: null,
        data: {},
        links: [],
      },
    }));
    const eventEdit = vi.fn(async () => ({ lookupId: "evt_1" }));
    const intervention = await importWithMocks<typeof import("../src/usecases/intervention.ts")>(
      "../src/usecases/intervention.ts",
      {
        "../src/usecases/event-record-mutations.ts": () => ({
          deleteEventRecord: eventDelete,
          editEventRecord: eventEdit,
        }),
        "../src/usecases/provider-event.ts": () => ({
          upsertEventRecord: eventUpsert,
          deleteEventRecord: eventDelete,
          showEventRecord: eventShow,
          editEventRecord: eventEdit,
        }),
      },
    );
    const addedIntervention = await intervention.addInterventionRecord({
      vault: "./vault",
      text: "20 minute red light sauna session",
    });
    expect(addedIntervention).toMatchObject({
      eventId: "evt_1",
      lookupId: "evt_1",
      ledgerFile: "events/evt_1.md",
      created: true,
      occurredAt: expect.any(String),
      kind: "intervention_session",
      title: "20-minute red light sauna",
      interventionType: "red-light-sauna",
      durationMinutes: 20,
      note: "20 minute red light sauna session",
    });
    expect("protocolId" in addedIntervention).toBe(false);
    const editedIntervention = await intervention.editInterventionRecord({
      vault: "./vault",
      lookup: "evt_1",
      set: ["title=Edited"],
    });
    assert.equal(editedIntervention.vault, "./vault");
    assert.equal(editedIntervention.entity.id, "evt_1");
    assert.deepEqual(await intervention.deleteInterventionRecord({ vault: "./vault", lookup: "evt_1" }), { deleted: true });

    const journalCore = {
      createExperiment: vi.fn(async () => ({
        created: true,
        experiment: {
          id: "exp_1",
          slug: "focus-sprint",
          relativePath: "experiments/focus-sprint.md",
        },
      })),
      ensureJournalDay: vi.fn(async () => ({
        created: true,
        relativePath: "journals/2026-04-08.md",
      })),
      appendJournal: vi.fn(async () => ({
        relativePath: "journals/2026-04-08.md",
        created: false,
        updated: true,
      })),
      updateExperiment: vi.fn(async () => ({
        experimentId: "exp_1",
        slug: "focus-sprint",
        relativePath: "experiments/focus-sprint.md",
        status: "active",
        updated: true,
      })),
      stopExperiment: vi.fn(async () => ({
        experimentId: "exp_1",
        slug: "focus-sprint",
        relativePath: "experiments/focus-sprint.md",
        status: "stopped",
        eventId: "evt_2",
        ledgerFile: "events/evt_2.md",
        updated: true,
      })),
      linkJournalEventIds: vi.fn(async () => ({
        relativePath: "journals/2026-04-08.md",
        created: true,
        changed: 1,
        eventIds: ["evt_1"],
        sampleStreams: [],
      })),
      unlinkJournalEventIds: vi.fn(async () => ({
        relativePath: "journals/2026-04-08.md",
        created: true,
        changed: 1,
        eventIds: [],
        sampleStreams: [],
      })),
      linkJournalStreams: vi.fn(async () => ({
        relativePath: "journals/2026-04-08.md",
        created: true,
        changed: 1,
        eventIds: [],
        sampleStreams: ["heart_rate"],
      })),
      unlinkJournalStreams: vi.fn(async () => ({
        relativePath: "journals/2026-04-08.md",
        created: true,
        changed: 1,
        eventIds: [],
        sampleStreams: [],
      })),
      updateVaultSummary: vi.fn(async () => ({
        metadataFile: "metadata.json",
        corePath: "core.md",
        title: "Vault",
        timezone: "UTC",
        updatedAt: "2026-04-08T12:00:00.000Z",
        updated: true,
      })),
    };
    const journalQuery = {
      readVault: vi.fn(async () => ({
        metadata: {
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_1",
          title: "Vault",
          timezone: "UTC",
          createdAt: "2026-04-08T12:00:00.000Z",
        },
        coreDocument: {
          path: "core.md",
          title: "Core",
          occurredAt: "2026-04-08T11:00:00.000Z",
        },
        entities: [],
        experiments: [],
        journalEntries: [],
        events: [],
        samples: [],
        audits: [],
        assessments: [],
        goals: [],
        conditions: [],
        allergies: [],
        protocols: [],
        familyMembers: [],
        geneticVariants: [],
        foods: [],
        habitatAspects: [],
        recipes: [],
        providers: [],
        workoutFormats: [],
        byFamily: {},
      })),
      lookupEntityById: vi.fn(() => sampleQueryRecord({
        entityId: "exp_1",
        primaryLookupId: "exp_1",
        family: "experiment",
        kind: "experiment",
      })),
      listEntities: vi.fn(() => [sampleQueryRecord({
        entityId: "exp_1",
        primaryLookupId: "exp_1",
        family: "experiment",
        kind: "experiment",
      })]),
      listMetricPoints: vi.fn(async () => {
        throw new Error("Experiment follow-up should not read metric points.");
      }),
      listMetricPointsBatch: vi.fn(async () => {
        throw new Error("Experiment follow-up should not read metric points.");
      }),
      decideExperimentFollowupDue: vi.fn(() => ({
        schema: "murph.experiment-followup-due.v1",
        kind: "missed-log",
        action: "notify",
        reason: "planned_session_log_missing",
        date: "2026-04-08",
        dedupeKey: "experiment-followup:exp_1:missed-log:2026-04-08",
        experiment: {
          id: "exp_1",
          slug: "focus-sprint",
          status: "active",
          title: "Focus Sprint",
        },
        window: {
          sessionDate: "2026-04-08",
          baselineStart: null,
          baselineEnd: null,
          interventionStart: null,
          interventionEnd: null,
        },
      })),
      showVaultSummary: vi.fn(async () => ({ title: "Vault", timezone: "UTC" })),
      showVaultStats: vi.fn(async () => ({ vault: "./vault" })),
    };

    const journal = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/runtime-import.ts": mockActualModule("../src/runtime-import.ts", (actual) => ({
        ...actual,
        loadRuntimeModule: vi.fn(async (specifier: string) => {
          if (specifier === "@murphai/core") {
            return journalCore;
          }
          throw new Error(`Unexpected specifier: ${specifier}`);
        }),
      })),
      "../src/query-runtime.ts": mockActualModule("../src/query-runtime.ts", (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => journalQuery),
      })),
    });
    assert.deepEqual(await journal.createExperimentRecord({ vault: "./vault", slug: "focus-sprint" }), {
      vault: "./vault",
      experimentId: "exp_1",
      lookupId: "exp_1",
      slug: "focus-sprint",
      experimentPath: "experiments/focus-sprint.md",
      created: true,
    });
    assert.deepEqual(await journal.ensureJournalRecord({ vault: "./vault", date: "2026-04-08" }), {
      vault: "./vault",
      lookupId: "journal:2026-04-08",
      journalPath: "journals/2026-04-08.md",
      created: true,
    });
    assert.deepEqual(await journal.appendJournalText({ vault: "./vault", date: "2026-04-08", text: "Hello" }), {
      vault: "./vault",
      date: "2026-04-08",
      lookupId: "journal:2026-04-08",
      journalPath: "journals/2026-04-08.md",
      created: false,
      updated: true,
    });
    expect(await journal.showExperimentRecord("./vault", "exp_1")).toMatchObject({
      vault: "./vault",
      entity: {
        id: "exp_1",
        kind: "experiment",
      },
    });
    expect(await journal.listExperimentRecords({ vault: "./vault", limit: 5 })).toMatchObject({
      vault: "./vault",
      filters: {
        status: null,
        limit: 5,
      },
      count: 1,
      nextCursor: null,
      items: [
        {
          id: "exp_1",
          kind: "experiment",
        },
      ],
    });
    expect(await journal.showExperimentFollowupDue({
      vault: "./vault",
      lookup: "exp_1",
      kind: "missed-log",
      date: "2026-04-08",
    })).toMatchObject({
      experimentId: "exp_1",
      lookupId: "exp_1",
      slug: "focus-sprint",
      kind: "missed-log",
      decision: {
        action: "notify",
      },
    });
    expect(journalQuery.listMetricPoints).not.toHaveBeenCalled();

    const anchoredExperimentId = "exp_01JNV4458HYPP53JDQCBP1QJAN";
    const anchoredExperiment = sampleQueryRecord({
      entityId: anchoredExperimentId,
      primaryLookupId: anchoredExperimentId,
      family: "experiment",
      recordClass: "bank",
      kind: "experiment",
      status: "active",
      experimentSlug: "glucose-anchors",
      attributes: {
        schemaVersion: "murph.frontmatter.experiment.v1",
        docType: "experiment",
        experimentId: anchoredExperimentId,
        slug: "glucose-anchors",
        status: "active",
        title: "Glucose Anchors",
        startedOn: "2026-06-01",
        runPlan: {
          baselineStart: "2026-06-01",
          baselineEnd: "2026-06-03",
          interventionStart: "2026-06-04",
          interventionEnd: "2026-06-18",
        },
        analysisPlan: {
          primaryBiomarkerKey: "biomarker:blood-glucose",
          desiredDirection: "decrease",
          measurementAnchors: [
            {
              role: "baseline",
              kind: "wearable_summary",
              recordId: "metric_sample_glucose_baseline",
              biomarkerKeys: ["biomarker:blood-glucose"],
              observedOn: "2026-05-29",
            },
            {
              role: "followup",
              kind: "wearable_summary",
              recordId: "metric_sample_glucose_followup",
              biomarkerKeys: ["biomarker:blood-glucose"],
              observedOn: "2026-06-18",
            },
          ],
        },
      },
    });
    const anchoredMetricPointFilters: unknown[] = [];
    const anchoredMetricQuery = {
      readVault: vi.fn(async () => journalQuery.readVault()),
      lookupEntityById: vi.fn(() => anchoredExperiment),
      listMetricPoints: vi.fn(async (_vault: string, filters: unknown) => {
        anchoredMetricPointFilters.push(filters);
        return [];
      }),
      listMetricPointsBatch: vi.fn(async (_vault: string, filtersList: readonly unknown[]) => {
        anchoredMetricPointFilters.push(...filtersList);
        return [];
      }),
      normalizeMetricKey: queryRuntime.normalizeMetricKey,
      resolveMetricDefinition: queryRuntime.resolveMetricDefinition,
      resolveMetricDefinitionForBiomarker: queryRuntime.resolveMetricDefinitionForBiomarker,
      summarizeExperimentProgress: vi.fn(() => ({
        schemaVersion: "murph.experiment-progress.v1",
        asOf: "2026-06-18",
        experiment: {
          id: anchoredExperimentId,
          slug: "glucose-anchors",
          status: "active",
          title: "Glucose Anchors",
        },
        phase: "review_due",
        windows: {
          baselineStart: "2026-06-01",
          baselineEnd: "2026-06-03",
          interventionStart: "2026-06-04",
          interventionEnd: "2026-06-18",
        },
        setupReadiness: { status: "ready", blockingReasons: [] },
        analysisReadiness: { status: "ready", blockingReasons: [] },
        dataCoverage: {
          status: "ready_for_review",
          baselineDaysAvailable: 1,
          interventionDaysAvailable: 1,
          primaryBiomarkerKey: "biomarker:blood-glucose",
          primaryMetricDaysAvailable: 2,
          wearableProviders: [],
        },
        adherence: {
          completedSessions: 0,
          expectedSessionsByNow: null,
          minimumUsefulSessions: null,
          status: "unknown",
          targetSessions: null,
        },
        signals: [],
        earlySignals: [],
        confounders: [],
        recommendation: null,
        commonsProtocolRef: null,
        protocolRef: null,
      })),
    };
    const anchoredJournal = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/query-runtime.ts": mockActualModule("../src/query-runtime.ts", (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => anchoredMetricQuery),
      })),
    });
    await anchoredJournal.showExperimentProgress({
      vault: "./vault",
      lookup: "glucose-anchors",
      asOf: "2026-06-18",
    });
    expect(anchoredMetricPointFilters).toEqual([
      {
        limit: null,
        metricKey: "glucose",
        to: "2026-06-18",
      },
    ]);

    assert.deepEqual(await journal.showVaultSummary("./vault"), {
      vault: "./vault",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_1",
      title: "Vault",
      timezone: "UTC",
      createdAt: "2026-04-08T12:00:00.000Z",
      corePath: "core.md",
      coreTitle: "Core",
      coreUpdatedAt: "2026-04-08T11:00:00.000Z",
    });
    assert.deepEqual(await journal.updateVaultSummary({ vault: "./vault", title: "Vault" }), {
      vault: "./vault",
      metadataFile: "metadata.json",
      corePath: "core.md",
      title: "Vault",
      timezone: "UTC",
      updatedAt: "2026-04-08T12:00:00.000Z",
      updated: true,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T01:02:03.000Z"));
    try {
      const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFM";
      const closeoutConflict = Object.assign(
        new Error("Experiment changed during outcome analysis."),
        { code: "EXPERIMENT_REVISION_CONFLICT" },
      );
      const writeExperimentOutcome = vi.fn().mockImplementation(async (input: {
          relativePath: string;
          outcome: Record<string, unknown> & {
            experiment: Record<string, unknown>;
          };
        }) => ({
          experimentId,
          slug: "focus-sprint",
          relativePath: input.relativePath,
          status: "active",
          outcome: {
            ...input.outcome,
            conclusion: {
              caveats: ["This is the already-saved result."],
              headline: "The immutable saved conclusion.",
              plainLanguage: "Later analysis does not replace this artifact.",
            },
            generatedAt: "2026-04-09T01:02:03.000Z",
            schema: "murph.experiment-outcome.v2",
          },
          outcomePath: "bank/experiments/outcomes/focus-sprint-2026-04-08.json",
          updatedExperiment: true,
        }));
      const experimentOutcomeCore = {
        withCanonicalWriteLock: vi.fn(async (
          _vaultRoot: string | undefined,
          run: () => Promise<unknown>,
        ) => run()),
        readReferencedExperimentOutcome: vi
          .fn()
          .mockRejectedValueOnce(closeoutConflict)
          .mockResolvedValue(null),
        writeExperimentOutcome,
      };
      const experimentOutcomeQuery = {
        readVault: vi.fn(async () => journalQuery.readVault()),
        lookupEntityById: vi.fn(() => ({
          entityId: experimentId,
          primaryLookupId: experimentId,
          lookupIds: [experimentId],
          family: "experiment",
          recordClass: "bank",
          kind: "experiment",
          status: "active",
          occurredAt: "2026-04-08T12:00:00.000Z",
          date: "2026-04-08",
          path: "experiments/focus-sprint.md",
          title: "Focus Sprint",
          body: "---\n",
          attributes: {
            schemaVersion: "murph.frontmatter.experiment.v1",
            docType: "experiment",
            experimentId,
            slug: "focus-sprint",
            status: "active",
            title: "Focus Sprint",
            startedOn: "2026-04-01",
          },
          links: [],
          relatedIds: [],
          stream: null,
          experimentSlug: "focus-sprint",
          tags: [],
          frontmatter: null,
        })),
        listMetricPoints: vi.fn(async () => []),
        listMetricPointsBatch: vi.fn(async () => []),
        analyzeExperimentOutcome: vi.fn(() => ({
          schemaVersion: "murph.experiment-outcome.v2",
          schema: "murph.experiment-outcome.v2",
          asOf: "2026-04-08",
          adherenceSummary: {
            adherenceLevel: "good",
            completedSessions: 8,
            minimumUsefulSessions: 6,
            status: "on_track",
            targetSessions: 10,
          },
          conclusion: {
            caveats: [],
            headline: "Headline",
            plainLanguage: "Plain language",
          },
          confidence: {
            level: "medium",
            reasons: [],
          },
          confounders: [],
          experiment: {
            id: experimentId,
            slug: "focus-sprint",
            status: "active",
            title: "Focus Sprint",
          },
          commonsProtocolRef: null,
          metricResults: [],
          protocolRef: null,
          windows: {
            baselineEnd: null,
            baselineStart: null,
            interventionEnd: null,
            interventionStart: null,
          },
        })),
      };

      const outcomeJournal = await importWithMocks<
        typeof import("../src/usecases/experiment-journal-vault.ts")
      >("../src/usecases/experiment-journal-vault.ts", {
        "@murphai/core": mockActualModule("@murphai/core", (actual) => actual),
        "../src/runtime-import.ts": mockActualModule("../src/runtime-import.ts", (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") {
              return experimentOutcomeCore;
            }

            throw new Error(`Unexpected specifier: ${specifier}`);
          }),
        })),
        "../src/query-runtime.ts": mockActualModule("../src/query-runtime.ts", (actual) => ({
          ...actual,
          loadQueryRuntime: vi.fn(async () => experimentOutcomeQuery),
        })),
      });

      const result = await outcomeJournal.writeExperimentOutcomeRecord({
        vault: "./vault",
        lookup: "exp_1",
      });

      expect(result).toMatchObject({
        vault: "./vault",
        experimentId,
        lookupId: experimentId,
        slug: "focus-sprint",
        asOf: "2026-04-08",
        outcomePath: "bank/experiments/outcomes/focus-sprint-2026-04-08.json",
        updatedExperiment: true,
        outcome: {
          schemaVersion: "murph.experiment-outcome.v2",
          generatedAt: "2026-04-09T01:02:03.000Z",
          outcomeId: `${experimentId}-outcome-2026-04-08`,
          schema: "murph.experiment-outcome.v2",
          conclusion: {
            caveats: ["This is the already-saved result."],
            headline: "The immutable saved conclusion.",
            plainLanguage: "Later analysis does not replace this artifact.",
          },
        },
      });
      expect(experimentOutcomeCore.readReferencedExperimentOutcome).toHaveBeenCalledTimes(2);
      expect(experimentOutcomeCore.writeExperimentOutcome).toHaveBeenCalledTimes(1);
      expect(experimentOutcomeCore.withCanonicalWriteLock).toHaveBeenCalledTimes(2);
      const closeoutInput = experimentOutcomeCore.writeExperimentOutcome.mock.calls[0]?.[0];
      expect(closeoutInput).toMatchObject({
        relativePath: "experiments/focus-sprint.md",
        expectedFrontmatter: {
          experimentId,
          slug: "focus-sprint",
          status: "active",
        },
        outcome: {
          outcomeId: `${experimentId}-outcome-2026-04-08`,
          asOf: "2026-04-08",
        },
      });
    } finally {
      vi.useRealTimers();
    }

    assert.equal(eventUpsert.mock.calls.length, 1);
    assert.equal(eventDelete.mock.calls.length, 1);
    assert.equal(eventEdit.mock.calls.length, 1);
    assert.equal(journalCore.createExperiment.mock.calls.length, 1);
    assert.equal(journalCore.ensureJournalDay.mock.calls.length, 1);
  });
});
