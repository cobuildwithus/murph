import os from "node:os";
import path from "node:path";
import { existsSync, promises as fs, readdirSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  buildAutomationSupportSeriesTag,
} from "@murphai/contracts";

import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import {
  resolveSlugMarkdownDocumentTarget,
  writeCanonicalMarkdownDocument,
} from "../src/markdown-documents.ts";
import {
  advanceAutomationDeviceActivityCursor,
  archiveAutomationIfActiveUntilElapsed,
  archiveAutomationIfExactRevision,
  buildAutomationMarkdownPreview,
  listAutomations,
  patchAutomation,
  readAutomation,
  readAutomationMarkdown,
  reconcileAutomationSupportSeriesNamespace,
  scaffoldAutomationPayload,
  showAutomation,
  upsertAutomation,
} from "../src/automation.ts";
import {
  reconcileAutomationSupportSeries as reconcileAutomationSupportSeriesFromPackageRoot,
} from "../src/index.ts";

async function createTempVaultRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "murph-core-markdown-"));
}

const tempRoots: string[] = [];

async function makeVaultRoot(): Promise<string> {
  const root = await createTempVaultRoot();
  tempRoots.push(root);
  return root;
}

type AutomationTestPayload = ReturnType<typeof scaffoldAutomationPayload> & {
  automationId?: string;
};

function createAutomationPayload(
  overrides: Partial<AutomationTestPayload> = {},
): AutomationTestPayload {
  return {
    ...scaffoldAutomationPayload(),
    ...overrides,
  };
}

function stableAutomationArchiveFields(
  record: Awaited<ReturnType<typeof upsertAutomation>>["record"],
) {
  const {
    markdown: _markdown,
    status: _status,
    updatedAt: _updatedAt,
    ...stable
  } = record;
  return stable;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      fs.rm(root, { recursive: true, force: true })
    ),
  );
});

