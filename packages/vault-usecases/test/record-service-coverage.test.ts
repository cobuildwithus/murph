import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

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

type QueryRecord = Parameters<typeof toCommandShowEntity>[0];

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
      ...toCommandShowEntity(record),
      data: {
        ...record.attributes,
        status: "active",
        stream: "stream-a",
      },
      quality: "active",
      stream: "stream-a",
    });

    assert.deepEqual(toAuditCommandListItem(record), {
      ...toCommandShowEntity(record),
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
    assert.equal(inferEntityKind("current"), "entity");
    assert.equal(inferEntityKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1"), "provider");
    assert.equal(isQueryableRecordId("goal_sleep"), true);
    assert.equal(isVaultQueryableRecordId("goal_sleep"), true);
    assert.equal(describeLookupConstraint("goal_sleep"), null);
    assert.equal(describeLookupConstraint("journal:2026-04-08"), null);
    assert.equal(toJournalLookupId("2026-04-08"), "journal:2026-04-08");

    assert.deepEqual(asEntityEnvelope("./vault", sampleQueryRecord(), "missing"), {
      vault: "./vault",
      entity: sampleQueryRecord(),
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
    assert.deepEqual(optionalStringArray([" alpha ", "beta"]), ["alpha", "beta"]);
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
      family: "profile_snapshot",
      kind: "snapshot",
      entityId: "snap_1",
      attributes: { relatedIds: ["goal_1"] },
      relatedIds: ["goal_1"],
    });
    assert.equal(toGenericShowEntity(entity).kind, "profile");
    assert.equal(toGenericListItem(entity).kind, "profile");
    assert.equal(
      Array.isArray(toGenericShowEntity(entity).links),
      true,
    );
    assert.equal(matchesGenericKindFilter(entity, "profile"), true);

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
    assert.deepEqual(buildDailyFoodSchedule("07:05", "America/New_York"), {
      kind: "dailyLocal",
      localTime: "07:05",
      timeZone: "America/New_York",
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
  test("keep the package-level barrels wired to the owning modules", async () => {
    const indexModule = await import("../src/index.ts");
    const helpersModule = await import("../src/helpers.ts");
    const recordsModule = await import("../src/records.ts");
    const runtimeModule = await import("../src/runtime.ts");
    const testingModule = await import("../src/testing.ts");
    const vaultServicesModule = await import("../src/vault-services.ts");
    const workoutsModule = await import("../src/workouts.ts");

    assert.equal(typeof indexModule.normalizeInputFileOption, "function");
    assert.equal(typeof helpersModule.applyRecordPatch, "function");
    assert.equal(typeof recordsModule.scaffoldFoodPayload, "function");
    assert.deepEqual(recordsModule.scaffoldFoodPayload(), scaffoldFoodPayload());
    assert.equal(typeof testingModule.applyRecordPatch, "function");
    assert.equal(typeof vaultServicesModule.createIntegratedVaultServices, "function");
    assert.equal(typeof workoutsModule.resolveWorkoutCapture, "function");
    assert.equal(typeof runtimeModule.createRuntimeUnavailableError, "function");
  });
});

describe("record service seams", () => {
  test("document/meal read wrappers route through the query runtime and event mutations", async () => {
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
                attributes: { documentPath: "raw/meals/meal_1/manifest.json" },
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
    const editEventRecord = vi.fn(async () => ({ lookupId: "doc_1" }));
    const deleteEventRecord = vi.fn(async () => ({ lookupId: "meal_1", deleted: true }));

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
        limit: 50,
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
          markdown: "Recorded details.",
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
    assert.deepEqual(await documentMeal.deleteMealRecord({ vault: "./vault", lookup: "meal_1" }), {
      lookupId: "meal_1",
      deleted: true,
    });

    assert.equal(editEventRecord.mock.calls.length, 1);
    assert.equal(deleteEventRecord.mock.calls.length, 1);
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
        relativePath: "foods/food_1.md",
        markdown: "# Food",
      })),
      listFoods: vi.fn(async () => []),
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

  test("intervention and experiment journal services keep their event and journal wiring stable", async () => {
    const eventUpsert = vi.fn(async () => ({
      eventId: "evt_1",
      lookupId: "evt_1",
      ledgerFile: "events/evt_1.md",
      created: true,
    }));
    const eventDelete = vi.fn(async () => ({ deleted: true }));
    const eventShow = vi.fn(async () => ({ vault: "./vault", entity: sampleQueryRecord({ entityId: "evt_1", primaryLookupId: "evt_1" }) }));
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
      protocolId: null,
      note: "20 minute red light sauna session",
    });
    const editedIntervention = await intervention.editInterventionRecord({
      vault: "./vault",
      lookup: "evt_1",
      set: ["title=Edited"],
    });
    assert.equal(editedIntervention.vault, "./vault");
    assert.equal(editedIntervention.entity.entityId, "evt_1");
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
          formatVersion: 1,
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
        profileSnapshots: [],
        currentProfile: null,
        goals: [],
        conditions: [],
        allergies: [],
        protocols: [],
        history: [],
        familyMembers: [],
        geneticVariants: [],
        foods: [],
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
    assert.deepEqual(await journal.showVaultSummary("./vault"), {
      vault: "./vault",
      formatVersion: 1,
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

    assert.equal(eventUpsert.mock.calls.length, 1);
    assert.equal(eventDelete.mock.calls.length, 1);
    assert.equal(eventEdit.mock.calls.length, 1);
    assert.equal(journalCore.createExperiment.mock.calls.length, 1);
    assert.equal(journalCore.ensureJournalDay.mock.calls.length, 1);
  });
});
