import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";

import {
  AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  buildAutomationSupportSeriesTag,
} from "@murphai/contracts";
import { HOSTED_RUNTIME_PROCESS_ENV } from "@murphai/hosted-execution/env";
import { upsertAutomation } from "@murphai/core";
import {
  automationRecordSchema,
  automationScaffoldResultSchema,
  createAutomationScaffoldPayload,
  registerAutomationCommands,
} from "../src/commands/automation.js";
import { createTempVaultContext, runInProcessJsonCli } from "./cli-test-helpers.js";

const LEGACY_ROUTE_CHANNEL_ENV_NAME = [
  "MURPH_ASSISTANT_CURRENT",
  "DELIVERY_ROUTE_CHANNEL",
].join("_");
const LEGACY_ROUTE_TARGET_ENV_NAME = [
  "MURPH_ASSISTANT_CURRENT",
  "DELIVERY_ROUTE_TARGET",
].join("_");

afterEach(() => {
  vi.unstubAllEnvs();
});

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>;
    required?: string[];
  };
  options: {
    properties: Record<string, unknown>;
    required?: string[];
  };
}

async function runRawInProcessCli(cli: Cli.Cli, args: string[]): Promise<string> {
  const output: string[] = [];
  let exitCode: number | null = null;

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code;
    },
    stdout(chunk) {
      output.push(chunk);
    },
  });

  assert.equal(exitCode, null);
  return output.join("").trim();
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, "--schema", "--format", "json"]),
  ) as CommandSchemaEnvelope;
}

function optionDescription(schema: CommandSchemaEnvelope, optionName: string): string {
  const property = schema.options.properties[optionName];
  assert.equal(typeof property, "object", `missing ${optionName}`);
  assert.notEqual(property, null, `missing ${optionName}`);

  const description = (property as { description?: unknown }).description;
  if (typeof description !== "string") {
    assert.fail(`missing ${optionName} description`);
  }
  return description;
}

function hasCommandMap(value: unknown): value is { commands: Map<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "commands" in value &&
    value.commands instanceof Map
  );
}

function requireAutomationCommandNames(cli: Cli.Cli): string[] {
  const commands = Cli.toCommands.get(cli);
  const automation = commands?.get("automation");

  if (!hasCommandMap(automation)) {
    throw new Error("Expected automation command group to be registered.");
  }

  return [...automation.commands.keys()].map((name) => `automation ${name}`);
}

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
    },
    route: {
      channel: "telegram",
      deliverySource: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    assistantTargetOverride: null,
    supportKind: null,
    instructions: "Write the scheduled assistant instructions here.",
    summary: "Weekly scheduled assistant notification instructions.",
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
    summary: "Weekly scheduled assistant notification instructions.",
    schedule: {
      kind: "cron",
      expression: "0 9 * * 1",
    },
    route: {
      channel: "telegram",
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    assistantTargetOverride: null,
    supportKind: null,
    continuityPolicy: "preserve",
    tags: ["assistant", "scheduled"],
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    instructions: "Write the scheduled assistant instructions here.",
    relativePath: "bank/automations/weekly-check-in.md",
    markdown: "---\n...\n---\nWrite the scheduled assistant instructions here.\n",
  });

  assert.equal(parsed.slug, "weekly-check-in");
  assert.equal(parsed.route.channel, "telegram");
  assert.equal(parsed.schedule.kind, "cron");
});

const recurringTimeZoneAutomationRecord = {
  automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWX",
  slug: "timezone-weekly-check-in",
  title: "Timezone weekly check-in",
  status: "active",
  summary: "Timezone-aware scheduled assistant notification instructions.",
  schedule: {
    kind: "cron",
    expression: "0 9 * * 1",
    timeZone: "Australia/Sydney",
  },
  route: {
    channel: "telegram",
    deliveryTarget: null,
    identityId: null,
    participantId: null,
    threadId: null,
  },
  assistantTargetOverride: null,
  supportKind: null,
  continuityPolicy: "preserve",
  tags: ["assistant", "scheduled"],
  createdAt: "2026-04-06T00:00:00.000Z",
  scheduleAnchorAt: "2026-04-06T00:00:00.000Z",
  updatedAt: "2026-04-06T00:00:00.000Z",
  instructions: "Write the scheduled assistant instructions here.",
  relativePath: "bank/automations/timezone-weekly-check-in.md",
  markdown: "---\n...\n---\nWrite the scheduled assistant instructions here.\n",
} as const;

test("automation record schema accepts recurring schedules with a valid timeZone", () => {
  const parsed = automationRecordSchema.parse(recurringTimeZoneAutomationRecord);

  assert.deepEqual(parsed.schedule, {
    kind: "cron",
    expression: "0 9 * * 1",
    timeZone: "Australia/Sydney",
  });
  assert.equal(parsed.scheduleAnchorAt, "2026-04-06T00:00:00.000Z");
});

test("automation record schema rejects recurring schedules with an invalid timeZone", () => {
  assert.throws(() => automationRecordSchema.parse({
    ...recurringTimeZoneAutomationRecord,
    schedule: {
      ...recurringTimeZoneAutomationRecord.schedule,
      timeZone: "Mars/Olympus_Mons",
    },
  }), /IANA time zone/u);
});

