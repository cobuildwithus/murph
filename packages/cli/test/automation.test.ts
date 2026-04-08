import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import {
  automationRecordSchema,
  automationScaffoldResultSchema,
  createAutomationScaffoldPayload,
  registerAutomationCommands,
} from "../src/commands/automation.js";
import { createTempVaultContext, runInProcessJsonCli } from "./cli-test-helpers.js";

test("automation scaffold payload uses the canonical default shape", () => {
  const payload = createAutomationScaffoldPayload();

  assert.deepEqual(payload, {
    title: "Weekly check-in",
    slug: "weekly-check-in",
    status: "active",
    continuityPolicy: "preserve",
    schedule: {
      kind: "cron",
      expression: "0 9 * * 1",
      timeZone: "Australia/Sydney",
    },
    route: {
      channel: "imessage",
      deliverResponse: true,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    },
    prompt: "Write the scheduled assistant prompt here.",
    summary: "Weekly scheduled assistant prompt.",
    tags: ["assistant", "scheduled"],
  });

  assert.doesNotThrow(() => automationScaffoldResultSchema.parse({
    vault: "./vault",
    noun: "automation",
    payload,
  }));
});

test("automation record schema accepts the canonical automation shape", () => {
  const parsed = automationRecordSchema.parse({
    automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWQ",
    slug: "weekly-check-in",
    title: "Weekly check-in",
    status: "active",
    summary: "Weekly scheduled assistant prompt.",
    schedule: {
      kind: "cron",
      expression: "0 9 * * 1",
      timeZone: "Australia/Sydney",
    },
    route: {
      channel: "imessage",
      deliverResponse: true,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    },
    continuityPolicy: "preserve",
    tags: ["assistant", "scheduled"],
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    prompt: "Write the scheduled assistant prompt here.",
    relativePath: "bank/automations/weekly-check-in.md",
    markdown: "---\n...\n---\nWrite the scheduled assistant prompt here.\n",
  });

  assert.equal(parsed.slug, "weekly-check-in");
  assert.equal(parsed.route.deliverResponse, true);
  assert.equal(parsed.schedule.kind, "cron");
});

test("automation record schema rejects invalid slugs", () => {
  assert.throws(() => automationRecordSchema.parse({
    automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWQ",
    slug: "Weekly check-in",
    title: "Weekly check-in",
    status: "active",
    summary: "Weekly scheduled assistant prompt.",
    schedule: {
      kind: "cron",
      expression: "0 9 * * 1",
      timeZone: "Australia/Sydney",
    },
    route: {
      channel: "imessage",
      deliverResponse: true,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    },
    continuityPolicy: "preserve",
    tags: ["assistant", "scheduled"],
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    prompt: "Write the scheduled assistant prompt here.",
    relativePath: "bank/automations/weekly-check-in.md",
    markdown: "---\n...\n---\nWrite the scheduled assistant prompt here.\n",
  }));
});

test("automation scaffold command returns the canonical scaffold envelope", async () => {
  const cli = Cli.create("vault-cli", {
    description: "automation test cli",
    version: "0.0.0-test",
  });

  registerAutomationCommands(cli);

  const { envelope, exitCode } = await runInProcessJsonCli(cli, [
    "automation",
    "scaffold",
    "--vault",
    "./vault",
  ]);

  assert.equal(exitCode, null);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, {
    vault: "./vault",
    noun: "automation",
    payload: createAutomationScaffoldPayload(),
  });
});

test("automation commands round-trip upsert, show, and list through the registered CLI", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-cli-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const payload = {
      ...createAutomationScaffoldPayload(),
      title: "Daily mobility",
      slug: "daily-mobility",
      summary: "Mobility prompt.",
      prompt: "Check mobility work.",
    };
    const payloadPath = path.join(parentRoot, "automation.json");
    await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const upserted = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
      path: string;
      vault: string;
    }>(cli, [
      "automation",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(upserted.exitCode, null);
    assert.equal(upserted.envelope.ok, true);

    const upsertedData = upserted.envelope.data;
    if (upsertedData === undefined) {
      throw new Error("Expected automation upsert data.");
    }

    assert.equal(upsertedData.created, true);
    assert.equal(upsertedData.lookupId, payload.slug);

    const shown = await runInProcessJsonCli<{
      automation: {
        automationId: string;
        slug: string;
        title: string;
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      payload.slug,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);

    const shownData = shown.envelope.data;
    if (shownData === undefined || shownData.automation === null) {
      throw new Error("Expected automation show data.");
    }

    assert.equal(shownData.automation.automationId, upsertedData.automationId);
    assert.equal(shownData.automation.slug, payload.slug);
    assert.equal(shownData.automation.title, payload.title);

    const listed = await runInProcessJsonCli<{
      count: number;
      filters: {
        limit: number;
        status: string[] | null;
        text: string | null;
      };
      items: Array<{
        automationId: string;
        slug: string;
      }>;
      vault: string;
    }>(cli, [
      "automation",
      "list",
      "--limit",
      "10",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(listed.exitCode, null);
    assert.equal(listed.envelope.ok, true);

    const listedData = listed.envelope.data;
    if (listedData === undefined) {
      throw new Error("Expected automation list data.");
    }

    assert.equal(listedData.count, 1);
    assert.equal(listedData.filters.limit, 10);
    assert.deepEqual(listedData.items.map((item) => item.slug), [payload.slug]);
    assert.equal(listedData.items[0]?.automationId, upsertedData.automationId);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
