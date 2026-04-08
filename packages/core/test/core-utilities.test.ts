import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, test, vi } from "vitest";

import { canonicalizeEventRelations } from "../src/event-links.ts";
import { VaultError, isVaultError } from "../src/errors.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "../src/frontmatter.ts";
import {
  bulletList,
  compareIsoTimestamps,
  heading,
  maybeSection,
  normalizeId,
  normalizeRelativePathList,
  normalizeSlug,
  normalizeTagList,
  normalizeTimestamp,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requireString,
  validateSortedStringList,
} from "../src/history/shared.ts";
import {
  assertPathWithinVault,
  assertPathWithinVaultOnDisk,
  basenameFromFilePath,
  formatVaultRelativePath,
  isAppendOnlyRelativePath,
  isRawRelativePath,
  normalizeOpaquePathSegment,
  normalizeRelativeVaultPath,
  normalizeVaultRoot,
  resolveVaultPath,
  resolveVaultPathOnDisk,
  sanitizeFileName,
  sanitizePathSegment,
} from "../src/path-safety.ts";
import {
  appendProfileSnapshot,
  buildCurrentProfileMarkdown,
  readCurrentProfileMarkdown,
  readCurrentProfile,
  rebuildCurrentProfile,
  stageCurrentProfileMaterialization,
} from "../src/profile/storage.ts";
import * as markdownDocuments from "../src/markdown-documents.ts";
import { createMarkdownRegistryApi } from "../src/registry/api.ts";
import {
  upsertMarkdownRegistryDocument,
  writeMarkdownRegistryRecord,
} from "../src/registry/markdown.ts";
import { WriteBatch } from "../src/operations/write-batch.ts";
import type { FileChange } from "../src/types.ts";
import {
  coerceDate,
  defaultTimeZone,
  extractIsoDatePrefix,
  normalizeTimeZone,
  requireTimeZone,
  toDateOnly,
  toIsoTimestamp,
  toLocalDayKey,
  toMonthShard,
} from "../src/time.ts";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "murph-core-utilities-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      fs.rm(root, {
        recursive: true,
        force: true,
      })
    ),
  );
});

