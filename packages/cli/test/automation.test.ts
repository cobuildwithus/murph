import assert from "node:assert/strict";

import { test } from "vitest";

import {
  automationRecordSchema,
  automationScaffoldResultSchema,
  createAutomationScaffoldPayload,
} from "../src/commands/automation.js";

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
