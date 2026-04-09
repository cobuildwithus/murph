import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { healthEntityDefinitions } from "@murphai/contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import * as helperApi from "@murphai/vault-usecases/helpers";
import {
  applyLimit,
  compareByLatest,
  compareNullableDates,
  firstString,
  matchesDateRange,
} from "../src/commands/query-record-command-helpers.ts";
import {
  asEntityEnvelope,
  asListEnvelope,
  assertNoReservedPayloadKeys,
  buildEntityLinks,
  buildScaffoldPayload,
  describeLookupConstraint,
  inferEntityKind,
  isQueryableRecordId,
  materializeExportPack,
  normalizeIssues,
  optionalStringArray,
  recordPath,
  requirePayloadObjectField,
  toGenericListItem,
  toGenericShowEntity,
  matchesGenericKindFilter,
  toJournalLookupId,
} from "../src/usecases/shared.ts";
import {
  compactObject,
  inferVaultLinkKind,
  mergeByRelativePath,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  normalizeStringArray,
  relativePathEntries,
  resolveVaultRelativePath,
  stringArray,
  toEventUpsertVaultCliError,
  toVaultCliError,
  toVaultMetadataCliError,
  toVaultUpgradeCliError,
  uniqueStrings,
} from "../src/usecases/vault-usecase-helpers.ts";
import type { QueryEntity } from "../src/query-runtime.ts";

function createQueryRecord(overrides: Partial<QueryEntity> = {}): QueryEntity {
  return {
    entityId: "goal_a",
    primaryLookupId: "goal_a",
    lookupIds: ["goal_a"],
    family: "goal",
    recordClass: "bank",
    kind: "goal",
    status: null,
    occurredAt: "2026-04-08T00:00:00Z",
    date: "2026-04-08",
    path: "bank/goals/goal-a.md",
    title: "Goal A",
    body: null,
    attributes: {},
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: [],
    ...overrides,
  };
}