test("automation record schema rejects invalid slugs", () => {
  assert.throws(() => automationRecordSchema.parse({
    automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWQ",
    slug: "Weekly check-in",
    title: "Weekly check-in",
    status: "active",
    summary: "Weekly scheduled assistant notification instructions.",
    schedule: {
      kind: "cron",
      expression: "0 9 * * 1",
    },
    route: {
      channel: "telegram",
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    continuityPolicy: "preserve",
    tags: ["assistant", "scheduled"],
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    instructions: "Write the scheduled assistant instructions here.",
    relativePath: "bank/automations/weekly-check-in.md",
    markdown: "---\n...\n---\nWrite the scheduled assistant instructions here.\n",
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

test("automation save and edit schemas expose typed fields while automation import-json is the JSON fallback", async () => {
  const cli = Cli.create("vault-cli", {
    description: "automation test cli",
    version: "0.0.0-test",
  });
  registerAutomationCommands(cli);

  const automationCommandNames = requireAutomationCommandNames(cli);
  assert.equal(automationCommandNames.includes("automation save"), true);
  assert.equal(automationCommandNames.includes("automation edit"), true);
  assert.equal(automationCommandNames.includes("automation import-json"), true);
  assert.equal(automationCommandNames.includes("automation set-status"), true);
  assert.equal(automationCommandNames.includes("automation reconcile-support-series"), true);
  assert.equal(automationCommandNames.includes("automation upsert"), false);

  const saveSchema = await readCommandSchema(cli, ["automation", "save"]);
  assert.deepEqual(saveSchema.args.required, ["title"]);
  assert.equal("input" in saveSchema.options.properties, false);
  assert.equal(saveSchema.options.required?.includes("input") ?? false, false);
  assert.equal(saveSchema.options.required?.includes("channel") ?? false, false);

  for (const field of [
    "id",
    "slug",
    "status",
    "summary",
    "activeUntil",
    "clearActiveUntil",
    "supportSeriesId",
    "tag",
    "tags",
    "continuityPolicy",
    "instructions",
    "scheduleKind",
    "scheduleAt",
    "scheduleEveryMs",
    "scheduleCron",
    "scheduleLocalTime",
    "channel",
    "deliveryTarget",
    "identityId",
    "participantId",
    "threadId",
    "assistantTargetOverrideModel",
    "assistantTargetOverrideModelProvider",
    "assistantTargetOverrideReasoningEffort",
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field);
  }

  const editSchema = await readCommandSchema(cli, ["automation", "edit"]);
  assert.deepEqual(editSchema.args.required, ["lookup"]);
  assert.equal("input" in editSchema.options.properties, false);
  assert.equal(editSchema.options.required?.includes("instructions") ?? false, false);
  assert.equal(editSchema.options.required?.includes("channel") ?? false, false);
  for (const field of [
    "title",
    "continuityPolicy",
    "instructions",
    "channel",
    "assistantTargetOverrideModel",
    "assistantTargetOverrideModelProvider",
    "assistantTargetOverrideReasoningEffort",
    "clearAssistantTargetOverride",
    "activeUntil",
    "clearActiveUntil",
    "supportSeriesId",
  ]) {
    assert.equal(field in editSchema.options.properties, true, field);
  }

  const importJsonSchema = await readCommandSchema(cli, ["automation", "import-json"]);
  assert.equal("input" in importJsonSchema.options.properties, true);
  assert.equal(importJsonSchema.options.required?.includes("input") ?? false, true);
  assert.deepEqual(importJsonSchema.args.required ?? [], []);

  const setStatusSchema = await readCommandSchema(cli, ["automation", "set-status"]);
  assert.deepEqual(setStatusSchema.args.required, ["lookup"]);
  assert.equal("status" in setStatusSchema.options.properties, true);
  assert.equal(setStatusSchema.options.required?.includes("status") ?? false, true);

  const listSchema = await readCommandSchema(cli, ["automation", "list"]);
  assert.equal("includeBody" in listSchema.options.properties, false);
  assert.equal("supportSeriesId" in listSchema.options.properties, true);
  assert.equal("cursor" in listSchema.options.properties, true);
});

test("automation save and edit manage assistant target overrides from typed fields", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-target-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const invalidReasoningEffort = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Invalid target override reminder",
      "--slug",
      "invalid-target-override-reminder",
      "--instructions",
      "This should fail before writing.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--assistant-target-override-reasoning-effort",
      "hihg",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(invalidReasoningEffort.exitCode, 1);
    assert.equal(invalidReasoningEffort.envelope.ok, false);
    assert.match(
      invalidReasoningEffort.envelope.ok
        ? ""
        : invalidReasoningEffort.envelope.error.message ?? "",
      /assistantTargetOverrideReasoningEffort|reasoning effort|low|medium|high|xhigh/u,
    );

    const saved = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
    }>(cli, [
      "automation",
      "save",
      "Target override reminder",
      "--slug",
      "target-override-reminder",
      "--instructions",
      "Run the higher-effort automation turn.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram_thread_real",
      "--assistant-target-override-model",
      "gpt-5.6-terra",
      "--assistant-target-override-model-provider",
      "vercel-ai-gateway",
      "--assistant-target-override-reasoning-effort",
      "high",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        assistantTargetOverride: {
          model?: string;
          modelProvider?: string;
          reasoningEffort?: string;
        } | null;
      } | null;
    }>(cli, [
      "automation",
      "show",
      "target-override-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.assistantTargetOverride, {
      model: "gpt-5.6-terra",
      modelProvider: "vercel-ai-gateway",
      reasoningEffort: "high",
    });

    const edited = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
    }>(cli, [
      "automation",
      "edit",
      "target-override-reminder",
      "--assistant-target-override-reasoning-effort",
      "medium",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(edited.exitCode, null);
    assert.equal(edited.envelope.ok, true);
    assert.equal(edited.envelope.data?.automationId, saved.envelope.data?.automationId);
    assert.equal(edited.envelope.data?.created, false);

    const editedShown = await runInProcessJsonCli<{
      automation: {
        assistantTargetOverride: {
          model?: string;
          modelProvider?: string;
          reasoningEffort?: string;
        } | null;
      } | null;
    }>(cli, [
      "automation",
      "show",
      "target-override-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(editedShown.exitCode, null);
    assert.equal(editedShown.envelope.ok, true);
    assert.deepEqual(editedShown.envelope.data?.automation?.assistantTargetOverride, {
      model: "gpt-5.6-terra",
      modelProvider: "vercel-ai-gateway",
      reasoningEffort: "medium",
    });

    const conflictingClear = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "target-override-reminder",
      "--clear-assistant-target-override",
      "--assistant-target-override-reasoning-effort",
      "low",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(conflictingClear.exitCode, 1);
    assert.equal(conflictingClear.envelope.ok, false);
    assert.match(
      conflictingClear.envelope.ok ? "" : conflictingClear.envelope.error.message ?? "",
      /cannot be combined/u,
    );

    const cleared = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
    }>(cli, [
      "automation",
      "edit",
      "target-override-reminder",
      "--clear-assistant-target-override",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(cleared.exitCode, null);
    assert.equal(cleared.envelope.ok, true);
    assert.equal(cleared.envelope.data?.automationId, saved.envelope.data?.automationId);
    assert.equal(cleared.envelope.data?.created, false);

    const clearedShown = await runInProcessJsonCli<{
      automation: {
        assistantTargetOverride: unknown;
      } | null;
    }>(cli, [
      "automation",
      "show",
      "target-override-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(clearedShown.exitCode, null);
    assert.equal(clearedShown.envelope.ok, true);
    assert.equal(clearedShown.envelope.data?.automation?.assistantTargetOverride, null);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save guidance keeps examples shell-copyable", async () => {
  const cli = Cli.create("vault-cli", {
    description: "automation test cli",
    version: "0.0.0-test",
  });
  registerAutomationCommands(cli);

  const schema = await readCommandSchema(cli, ["automation", "save"]);
  const help = await runRawInProcessCli(cli, ["automation", "save", "--help"]);
  const llms = await runRawInProcessCli(cli, ["automation", "save", "--llms-full"]);

  assert.match(optionDescription(schema, "tag"), /Repeat --tag/u);
  assert.match(optionDescription(schema, "tags"), /Legacy alias for --tag/u);
  for (const rendered of [help, llms]) {
    assert.match(rendered, /automation save 'Daily mobility'/u);
    assert.match(rendered, /--instructions 'Ask about mobility work and summarize the next step\.'/u);
  }
});

test("hosted automation CLI mutations fail closed while reads stay available", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-hosted-root-tool-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const seeded = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Existing reminder",
      "--slug",
      "existing-reminder",
      "--status",
      "paused",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram_thread_real",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(seeded.envelope.ok, true);

    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    const mutations = [
      [
        "automation",
        "save",
        "Blocked reminder",
        "--instructions",
        "Send the reminder.",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "edit",
        "existing-reminder",
        "--summary",
        "Blocked edit",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "set-status",
        "existing-reminder",
        "--status",
        "active",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "import-json",
        "--input",
        `@${path.join(parentRoot, "not-read.json")}`,
        "--vault",
        vaultRoot,
      ],
    ] as const;

    for (const args of mutations) {
      const result = await runInProcessJsonCli(cli, [...args]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.envelope.ok, false);
      if (!result.envelope.ok) {
        assert.match(result.envelope.error.message ?? "", /root hosted automation tool/u);
      }
    }

    const shown = await runInProcessJsonCli(cli, [
      "automation",
      "show",
      "existing-reminder",
      "--vault",
      vaultRoot,
    ]);
    const listed = await runInProcessJsonCli(cli, [
      "automation",
      "list",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.equal(listed.envelope.ok, true);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation edit patches sparse fields without implicit route rebinding", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-edit-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const saved = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
    }>(cli, [
      "automation",
      "save",
      "Preserve route reminder",
      "--slug",
      "preserve-route-reminder",
      "--continuity-policy",
      "fresh",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--tag",
      "assistant",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_chat_real",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);
    assert.equal(saved.envelope.data?.created, true);

    const edited = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
    }>(cli, [
      "automation",
      "edit",
      "preserve-route-reminder",
      "--continuity-policy",
      "preserve",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(edited.exitCode, null);
    assert.equal(edited.envelope.ok, true);
    assert.equal(edited.envelope.data?.automationId, saved.envelope.data?.automationId);
    assert.equal(edited.envelope.data?.created, false);

    const shown = await runInProcessJsonCli<{
      automation: {
        continuityPolicy: string;
        instructions: string;
        route: {
          channel: string;
          deliveryTarget: string | null;
        };
        schedule: {
          kind: string;
          localTime?: string;
          timeZone?: string;
        };
        tags: string[];
      } | null;
    }>(cli, [
      "automation",
      "show",
      "preserve-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.continuityPolicy, "preserve");
    assert.equal(shown.envelope.data?.automation?.instructions, "Send the reminder.");
    assert.equal(shown.envelope.data?.automation?.route.channel, "linq");
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, "linq_chat_real");
    assert.equal(shown.envelope.data?.automation?.schedule.kind, "dailyLocal");
    assert.equal(shown.envelope.data?.automation?.schedule.localTime, "08:30");
    assert.equal(shown.envelope.data?.automation?.schedule.timeZone, undefined);
    assert.deepEqual(shown.envelope.data?.automation?.tags, ["assistant"]);

    const routeShown = await runInProcessJsonCli<{
      automation: {
        instructions: string;
        route: {
          channel: string;
          deliveryTarget: string | null;
        };
        schedule: {
          kind: string;
          localTime?: string;
        };
        tags: string[];
      } | null;
    }>(cli, [
      "automation",
      "show",
      "preserve-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(routeShown.exitCode, null);
    assert.equal(routeShown.envelope.ok, true);
    assert.equal(routeShown.envelope.data?.automation?.route.channel, "linq");
    assert.equal(routeShown.envelope.data?.automation?.route.deliveryTarget, "linq_chat_real");
    assert.equal(routeShown.envelope.data?.automation?.instructions, "Send the reminder.");
    assert.equal(routeShown.envelope.data?.automation?.schedule.kind, "dailyLocal");
    assert.equal(routeShown.envelope.data?.automation?.schedule.localTime, "08:30");
    assert.deepEqual(routeShown.envelope.data?.automation?.tags, ["assistant"]);

    const tagEdited = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
    }>(cli, [
      "automation",
      "edit",
      "preserve-route-reminder",
      "--tag",
      "scheduled",
      "--tag",
      "experiment",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(tagEdited.exitCode, null);
    assert.equal(tagEdited.envelope.ok, true);
    assert.equal(tagEdited.envelope.data?.automationId, saved.envelope.data?.automationId);
    assert.equal(tagEdited.envelope.data?.created, false);

    const mixedTags = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "preserve-route-reminder",
      "--tag",
      "scheduled",
      "--tags",
      "experiment",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(mixedTags.exitCode, 1);
    assert.equal(mixedTags.envelope.ok, false);
    assert.match(
      mixedTags.envelope.ok ? "" : mixedTags.envelope.error.message ?? "",
      /Use --tag or legacy --tags, not both/u,
    );

    const tagShown = await runInProcessJsonCli<{
      automation: {
        instructions: string;
        route: {
          channel: string;
          deliveryTarget: string | null;
        };
        schedule: {
          kind: string;
          localTime?: string;
        };
        tags: string[];
      } | null;
    }>(cli, [
      "automation",
      "show",
      "preserve-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(tagShown.exitCode, null);
    assert.equal(tagShown.envelope.ok, true);
    assert.equal(tagShown.envelope.data?.automation?.route.channel, "linq");
    assert.equal(tagShown.envelope.data?.automation?.route.deliveryTarget, "linq_chat_real");
    assert.equal(tagShown.envelope.data?.automation?.instructions, "Send the reminder.");
    assert.equal(tagShown.envelope.data?.automation?.schedule.kind, "dailyLocal");
    assert.equal(tagShown.envelope.data?.automation?.schedule.localTime, "08:30");
    assert.deepEqual(tagShown.envelope.data?.automation?.tags, ["scheduled", "experiment"]);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation edit preserves an explicit timezone when changing wall-clock time", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-edit-timezone-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    await upsertAutomation({
      vaultRoot,
      ...createAutomationScaffoldPayload(),
      schedule: {
        kind: "dailyLocal",
        localTime: "21:00",
        timeZone: "America/Chicago",
      },
      slug: "central-evening-reminder",
      status: "paused",
      title: "Central evening reminder",
    });

    const edited = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "central-evening-reminder",
      "--trigger-kind",
      "dailyLocal",
      "--trigger-local-time",
      "22:00",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(edited.exitCode, null);
    assert.equal(edited.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        schedule: {
          kind: string;
          localTime?: string;
          timeZone?: string;
        };
      } | null;
    }>(cli, [
      "automation",
      "show",
      "central-evening-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.schedule, {
      kind: "dailyLocal",
      localTime: "22:00",
      timeZone: "America/Chicago",
    });
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save rejects routes without a deliverable target", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-route-required-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(LEGACY_ROUTE_CHANNEL_ENV_NAME, "linq");
    vi.stubEnv(LEGACY_ROUTE_TARGET_ENV_NAME, "linq_chat_real");

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Broken route reminder",
      "--slug",
      "broken-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--thread-id",
      "hid_redacted_thread",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, 1);
    assert.equal(saved.envelope.ok, false);

    const realThreadRoute = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Real thread route reminder",
      "--slug",
      "real-thread-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--thread-id",
      "linq_chat_real",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(realThreadRoute.exitCode, null);
    assert.equal(realThreadRoute.envelope.ok, true);

    const missingTelegramTarget = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Broken telegram route reminder",
      "--slug",
      "broken-telegram-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "telegram",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(missingTelegramTarget.exitCode, 1);
    assert.equal(missingTelegramTarget.envelope.ok, false);

    const missingChannel = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Broken missing channel reminder",
      "--slug",
      "broken-missing-channel-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--delivery-target",
      "telegram_thread_real",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(missingChannel.exitCode, 1);
    assert.equal(missingChannel.envelope.ok, false);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save and import-json reject email routes with only a thread locator", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-email-thread-only-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Email thread-only reminder",
      "--slug",
      "email-thread-only-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "0 11 * * 5",
      "--channel",
      "email",
      "--thread-id",
      "hbm_thread_locator",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, 1);
    assert.equal(saved.envelope.ok, false);
    assert.match(
      saved.envelope.error.message ?? "",
      /email automation routes require an explicit delivery target/i,
    );

    const payload = {
      ...createAutomationScaffoldPayload(),
      title: "Imported email thread-only reminder",
      slug: "imported-email-thread-only-reminder",
      instructions: "Send the reminder.",
      schedule: {
        kind: "cron",
        expression: "0 11 * * 5",
      },
      route: {
        channel: "email",
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: "hbm_thread_locator",
      },
    };
    const payloadPath = path.join(parentRoot, "email-thread-only-automation.json");
    await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const imported = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.exitCode, 1);
    assert.equal(imported.envelope.ok, false);
    assert.match(
      imported.envelope.error.message ?? "",
      /email automation routes require an explicit delivery target/i,
    );
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation active writes require a sender identity for local explicit email targets", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-email-identity-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Email identity reminder",
      "--slug",
      "email-identity-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "0 11 * * 5",
      "--channel",
      "email",
      "--delivery-target",
      "member@example.com",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, 1);
    assert.equal(saved.envelope.ok, false);
    assert.match(saved.envelope.error.message ?? "", /sender identity/i);

    const savedPrivateIdentity = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Email private identity reminder",
      "--slug",
      "email-private-identity-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "0 11 * * 5",
      "--channel",
      "email",
      "--delivery-target",
      "member@example.com",
      "--identity-id",
      "hid_email_identity",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(savedPrivateIdentity.exitCode, 1);
    assert.equal(savedPrivateIdentity.envelope.ok, false);
    assert.match(savedPrivateIdentity.envelope.error.message ?? "", /sender identity/i);

    const payload = {
      ...createAutomationScaffoldPayload(),
      title: "Imported email identity reminder",
      slug: "imported-email-identity-reminder",
      instructions: "Send the reminder.",
      schedule: {
        kind: "cron",
        expression: "0 11 * * 5",
      },
      route: {
        channel: "email",
        deliveryTarget: "member@example.com",
        identityId: "hid_email_identity",
        participantId: null,
        threadId: null,
      },
    };
    const payloadPath = path.join(parentRoot, "email-identity-automation.json");
    await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const imported = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.exitCode, 1);
    assert.equal(imported.envelope.ok, false);
    assert.match(imported.envelope.error.message ?? "", /sender identity/i);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation active writes allow local email participant routes with a sender identity", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-email-participant-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Email participant reminder",
      "--slug",
      "email-participant-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "0 11 * * 5",
      "--channel",
      "email",
      "--identity-id",
      "agentmail-inbox-1",
      "--participant-id",
      "recipient@example.test",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
        };
      } | null;
    }>(cli, [
      "automation",
      "show",
      "email-participant-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, null);
    assert.equal(shown.envelope.data?.automation?.route.identityId, "agentmail-inbox-1");
    assert.equal(shown.envelope.data?.automation?.route.participantId, "recipient@example.test");
    assert.equal(shown.envelope.data?.automation?.route.threadId, null);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation set-status and edit reject reactivating invalid legacy email routes", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-legacy-email-active-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    async function createLegacyInvalidEmailAutomation(slug: string) {
      return upsertAutomation({
        continuityPolicy: "fresh",
        instructions: "Send the reminder.",
        route: {
          channel: "email",
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: "email-thread-only",
        },
        schedule: {
          expression: "0 11 * * 5",
          kind: "cron",
        },
        slug,
        status: "paused",
        summary: null,
        tags: ["assistant", "scheduled"],
        title: `Legacy invalid email ${slug}`,
        vaultRoot,
      });
    }

    async function createLegacyIdentitylessEmailAutomation(slug: string) {
      return upsertAutomation({
        continuityPolicy: "fresh",
        instructions: "Send the reminder.",
        route: {
          channel: "email",
          deliveryTarget: "member@example.com",
          identityId: null,
          participantId: null,
          threadId: null,
        },
        schedule: {
          expression: "0 11 * * 5",
          kind: "cron",
        },
        slug,
        status: "paused",
        summary: null,
        tags: ["assistant", "scheduled"],
        title: `Legacy identity-less email ${slug}`,
        vaultRoot,
      });
    }

    const setStatusRecord = await createLegacyInvalidEmailAutomation(
      "legacy-email-set-status",
    );
    const editRecord = await createLegacyInvalidEmailAutomation(
      "legacy-email-edit",
    );
    const identitylessSetStatusRecord = await createLegacyIdentitylessEmailAutomation(
      "legacy-email-identityless-set-status",
    );
    const identitylessEditRecord = await createLegacyIdentitylessEmailAutomation(
      "legacy-email-identityless-edit",
    );

    const setStatusActive = await runInProcessJsonCli(cli, [
      "automation",
      "set-status",
      setStatusRecord.record.slug,
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(setStatusActive.exitCode, 1);
    assert.equal(setStatusActive.envelope.ok, false);
    assert.match(
      setStatusActive.envelope.error.message ?? "",
      /email automation routes require an explicit delivery target/i,
    );

    const identitylessSetStatusActive = await runInProcessJsonCli(cli, [
      "automation",
      "set-status",
      identitylessSetStatusRecord.record.slug,
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(identitylessSetStatusActive.exitCode, 1);
    assert.equal(identitylessSetStatusActive.envelope.ok, false);
    assert.match(
      identitylessSetStatusActive.envelope.error.message ?? "",
      /sender identity/i,
    );

    const archived = await runInProcessJsonCli(cli, [
      "automation",
      "set-status",
      setStatusRecord.record.slug,
      "--status",
      "archived",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(archived.exitCode, null);
    assert.equal(archived.envelope.ok, true);

    const editActive = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      editRecord.record.slug,
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(editActive.exitCode, 1);
    assert.equal(editActive.envelope.ok, false);
    assert.match(
      editActive.envelope.error.message ?? "",
      /email automation routes require an explicit delivery target/i,
    );

    const identitylessEditActive = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      identitylessEditRecord.record.slug,
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(identitylessEditActive.exitCode, 1);
    assert.equal(identitylessEditActive.envelope.ok, false);
    assert.match(
      identitylessEditActive.envelope.error.message ?? "",
      /sender identity/i,
    );

    const archivedEdit = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      editRecord.record.slug,
      "--status",
      "archived",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(archivedEdit.exitCode, null);
    assert.equal(archivedEdit.envelope.ok, true);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation commands round-trip save, import-json, show, and list through the registered CLI", async () => {
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
      instructions: "Check mobility work.",
    };
    const payloadPath = path.join(parentRoot, "automation.json");

    const saved = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
      path: string;
      vault: string;
    }>(cli, [
      "automation",
      "save",
      payload.title,
      "--slug",
      payload.slug,
      "--summary",
      payload.summary,
      "--instructions",
      payload.instructions,
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--channel",
      "telegram",
      "--delivery-target",
      "agentmail:daily",
      "--identity-id",
      "identity_daily",
      "--participant-id",
      "participant_daily",
      "--thread-id",
      "thread_daily",
      "--tags",
      "assistant",
      "--tags",
      "scheduled",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const savedData = saved.envelope.data;
    if (savedData === undefined) {
      throw new Error("Expected automation save data.");
    }

    assert.equal(savedData.created, true);
    assert.equal(savedData.lookupId, payload.slug);

    const importedPayload = {
      ...payload,
      title: "Weekly planning",
      slug: "weekly-planning",
      schedule: {
        kind: "cron",
        expression: "0 9 * * 1",
      },
      route: {
        channel: "email",
        deliveryTarget: "weekly-planning@example.invalid",
        identityId: "weekly-planning-sender",
        participantId: null,
        threadId: null,
      },
    };
    await writeFile(payloadPath, `${JSON.stringify(importedPayload, null, 2)}\n`, "utf8");

    const imported = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
      path: string;
      vault: string;
    }>(cli, [
      "automation",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.exitCode, null);
    assert.equal(imported.envelope.ok, true);

    const importedData = imported.envelope.data;
    if (importedData === undefined) {
      throw new Error("Expected automation import-json data.");
    }

    assert.equal(importedData.created, true);
    assert.equal(importedData.lookupId, importedPayload.slug);

    const shown = await runInProcessJsonCli<{
      automation: {
        automationId: string;
        slug: string;
        title: string;
        route: {
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
        };
        schedule: {
          kind: string;
          localTime?: string;
        };
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

    assert.equal(shownData.automation.automationId, savedData.automationId);
    assert.equal(shownData.automation.slug, payload.slug);
    assert.equal(shownData.automation.title, payload.title);
    assert.equal(shownData.automation.schedule.kind, "dailyLocal");
    assert.equal(shownData.automation.schedule.localTime, "08:30");
    assert.equal(shownData.automation.route.deliveryTarget, "agentmail:daily");
    assert.equal(shownData.automation.route.identityId, "identity_daily");
    assert.equal(shownData.automation.route.participantId, "participant_daily");
    assert.equal(shownData.automation.route.threadId, "thread_daily");

    const archived = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
      path: string;
      vault: string;
    }>(cli, [
      "automation",
      "set-status",
      payload.slug,
      "--status",
      "archived",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(archived.exitCode, null);
    assert.equal(archived.envelope.ok, true);
    assert.equal(archived.envelope.data?.created, false);
    assert.equal(archived.envelope.data?.automationId, savedData.automationId);

    const archivedShown = await runInProcessJsonCli<{
      automation: {
        automationId: string;
        instructions: string;
        route: {
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
        };
        schedule: {
          kind: string;
          localTime?: string;
        };
        status: string;
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      payload.slug,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(archivedShown.exitCode, null);
    assert.equal(archivedShown.envelope.ok, true);
    assert.equal(archivedShown.envelope.data?.automation?.status, "archived");
    assert.equal(
      archivedShown.envelope.data?.automation?.instructions,
      payload.instructions,
    );
    assert.equal(
      archivedShown.envelope.data?.automation?.schedule.localTime,
      "08:30",
    );
    assert.equal(
      archivedShown.envelope.data?.automation?.route.deliveryTarget,
      "agentmail:daily",
    );
    assert.equal(
      archivedShown.envelope.data?.automation?.route.identityId,
      "identity_daily",
    );
    assert.equal(
      archivedShown.envelope.data?.automation?.route.participantId,
      "participant_daily",
    );
    assert.equal(
      archivedShown.envelope.data?.automation?.route.threadId,
      "thread_daily",
    );

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

    assert.equal(listedData.count, 2);
    assert.equal(listedData.filters.limit, 10);
    assert.deepEqual(listedData.items.map((item) => item.slug), [
      payload.slug,
      importedPayload.slug,
    ]);
    assert.equal(listedData.items[0]?.automationId, savedData.automationId);
    assert.equal("instructions" in (listedData.items[0] ?? {}), false);
    assert.equal("markdown" in (listedData.items[0] ?? {}), false);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation support-series CLI pages exact matches and reconciles idempotently", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-support-series-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation support series test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    const seriesId = "experiment:exp_sleep";
    const supportSeriesTag = buildAutomationSupportSeriesTag(seriesId);
    const equalOneShotBound = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Equal one-shot bound",
      "--slug",
      "equal-one-shot-bound",
      "--instructions",
      "This one-shot must retain a finite retry window.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-08-01T08:00:00.000Z",
      "--active-until",
      "2026-08-01T08:00:00.000Z",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram:equal-bound",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(equalOneShotBound.exitCode, 1);
    assert.equal(equalOneShotBound.envelope.ok, false);
    assert.match(
      equalOneShotBound.envelope.ok
        ? ""
        : equalOneShotBound.envelope.error.message ?? "",
      /activeUntil must be after schedule\.at/u,
    );

    const manualSeriesId = "experiment:exp_manual";
    const manualSeries = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Manual support series",
      "--slug",
      "manual-support-series",
      "--instructions",
      "Send the manual support check-in.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram:manual-series",
      "--support-series-id",
      manualSeriesId,
      "--support-kind",
      "check_in",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(manualSeries.exitCode, null);
    assert.equal(manualSeries.envelope.ok, true);
    const shownManualSeries = await runInProcessJsonCli<{
      automation: { supportKind: string | null; tags: string[] } | null;
    }>(cli, [
      "automation",
      "show",
      "manual-support-series",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shownManualSeries.exitCode, null);
    assert.equal(shownManualSeries.envelope.ok, true);
    assert.deepEqual(shownManualSeries.envelope.data?.automation?.tags, [
      buildAutomationSupportSeriesTag(manualSeriesId),
    ]);
    assert.equal(
      shownManualSeries.envelope.data?.automation?.supportKind,
      "check_in",
    );

    const clearedManualSupportKind = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "manual-support-series",
      "--clear-support-kind",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(clearedManualSupportKind.exitCode, null);
    assert.equal(clearedManualSupportKind.envelope.ok, true);
    const shownClearedManualSeries = await runInProcessJsonCli<{
      automation: { supportKind: string | null } | null;
    }>(cli, [
      "automation",
      "show",
      "manual-support-series",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shownClearedManualSeries.envelope.ok, true);
    assert.equal(
      shownClearedManualSeries.envelope.data?.automation?.supportKind,
      null,
    );

    const automationIds = [
      "automation_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "automation_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      "automation_01ARZ3NDEKTSV4RRFFQ69G5FAX",
    ];
    const created = await Promise.all(
      Array.from({ length: 3 }, (_, index) => {
        const payload = createAutomationScaffoldPayload();
        return upsertAutomation({
          ...payload,
          activeUntil: "2026-08-01T00:00:00.000Z",
          automationId: automationIds[index],
          route: {
            ...payload.route,
            channel: "telegram",
            deliveryTarget: "telegram:series",
          },
          slug: `cli-series-${index}`,
          tags: [...(payload.tags ?? []), supportSeriesTag],
          title: `CLI series ${index}`,
          vaultRoot,
        });
      }),
    );

    const ordinaryTagEdit = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      created[0]?.record.slug ?? "missing",
      "--tag",
      "ordinary-tag",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(ordinaryTagEdit.exitCode, null);
    assert.equal(ordinaryTagEdit.envelope.ok, true);
    const shownOrdinaryTagEdit = await runInProcessJsonCli<{
      automation: { tags: string[] } | null;
    }>(cli, [
      "automation",
      "show",
      created[0]?.record.slug ?? "missing",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shownOrdinaryTagEdit.envelope.ok, true);
    assert.deepEqual(shownOrdinaryTagEdit.envelope.data?.automation?.tags, [
      "ordinary-tag",
      supportSeriesTag,
    ]);

    const sameOwner = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      created[0]?.record.slug ?? "missing",
      "--support-series-id",
      seriesId,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(sameOwner.exitCode, null);
    assert.equal(sameOwner.envelope.ok, true);

    const rawOwner = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      created[0]?.record.slug ?? "missing",
      "--tag",
      supportSeriesTag,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(rawOwner.exitCode, 1);
    assert.equal(rawOwner.envelope.ok, false);
    assert.match(
      rawOwner.envelope.ok ? "" : rawOwner.envelope.error.message ?? "",
      /reserved system:support-series:.*--support-series-id/iu,
    );

    const forgedReconcileMarker = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      created[0]?.record.slug ?? "missing",
      "--tag",
      AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(forgedReconcileMarker.exitCode, 1);
    assert.equal(forgedReconcileMarker.envelope.ok, false);
    assert.match(
      forgedReconcileMarker.envelope.ok
        ? ""
        : forgedReconcileMarker.envelope.error.message ?? "",
      /internal reconciliation marker/iu,
    );

    const changedOwner = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      created[0]?.record.slug ?? "missing",
      "--support-series-id",
      "experiment:exp_other",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(changedOwner.exitCode, 1);
    assert.equal(changedOwner.envelope.ok, false);
    assert.match(
      changedOwner.envelope.ok ? "" : changedOwner.envelope.error.message ?? "",
      /support series ownership cannot be removed or replaced/u,
    );

    const rawImportPayload = {
      ...createAutomationScaffoldPayload(),
      title: "Raw support-series import",
      slug: "raw-support-series-import",
      route: {
        ...createAutomationScaffoldPayload().route,
        channel: "telegram",
        deliveryTarget: "telegram:raw-series",
      },
      tags: [supportSeriesTag],
    };
    const rawImportPath = path.join(parentRoot, "raw-support-series-import.json");
    await writeFile(rawImportPath, `${JSON.stringify(rawImportPayload, null, 2)}\n`, "utf8");
    const rawImport = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${rawImportPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(rawImport.exitCode, 1);
    assert.equal(rawImport.envelope.ok, false);
    assert.match(
      rawImport.envelope.ok ? "" : rawImport.envelope.error.message ?? "",
      /reserved system:support-series:.*--support-series-id/iu,
    );

    const first = await runInProcessJsonCli<{
      count: number;
      totalCount: number;
      nextCursor: string | null;
      items: Array<{ automationId: string; activeUntil: string | null }>;
    }>(cli, [
      "automation",
      "list",
      "--support-series-id",
      seriesId,
      "--limit",
      "2",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(first.exitCode, null);
    assert.equal(first.envelope.ok, true);
    assert.equal(first.envelope.data?.count, 2);
    assert.equal(first.envelope.data?.totalCount, 3);
    assert.equal(first.envelope.data?.nextCursor, automationIds[1]);
    assert.equal(first.envelope.data?.items[0]?.activeUntil, "2026-08-01T00:00:00.000Z");

    const second = await runInProcessJsonCli<{
      count: number;
      totalCount: number;
      nextCursor: string | null;
      items: Array<{ automationId: string }>;
    }>(cli, [
      "automation",
      "list",
      "--support-series-id",
      seriesId,
      "--cursor",
      first.envelope.data?.nextCursor ?? "missing",
      "--limit",
      "2",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(second.exitCode, null);
    assert.equal(second.envelope.ok, true);
    assert.equal(second.envelope.data?.count, 1);
    assert.equal(second.envelope.data?.totalCount, 3);
    assert.equal(second.envelope.data?.nextCursor, null);
    assert.deepEqual(
      second.envelope.data?.items.map((item) => item.automationId),
      [automationIds[2]],
    );

    const reconciled = await runInProcessJsonCli<{
      archivedCount: number;
      matchedCount: number;
      unchangedCount: number;
      missingDesiredAutomationIds: string[];
    }>(cli, [
      "automation",
      "reconcile-support-series",
      seriesId,
      "--desired-automation-id",
      created[0]?.record.automationId ?? "missing",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(reconciled.exitCode, null);
    assert.equal(reconciled.envelope.ok, true);
    assert.equal(reconciled.envelope.data?.archivedCount, 2);
    assert.equal(reconciled.envelope.data?.matchedCount, 3);
    assert.deepEqual(reconciled.envelope.data?.missingDesiredAutomationIds, []);
    assert.equal(reconciled.envelope.data?.unchangedCount, 1);

    const repeated = await runInProcessJsonCli<{ archivedCount: number }>(cli, [
      "automation",
      "reconcile-support-series",
      seriesId,
      "--desired-automation-id",
      created[0]?.record.automationId ?? "missing",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(repeated.exitCode, null);
    assert.equal(repeated.envelope.ok, true);
    assert.equal(repeated.envelope.data?.archivedCount, 0);

    const cleared = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      created[0]?.record.slug ?? "missing",
      "--clear-active-until",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(cleared.exitCode, null);
    assert.equal(cleared.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: { activeUntil: string | null } | null;
    }>(cli, [
      "automation",
      "show",
      created[0]?.record.slug ?? "missing",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.activeUntil, null);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation import-json accepts Linq participant routes with delivery source", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-linq-participant-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const payload = {
      ...createAutomationScaffoldPayload(),
      title: "Linq setup continuation",
      slug: "linq-setup-continuation",
      instructions: "Continue setup over Linq.",
      route: {
        channel: "linq",
        deliverySource: {
          fromPhoneNumber: "+15550001111",
          kind: "linq",
        },
        deliveryTarget: null,
        identityId: "identity_linq",
        participantId: "+15550002222",
        threadId: null,
      },
    };
    const payloadPath = path.join(parentRoot, "automation-linq-participant.json");
    await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const imported = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
      path: string;
      vault: string;
    }>(cli, [
      "automation",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.exitCode, null);
    assert.equal(imported.envelope.ok, true);
    assert.equal(imported.envelope.data?.created, true);
    assert.equal(imported.envelope.data?.lookupId, payload.slug);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          deliverySource: { fromPhoneNumber: string; kind: string } | null;
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
        };
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
    assert.deepEqual(shown.envelope.data?.automation?.route.deliverySource, {
      fromPhoneNumber: "+15550001111",
      kind: "linq",
    });
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, null);
    assert.equal(shown.envelope.data?.automation?.route.identityId, "identity_linq");
    assert.equal(shown.envelope.data?.automation?.route.participantId, "+15550002222");
    assert.equal(shown.envelope.data?.automation?.route.threadId, null);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation save maps trigger flags and keeps legacy schedule flags working", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-schedules-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const schedules = [
      ["at", "one-shot-check", ["--trigger-at", "2026-04-26T08:00:00.000Z"]],
      ["every", "hourly-check", ["--trigger-every-ms", "3600000"]],
      ["cron", "weekly-check", ["--trigger-cron", "0 9 * * 1"]],
      ["dailyLocal", "daily-check", ["--trigger-local-time", "08:30"]],
      ["every", "legacy-hourly-check", ["--schedule-every-ms", "3600000"]],
    ] as const;

    for (const [kind, slug, scheduleArgs] of schedules) {
      const saved = await runInProcessJsonCli<{
        automationId: string;
        lookupId: string;
      }>(cli, [
        "automation",
        "save",
        slug,
        "--slug",
        slug,
        "--instructions",
        `Run ${slug}.`,
        slug.startsWith("legacy-") ? "--schedule-kind" : "--trigger-kind",
        kind,
        ...scheduleArgs,
        "--channel",
        "telegram",
        "--delivery-target",
        `telegram-thread-${slug}`,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(saved.exitCode, null);
      assert.equal(saved.envelope.ok, true);
      assert.equal(saved.envelope.data?.lookupId, slug);
    }

    const deviceActivity = await runInProcessJsonCli<{
      lookupId: string;
    }>(cli, [
      "automation",
      "save",
      "after-surfing-check",
      "--slug",
      "after-surfing-check",
      "--instructions",
      "Ask how surfing felt.",
      "--trigger-kind",
      "deviceActivity",
      "--device-source",
      "whoop",
      "--activity-kind",
      "Surfing",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram-thread-surfing",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(deviceActivity.exitCode, null);
    assert.equal(deviceActivity.envelope.ok, true);
    assert.equal(deviceActivity.envelope.data?.lookupId, "after-surfing-check");

    const shownDeviceActivity = await runInProcessJsonCli<{
      automation: {
        schedule: {
          activityKind?: string;
          after: string;
          kind: string;
          source?: string;
        };
      } | null;
    }>(cli, [
      "automation",
      "show",
      "after-surfing-check",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(shownDeviceActivity.exitCode, null);
    assert.equal(shownDeviceActivity.envelope.ok, true);
    assert.notEqual(shownDeviceActivity.envelope.data?.automation, null);
    assert.equal(shownDeviceActivity.envelope.data?.automation?.schedule.kind, "deviceActivity");
    assert.equal(shownDeviceActivity.envelope.data?.automation?.schedule.source, "whoop");
    assert.equal(shownDeviceActivity.envelope.data?.automation?.schedule.activityKind, "surfing");
    assert.match(
      shownDeviceActivity.envelope.data?.automation?.schedule.after ?? "",
      /^\d{4}-\d{2}-\d{2}T/u,
    );

    const rejectedDeviceFlag = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "misplaced-device-filter",
      "--slug",
      "misplaced-device-filter",
      "--instructions",
      "Run the ordinary reminder.",
      "--trigger-kind",
      "at",
      "--trigger-at",
      "2026-04-26T08:00:00.000Z",
      "--device-source",
      "whoop",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram-thread-device-filter",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(rejectedDeviceFlag.exitCode, 1);
    assert.equal(rejectedDeviceFlag.envelope.ok, false);
    assert.match(
      rejectedDeviceFlag.envelope.error.message ?? "",
      /--device-source and --activity-kind/u,
    );

    const rejectedLegacyScheduleKindDeviceActivity = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "schedule-kind-device-activity",
      "--slug",
      "schedule-kind-device-activity",
      "--instructions",
      "Ask how the walk felt.",
      "--schedule-kind",
      "deviceActivity",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram-thread-legacy-device",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(rejectedLegacyScheduleKindDeviceActivity.exitCode, 1);
    assert.equal(rejectedLegacyScheduleKindDeviceActivity.envelope.ok, false);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
