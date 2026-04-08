import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import {
  resolveSlugMarkdownDocumentTarget,
  writeCanonicalMarkdownDocument,
} from "../src/markdown-documents.ts";
import {
  buildAutomationMarkdownPreview,
  listAutomations,
  readAutomation,
  readAutomationMarkdown,
  scaffoldAutomationPayload,
  showAutomation,
  upsertAutomation,
} from "../src/automation.ts";

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

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      fs.rm(root, { recursive: true, force: true })
    ),
  );
});

describe("markdown document primitives", () => {
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
      prompt: created.record.prompt,
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
    expect(parsed.body).toContain(result.record.prompt);
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
        prompt: "Report the sleep recovery highlights.",
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
        prompt: "Track project handoff blockers.",
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
        prompt: "Retire stale automation notes.",
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
        prompt: "Report the sleep recovery highlights.",
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
        prompt: "Track project handoff blockers.",
        tags: ["project", "handoff"],
      }),
    });

    const readById = await readAutomation({
      vaultRoot,
      automationId: active.record.automationId,
    });

    expect(readById.slug).toBe("sleep-check-in");
    expect(readById.prompt).toBe("Report the sleep recovery highlights.");

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
      prompt: "Draft a nightly digest.  \n",
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
    expect(readRecord.prompt).toBe("Draft a nightly digest.");
    expect(readRecord.status).toBe("paused");
    expect(readRecord.summary).toBe("Trimmed summary");
    expect(readRecord.tags).toEqual(["nightly", "assistant"]);
  });
});