describe("helper barrel exports", () => {
  it("re-exports stable helper functions from the public helper seam", () => {
    expect(helperApi.applyLimit).toBe(applyLimit);
    expect(helperApi.compareByLatest).toBe(compareByLatest);
    expect(helperApi.compareNullableDates).toBe(compareNullableDates);
    expect(helperApi.firstString).toBe(firstString);
    expect(helperApi.matchesDateRange).toBe(matchesDateRange);
    expect(helperApi.assertNoReservedPayloadKeys).toBe(assertNoReservedPayloadKeys);
    expect(helperApi.compactObject).toBe(compactObject);
    expect(helperApi.mergeByRelativePath).toBe(mergeByRelativePath);
    expect(helperApi.normalizeIsoTimestamp).toBe(normalizeIsoTimestamp);
    expect(helperApi.normalizeOptionalText).toBe(normalizeOptionalText);
    expect(helperApi.normalizeStringArray).toBe(normalizeStringArray);
    expect(helperApi.uniqueStrings).toBe(uniqueStrings);
  });

  it("keeps helper behavior stable through the public helper barrel", () => {
    expect(helperApi.normalizeOptionalText("  hello  ")).toBe("hello");
    expect(helperApi.normalizeOptionalText("   ")).toBeNull();
    expect(helperApi.normalizeIsoTimestamp("2026-04-08T12:34:56Z")).toBe(
      "2026-04-08T12:34:56Z",
    );
    expect(helperApi.normalizeIsoTimestamp("2026-04-08")).toBeNull();
    expect(helperApi.normalizeStringArray([" sleep ", "sleep", "", 1])).toEqual([
      "sleep",
    ]);
    expect(helperApi.uniqueStrings(["goal", "goal", "sleep"])).toEqual(["goal", "sleep"]);

    expect(
      helperApi.mergeByRelativePath(
        [{ relativePath: "bank/goals/sleep.md", title: "old" }],
        [
          { relativePath: "bank/goals/sleep.md", title: "new" },
          { relativePath: "bank/goals/energy.md", title: "energy" },
        ],
      ),
    ).toEqual([
      { relativePath: "bank/goals/sleep.md", title: "new" },
      { relativePath: "bank/goals/energy.md", title: "energy" },
    ]);

    expect(helperApi.compactObject({ keep: 1, drop: undefined, text: "ok" })).toEqual({
      keep: 1,
      text: "ok",
    });

    expect(helperApi.applyLimit([1, 2, 3], 2)).toEqual([1, 2]);
    expect(helperApi.applyLimit([1, 2, 3])).toEqual([1, 2, 3]);
    expect(helperApi.matchesDateRange("2026-04-08T12:34:56Z", "2026-04-01", "2026-04-30")).toBe(
      true,
    );
    expect(helperApi.matchesDateRange("2026-03-30T12:34:56Z", "2026-04-01")).toBe(false);
    expect(helperApi.compareNullableDates("2026-04-08", "2026-04-09")).toBeLessThan(0);
    expect(
      helperApi.compareByLatest(
        createQueryRecord({
          entityId: "goal_a",
          occurredAt: "2026-04-08T00:00:00Z",
          primaryLookupId: "goal_a",
          title: "A",
        }),
        createQueryRecord({
          entityId: "goal_b",
          lookupIds: ["goal_b"],
          occurredAt: "2026-04-07T00:00:00Z",
          path: "bank/goals/goal-b.md",
          primaryLookupId: "goal_b",
          title: "B",
        }),
      ),
    ).toBeLessThan(0);
    expect(helperApi.firstString({ title: " Sleep ", summary: "ignored" }, ["title"])).toBe(
      "Sleep",
    );
  });

  it("fails closed when callers try to set reserved payload fields", () => {
    expect(() =>
      helperApi.assertNoReservedPayloadKeys({
        lookupId: "goal_sleep",
      }),
    ).toThrowError(VaultCliError);
    expect(() =>
      helperApi.assertNoReservedPayloadKeys({
        lookupId: "goal_sleep",
      }),
    ).toThrow("Payload file may not set reserved field: lookupId.");
  });

  it("covers the shared helper branches and vault-usecase helper branches", async () => {
    expect(normalizeIssues()).toEqual([]);
    expect(
      normalizeIssues([
        {
          code: "123",
          path: undefined,
          message: undefined,
          severity: "warning",
        },
        {
          severity: "info",
        },
      ]),
    ).toEqual([
      {
        code: "123",
        path: "vault.json",
        message: "Validation issue.",
        severity: "warning",
      },
      {
        code: "validation_issue",
        path: "vault.json",
        message: "Validation issue.",
        severity: "error",
      },
    ]);

    expect(inferEntityKind("current")).toBe("core");
    expect(inferEntityKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1")).toBe("provider");
    expect(inferEntityKind("xfm_01JNV422Y2M5ZBV64ZP4N1DRB1")).toBe("transform");
    expect(inferEntityKind("unknown_lookup")).toBe("entity");
    expect(isQueryableRecordId("current")).toBe(true);
    expect(isQueryableRecordId("xfm_01JNV422Y2M5ZBV64ZP4N1DRB1")).toBe(false);
    expect(describeLookupConstraint("prov_01JNV422Y2M5ZBV64ZP4N1DRB1")).toBeNull();
    expect(describeLookupConstraint("xfm_01JNV422Y2M5ZBV64ZP4N1DRB1")).toContain("import batch");

    expect(
      asEntityEnvelope("./vault", toGenericShowEntity(createQueryRecord()), "missing entity"),
    ).toEqual({
      vault: "./vault",
      entity: toGenericShowEntity(createQueryRecord()),
    });
    expect(() => asEntityEnvelope("./vault", null, "missing entity")).toThrowError(VaultCliError);
    expect(asListEnvelope("./vault", { limit: 10, status: "open" }, [1, 2, 3])).toEqual({
      vault: "./vault",
      filters: { limit: 10, status: "open" },
      items: [1, 2, 3],
      count: 3,
      nextCursor: null,
    });

    expect(recordPath({ relativePath: "bank/goals/goal-a.md" })).toBe("bank/goals/goal-a.md");
    expect(recordPath({ document: { relativePath: "bank/goals/goal-b.md" } })).toBe(
      "bank/goals/goal-b.md",
    );
    expect(recordPath({})).toBeUndefined();

    expect(buildScaffoldPayload("goal")).toEqual(
      healthEntityDefinitions.find((entry) => entry.noun === "goal")?.scaffoldTemplate,
    );

    expect(
      buildEntityLinks({
        data: {
          relatedIds: ["evt_2"],
          eventIds: ["evt_2"],
          sourceAssessmentIds: ["assess_1"],
          sourceEventIds: ["evt_3"],
          topGoalIds: ["goal_1"],
          relatedGoalIds: ["goal_2"],
          relatedConditionIds: ["condition_1"],
          relatedProtocolIds: ["protocol_1"],
          relatedExperimentIds: ["exp_1"],
          sourceFamilyMemberIds: ["family_1"],
          relatedVariantIds: ["variant_1"],
          snapshotId: "current",
          parentGoalId: "goal_parent",
        },
        relatedIds: ["evt_1", "evt_1", "xfm_1"],
      }),
    ).toEqual([
      { id: "evt_1", kind: inferEntityKind("evt_1"), queryable: isQueryableRecordId("evt_1") },
      { id: "xfm_1", kind: inferEntityKind("xfm_1"), queryable: isQueryableRecordId("xfm_1") },
      { id: "evt_2", kind: inferEntityKind("evt_2"), queryable: isQueryableRecordId("evt_2") },
      {
        id: "assess_1",
        kind: inferEntityKind("assess_1"),
        queryable: isQueryableRecordId("assess_1"),
      },
      { id: "evt_3", kind: inferEntityKind("evt_3"), queryable: isQueryableRecordId("evt_3") },
      { id: "goal_1", kind: inferEntityKind("goal_1"), queryable: isQueryableRecordId("goal_1") },
      { id: "goal_2", kind: inferEntityKind("goal_2"), queryable: isQueryableRecordId("goal_2") },
      {
        id: "condition_1",
        kind: inferEntityKind("condition_1"),
        queryable: isQueryableRecordId("condition_1"),
      },
      {
        id: "protocol_1",
        kind: inferEntityKind("protocol_1"),
        queryable: isQueryableRecordId("protocol_1"),
      },
      { id: "exp_1", kind: inferEntityKind("exp_1"), queryable: isQueryableRecordId("exp_1") },
      {
        id: "family_1",
        kind: inferEntityKind("family_1"),
        queryable: isQueryableRecordId("family_1"),
      },
      {
        id: "variant_1",
        kind: inferEntityKind("variant_1"),
        queryable: isQueryableRecordId("variant_1"),
      },
      { id: "current", kind: inferEntityKind("current"), queryable: isQueryableRecordId("current") },
      {
        id: "goal_parent",
        kind: inferEntityKind("goal_parent"),
        queryable: isQueryableRecordId("goal_parent"),
      },
    ]);

    expect(inferVaultLinkKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1")).toBe("entity");
    expect(
      inferVaultLinkKind("prov_01JNV422Y2M5ZBV64ZP4N1DRB1", { includeProviderIds: true }),
    ).toBe("provider");
    expect(normalizeOptionalText(undefined)).toBeNull();
    expect(normalizeOptionalText("  hello  ")).toBe("hello");
    expect(normalizeIsoTimestamp("2026-04-08T12:34:56Z")).toBe("2026-04-08T12:34:56Z");
    expect(normalizeIsoTimestamp("2026-04-08")).toBeNull();
    expect(normalizeStringArray([" sleep ", "sleep", "", 1])).toEqual(["sleep"]);
    expect(normalizeStringArray("sleep")).toBeUndefined();
    expect(stringArray([" sleep ", "", "wake", 1])).toEqual([" sleep ", "wake"]);
    expect(relativePathEntries([{ relativePath: " bank/goals/goal-a.md " }, {}, null])).toEqual([
      "bank/goals/goal-a.md",
    ]);
    expect(
      mergeByRelativePath(
        [{ relativePath: "bank/goals/goal-a.md", title: "old" }],
        [
          { relativePath: "bank/goals/goal-a.md", title: "new" },
          { relativePath: "bank/goals/goal-b.md", title: "goal b" },
        ],
      ),
    ).toEqual([
      { relativePath: "bank/goals/goal-a.md", title: "new" },
      { relativePath: "bank/goals/goal-b.md", title: "goal b" },
    ]);
    expect(compactObject({ keep: 1, drop: undefined, text: "ok" })).toEqual({
      keep: 1,
      text: "ok",
    });

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-helper-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-helper-outside-"));

    try {
      await mkdir(path.join(vaultRoot, "journal"), { recursive: true });
      await mkdir(path.join(vaultRoot, "bank"), { recursive: true });
      await symlink(outsideRoot, path.join(vaultRoot, "bank", "providers"));

      expect(await resolveVaultRelativePath(vaultRoot, "journal/2026-03-17.md")).toBe(
        path.join(vaultRoot, "journal", "2026-03-17.md"),
      );

      await expect(resolveVaultRelativePath(vaultRoot, "../escape.md")).rejects.toMatchObject({
        name: "VaultCliError",
        code: "invalid_path",
        message: 'Vault-relative path "../escape.md" escapes the selected vault root.',
      });

      await expect(
        resolveVaultRelativePath(vaultRoot, "bank/providers/labcorp.md"),
      ).rejects.toMatchObject({
        name: "VaultCliError",
        code: "invalid_path",
        message:
          'Vault-relative path "bank/providers/labcorp.md" may not traverse symbolic links inside the selected vault root.',
      });
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }

    expect(
      toVaultCliError(
        Object.assign(new Error("Need upgrade"), {
          name: "VaultError",
          code: "VAULT_UPGRADE_REQUIRED",
          details: { severity: "high" },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: "vault_error",
        context: expect.objectContaining({
          vaultCode: "VAULT_UPGRADE_REQUIRED",
          severity: "high",
        }),
      }),
    );

    const passthrough = new Error("boom");
    expect(toVaultCliError(passthrough)).toBe(passthrough);

    expect(
      toEventUpsertVaultCliError(
        Object.assign(new Error("Bad event"), {
          name: "VaultError",
          code: "EVENT_CONTRACT_INVALID",
          details: { field: "kind" },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: "contract_invalid",
        context: expect.objectContaining({
          vaultCode: "EVENT_CONTRACT_INVALID",
          field: "kind",
        }),
      }),
    );

    expect(
      toVaultMetadataCliError(
        Object.assign(new Error("Need metadata"), {
          name: "VaultError",
          code: "VAULT_INVALID_METADATA",
        }),
      ),
    ).toEqual(expect.objectContaining({ code: "invalid_metadata" }));

    expect(
      toVaultUpgradeCliError(
        Object.assign(new Error("Need upgrade"), {
          name: "VaultError",
          code: "VAULT_UPGRADE_UNSUPPORTED",
        }),
      ),
    ).toEqual(expect.objectContaining({ code: "upgrade_unsupported" }));
  });

  it("covers the public helper payload branches and generic entity rendering helpers", async () => {
    expect(optionalStringArray(undefined, "tags")).toBeUndefined();
    expect(optionalStringArray([" sleep ", "wake"], "tags")).toEqual(["sleep", "wake"]);
    expect(() => optionalStringArray("sleep", "tags")).toThrowError(VaultCliError);
    expect(() => optionalStringArray(["sleep", ""], "tags")).toThrowError(VaultCliError);

    expect(requirePayloadObjectField({ payload: { title: "ok" } }, "payload")).toEqual({
      title: "ok",
    });
    expect(() => requirePayloadObjectField({ payload: [] }, "payload")).toThrowError(VaultCliError);

    const tempDir = await mkdtemp(path.join(tmpdir(), "murph-export-pack-"));

    try {
      await materializeExportPack(tempDir, [{ path: "nested/file.txt", contents: "ok" }]);
      expect(await readFile(path.join(tempDir, "nested", "file.txt"), "utf8")).toBe("ok");

      await expect(
        materializeExportPack(tempDir, [{ path: "/absolute.txt", contents: "nope" }]),
      ).rejects.toMatchObject({
        name: "VaultCliError",
        code: "invalid_export_pack",
      });

      await expect(
        materializeExportPack(tempDir, [{ path: "../escape.txt", contents: "nope" }]),
      ).rejects.toMatchObject({
        name: "VaultCliError",
        code: "invalid_export_pack",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    const goalRecord = createQueryRecord({
      entityId: "goal_1",
      primaryLookupId: "goal_1",
      lookupIds: ["goal_1"],
      family: "goal",
      recordClass: "bank",
      kind: "goal",
      path: "bank/goals/goal-1.md",
      attributes: { goalId: "goal_1" },
    });
    const bloodTest = createQueryRecord({
      entityId: "evt_1",
      primaryLookupId: "evt_1",
      lookupIds: ["evt_1"],
      family: "event",
      recordClass: "ledger",
      kind: "test",
      path: "ledger/events/2026/2026-04.jsonl",
      attributes: {
        testCategory: "blood",
        relatedIds: ["goal_1"],
      },
      relatedIds: ["goal_1"],
    });
    const audit = createQueryRecord({
      entityId: "aud_1",
      primaryLookupId: "aud_1",
      lookupIds: ["aud_1"],
      family: "audit",
      recordClass: "ledger",
      kind: "audit",
      path: "audit/entry.md",
    });

    expect(toGenericShowEntity(goalRecord).kind).toBe("goal");
    expect(toGenericListItem(goalRecord).kind).toBe("goal");
    expect(toGenericShowEntity(bloodTest).kind).toBe("blood_test");
    expect(matchesGenericKindFilter(goalRecord)).toBe(true);
    expect(matchesGenericKindFilter(audit)).toBe(false);
    expect(matchesGenericKindFilter(goalRecord, "goal")).toBe(true);
    expect(matchesGenericKindFilter(bloodTest, "blood_test")).toBe(true);
    expect(matchesGenericKindFilter(audit, "audit")).toBe(true);
    expect(toJournalLookupId("2026-04-08")).toBe("journal:2026-04-08");
  });

  it("covers the remaining helper edge branches with direct behavior assertions", async () => {
    expect(inferEntityKind("goal_sleep")).toBe("goal");
    expect(isQueryableRecordId("pack_01JNV422Y2M5ZBV64ZP4N1DRB1")).toBe(false);
    expect(describeLookupConstraint("pack_01JNV422Y2M5ZBV64ZP4N1DRB1")).toContain(
      "derived exports",
    );

    expect(optionalStringArray(null, "tags")).toBeUndefined();
    expect(optionalStringArray([], "tags")).toBeUndefined();
    expect(() => requirePayloadObjectField({}, "payload")).toThrow(
      'Payload file must include a plain-object "payload" field.',
    );
    expect(() => buildScaffoldPayload("missing")).toThrow(
      "No scaffold template is defined for missing.",
    );

    expect(
      buildEntityLinks({
        relatedIds: ["   "],
        data: {
          relatedIds: [""],
          parentGoalId: "prov_01JNV422Y2M5ZBV64ZP4N1DRB1",
          snapshotId: "   ",
        },
      }),
    ).toEqual([
      {
        id: "prov_01JNV422Y2M5ZBV64ZP4N1DRB1",
        kind: "provider",
        queryable: true,
      },
    ]);

    const symptomEntity = createQueryRecord({
      entityId: "evt_99",
      primaryLookupId: "evt_99",
      lookupIds: ["evt_99"],
      family: "event",
      recordClass: "ledger",
      kind: "symptom",
      path: "ledger/events/2026/2026-04.jsonl",
      body: "Tracked symptoms",
      attributes: {
        parentGoalId: "goal_sleep",
      },
      relatedIds: ["current"],
    });

    expect(toGenericShowEntity(symptomEntity)).toEqual({
      id: "evt_99",
      kind: "symptom",
      title: "Goal A",
      occurredAt: "2026-04-08T00:00:00Z",
      path: "ledger/events/2026/2026-04.jsonl",
      markdown: "Tracked symptoms",
      data: {
        parentGoalId: "goal_sleep",
      },
      links: [
        {
          id: "current",
          kind: "core",
          queryable: true,
        },
        {
          id: "goal_sleep",
          kind: "goal",
          queryable: true,
        },
      ],
    });
    expect(toGenericListItem(symptomEntity)).toEqual(toGenericShowEntity(symptomEntity));
    expect(matchesGenericKindFilter(createQueryRecord({ family: "core", kind: "core" }))).toBe(
      false,
    );
    expect(matchesGenericKindFilter(symptomEntity, "symptom")).toBe(true);
    expect(matchesGenericKindFilter(symptomEntity, "event")).toBe(true);

    expect(normalizeIsoTimestamp("2026-04-08T12:34:56+10:00")).toBe(
      "2026-04-08T12:34:56+10:00",
    );
    expect(stringArray(undefined)).toEqual([]);
    expect(relativePathEntries(undefined)).toEqual([]);
    expect(
      mergeByRelativePath(undefined, [{ relativePath: "bank/goals/goal-c.md", title: "goal c" }]),
    ).toEqual([{ relativePath: "bank/goals/goal-c.md", title: "goal c" }]);
    expect(compactObject({ keep: false, nullable: null, drop: undefined })).toEqual({
      keep: false,
      nullable: null,
    });

    const existingCliError = new VaultCliError("already_cli", "Already mapped.");
    expect(toVaultCliError(existingCliError)).toBe(existingCliError);

    expect(
      toVaultCliError(
        Object.assign(new Error("Bad timestamp"), {
          name: "VaultError",
          code: "INVALID_TIMESTAMP",
          details: { field: "occurredAt" },
        }),
        {
          INVALID_TIMESTAMP: {
            code: "invalid_timestamp",
            message: "Timestamp must be ISO-8601.",
            details: (details) => ({
              field: details.field,
              normalized: true,
            }),
          },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        code: "invalid_timestamp",
        message: "Timestamp must be ISO-8601.",
        context: expect.objectContaining({
          vaultCode: "INVALID_TIMESTAMP",
          field: "occurredAt",
          normalized: true,
        }),
      }),
    );

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-helper-existing-"));

    try {
      await mkdir(path.join(vaultRoot, "journal"), { recursive: true });
      await writeFile(path.join(vaultRoot, "journal", "2026-03-17.md"), "# Journal", "utf8");

      expect(await resolveVaultRelativePath(vaultRoot, "journal/2026-03-17.md")).toBe(
        path.join(vaultRoot, "journal", "2026-03-17.md"),
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