test("path helpers normalize, format, and classify vault paths", async () => {
  const vaultRoot = await makeTempRoot();

  assert.equal(normalizeVaultRoot(vaultRoot), path.resolve(vaultRoot));
  assert.equal(normalizeRelativeVaultPath("bank\\goals\\sleep.md"), "bank/goals/sleep.md");
  assert.equal(normalizeOpaquePathSegment("Goal-1", "segment"), "Goal-1");
  assert.deepEqual(resolveVaultPath(vaultRoot, "bank/goals/sleep.md"), {
    vaultRoot: path.resolve(vaultRoot),
    relativePath: "bank/goals/sleep.md",
    absolutePath: path.join(path.resolve(vaultRoot), "bank/goals/sleep.md"),
  });
  assert.equal(formatVaultRelativePath(vaultRoot, path.join(vaultRoot, "bank/goals/sleep.md")), "bank/goals/sleep.md");
  assert.equal(isRawRelativePath("raw/documents/file.pdf"), true);
  assert.equal(isRawRelativePath("bank/goals/sleep.md"), false);
  assert.equal(isAppendOnlyRelativePath("audit/2026/2026-04.jsonl"), true);
  assert.equal(isAppendOnlyRelativePath("bank/goals/sleep.md"), false);
  assert.equal(sanitizePathSegment(" Bedtime Consistency! "), "bedtime-consistency");
  assert.equal(basenameFromFilePath("folder/subdir/report.PDF"), "report.PDF");
  assert.equal(sanitizeFileName("folder/My Report 2026.PDF"), "my-report-2026.pdf");

  assert.throws(
    () => normalizeRelativeVaultPath("../escape"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );
  assert.throws(
    () => normalizeRelativeVaultPath("/absolute/path"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );
  assert.throws(
    () => normalizeRelativeVaultPath("bad\u0000path"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );
  assert.throws(
    () => normalizeOpaquePathSegment(" bad ", "segment"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH_SEGMENT",
  );
  assert.throws(
    () => normalizeOpaquePathSegment("a/b", "segment"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH_SEGMENT",
  );
  assert.throws(
    () => normalizeOpaquePathSegment("..", "segment"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH_SEGMENT",
  );
  assert.throws(
    () => normalizeOpaquePathSegment("\u0001bad", "segment"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH_SEGMENT",
  );
  assert.throws(
    () => basenameFromFilePath("folder/subdir/"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_SOURCE_PATH",
  );
  assert.throws(
    () => assertPathWithinVault(vaultRoot, path.join(vaultRoot, "..", "outside.txt")),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_PATH_ESCAPE",
  );
});

test("path helpers validate on-disk roots and block symlink traversal", async () => {
  const vaultRoot = await makeTempRoot();
  const bankDirectory = path.join(vaultRoot, "bank");
  const realDirectory = path.join(vaultRoot, "real");

  await fs.mkdir(realDirectory, { recursive: true });
  await fs.symlink(realDirectory, bankDirectory, "dir");

  await assert.rejects(
    () => assertPathWithinVaultOnDisk(vaultRoot, path.join(vaultRoot, "bank", "goal.md")),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_PATH_SYMLINK" &&
      error.details.relativePath === "bank",
  );

  await assert.doesNotReject(() => assertPathWithinVaultOnDisk(vaultRoot, vaultRoot));

  await assert.rejects(
    () => assertPathWithinVaultOnDisk(path.join(vaultRoot, "missing-root"), path.join(vaultRoot, "missing-root", "item.md")),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_ROOT",
  );

  const nestedRoot = await makeTempRoot();
  await fs.mkdir(path.join(nestedRoot, "bank"), { recursive: true });
  const resolved = await resolveVaultPathOnDisk(nestedRoot, "bank/missing.md");
  assert.equal(resolved.relativePath, "bank/missing.md");
});

test("time helpers normalize dates and time zones and surface invalid input clearly", () => {
  const reference = new Date("2026-04-08T10:15:30.000Z");

  assert.equal(coerceDate(undefined).getTime() > 0, true);
  assert.equal(coerceDate(reference).toISOString(), "2026-04-08T10:15:30.000Z");
  assert.equal(toIsoTimestamp(reference), "2026-04-08T10:15:30.000Z");
  assert.equal(toDateOnly(reference), "2026-04-08");
  assert.equal(toDateOnly("2026-04-08T10:15:30.000Z"), "2026-04-08");
  assert.equal(toDateOnly("2026-04-08"), "2026-04-08");
  assert.equal(toMonthShard(reference), "2026-04");
  assert.equal(normalizeTimeZone(null), undefined);
  assert.equal(normalizeTimeZone(undefined), undefined);
  assert.equal(normalizeTimeZone("Australia/Sydney"), "Australia/Sydney");
  assert.equal(requireTimeZone(null), defaultTimeZone());
  assert.equal(requireTimeZone(undefined), defaultTimeZone());
  assert.equal(toLocalDayKey("2026-04-08", "Australia/Sydney"), "2026-04-08");
  assert.equal(extractIsoDatePrefix("2026-04-08T10:15:30.000Z"), "2026-04-08");
  assert.equal(extractIsoDatePrefix("not-a-date"), null);

  assert.throws(
    () => coerceDate("not-a-date", "occurredAt"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_DATE",
  );
  assert.throws(
    () => normalizeTimeZone("Mars/Olympus", "timeZone"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_TIMEZONE",
  );
  assert.throws(
    () => toLocalDayKey("not-a-date", "Australia/Sydney", "occurredAt"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_DATE",
  );
  assert.throws(
    () => toLocalDayKey(reference, "Mars/Olympus", "occurredAt"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_DATE",
  );
});

test("path helpers reject additional malformed inputs and preserve sanitized fallbacks", () => {
  const vaultRoot = "/vault";

  assert.throws(
    () => normalizeRelativeVaultPath("C:\\vault\\sleep.md"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );
  assert.throws(
    () => normalizeRelativeVaultPath("."),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );
  assert.throws(
    () => normalizeRelativeVaultPath(".."),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );
  assert.throws(
    () => normalizeOpaquePathSegment(123, "segment"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH_SEGMENT",
  );
  assert.throws(
    () => normalizeOpaquePathSegment("C:\\tmp", "segment"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH_SEGMENT",
  );
  assert.equal(sanitizePathSegment("!!!", "fallback"), "fallback");
  assert.equal(sanitizeFileName("!!!.TXT", "artifact"), "artifact.txt");
  assert.equal(basenameFromFilePath("folder\\subdir\\report.PDF"), "report.PDF");
  assert.equal(formatVaultRelativePath(vaultRoot, path.join(vaultRoot, "nested", "note.md")), "nested/note.md");
});

test("history helpers normalize optional values and ordering helpers", () => {
  assert.equal(requireString("  ready  ", "field"), "ready");
  assert.throws(
    () => requireString("", "field"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  assert.throws(
    () => requireString("x".repeat(241), "field"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.equal(optionalString(undefined, "field"), undefined);
  assert.equal(optionalString(null, "field"), undefined);
  assert.equal(optionalString("   ", "field"), undefined);
  assert.equal(optionalString("  value  ", "field"), "value");
  assert.throws(
    () => optionalString("x".repeat(4001), "field"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.equal(optionalBoolean(undefined, "flag"), undefined);
  assert.equal(optionalBoolean(true, "flag"), true);
  assert.throws(
    () => optionalBoolean("true", "flag"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.equal(optionalInteger(undefined, "count"), undefined);
  assert.equal(optionalInteger(3, "count", 1, 5), 3);
  assert.throws(
    () => optionalInteger(1.5, "count"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  assert.throws(
    () => optionalInteger(0, "count", 1),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  assert.throws(
    () => optionalInteger(6, "count", 1, 5),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.equal(optionalEnum(undefined, ["manual", "imported"] as const, "source"), undefined);
  assert.equal(optionalEnum("", ["manual", "imported"] as const, "source"), undefined);
  assert.equal(optionalEnum("manual", ["manual", "imported"] as const, "source"), "manual");
  assert.throws(
    () => optionalEnum(1, ["manual", "imported"] as const, "source"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  assert.throws(
    () => optionalEnum("other", ["manual", "imported"] as const, "source"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.equal(validateSortedStringList(undefined, "items"), undefined);
  assert.equal(validateSortedStringList([], "items"), undefined);
  assert.deepEqual(validateSortedStringList(["beta", "alpha", "beta"], "items"), ["alpha", "beta"]);
  assert.throws(
    () => validateSortedStringList("bad", "items"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.deepEqual(normalizeTagList(["Sleep Focus"], "tags"), ["sleep-focus"]);
  assert.deepEqual(normalizeRelativePathList(["bank\\goals\\sleep.md"], "paths"), ["bank/goals/sleep.md"]);
  assert.equal(normalizeId(undefined, "id", "goal"), undefined);
  assert.equal(normalizeId("goal_01ARZ3NDEKTSV4RRFFQ69G5FAV", "id", "goal"), "goal_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.throws(
    () => normalizeId("goal_bad", "id", "goal"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  assert.equal(normalizeSlug(undefined, "slug", "Fallback Value"), "fallback-value");
  assert.throws(
    () => normalizeSlug("   ", "slug"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  assert.equal(normalizeTimestamp(new Date("2026-04-08T10:15:30.000Z"), "recordedAt"), "2026-04-08T10:15:30.000Z");

  const earlier = {
    occurredAt: "2026-04-07T10:15:30.000Z",
    recordedAt: "2026-04-07T10:15:31.000Z",
    id: "evt_01",
  };
  const later = {
    occurredAt: "2026-04-08T10:15:30.000Z",
    recordedAt: "2026-04-08T10:15:31.000Z",
    id: "evt_02",
  };
  const sameTimesLeft = {
    occurredAt: "2026-04-08T10:15:30.000Z",
    recordedAt: "2026-04-08T10:15:30.000Z",
    id: "evt_01",
  };
  const sameTimesRight = {
    occurredAt: "2026-04-08T10:15:30.000Z",
    recordedAt: "2026-04-08T10:15:30.000Z",
    id: "evt_02",
  };

  assert.ok(compareIsoTimestamps(earlier, later, "asc") < 0);
  assert.ok(compareIsoTimestamps(earlier, later, "desc") > 0);
  assert.ok(compareIsoTimestamps(sameTimesLeft, sameTimesRight, "asc") < 0);
  assert.ok(compareIsoTimestamps(sameTimesLeft, sameTimesRight, "desc") > 0);
  assert.equal(heading("Notes"), "## Notes");
  assert.equal(bulletList(undefined), "- none");
  assert.equal(bulletList(["alpha", "beta"]), "- alpha\n- beta");
  assert.equal(maybeSection("Notes", undefined), "## Notes\n\n- none");
  assert.equal(maybeSection("Notes", "- alpha"), "## Notes\n\n- alpha");
});

test("frontmatter helpers round-trip nested values and reject invalid shapes", () => {
  const markdown = stringifyFrontmatterDocument({
    attributes: {
      title: "Morning Note",
      empty: "",
      enabled: true,
      count: 2,
      nested: {
        tags: ["sleep", "energy"],
        metadata: {
          note: null,
        },
      },
      emptyArray: [],
      emptyObject: {},
    },
    body: "Keep the walks short and consistent.\n",
  });
  const parsed = parseFrontmatterDocument(markdown);

  assert.equal(parsed.attributes.title, "Morning Note");
  assert.deepEqual(parsed.attributes.nested, {
    tags: ["sleep", "energy"],
    metadata: {
      note: null,
    },
  });
  assert.deepEqual(parsed.attributes.emptyArray, []);
  assert.deepEqual(parsed.attributes.emptyObject, {});
  assert.equal(parsed.body, "Keep the walks short and consistent.\n");
  assert.match(markdown, /emptyArray: \[\]/u);
  assert.match(markdown, /emptyObject: \{\}/u);

  assert.throws(
    () =>
      stringifyFrontmatterDocument({
        attributes: {
          "bad key": "value",
        },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_FRONTMATTER_KEY",
  );
  assert.throws(
    () =>
      stringifyFrontmatterDocument({
        attributes: {
          createdAt: 1n as never,
        },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_UNSUPPORTED_FRONTMATTER",
  );
  assert.throws(
    () => stringifyFrontmatterDocument({ attributes: null as never }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_FRONTMATTER",
  );
  assert.throws(
    () => parseFrontmatterDocument("---\n[bad]\n---\nbody"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_FRONTMATTER",
  );
});

test("registry and profile helpers materialize, read, update, and delete markdown records", async () => {
  type RegistryRecord = {
    id: string;
    slug: string;
    relativePath: string;
    markdown: string;
  };

  const vaultRoot = await makeTempRoot();
  const registryDirectory = "library/records";

  await fs.mkdir(path.join(vaultRoot, registryDirectory), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(vaultRoot, registryDirectory, "alpha.md"),
    stringifyFrontmatterDocument({
      attributes: {
        id: "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        slug: "alpha",
      },
      body: "Alpha body\n",
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, registryDirectory, "bravo.md"),
    stringifyFrontmatterDocument({
      attributes: {
        id: "reg_01ARZ3NDEKTSV4RRFFQ69G5FBW",
        slug: "bravo",
      },
      body: "Bravo body\n",
    }),
    "utf8",
  );

  const baseOptions = {
    directory: registryDirectory,
    recordFromParts: (attributes: Record<string, unknown>, relativePath: string, markdown: string): RegistryRecord => ({
      id: String(attributes.id),
      slug: String(attributes.slug),
      relativePath,
      markdown,
    }),
    isExpectedRecord: (record: RegistryRecord) => typeof record.id === "string" && typeof record.slug === "string",
    invalidCode: "MOCK_REGISTRY_INVALID",
    invalidMessage: "Mock registry record is invalid.",
    sortRecords: (records: RegistryRecord[]) => {
      records.sort((left, right) => left.slug.localeCompare(right.slug));
    },
    getRecordId: (record: RegistryRecord) => record.id,
    getRecordSlug: (record: RegistryRecord) => record.slug,
    getRecordRelativePath: (record: RegistryRecord) => record.relativePath,
    conflictCode: "MOCK_REGISTRY_CONFLICT",
    conflictMessage: "Mock registry record is conflicted.",
    readMissingCode: "MOCK_REGISTRY_MISSING",
    readMissingMessage: "Mock registry record is missing.",
    createRecordId: () => "reg_01ARZ3NDEKTSV4RRFFQ69G5F6X",
    operationType: "mock_registry_write",
    summary: (recordId: string) => `Mock registry record ${recordId}`,
    audit: {
      action: "vault_init" as const,
      commandName: "core.mockRegistryWrite",
      summary: (created: boolean, recordId: string) =>
        `${created ? "Created" : "Updated"} mock registry record ${recordId}`,
    },
  };

  const apiWithoutDelete = createMarkdownRegistryApi<RegistryRecord>({
    ...baseOptions,
  });
  await assert.rejects(
    () =>
      apiWithoutDelete.deleteRecord({
        vaultRoot,
        slug: "alpha",
      }),
    (error: unknown) => error instanceof Error && error.message === "Markdown registry delete is not configured for this record type.",
  );

  const api = createMarkdownRegistryApi<RegistryRecord>({
    ...baseOptions,
    deleteOperationType: "mock_registry_delete",
    deleteSummary: (recordId: string) => `Delete mock registry record ${recordId}`,
  });

  const records = await api.listRecords(vaultRoot);
  assert.deepEqual(records.map((record) => record.slug), ["alpha", "bravo"]);

  assert.throws(
    () => api.selectExistingRecord(records, "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV", "bravo"),
    (error: unknown) => error instanceof VaultError && error.code === "MOCK_REGISTRY_CONFLICT",
  );

  assert.equal((await api.resolveExistingRecord({ vaultRoot, slug: "alpha" }))?.slug, "alpha");

  await assert.rejects(
    () =>
      api.readRecord({
        vaultRoot,
        slug: "missing",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "MOCK_REGISTRY_MISSING",
  );

  const created = await api.upsertRecord({
    vaultRoot,
    existingRecord: null,
    requestedSlug: "charlie",
    defaultSlug: "charlie",
    buildDocument: ({ recordId, slug }) => ({
      attributes: {
        id: recordId,
        slug,
      },
      body: "Charlie body\n",
    }),
  });
  assert.equal(created.created, true);
  assert.equal(created.record.slug, "charlie");
  assert.equal(created.record.relativePath, "library/records/charlie.md");
  await assert.doesNotReject(() => fs.access(path.join(vaultRoot, "library/records/charlie.md")));

  const updated = await api.upsertRecord({
    vaultRoot,
    existingRecord: created.record,
    requestedSlug: "delta",
    defaultSlug: "delta",
    allowSlugUpdate: true,
    buildDocument: ({ recordId, slug }) => ({
      attributes: {
        id: recordId,
        slug,
      },
      body: "Delta body\n",
    }),
  });
  assert.equal(updated.created, false);
  assert.equal(updated.record.slug, "delta");
  assert.equal(updated.record.relativePath, "library/records/delta.md");
  await assert.doesNotReject(() => fs.access(path.join(vaultRoot, "library/records/delta.md")));
  await assert.rejects(() => fs.access(path.join(vaultRoot, "library/records/charlie.md")));

  const deleted = await api.deleteRecord({
    vaultRoot,
    slug: "alpha",
  });
  assert.equal(deleted.record.slug, "alpha");
  await assert.rejects(() => fs.access(path.join(vaultRoot, "library/records/alpha.md")));

  const initialCurrent = await readCurrentProfileMarkdown(vaultRoot);
  assert.equal(initialCurrent.exists, false);
  assert.equal(initialCurrent.markdown, null);

  const emptyBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "profile_current_rebuild",
    summary: "Profile current materialization without snapshots",
    occurredAt: "2026-04-08T10:15:30.000Z",
  });
  const emptyMaterialization = await stageCurrentProfileMaterialization(emptyBatch, initialCurrent, null);
  assert.equal(emptyMaterialization.updated, false);
  assert.equal(emptyMaterialization.markdown, null);
  assert.equal(emptyMaterialization.rebuildAudit.summary, "Profile current rebuild found no snapshots to materialize.");

  const appended = await appendProfileSnapshot({
    vaultRoot,
    recordedAt: "2026-04-08T10:15:30.000Z",
    source: "manual",
    profile: {},
  });
  const currentAfterAppend = await readCurrentProfileMarkdown(vaultRoot);
  const expectedMarkdown = buildCurrentProfileMarkdown(appended.snapshot);
  assert.equal(currentAfterAppend.exists, true);
  assert.equal(currentAfterAppend.markdown, expectedMarkdown);

  const deleteBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "profile_current_rebuild",
    summary: "Profile current deletion branch",
    occurredAt: "2026-04-08T10:15:31.000Z",
  });
  const deleteMaterialization = await stageCurrentProfileMaterialization(deleteBatch, currentAfterAppend, null);
  assert.equal(deleteMaterialization.updated, true);
  assert.equal(deleteMaterialization.markdown, null);
  assert.deepEqual(deleteMaterialization.rebuildAudit.changes, [
    {
      path: "bank/profile/current.md",
      op: "update",
    },
  ]);

  const sameBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "profile_current_rebuild",
    summary: "Profile current unchanged branch",
    occurredAt: "2026-04-08T10:15:32.000Z",
  });
  const sameMaterialization = await stageCurrentProfileMaterialization(sameBatch, currentAfterAppend, appended.snapshot);
  assert.equal(sameMaterialization.updated, false);
  assert.equal(sameMaterialization.markdown, expectedMarkdown);
  assert.deepEqual(sameMaterialization.rebuildAudit.changes, []);
});

test("markdown registry wrappers and profile reads cover the remaining branch seams", async () => {
  const vaultRoot = await makeTempRoot();

  await fs.mkdir(path.join(vaultRoot, "library/records"), {
    recursive: true,
  });

  const upsertAuditPath = await upsertMarkdownRegistryDocument({
    vaultRoot,
    operationType: "mock_registry_write",
    summary: "Write markdown registry document",
    relativePath: "library/records/omega.md",
    markdown: "# Omega\n",
    created: true,
    audit: {
      action: "vault_init",
      commandName: "core.mockRegistryWrite",
      summary: "Created mock registry document.",
    },
  });
  await assert.doesNotReject(() => fs.access(path.join(vaultRoot, upsertAuditPath)));

  const writtenRecord = await writeMarkdownRegistryRecord({
    vaultRoot,
    target: {
      recordId: "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "omega",
      relativePath: "library/records/omega-frontmatter.md",
      created: true,
    },
    attributes: {
      id: "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "omega",
    },
    body: "Omega body\n",
    recordFromParts: (attributes: Record<string, unknown>, relativePath: string, markdown: string) => ({
      id: String(attributes.id),
      slug: String(attributes.slug),
      relativePath,
      markdown,
    }),
    operationType: "mock_registry_write",
    summary: "Write markdown registry record",
    audit: {
      action: "vault_init",
      commandName: "core.mockRegistryWrite",
      summary: "Created mock registry record.",
    },
  });

  assert.equal(writtenRecord.record.slug, "omega");
  assert.equal(writtenRecord.record.relativePath, "library/records/omega-frontmatter.md");
  await assert.doesNotReject(() => fs.access(path.join(vaultRoot, writtenRecord.auditPath)));

  const markdownWriteResult = {
    auditPath: null,
    markdown: "# Broken\n",
    write: {
      relativePath: "library/records/broken.md",
      created: true,
      files: ["library/records/broken.md"],
      changes: [
        {
          path: "library/records/broken.md",
          op: "create",
        },
      ],
    },
  } satisfies Awaited<ReturnType<typeof markdownDocuments.writeCanonicalMarkdownDocument>>;

  const frontmatterWriteResult = {
    auditPath: null,
    markdown: "---\nid: reg_01ARZ3NDEKTSV4RRFFQ69G5FAV\nslug: broken\n---\nBroken body\n",
    record: {
      id: "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "broken",
    },
    write: {
      relativePath: "library/records/broken-frontmatter.md",
      created: true,
      files: ["library/records/broken-frontmatter.md"],
      changes: [
        {
          path: "library/records/broken-frontmatter.md",
          op: "create",
        },
      ],
    },
  } satisfies {
    auditPath: string | null;
    markdown: string;
    record: {
      id: string;
      slug: string;
    };
    write: {
      relativePath: string;
      created: boolean;
      files: string[];
      changes: FileChange[];
    };
  };

  const markdownWriteSpy = vi.spyOn(markdownDocuments, "writeCanonicalMarkdownDocument");
  const frontmatterWriteSpy = vi.spyOn(markdownDocuments, "writeCanonicalFrontmatterDocument");

  try {
    markdownWriteSpy.mockResolvedValueOnce(markdownWriteResult);
    await assert.rejects(
      () =>
        upsertMarkdownRegistryDocument({
          vaultRoot,
          operationType: "mock_registry_write",
          summary: "Write markdown registry document",
          relativePath: "library/records/broken.md",
          markdown: "# Broken\n",
          created: true,
          audit: {
            action: "vault_init",
            commandName: "core.mockRegistryWrite",
            summary: "Created mock registry document.",
          },
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Markdown registry upsert audit path was not produced.",
    );

    frontmatterWriteSpy.mockResolvedValueOnce(frontmatterWriteResult);
    await assert.rejects(
      () =>
        writeMarkdownRegistryRecord({
          vaultRoot,
          target: {
            recordId: "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            slug: "broken",
            relativePath: "library/records/broken-frontmatter.md",
            created: true,
          },
          attributes: {
            id: "reg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            slug: "broken",
          },
          body: "Broken body\n",
          recordFromParts: (attributes: Record<string, unknown>, relativePath: string, markdown: string) => ({
            id: String(attributes.id),
            slug: String(attributes.slug),
            relativePath,
            markdown,
          }),
          operationType: "mock_registry_write",
          summary: "Write markdown registry record",
          audit: {
            action: "vault_init",
            commandName: "core.mockRegistryWrite",
            summary: "Created mock registry record.",
          },
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Markdown registry write audit path was not produced.",
    );
  } finally {
    markdownWriteSpy.mockRestore();
    frontmatterWriteSpy.mockRestore();
  }
});

test("profile helpers preserve source fallbacks and read/rebuild current profile state", async () => {
  const vaultRoot = await makeTempRoot();

  const emptyRead = await readCurrentProfile({ vaultRoot });
  assert.equal(emptyRead.exists, false);
  assert.equal(emptyRead.markdown, null);
  assert.equal(emptyRead.snapshot, null);
  assert.equal(emptyRead.profile, null);

  const emptyRebuild = await rebuildCurrentProfile({ vaultRoot });
  assert.equal(emptyRebuild.exists, false);
  assert.equal(emptyRebuild.markdown, null);
  assert.equal(emptyRebuild.snapshot, null);
  assert.equal(emptyRebuild.profile, null);
  assert.equal(emptyRebuild.updated, false);

  const appended = await appendProfileSnapshot({
    vaultRoot,
    recordedAt: "2026-04-08T10:15:30.000Z",
    source: "import" as never,
    sourceAssessmentIds: [
      "asmt_01JNV40W8VFYQ2H7CMJY5A9R4K",
      "asmt_01JNV40W8VFYQ2H7CMJY5A9R4K",
    ],
    sourceEventIds: [
      "evt_01JNV46VFEV8Q05M8NSEJ2MZXG",
      "evt_01JNV46VFEV8Q05M8NSEJ2MZXG",
    ],
    profile: {
      narrative: {
        summary: "Sleep is a primary concern and caffeine load is likely contributing.",
        highlights: ["Sleep latency is elevated", "Caffeine use remains high"],
      },
      goals: {
        topGoalIds: ["goal_01JNV43AK9SK58T6GX3DWRZH9Q"],
      },
      unitPreferences: {
        weight: "lb",
        distance: "mi",
        bodyMeasurement: "in",
      },
      custom: {
        sleep: {
          averageHours: 6.5,
          difficultyFallingAsleep: true,
        },
        nutrition: {
          pattern: "omnivore",
        },
        substances: {
          caffeine: "3 servings daily",
        },
      },
    },
  });

  assert.equal(appended.snapshot.source, "manual");
  assert.deepEqual(appended.snapshot.sourceAssessmentIds, [
    "asmt_01JNV40W8VFYQ2H7CMJY5A9R4K",
  ]);
  assert.deepEqual(appended.snapshot.sourceEventIds, ["evt_01JNV46VFEV8Q05M8NSEJ2MZXG"]);

  const populatedRead = await readCurrentProfile({ vaultRoot });
  assert.equal(populatedRead.exists, true);
  assert.equal(populatedRead.snapshot?.id, appended.snapshot.id);
  assert.deepEqual(populatedRead.profile, appended.snapshot.profile);
  assert.equal(populatedRead.markdown, appended.currentProfile.markdown);

  const populatedRebuild = await rebuildCurrentProfile({ vaultRoot });
  assert.equal(populatedRebuild.exists, true);
  assert.equal(populatedRebuild.snapshot?.id, appended.snapshot.id);
  assert.equal(populatedRebuild.updated, false);
  assert.equal(populatedRebuild.markdown, appended.currentProfile.markdown);
});

test("event link canonicalization dedupes links, falls back from related ids, and reports invalid shapes", () => {
  const deduped = canonicalizeEventRelations({
    links: [
      {
        type: "related_to",
        targetId: "evt_01",
      },
      {
        type: "related_to",
        targetId: "evt_01",
      },
      {
        type: "caused_by",
        targetId: "evt_02",
      },
    ],
    relatedIds: ["evt_99"],
    normalizeStringList: (value) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined),
    errorCode: "EVENT_LINKS_INVALID",
    errorMessage: "Links are invalid.",
  });

  assert.deepEqual(deduped.links, [
    {
      type: "related_to",
      targetId: "evt_01",
    },
    {
      type: "caused_by",
      targetId: "evt_02",
    },
  ]);
  assert.deepEqual(deduped.relatedIds, ["evt_01", "evt_02"]);

  const fallback = canonicalizeEventRelations({
    links: undefined,
    relatedIds: ["evt_03", "evt_03"],
    normalizeStringList: (value) => (Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))] : undefined),
    errorCode: "EVENT_LINKS_INVALID",
    errorMessage: "Links are invalid.",
  });
  assert.deepEqual(fallback.links, [
    {
      type: "related_to",
      targetId: "evt_03",
    },
  ]);
  assert.deepEqual(fallback.relatedIds, ["evt_03"]);

  assert.equal(isVaultError(new VaultError("TEST", "Broken")), true);
  assert.equal(isVaultError(new Error("nope")), false);
  assert.throws(
    () =>
      canonicalizeEventRelations({
        links: [{ type: "related_to" }],
        relatedIds: undefined,
        normalizeStringList: () => undefined,
        errorCode: "EVENT_LINKS_INVALID",
        errorMessage: "Links are invalid.",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_LINKS_INVALID",
  );
});