describe("markdown document primitives", () => {
  it("exports support-series reconciliation from the package root", () => {
    expect(reconcileAutomationSupportSeriesFromPackageRoot).toBeTypeOf("function");
  });

  it("rejects invalid automation assistant reasoning effort before writing", async () => {
    const vaultRoot = await makeVaultRoot();
    const invalidInput = JSON.parse(JSON.stringify({
      vaultRoot,
      ...createAutomationPayload(),
    }));
    invalidInput.assistantTargetOverride = {
      reasoningEffort: "hihg",
    };

    await expect(upsertAutomation(invalidInput)).rejects.toThrow(
      /assistantTargetOverride\.reasoningEffort must be one of low, medium, high, xhigh/u,
    );
    await expect(listAutomations({ vaultRoot })).resolves.toEqual({
      count: 0,
      items: [],
    });
  });

  it("keeps the existing slug by default and only renames when explicitly allowed", () => {
    const existingRecord = {
      recordId: "goal_01",
      slug: "sleep-quality",
      relativePath: "bank/goals/sleep-quality.md",
    };

    const stableTarget = resolveSlugMarkdownDocumentTarget({
      existingRecord,
      recordId: existingRecord.recordId,
      requestedSlug: "renamed-goal",
      defaultSlug: "renamed-goal",
      allowSlugUpdate: false,
      directory: "bank/goals",
      getRecordId: (record) => record.recordId,
      getRecordSlug: (record) => record.slug,
      getRecordRelativePath: (record) => record.relativePath,
      createRecordId: () => "goal_new",
    });

    expect(stableTarget).toEqual({
      recordId: "goal_01",
      slug: "sleep-quality",
      relativePath: "bank/goals/sleep-quality.md",
      created: false,
      previousRelativePath: undefined,
    });

    const renamedTarget = resolveSlugMarkdownDocumentTarget({
      existingRecord,
      recordId: existingRecord.recordId,
      requestedSlug: "renamed-goal",
      defaultSlug: "renamed-goal",
      allowSlugUpdate: true,
      directory: "bank/goals",
      getRecordId: (record) => record.recordId,
      getRecordSlug: (record) => record.slug,
      getRecordRelativePath: (record) => record.relativePath,
      createRecordId: () => "goal_new",
    });

    expect(renamedTarget).toEqual({
      recordId: "goal_01",
      slug: "renamed-goal",
      relativePath: "bank/goals/renamed-goal.md",
      created: false,
      previousRelativePath: "bank/goals/sleep-quality.md",
    });
  });

  it("writes markdown documents through one canonical path and cleans up renamed files", async () => {
    const vaultRoot = await makeVaultRoot();

    await writeCanonicalMarkdownDocument({
      vaultRoot,
      operationType: "test_markdown_seed",
      summary: "Seed markdown document",
      target: {
        relativePath: "bank/test/original.md",
        created: true,
      },
      markdown: "# Original\n",
      overwrite: false,
      audit: {
        action: "show",
        commandName: "test.seedMarkdownDocument",
        summary: "Seeded original markdown document.",
      },
    });

    const renamed = await writeCanonicalMarkdownDocument({
      vaultRoot,
      operationType: "test_markdown_rename",
      summary: "Rename markdown document",
      target: {
        relativePath: "bank/test/renamed.md",
        previousRelativePath: "bank/test/original.md",
        created: false,
      },
      markdown: "# Renamed\n",
      audit: {
        action: "show",
        commandName: "test.renameMarkdownDocument",
        summary: "Renamed markdown document.",
      },
    });

    await expect(
      fs.readFile(path.join(vaultRoot, "bank/test/original.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(path.join(vaultRoot, "bank/test/renamed.md"), "utf8"),
    ).resolves.toBe("# Renamed\n");
    expect(renamed.write.changes).toEqual([
      {
        path: "bank/test/renamed.md",
        op: "update",
      },
      {
        path: "bank/test/original.md",
        op: "delete",
      },
    ]);
    expect(renamed.auditPath).toMatch(/^audit\//u);
  });

  it("renames automation markdown files without reporting the surviving path as a create", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      vaultRoot,
      ...scaffoldAutomationPayload(),
    });
    const renamed = await upsertAutomation({
      vaultRoot,
      automationId: created.record.automationId,
      title: created.record.title,
      slug: "renamed-weekly-check-in",
      instructions: created.record.instructions,
      schedule: created.record.schedule,
      route: created.record.route,
      continuityPolicy: created.record.continuityPolicy,
      status: created.record.status,
      summary: created.record.summary ?? undefined,
      tags: created.record.tags,
      allowSlugRename: true,
    });

    await expect(
      fs.readFile(path.join(vaultRoot, created.record.relativePath), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(path.join(vaultRoot, renamed.record.relativePath), "utf8"),
    ).resolves.toContain("renamed-weekly-check-in");

    expect(renamed.created).toBe(false);
    expect(renamed.record.relativePath).toBe("bank/automations/renamed-weekly-check-in.md");
    expect(renamed.auditPath).toMatch(/^audit\//u);
  });

  it("returns a real audit shard path for automation upserts", async () => {
    const vaultRoot = await makeVaultRoot();
    const result = await upsertAutomation({
      vaultRoot,
      ...scaffoldAutomationPayload(),
    });

    expect(result.auditPath).toMatch(/^audit\//u);
    expect(result.auditPath).not.toBe(result.record.relativePath);

    const storedMarkdown = await fs.readFile(
      path.join(vaultRoot, result.record.relativePath),
      "utf8",
    );
    const parsed = parseFrontmatterDocument(storedMarkdown);

    expect(parsed.attributes.automationId).toBe(result.record.automationId);
    expect(parsed.attributes.slug).toBe(result.record.slug);
    expect(parsed.body).toContain(result.record.instructions);
  });

  it("preserves existing automation tags when an upsert omits tags", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        tags: ["sleep", "recovery"],
      }),
    });

    const updated = await upsertAutomation({
      vaultRoot,
      automationId: created.record.automationId,
      title: created.record.title,
      slug: created.record.slug,
      instructions: "Report only the most important sleep trend.",
      schedule: created.record.schedule,
      route: created.record.route,
      continuityPolicy: created.record.continuityPolicy,
      status: created.record.status,
      summary: created.record.summary ?? undefined,
    });

    expect(updated.record.tags).toEqual(["sleep", "recovery"]);
  });

  it("round-trips activeUntil and archives only the current elapsed definition", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      vaultRoot,
      now: new Date("2026-07-01T00:00:00.000Z"),
      ...createAutomationPayload({
        activeUntil: "2026-07-10T00:00:00.000Z",
      }),
    });

    expect(created.record.activeUntil).toBe("2026-07-10T00:00:00.000Z");
    const extended = await patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      activeUntil: "2026-07-12T00:00:00.000Z",
      now: new Date("2026-07-02T00:00:00.000Z"),
    });
    const stale = await archiveAutomationIfActiveUntilElapsed({
      vaultRoot,
      lookup: created.record.automationId,
      expectedUpdatedAt: created.record.updatedAt,
      now: new Date("2026-07-12T00:00:00.000Z"),
    });
    expect(stale.archived).toBe(false);
    expect(stale.record.activeUntil).toBe("2026-07-12T00:00:00.000Z");
    expect(stale.record.status).toBe("active");

    const archived = await archiveAutomationIfActiveUntilElapsed({
      vaultRoot,
      lookup: created.record.automationId,
      expectedUpdatedAt: extended.record.updatedAt,
      now: new Date("2026-07-12T00:00:00.000Z"),
    });
    expect(archived.archived).toBe(true);
    expect(archived.record.status).toBe("archived");
    expect(archived.record.activeUntil).toBe("2026-07-12T00:00:00.000Z");

    const repeated = await archiveAutomationIfActiveUntilElapsed({
      vaultRoot,
      lookup: created.record.automationId,
      now: new Date("2026-07-13T00:00:00.000Z"),
    });
    expect(repeated.archived).toBe(false);
    expect(repeated.record.status).toBe("archived");

    await expect(archiveAutomationIfActiveUntilElapsed({
      vaultRoot,
      lookup: created.record.automationId,
      now: new Date(Number.NaN),
    })).rejects.toThrow(/now must be a valid Date/u);

    const boundedOneShot = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        activeUntil: "2026-07-09T00:00:01.000Z",
        schedule: {
          kind: "at",
          at: "2026-07-09T00:00:00.000Z",
        },
      }),
    });
    expect(boundedOneShot.record.activeUntil).toBe("2026-07-09T00:00:01.000Z");
    await expect(upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        activeUntil: "2026-07-09T00:00:00.000Z",
        schedule: {
          kind: "at",
          at: "2026-07-09T00:00:00.000Z",
        },
      }),
    })).rejects.toThrow(/activeUntil must be after schedule\.at/u);
  });

  it("archives only an active exact revision and preserves its canonical fields", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      ...createAutomationPayload({
        activeUntil: "2026-07-20T23:00:00.000Z",
        assistantTargetOverride: {
          model: "gpt-test",
          modelProvider: "test-provider",
          reasoningEffort: "high",
        },
        continuityPolicy: "preserve",
        route: {
          channel: "linq",
          deliverySource: null,
          deliveryTarget: "group_chat",
          identityId: "linq_identity",
          participantId: null,
          threadId: "group_chat",
          threadIsDirect: false,
        },
        schedule: { kind: "dailyLocal", localTime: "08:00" },
        summary: "Exact challenge closeout.",
        supportKind: "check_in",
        tags: ["challenge"],
        title: "Exact challenge dispatch",
      }),
      now: new Date("2026-07-18T12:00:00.000Z"),
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "exact-challenge",
        projectionScopeKey: "steps-days.v0",
      },
      vaultRoot,
    });

    const stale = await archiveAutomationIfExactRevision({
      expectedUpdatedAt: "2026-07-18T11:59:59.000Z",
      lookup: created.record.automationId,
      now: new Date("2026-07-19T12:00:00.000Z"),
      vaultRoot,
    });
    expect(stale).toMatchObject({
      archived: false,
      record: { status: "active", updatedAt: created.record.updatedAt },
    });

    const archived = await archiveAutomationIfExactRevision({
      expectedUpdatedAt: created.record.updatedAt,
      lookup: created.record.slug,
      now: new Date("2026-07-19T12:00:00.000Z"),
      vaultRoot,
    });
    expect(archived.archived).toBe(true);
    expect(archived.record.status).toBe("archived");
    expect(archived.record.updatedAt).toBe("2026-07-19T12:00:00.000Z");
    expect(stableAutomationArchiveFields(archived.record)).toEqual(
      stableAutomationArchiveFields(created.record),
    );
    expect(parseFrontmatterDocument(archived.record.markdown).attributes).toMatchObject({
      scheduledTask: created.record.scheduledTask,
      status: "archived",
      supportKind: "check_in",
    });

    const repeated = await archiveAutomationIfExactRevision({
      expectedUpdatedAt: archived.record.updatedAt,
      lookup: archived.record.automationId,
      vaultRoot,
    });
    expect(repeated).toMatchObject({
      archived: false,
      record: { status: "archived" },
    });

    await expect(archiveAutomationIfExactRevision({
      expectedUpdatedAt: created.record.updatedAt,
      lookup: "missing-automation",
      vaultRoot,
    })).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_MISSING",
      message: "Automation was not found.",
    });
  });

  it("allows first support-series assignment but preserves ownership thereafter", async () => {
    const vaultRoot = await makeVaultRoot();
    const supportSeriesTag = buildAutomationSupportSeriesTag("experiment:exp_sleep");
    const created = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({ tags: ["assistant"] }),
    });
    const assigned = await patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      tags: ["assistant", supportSeriesTag],
    });
    expect(assigned.record.tags).toContain(supportSeriesTag);

    await expect(patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      tags: ["assistant"],
    })).rejects.toThrow(/support series ownership cannot be removed or replaced/u);
    await expect(patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      tags: ["assistant", buildAutomationSupportSeriesTag("experiment:exp_other")],
    })).rejects.toThrow(/support series ownership cannot be removed or replaced/u);
  });

  it("rejects a forged reconcile-owned archive marker", async () => {
    const vaultRoot = await makeVaultRoot();

    await expect(upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        tags: [AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG],
      }),
    })).rejects.toThrow(/reserved for internal reconciliation/u);
  });

  it("reconciles every support-series member beyond 200 and is idempotent", async () => {
    const vaultRoot = await makeVaultRoot();
    const automationsDirectory = path.join(vaultRoot, "bank", "automations");
    await fs.mkdir(automationsDirectory, { recursive: true });
    const keptAutomationId = "automation_support_000";
    const currentTag = buildAutomationSupportSeriesTag("experiment:exp_current");
    const deletedTag = buildAutomationSupportSeriesTag("experiment:exp_deleted");
    await Promise.all(
      Array.from({ length: 205 }, async (_, index) => {
        const suffix = String(index).padStart(3, "0");
        const slug = `support-${suffix}`;
        const markdown = buildAutomationMarkdownPreview(createAutomationPayload({
          automationId: `automation_support_${suffix}`,
          slug,
          title: `Support ${suffix}`,
          tags: [index < 201 ? currentTag : deletedTag],
        }));
        await fs.writeFile(path.join(automationsDirectory, `${slug}.md`), markdown, "utf8");
      }),
    );

    let readChecks = 0;
    const yieldedDuringRead = await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment:",
      desiredSeries: [{
        supportSeriesTag: currentTag,
        desiredAutomationIds: [keptAutomationId],
      }],
      now: new Date("2026-07-13T00:00:00.000Z"),
      shouldYield: () => {
        readChecks += 1;
        return readChecks >= 25;
      },
    });
    expect(yieldedDuringRead).toMatchObject({
      archivedCount: 0,
      matchedCount: 0,
      unchangedCount: 0,
      yielded: true,
    });
    expect(existsSync(path.join(vaultRoot, ".runtime", "operations"))).toBe(false);

    const yielded = await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment:",
      desiredSeries: [{
        supportSeriesTag: currentTag,
        desiredAutomationIds: [keptAutomationId],
      }],
      now: new Date("2026-07-14T00:00:00.000Z"),
      shouldYield: () => {
        const operationsRoot = path.join(vaultRoot, ".runtime", "operations");
        if (!existsSync(operationsRoot)) {
          return false;
        }
        return readdirSync(operationsRoot, { withFileTypes: true }).some((entry) => {
          if (!entry.isDirectory()) {
            return false;
          }
          const payloadRoot = path.join(operationsRoot, entry.name, "payloads");
          return existsSync(payloadRoot) && readdirSync(payloadRoot).length > 0;
        });
      },
    });
    expect(yielded).toEqual({
      archivedCount: 0,
      auditPath: null,
      matchedCount: 0,
      missingDesiredAutomationIds: [],
      unchangedCount: 0,
      yielded: true,
    });
    const unchangedAfterYield = await listAutomations({ vaultRoot });
    expect(unchangedAfterYield.items.every((record) => record.status === "active")).toBe(true);
    expect(unchangedAfterYield.items.some((record) =>
      record.tags.includes(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG)
    )).toBe(false);

    const reconciled = await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment:",
      desiredSeries: [{
        supportSeriesTag: currentTag,
        desiredAutomationIds: [keptAutomationId],
      }],
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(reconciled).toMatchObject({
      archivedCount: 204,
      matchedCount: 205,
      missingDesiredAutomationIds: [],
      unchangedCount: 1,
    });
    expect(reconciled.auditPath).toMatch(/^audit\//u);

    const records = await listAutomations({ vaultRoot });
    expect(records.count).toBe(205);
    expect(records.items.filter((record) => record.status === "active")).toHaveLength(1);
    expect(records.items.find((record) => record.automationId === keptAutomationId)?.status)
      .toBe("active");

    const repeated = await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment:",
      desiredSeries: [{
        supportSeriesTag: currentTag,
        desiredAutomationIds: [keptAutomationId],
      }],
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(repeated).toEqual({
      archivedCount: 0,
      auditPath: null,
      matchedCount: 205,
      missingDesiredAutomationIds: [],
      unchangedCount: 205,
    });

    await expect(reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment:",
      desiredSeries: [
        {
          supportSeriesTag: currentTag,
          desiredAutomationIds: [keptAutomationId],
        },
        {
          supportSeriesTag: deletedTag,
          desiredAutomationIds: [keptAutomationId],
        },
      ],
    })).rejects.toThrow(/cannot be desired by multiple support series/u);
  });

  it("marks only active records archived by support reconciliation and is idempotent", async () => {
    const vaultRoot = await makeVaultRoot();
    const supportSeriesTag = buildAutomationSupportSeriesTag(
      "experiment-lifecycle:exp_reactivation",
    );
    const active = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        automationId: "automation_01JRACT1VAT10N000000000001",
        slug: "reconcile-active",
        tags: [supportSeriesTag],
      }),
    });
    const paused = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        automationId: "automation_01JRACT1VAT10N000000000002",
        slug: "reconcile-paused",
        status: "paused",
        tags: [supportSeriesTag],
      }),
    });

    const reconciled = await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment-lifecycle:",
      desiredSeries: [],
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(reconciled.archivedCount).toBe(1);
    expect((await readAutomation({
      automationId: active.record.automationId,
      vaultRoot,
    })).tags).toContain(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG);
    expect(await readAutomation({
      automationId: paused.record.automationId,
      vaultRoot,
    })).toMatchObject({
      status: "paused",
      tags: [supportSeriesTag],
    });

    const repeated = await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment-lifecycle:",
      desiredSeries: [],
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(repeated.archivedCount).toBe(0);
    const archivedAgain = await readAutomation({
      automationId: active.record.automationId,
      vaultRoot,
    });
    expect(archivedAgain.tags.filter(
      (tag) => tag === AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
    )).toHaveLength(1);

    const reactivated = await patchAutomation({
      vaultRoot,
      lookup: active.record.automationId,
      status: "active",
      now: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(reactivated.record.tags).not.toContain(
      AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
    );

    const consumed = await patchAutomation({
      vaultRoot,
      lookup: active.record.automationId,
      status: "archived",
      now: new Date("2026-07-18T00:00:00.000Z"),
    });
    expect(consumed.record.tags).not.toContain(
      AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
    );
  });

  it("retires reconciliation reactivation authority when the user archives an already archived record", async () => {
    const vaultRoot = await makeVaultRoot();
    const supportSeriesTag = buildAutomationSupportSeriesTag(
      "experiment-lifecycle:exp_explicit_archive",
    );
    const created = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        automationId: "automation_01K00000000000000000000003",
        slug: "reconcile-explicit-archive",
        tags: [supportSeriesTag],
      }),
    });

    await reconcileAutomationSupportSeriesNamespace({
      vaultRoot,
      seriesIdPrefix: "experiment-lifecycle:",
      desiredSeries: [],
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect((await readAutomation({
      automationId: created.record.automationId,
      vaultRoot,
    })).tags).toContain(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG);

    const explicitlyArchived = await patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      status: "archived",
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(explicitlyArchived.record.tags).not.toContain(
      AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
    );
  });

  it("patches one automation field while preserving omitted fields", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        continuityPolicy: "fresh",
        instructions: "Check sleep trend.",
        summary: "Sleep prompt.",
        tags: ["sleep", "scheduled"],
      }),
    });

    const patched = await patchAutomation({
      vaultRoot,
      lookup: created.record.slug,
      continuityPolicy: "preserve",
    });

    expect(patched.created).toBe(false);
    expect(patched.record.automationId).toBe(created.record.automationId);
    expect(patched.record.continuityPolicy).toBe("preserve");
    expect(patched.record.title).toBe(created.record.title);
    expect(patched.record.instructions).toBe(created.record.instructions);
    expect(patched.record.schedule).toEqual(created.record.schedule);
    expect(patched.record.route).toEqual(created.record.route);
    expect(patched.record.summary).toBe(created.record.summary);
    expect(patched.record.tags).toEqual(created.record.tags);
  });

  it("keeps a create-only scheduled task and its route immutable", async () => {
    const vaultRoot = await makeVaultRoot();
    const payload = createAutomationPayload({
      continuityPolicy: "preserve",
      route: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "group_chat",
        identityId: "linq_identity",
        participantId: null,
        threadId: "group_chat",
        threadIsDirect: false,
      },
      slug: "morning-mobility-dispatch",
      title: "Morning mobility dispatch",
    });
    const scheduledTask = {
      kind: "group_challenge",
      knowledgeSlug: "morning-mobility",
      projectionScopeKey: "steps-days.v0",
    } as const;
    await expect(upsertAutomation({
      vaultRoot,
      ...payload,
      scheduledTask,
    })).rejects.toThrow(/requires a finite activeUntil/u);
    await expect(upsertAutomation({
      vaultRoot,
      ...payload,
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      schedule: {
        kind: "deviceActivity",
        after: "2026-07-18T12:00:00.000Z",
      },
      scheduledTask,
    })).rejects.toThrow(/requires a time-driven schedule/u);
    const created = await upsertAutomation({
      vaultRoot,
      ...payload,
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      scheduledTask,
    });

    expect(created.record.scheduledTask).toEqual(scheduledTask);
    expect(parseFrontmatterDocument(created.record.markdown).attributes.scheduledTask)
      .toEqual(created.record.scheduledTask);

    const patched = await patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      route: { ...created.record.route },
      title: "Morning mobility group dispatch",
    });
    expect(patched.record.scheduledTask).toEqual(created.record.scheduledTask);
    expect(patched.record.route).toEqual(created.record.route);

    const ordinaryUpsert = await upsertAutomation({
      vaultRoot,
      ...payload,
      automationId: created.record.automationId,
      instructions: "Send the updated challenge dispatch.",
      title: patched.record.title,
    });
    expect(ordinaryUpsert.record.scheduledTask).toEqual(created.record.scheduledTask);

    await expect(upsertAutomation({
      vaultRoot,
      ...payload,
      automationId: created.record.automationId,
      scheduledTask: null,
      title: patched.record.title,
    })).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_SCHEDULED_TASK_IMMUTABLE",
    });
    await expect(upsertAutomation({
      vaultRoot,
      ...payload,
      automationId: created.record.automationId,
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "evening-mobility",
        projectionScopeKey: "steps-days.v0",
      },
      title: patched.record.title,
    })).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_SCHEDULED_TASK_IMMUTABLE",
    });
    await expect(upsertAutomation({
      vaultRoot,
      ...payload,
      automationId: created.record.automationId,
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "sleep-duration-days.v0",
      },
      title: patched.record.title,
    })).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_SCHEDULED_TASK_IMMUTABLE",
    });
    await expect(patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      route: {
        ...created.record.route,
        deliveryTarget: "different_group_chat",
        threadId: "different_group_chat",
      },
    })).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_SCHEDULED_TASK_ROUTE_IMMUTABLE",
    });

    const unbound = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        slug: "ordinary-reminder",
        title: "Ordinary reminder",
      }),
    });
    await expect(upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        automationId: unbound.record.automationId,
        slug: unbound.record.slug,
        scheduledTask: {
          kind: "group_challenge",
          knowledgeSlug: "morning-mobility",
          projectionScopeKey: "steps-days.v0",
        },
        title: unbound.record.title,
      }),
    })).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_SCHEDULED_TASK_CREATE_ONLY",
    });
  });

  it("advances only the device activity cursor and refuses stale matcher expectations", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        assistantTargetOverride: {
          reasoningEffort: "low",
        },
        continuityPolicy: "preserve",
        instructions: "Ask about walks.",
        schedule: {
          kind: "deviceActivity",
          after: "2026-06-07T11:00:00.000Z",
          activityKind: "walk",
          source: "whoop",
        },
        tags: ["device"],
      }),
    });

    const advanced = await advanceAutomationDeviceActivityCursor({
      vaultRoot,
      lookup: created.record.automationId,
      after: "2026-06-07T12:00:00.000Z",
      afterOccurredAt: "2026-06-07T11:30:00.000Z",
      afterEntityId: "evt_walk",
      expectedActivityKind: "walk",
      expectedContinuityPolicy: created.record.continuityPolicy,
      expectedInstructions: created.record.instructions,
      expectedRoute: created.record.route,
      expectedSource: "whoop",
      now: new Date("2026-06-07T12:01:00.000Z"),
    });

    expect(advanced.advanced).toBe(true);
    expect(advanced.record.schedule).toEqual({
      kind: "deviceActivity",
      after: "2026-06-07T12:00:00.000Z",
      afterOccurredAt: "2026-06-07T11:30:00.000Z",
      afterEntityId: "evt_walk",
      activityKind: "walk",
      source: "whoop",
    });
    expect(advanced.record.instructions).toBe(created.record.instructions);
    expect(advanced.record.assistantTargetOverride).toEqual({
      reasoningEffort: "low",
    });
    expect(advanced.record.tags).toEqual(["device"]);

    const stale = await advanceAutomationDeviceActivityCursor({
      vaultRoot,
      lookup: created.record.automationId,
      after: "2026-06-07T11:30:00.000Z",
      afterOccurredAt: "2026-06-07T11:15:00.000Z",
      afterEntityId: "evt_older",
      expectedActivityKind: "walk",
      expectedContinuityPolicy: created.record.continuityPolicy,
      expectedInstructions: created.record.instructions,
      expectedRoute: created.record.route,
      expectedSource: "whoop",
      now: new Date("2026-06-07T12:01:30.000Z"),
    });

    expect(stale.advanced).toBe(false);
    expect(stale.record.schedule).toEqual(advanced.record.schedule);

    const targetEdited = await patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      assistantTargetOverride: {
        reasoningEffort: "high",
      },
      now: new Date("2026-06-07T12:01:45.000Z"),
    });

    const targetAdvanced = await advanceAutomationDeviceActivityCursor({
      vaultRoot,
      lookup: created.record.automationId,
      after: "2026-06-07T12:30:00.000Z",
      afterOccurredAt: "2026-06-07T12:15:00.000Z",
      afterEntityId: "evt_target_edit",
      expectedActivityKind: "walk",
      expectedContinuityPolicy: created.record.continuityPolicy,
      expectedInstructions: created.record.instructions,
      expectedRoute: created.record.route,
      expectedSource: "whoop",
      now: new Date("2026-06-07T12:02:00.000Z"),
    });

    expect(targetAdvanced.advanced).toBe(true);
    expect(targetAdvanced.record.assistantTargetOverride).toEqual(
      targetEdited.record.assistantTargetOverride,
    );
    expect(targetAdvanced.record.schedule).toEqual({
      kind: "deviceActivity",
      after: "2026-06-07T12:30:00.000Z",
      afterOccurredAt: "2026-06-07T12:15:00.000Z",
      afterEntityId: "evt_target_edit",
      activityKind: "walk",
      source: "whoop",
    });

    const retargeted = await patchAutomation({
      vaultRoot,
      lookup: created.record.automationId,
      schedule: {
        kind: "deviceActivity",
        after: "2026-06-07T12:00:00.000Z",
        afterOccurredAt: "2026-06-07T11:30:00.000Z",
        afterEntityId: "evt_walk",
        activityKind: "run",
        source: "whoop",
      },
      now: new Date("2026-06-07T12:02:00.000Z"),
    });

    const skipped = await advanceAutomationDeviceActivityCursor({
      vaultRoot,
      lookup: created.record.automationId,
      after: "2026-06-07T13:00:00.000Z",
      afterOccurredAt: "2026-06-07T12:30:00.000Z",
      afterEntityId: "evt_run",
      expectedActivityKind: "walk",
      expectedContinuityPolicy: created.record.continuityPolicy,
      expectedInstructions: created.record.instructions,
      expectedRoute: created.record.route,
      expectedSource: "whoop",
      now: new Date("2026-06-07T12:03:00.000Z"),
    });

    expect(skipped.advanced).toBe(false);
    expect(skipped.record.schedule).toEqual(retargeted.record.schedule);
  });

  it("rejects partial device activity cursor shapes", async () => {
    const vaultRoot = await makeVaultRoot();

    await expect(
      upsertAutomation({
        vaultRoot,
        ...createAutomationPayload({
          schedule: {
            kind: "deviceActivity",
            after: "2026-06-07T11:00:00.000Z",
            afterOccurredAt: "2026-06-07T10:30:00.000Z",
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "VAULT_INVALID_INPUT",
    });
  });

  it("clears automation summary when null is provided explicitly", async () => {
    const vaultRoot = await makeVaultRoot();
    const created = await upsertAutomation({
      vaultRoot,
      ...createAutomationPayload({
        summary: "Sleep prompt.",
      }),
    });

    const clearedByUpsert = await upsertAutomation({
      vaultRoot,
      automationId: created.record.automationId,
      title: created.record.title,
      slug: created.record.slug,
      instructions: created.record.instructions,
      schedule: created.record.schedule,
      route: created.record.route,
      continuityPolicy: created.record.continuityPolicy,
      status: created.record.status,
      summary: null,
      tags: created.record.tags,
    });
    expect(clearedByUpsert.record.summary).toBeNull();

    const restored = await patchAutomation({
      vaultRoot,
      lookup: created.record.slug,
      summary: "Restored summary.",
    });
    expect(restored.record.summary).toBe("Restored summary.");

    const clearedByPatch = await patchAutomation({
      vaultRoot,
      lookup: created.record.slug,
      summary: null,
    });
    expect(clearedByPatch.record.summary).toBeNull();
  });

  it("lists automations with status/text filters and limit", async () => {
    const vaultRoot = await makeVaultRoot();
    const now = new Date("2026-04-08T00:00:00.000Z");

    await upsertAutomation({
      vaultRoot,
      automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      now,
      ...createAutomationPayload({
        title: "Sleep Check In",
        slug: "sleep-check-in",
        summary: "Weekly sleep digest.",
        status: "active",
        instructions: "Report the sleep recovery highlights.",
        tags: ["sleep", "recovery"],
      }),
    });

    await upsertAutomation({
      vaultRoot,
      automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      now,
      ...createAutomationPayload({
        title: "Project Handoff",
        slug: "project-handoff",
        summary: "Paused handoff tracker.",
        status: "paused",
        instructions: "Track project handoff blockers.",
        tags: ["project", "handoff"],
      }),
    });

    await upsertAutomation({
      vaultRoot,
      automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      now,
      ...createAutomationPayload({
        title: "Archive Sweep",
        slug: "archive-sweep",
        summary: "Legacy cleanup.",
        status: "archived",
        instructions: "Retire stale automation notes.",
        tags: ["cleanup"],
      }),
    });

    const statusMatches = await listAutomations({
      vaultRoot,
      status: ["archived", "paused"],
      limit: 1,
    });

    expect(statusMatches.count).toBe(2);
    expect(statusMatches.items).toHaveLength(1);
    expect(statusMatches.items[0].automationId).toBe("automation_01ARZ3NDEKTSV4RRFFQ69G5FAX");

    const textMatches = await listAutomations({
      vaultRoot,
      status: "paused",
      text: "HANDOFF",
    });

    expect(textMatches.count).toBe(1);
    expect(textMatches.items.map((record) => record.automationId)).toEqual([
      "automation_01ARZ3NDEKTSV4RRFFQ69G5FAW",
    ]);

    const promptMatches = await listAutomations({
      vaultRoot,
      text: "recovery",
    });

    expect(promptMatches.count).toBe(1);
    expect(promptMatches.items[0].automationId).toBe("automation_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  it("reads automations by id, shows them by slug, and rejects conflicting selectors", async () => {
    const vaultRoot = await makeVaultRoot();
    const now = new Date("2026-04-08T00:00:00.000Z");
    const active = await upsertAutomation({
      vaultRoot,
      automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      now,
      ...createAutomationPayload({
        title: "Sleep Check In",
        slug: "sleep-check-in",
        summary: "Weekly sleep digest.",
        status: "active",
        instructions: "Report the sleep recovery highlights.",
        tags: ["sleep", "recovery"],
      }),
    });

    const paused = await upsertAutomation({
      vaultRoot,
      automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      now,
      ...createAutomationPayload({
        title: "Project Handoff",
        slug: "project-handoff",
        summary: "Paused handoff tracker.",
        status: "paused",
        instructions: "Track project handoff blockers.",
        tags: ["project", "handoff"],
      }),
    });

    const readById = await readAutomation({
      vaultRoot,
      automationId: active.record.automationId,
    });

    expect(readById.slug).toBe("sleep-check-in");
    expect(readById.instructions).toBe("Report the sleep recovery highlights.");

    const shownBySlug = await showAutomation({
      vaultRoot,
      slug: paused.record.slug,
    });

    expect(shownBySlug?.automationId).toBe(paused.record.automationId);

    await expect(
      showAutomation({
        vaultRoot,
        automationId: active.record.automationId,
        slug: paused.record.slug,
      }),
    ).rejects.toMatchObject({
      code: "VAULT_AUTOMATION_CONFLICT",
      message: "Automation id and slug resolve to different records.",
    });
  });

  it("normalizes automation preview markdown and round-trips stored markdown", async () => {
    const vaultRoot = await makeVaultRoot();
    const previewInput = createAutomationPayload({
      automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FAZ",
      slug: undefined,
      title: "  Nightly Digest  ",
      summary: "  Trimmed summary  ",
      status: "paused",
      continuityPolicy: "fresh",
      instructions: "Draft a nightly digest.  \n",
      tags: ["nightly", "nightly", "assistant"],
    });

    const previewMarkdown = buildAutomationMarkdownPreview(previewInput);
    const previewDocument = parseFrontmatterDocument(previewMarkdown);
    const previewRelativePath = `bank/automations/${previewDocument.attributes.slug}.md`;

    await fs.mkdir(path.join(vaultRoot, "bank/automations"), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, previewRelativePath), previewMarkdown, "utf8");

    expect(previewDocument.attributes.slug).toBe("nightly-digest");
    expect(previewDocument.attributes.summary).toBe("Trimmed summary");
    expect(previewDocument.attributes.tags).toEqual(["nightly", "assistant"]);
    expect(previewDocument.body).toBe("Draft a nightly digest.");

    const readMarkdown = await readAutomationMarkdown(vaultRoot, previewInput.automationId!);
    expect(readMarkdown).toBe(previewMarkdown);

    const readRecord = await readAutomation({
      vaultRoot,
      automationId: previewInput.automationId!,
    });

    expect(readRecord.relativePath).toBe(previewRelativePath);
    expect(readRecord.instructions).toBe("Draft a nightly digest.");
    expect(readRecord.status).toBe("paused");
    expect(readRecord.summary).toBe("Trimmed summary");
    expect(readRecord.tags).toEqual(["nightly", "assistant"]);
  });
});
