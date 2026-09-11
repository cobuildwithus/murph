import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  listAutomations,
  listAutomationPage,
  readAutomationByRelativePath,
} from "../src/automation.ts";

const vaults: string[] = [];

afterEach(async () => {
  await Promise.all(vaults.splice(0).map((vault) => rm(vault, { recursive: true, force: true })));
});

async function createVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-automation-query-"));
  vaults.push(vault);
  await mkdir(path.join(vault, "bank/automations"), { recursive: true });
  return vault;
}

async function writeAutomation(
  vault: string,
  filename: string,
  input: {
    id: string;
    status: string;
    everyMs?: number;
    instructions?: string;
  },
): Promise<void> {
  await writeFile(path.join(vault, "bank/automations", `${filename}.md`), [
    "---",
    "schemaVersion: murph.frontmatter.automation.v1",
    "docType: automation",
    `automationId: ${input.id}`,
    "slug: optional-follow-up",
    "title: Optional follow-up",
    `status: ${input.status}`,
    "followUpSourceIntentId: synthetic-source-intent",
    "activeUntil: 2030-01-03T00:00:00.000Z",
    "schedule:",
    "  kind: every",
    `  everyMs: ${input.everyMs ?? 60000}`,
    "route:",
    "  channel: telegram",
    "  participantId: synthetic-actor",
    "  threadId: synthetic-thread",
    "  threadIsDirect: true",
    "tags:",
    "  - synthetic-support",
    "createdAt: 2030-01-01T00:00:00.000Z",
    "updatedAt: 2030-01-02T00:00:00.000Z",
    "---",
    "",
    input.instructions ?? "Necessary phrase.\n\nPreserve this second paragraph.   ",
    "",
  ].join("\n"));
}

it("preserves filtered automation ordering, body, pagination, and fresh canonical edits across read batches", async () => {
  const vault = await createVault();
  await writeAutomation(vault, "00-first", { id: "auto_z", status: "active" });
  for (let index = 0; index < 18; index++) {
    await writeAutomation(vault, `archive-${index}`, {
      id: `auto_archived_${index}`,
      status: "archived",
    });
  }
  await writeAutomation(vault, "98-second", { id: "auto_b", status: "paused" });
  await writeAutomation(vault, "99-last", { id: "auto_a", status: "legacy-unknown" });

  const options = {
    status: ["active", "paused"],
    text: "necessary phrase",
    exactTag: "synthetic-support",
  };
  const records = await listAutomations(vault, options);
  expect(records.map((record) => [record.automationId, record.status])).toEqual([
    ["auto_a", "active"],
    ["auto_b", "paused"],
    ["auto_z", "active"],
  ]);
  expect(records.every((record) =>
    record.instructions === "Necessary phrase.\n\nPreserve this second paragraph."
    && record.followUpSourceIntentId === "synthetic-source-intent"
    && record.route.threadIsDirect === true
  )).toBe(true);
  expect(await readAutomationByRelativePath(vault, "bank/automations/99-last.md"))
    .toEqual(records[0]);
  expect(await listAutomations(vault, { ...options, limit: 2 })).toEqual(records.slice(0, 2));

  const firstPage = await listAutomationPage(vault, { ...options, limit: 2 });
  expect(firstPage).toEqual({ items: records.slice(0, 2), nextCursor: "auto_b", totalCount: 3 });
  expect(await listAutomationPage(vault, { ...options, limit: 2, cursor: "auto_b" }))
    .toEqual({ items: records.slice(2), nextCursor: null, totalCount: 3 });

  await writeAutomation(vault, "99-last", { id: "auto_a", status: "archived" });
  expect(await listAutomations(vault, options)).toEqual(records.slice(1));
});

it.each([
  { everyMs: 0, instructions: "Valid body", error: /schedule\.everyMs/u },
  { everyMs: 60000, instructions: "   ", error: /instructions body/u },
])("validates excluded archived documents after a matching limited result: $error", async ({
  everyMs, instructions, error,
}) => {
  const vault = await createVault();
  await writeAutomation(vault, "00-active", { id: "auto_active", status: "active" });
  for (let index = 0; index < 16; index++) {
    await writeAutomation(vault, `archive-${index}`, {
      id: `auto_archived_${index}`,
      status: "archived",
    });
  }
  await writeAutomation(vault, "zz-invalid", {
    id: "auto_invalid", status: "archived", everyMs, instructions,
  });

  const options = { status: ["active", "paused"], limit: 1 };
  await expect(listAutomations(vault, options)).rejects.toThrow(error);
  await expect(listAutomationPage(vault, options)).rejects.toThrow(error);
});
