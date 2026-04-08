import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import {
  resolveSlugMarkdownDocumentTarget,
  writeCanonicalMarkdownDocument,
} from "../src/markdown-documents.ts";
import { scaffoldAutomationPayload, upsertAutomation } from "../src/automation.ts";

async function createTempVaultRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "murph-core-markdown-"));
}

const tempRoots: string[] = [];

async function makeVaultRoot(): Promise<string> {
  const root = await createTempVaultRoot();
  tempRoots.push(root);
  return root;
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
      summary: created.record.summary,
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
});
