import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAutomationSupportSeriesTag } from "@murphai/contracts";
import { listAutomationPage, listAutomations } from "../src/index.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, { force: true, recursive: true })
    ),
  );
});

describe("automation exact-tag pagination", () => {
  it("pages every exact support-series match beyond 200 by immutable id", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-automation-page-"));
    createdVaultRoots.push(vaultRoot);
    await mkdir(path.join(vaultRoot, "bank/automations"), { recursive: true });
    const exactTag = buildAutomationSupportSeriesTag("experiment:exp_sleep");
    const otherTag = buildAutomationSupportSeriesTag("experiment:exp_sleep-other");
    await Promise.all([
      ...Array.from({ length: 205 }, (_, index) =>
        writeAutomation(vaultRoot, index, exactTag)
      ),
      writeAutomation(vaultRoot, 999, otherTag),
    ]);

    const first = await listAutomationPage(vaultRoot, {
      exactTag,
      limit: 200,
    });
    expect(first.totalCount).toBe(205);
    expect(first.items).toHaveLength(200);
    expect(first.items[0]?.automationId).toBe("automation_page_000");
    expect(first.nextCursor).toBe("automation_page_199");
    expect(first.items.every((record) => record.activeUntil === "2026-08-01T00:00:00.000Z"))
      .toBe(true);

    const second = await listAutomationPage(vaultRoot, {
      cursor: first.nextCursor ?? undefined,
      exactTag,
      limit: 200,
    });
    expect(second.totalCount).toBe(205);
    expect(second.items.map((record) => record.automationId)).toEqual([
      "automation_page_200",
      "automation_page_201",
      "automation_page_202",
      "automation_page_203",
      "automation_page_204",
    ]);
    expect(second.nextCursor).toBeNull();

    const exactMatches = await listAutomations(vaultRoot, { exactTag });
    expect(exactMatches).toHaveLength(205);
    expect(exactMatches.some((record) => record.automationId === "automation_page_999"))
      .toBe(false);
  });

  it("rejects a one-shot whose exclusive end equals its scheduled instant", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-automation-bound-"));
    createdVaultRoots.push(vaultRoot);
    await mkdir(path.join(vaultRoot, "bank/automations"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "bank/automations/equal-bound.md"),
      [
        "---",
        "schemaVersion: murph.frontmatter.automation.v1",
        "docType: automation",
        "automationId: automation_equal_bound",
        "slug: equal-bound",
        "title: Equal bound",
        "status: active",
        "activeUntil: 2026-08-01T08:00:00.000Z",
        "schedule:",
        "  kind: at",
        "  at: 2026-08-01T08:00:00.000Z",
        "route:",
        "  channel: linq",
        "  deliveryTarget: test-target",
        "  identityId: null",
        "  participantId: null",
        "  threadId: null",
        "continuityPolicy: preserve",
        "createdAt: 2026-07-15T00:00:00.000Z",
        "updatedAt: 2026-07-15T00:00:00.000Z",
        "---",
        "",
        "This cannot fire before its exclusive end.",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(listAutomationPage(vaultRoot))
      .rejects.toThrow(/activeUntil must be after schedule\.at/u);
  });
});

async function writeAutomation(
  vaultRoot: string,
  index: number,
  tag: string,
): Promise<void> {
  const suffix = String(index).padStart(3, "0");
  const slug = `page-${suffix}`;
  await writeFile(
    path.join(vaultRoot, "bank/automations", `${slug}.md`),
    [
      "---",
      "schemaVersion: murph.frontmatter.automation.v1",
      "docType: automation",
      `automationId: automation_page_${suffix}`,
      `slug: ${slug}`,
      `title: Page ${suffix}`,
      "status: active",
      "activeUntil: 2026-08-01T00:00:00.000Z",
      "schedule:",
      "  kind: every",
      "  everyMs: 60000",
      "route:",
      "  channel: linq",
      "  deliveryTarget: test-target",
      "  identityId: null",
      "  participantId: null",
      "  threadId: null",
      "continuityPolicy: preserve",
      "tags:",
      `  - ${tag}`,
      "createdAt: 2026-07-15T00:00:00.000Z",
      "updatedAt: 2026-07-15T00:00:00.000Z",
      "---",
      "",
      `Run page ${suffix}.`,
      "",
    ].join("\n"),
    "utf8",
  );
}
