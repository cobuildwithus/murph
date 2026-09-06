import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";

import {
  AUTOMATION_DOC_TYPE,
  AUTOMATION_SCHEMA_VERSION,
  AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  automationAssistantTargetOverrideSchema,
  automationContextReferencesSchema,
  automationDeviceActivitySourceValues,
  automationRouteSchema,
  automationScaffoldPayloadSchema,
  automationScheduleSchema,
  buildAutomationSupportSeriesTag,
} from "@murphai/contracts";
import { advanceAutomationDeviceActivityCursor, upsertAutomation } from "@murphai/core";
import {
  listAutomations,
  showAutomation,
  type AutomationListPageOptions,
  type AutomationQueryRecord,
} from "@murphai/query";
import {
  automationRecordSchema,
  automationScaffoldResultSchema,
  createAutomationScaffoldPayload,
  registerAutomationCommands,
} from "../src/commands/automation.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
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
  vi.restoreAllMocks();
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

function replaceFirstIssuePath(
  issues: readonly { path: PropertyKey[] }[],
  path: readonly PropertyKey[] | undefined,
): void {
  if (path === undefined) return;
  const issue = issues[0];
  assert.ok(issue, "validation fixture must produce an issue");
  issue.path.splice(0, issue.path.length, ...path);
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
    "contextReference",
    "tag",
    "tags",
    "continuityPolicy",
    "instructions",
    "scheduleKind",
    "scheduleAt",
    "scheduleEveryMs",
    "scheduleCron",
    "scheduleLocalTime",
    "scheduleTimeZone",
    "triggerTimeZone",
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
    "contextReference",
    "clearContextReferences",
  ]) {
    assert.equal(field in editSchema.options.properties, true, field);
  }

  for (const schema of [saveSchema, editSchema]) {
    assert.deepEqual(
      (schema.options.properties.deviceSource as { enum: string[] }).enum,
      [...automationDeviceActivitySourceValues],
    );
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
  assert.equal("compact" in listSchema.options.properties, true);
  assert.match(optionDescription(listSchema, "compact"), /automation show/u);
});

interface AutomationPublicPathCase {
  expectedPaths: readonly string[];
  invalidValue: () => unknown;
  name: string;
  overrideIssuePath?: readonly PropertyKey[];
  saveOptions?: readonly string[];
  schema: "context" | "payload" | "route" | "schedule" | "target";
}

const automationPublicPathCases = [
  {
    name: "permits the cron expression for a cron command",
    schema: "schedule",
    invalidValue: () => ({ kind: "cron", expression: "not-a-cron" }),
    saveOptions: ["--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1"],
    expectedPaths: ["schedule.expression"],
  },
  {
    name: "rejects the cron expression for an at command",
    schema: "schedule",
    invalidValue: () => ({ kind: "cron", expression: "not-a-cron" }),
    saveOptions: ["--trigger-kind", "at", "--trigger-at", "2099-01-01T00:00:00.000Z"],
    expectedPaths: [],
  },
  {
    name: "permits a route field",
    schema: "route",
    invalidValue: () => ({
      channel: "",
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    }),
    saveOptions: ["--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1"],
    expectedPaths: ["route.channel"],
  },
  {
    name: "rejects a private nested route field",
    schema: "route",
    invalidValue: () => ({
      channel: "linq",
      deliverySource: { kind: "linq", fromPhoneNumber: "" },
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    }),
    saveOptions: ["--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1"],
    expectedPaths: [],
  },
  {
    name: "permits an assistant target field",
    schema: "target",
    invalidValue: () => ({ reasoningEffort: "not-an-effort" }),
    saveOptions: [
      "--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1",
      "--assistant-target-override-model", "gpt-5.6-sol",
    ],
    expectedPaths: ["assistantTargetOverride.reasoningEffort"],
  },
  {
    name: "rejects an arbitrary assistant target field",
    schema: "target",
    invalidValue: () => ({ reasoningEffort: "not-an-effort" }),
    overrideIssuePath: ["privateTargetField"],
    saveOptions: [
      "--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1",
      "--assistant-target-override-model", "gpt-5.6-sol",
    ],
    expectedPaths: [],
  },
  {
    name: "permits a bounded context-reference index",
    schema: "context",
    invalidValue: () => [
      { entityId: "wfmt_01", entityKind: "workout_format" },
      { entityId: "invalid context id", entityKind: "experiment" },
    ],
    saveOptions: [
      "--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1",
      "--context-reference", "workout_format=wfmt_01",
    ],
    expectedPaths: ["contextReference.1.entityId"],
  },
  {
    name: "rejects a negative context-reference index",
    schema: "context",
    invalidValue: () => [{ entityId: "invalid context id", entityKind: "experiment" }],
    overrideIssuePath: [-1, "entityId"],
    saveOptions: [
      "--trigger-kind", "cron", "--trigger-cron", "0 9 * * 1",
      "--context-reference", "workout_format=wfmt_01",
    ],
    expectedPaths: [],
  },
  {
    name: "uses the plural payload root for indexed context references",
    schema: "payload",
    invalidValue: () => ({
      ...createAutomationScaffoldPayload(),
      contextReferences: [
        { entityId: "wfmt_01", entityKind: "workout_format" },
        { entityId: "invalid context id", entityKind: "experiment" },
      ],
    }),
    expectedPaths: ["payload.contextReferences.1.entityId"],
  },
  {
    name: "permits a bounded tag index",
    schema: "payload",
    invalidValue: () => ({
      ...createAutomationScaffoldPayload(),
      tags: ["visible-tag", ""],
    }),
    expectedPaths: ["payload.tags.1"],
  },
  {
    name: "permits an allowlisted top-level payload field",
    schema: "payload",
    invalidValue: () => ({
      ...createAutomationScaffoldPayload(),
      status: "not-a-status",
    }),
    expectedPaths: ["payload.status"],
  },
  {
    name: "rejects an arbitrary top-level payload field",
    schema: "payload",
    invalidValue: () => ({
      ...createAutomationScaffoldPayload(),
      privatePayloadField: "private-value",
    }),
    expectedPaths: [],
  },
] satisfies readonly AutomationPublicPathCase[];

test.each(automationPublicPathCases)(
  "automation public validation paths $name",
  async (testCase) => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      "murph-automation-public-path-",
    );
    const importPath = path.join(parentRoot, "automation.json");

    try {
      const invalidValue = testCase.invalidValue();
      switch (testCase.schema) {
        case "schedule": {
          const failure = automationScheduleSchema.safeParse(invalidValue);
          assert.equal(failure.success, false);
          if (failure.success) assert.fail("schedule fixture must fail validation");
          replaceFirstIssuePath(failure.error.issues, testCase.overrideIssuePath);
          vi.spyOn(automationScheduleSchema, "safeParse").mockReturnValue(failure);
          break;
        }
        case "route": {
          const failure = automationRouteSchema.safeParse(invalidValue);
          assert.equal(failure.success, false);
          if (failure.success) assert.fail("route fixture must fail validation");
          replaceFirstIssuePath(failure.error.issues, testCase.overrideIssuePath);
          vi.spyOn(automationRouteSchema, "safeParse").mockReturnValue(failure);
          break;
        }
        case "target": {
          const failure = automationAssistantTargetOverrideSchema.safeParse(invalidValue);
          assert.equal(failure.success, false);
          if (failure.success) assert.fail("target fixture must fail validation");
          replaceFirstIssuePath(failure.error.issues, testCase.overrideIssuePath);
          vi.spyOn(automationAssistantTargetOverrideSchema, "safeParse").mockReturnValue(failure);
          break;
        }
        case "context": {
          const failure = automationContextReferencesSchema.safeParse(invalidValue);
          assert.equal(failure.success, false);
          if (failure.success) assert.fail("context fixture must fail validation");
          replaceFirstIssuePath(failure.error.issues, testCase.overrideIssuePath);
          vi.spyOn(automationContextReferencesSchema, "safeParse").mockReturnValue(failure);
          break;
        }
        case "payload": {
          const failure = automationScaffoldPayloadSchema.safeParse(invalidValue);
          assert.equal(failure.success, false);
          if (failure.success) assert.fail("payload fixture must fail validation");
          replaceFirstIssuePath(failure.error.issues, testCase.overrideIssuePath);
          vi.spyOn(automationScaffoldPayloadSchema, "safeParse").mockReturnValue(failure);
          await writeFile(importPath, JSON.stringify(createAutomationScaffoldPayload()));
          break;
        }
      }

      const cli = Cli.create("vault-cli", {
        description: "automation test cli",
        version: "0.0.0-test",
      });
      cli.use(incurErrorBridge);
      registerAutomationCommands(cli);

      const args = testCase.schema === "payload"
        ? ["automation", "import-json", "--input", `@${importPath}`, "--vault", vaultRoot]
        : [
          "automation", "save", "Validation mapping",
          "--instructions", "Do not expose private-validation-input.",
          "--status", "paused",
          "--channel", "linq",
          "--delivery-target", "validation-thread",
          ...(testCase.saveOptions ?? []),
          "--vault", vaultRoot,
        ];
      const result = await runInProcessJsonCli(cli, args);

      assert.equal(result.exitCode, 1);
      assert.equal(result.envelope.ok, false);
      if (result.envelope.ok) assert.fail("validation fixture must return an error envelope");
      assert.deepEqual(
        result.envelope.error.fieldErrors?.map((fieldError) => fieldError.path) ?? [],
        testCase.expectedPaths,
      );
      assert.equal(
        JSON.stringify(result.envelope).includes("private-validation-input"),
        false,
      );
    } finally {
      await rm(parentRoot, { recursive: true, force: true });
    }
  },
);

test("automation save persists a weekly wall-clock cron with an explicit timezone", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-weekly-wall-clock-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    cli.use(incurErrorBridge);
    registerAutomationCommands(cli);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Sunday status pulse",
      "--slug",
      "sunday-status-pulse",
      "--instructions",
      "Collect a short weekly status update.",
      "--support-kind",
      "check_in",
      "--trigger-kind",
      "cron",
      "--trigger-cron",
      "0 19 * * 0",
      "--trigger-time-zone",
      "America/New_York",
      "--channel",
      "linq",
      "--delivery-target",
      "group-thread",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        schedule: unknown;
        supportKind: string | null;
      } | null;
    }>(cli, [
      "automation",
      "show",
      "sunday-status-pulse",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.schedule, {
      kind: "cron",
      expression: "0 19 * * 0",
      timeZone: "America/New_York",
    });
    assert.equal(shown.envelope.data?.automation?.supportKind, "check_in");
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation internal validation returns field-specific non-echoing recovery envelopes", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-validation-envelope-",
  );
  const importPath = path.join(parentRoot, "invalid-automation.json");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    cli.use(incurErrorBridge);
    registerAutomationCommands(cli);

    const invalidSchedule = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Invalid weekly schedule",
      "--instructions",
      "Never echo private-schedule-input.",
      "--status",
      "paused",
      "--trigger-kind",
      "cron",
      "--trigger-cron",
      "0 19 * *",
      "--channel",
      "linq",
      "--delivery-target",
      "validation-thread",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(invalidSchedule.exitCode, 1);
    assert.equal(invalidSchedule.envelope.ok, false);
    if (!invalidSchedule.envelope.ok) {
      assert.equal(invalidSchedule.envelope.error.code, "invalid_schedule");
      assert.equal(invalidSchedule.envelope.error.retryable, false);
      assert.equal(invalidSchedule.envelope.error.stage, "validation");
      assert.match(invalidSchedule.envelope.error.message ?? "", /five-field cron/u);
      assert.equal(invalidSchedule.envelope.error.hint, undefined);
      assert.equal(
        invalidSchedule.envelope.error.fieldErrors?.[0]?.path,
        "schedule.expression",
      );
      assert.equal(
        JSON.stringify(invalidSchedule.envelope).includes("private-schedule-input"),
        false,
      );
    }

    await writeFile(importPath, JSON.stringify({
      ...createAutomationScaffoldPayload(),
      instructions: "Never echo private-import-input.",
      status: "not-a-status",
    }));
    const invalidImport = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${importPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(invalidImport.exitCode, 1);
    assert.equal(invalidImport.envelope.ok, false);
    if (!invalidImport.envelope.ok) {
      assert.equal(invalidImport.envelope.error.code, "invalid_automation_payload");
      assert.equal(invalidImport.envelope.error.retryable, false);
      assert.equal(invalidImport.envelope.error.stage, "validation");
      assert.equal(
        invalidImport.envelope.error.fieldErrors?.[0]?.path,
        "payload.status",
      );
      assert.equal(
        JSON.stringify(invalidImport.envelope).includes("private-import-input"),
        false,
      );
    }
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save and edit preserve exact canonical context references", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-context-references-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    cli.use(incurErrorBridge);
    registerAutomationCommands(cli);
    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Workout reminder",
      "--slug",
      "workout-reminder",
      "--instructions",
      "Remind the member about the exact saved routine.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram_thread_real",
      "--context-reference",
      "workout_format=wfmt_01JQ8PWXP5A68SQM1W0GYM41WA",
      "--context-reference",
      "experiment=exp_01JQ8PWXP5A68SQM1W0GYM41WB",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);
    const shown = await runInProcessJsonCli<{
      automation: { contextReferences: Array<{ entityId: string; entityKind: string }> } | null;
    }>(cli, [
      "automation",
      "show",
      "workout-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.contextReferences, [
      { entityId: "wfmt_01JQ8PWXP5A68SQM1W0GYM41WA", entityKind: "workout_format" },
      { entityId: "exp_01JQ8PWXP5A68SQM1W0GYM41WB", entityKind: "experiment" },
    ]);
    const cleared = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "workout-reminder",
      "--clear-context-references",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(cleared.exitCode, null);
    assert.equal(cleared.envelope.ok, true);
    const clearedShown = await runInProcessJsonCli<{
      automation: { contextReferences: unknown[] } | null;
    }>(cli, [
      "automation",
      "show",
      "workout-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(clearedShown.exitCode, null);
    assert.equal(clearedShown.envelope.ok, true);
    assert.deepEqual(clearedShown.envelope.data?.automation?.contextReferences, []);
    const malformed = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Malformed reference reminder",
      "--instructions",
      "This request must fail before persistence.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2099-01-01T00:00:00.000Z",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram_thread_real",
      "--context-reference",
      "missing-separator",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(malformed.exitCode, 1);
    assert.equal(malformed.envelope.ok, false);
    if (!malformed.envelope.ok) {
      assert.match(malformed.envelope.error.message ?? "", /entity-kind.*entity-id/u);
      assert.equal(
        malformed.envelope.error.fieldErrors?.[0]?.path,
        "contextReference",
      );
      assert.equal(
        JSON.stringify(malformed.envelope).includes("missing-separator"),
        false,
      );
    }
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
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
    if (!invalidReasoningEffort.envelope.ok) {
      assert.deepEqual(invalidReasoningEffort.envelope.error, {
        code: "VALIDATION_ERROR",
        message: "The command input is invalid.",
        retryable: false,
        hint: "Check the command schema and correct the invalid input.",
        stage: "validation",
        fieldErrors: [
          {
            code: "invalid_value",
            missing: false,
            path: "assistantTargetOverrideReasoningEffort",
            expected: "",
            received: "invalid",
            message: "This field is invalid.",
          },
        ],
      });
      assert.equal(
        JSON.stringify(invalidReasoningEffort.envelope.error).includes("hihg"),
        false,
      );
    }

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

test("automation save, import-json, and reactivation hard-cut local email delivery", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-local-email-hard-cut-",
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
      "Unsupported local email reminder",
      "--slug",
      "unsupported-local-email-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "0 11 * * 5",
      "--channel",
      "email",
      "--delivery-target",
      "recipient@example.test",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, 1);
    assert.equal(saved.envelope.ok, false);
    assert.match(
      saved.envelope.error.message ?? "",
      /local email automation delivery is not supported/i,
    );

    const payload = {
      ...createAutomationScaffoldPayload(),
      title: "Imported unsupported local email reminder",
      slug: "imported-unsupported-local-email-reminder",
      instructions: "Send the reminder.",
      schedule: {
        kind: "cron",
        expression: "0 11 * * 5",
      },
      route: {
        channel: "email",
        deliveryTarget: "recipient@example.test",
        identityId: null,
        participantId: null,
        threadId: null,
      },
    };
    const payloadPath = path.join(parentRoot, "local-email-automation.json");
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
      /local email automation delivery is not supported/i,
    );

    const paused = await upsertAutomation({
      continuityPolicy: "fresh",
      instructions: "Send the reminder.",
      route: {
        channel: "email",
        deliveryTarget: "recipient@example.test",
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        expression: "0 11 * * 5",
        kind: "cron",
      },
      slug: "paused-local-email-reminder",
      status: "paused",
      summary: null,
      tags: ["assistant", "scheduled"],
      title: "Paused local email reminder",
      vaultRoot,
    });

    const reactivated = await runInProcessJsonCli(cli, [
      "automation",
      "set-status",
      paused.record.slug,
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(reactivated.exitCode, 1);
    assert.equal(reactivated.envelope.ok, false);
    assert.match(
      reactivated.envelope.error.message ?? "",
      /local email automation delivery is not supported/i,
    );
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation compact list preserves empty page semantics", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-compact-empty-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation compact empty test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const listed = await runInProcessJsonCli<{
      compact: true;
      count: number;
      items: unknown[];
      nextCursor: string | null;
      totalCount: number;
    }>(cli, [
      "automation",
      "list",
      "--compact",
      "--limit",
      "25",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(listed.exitCode, null);
    assert.equal(listed.envelope.ok, true);
    assert.equal(listed.envelope.data?.compact, true);
    assert.equal(listed.envelope.data?.count, 0);
    assert.equal(listed.envelope.data?.totalCount, 0);
    assert.equal(listed.envelope.data?.nextCursor, null);
    assert.deepEqual(listed.envelope.data?.items, []);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation compact list retains enumeration state and materially reduces a 25-item page", async () => {
  const cli = Cli.create("vault-cli", {
    description: "automation compact fixture test cli",
    version: "0.0.0-test",
  });
  const vaultRoot = "/synthetic/automation-compact-vault";
  const seriesId = "experiment:exp_compact_fixture";
  const supportSeriesTag = buildAutomationSupportSeriesTag(seriesId);
  const foreignSupportSeriesTag = buildAutomationSupportSeriesTag(
    "experiment:exp_foreign_fixture",
  );
  const idAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const fixtureRecords: AutomationQueryRecord[] = Array.from({ length: 25 }, (_, index) => {
    const suffix = idAlphabet[index];
    if (suffix === undefined) {
      throw new Error("Expected a deterministic automation id suffix.");
    }
    const fixtureIndex = String(index).padStart(2, "0");
    const record = automationRecordSchema.parse({
      activeUntil: "2026-12-31T23:59:59.000Z",
      assistantTargetOverride: {
        model: "gpt-5.6-terra",
        modelProvider: "vercel-ai-gateway",
        reasoningEffort: "low",
      },
      automationId: `automation_01ARZ3NDEKTSV4RRFFQ69G5FA${suffix}`,
      contextReferences: [{
        entityId: "exp_compact_fixture",
        entityKind: "experiment",
      }],
      continuityPolicy: "preserve",
      createdAt: "2026-08-29T12:00:00.000Z",
      instructions: `Synthetic scheduled assistant instructions ${fixtureIndex}.`,
      markdown: `# Synthetic support inventory ${fixtureIndex}`,
      plannedOccurrenceOffsetMs: index * 60_000,
      relativePath: `bank/automations/compact-fixture-${fixtureIndex}.md`,
      route: {
        channel: "telegram",
        deliveryTarget: `telegram:compact-fixture-${fixtureIndex}`,
        identityId: `identity_compact_fixture_${fixtureIndex}`,
        participantId: `participant_compact_fixture_${fixtureIndex}`,
        threadId: `thread_compact_fixture_${fixtureIndex}`,
      },
      schedule: {
        expression: `${index % 60} 9 * * 1`,
        kind: "cron",
        timeZone: "America/New_York",
      },
      scheduleAnchorAt: "2026-08-29T12:00:00.000Z",
      slug: `compact-fixture-${fixtureIndex}`,
      status: index % 3 === 0 ? "paused" : "active",
      summary: `Synthetic support inventory summary ${fixtureIndex} with enough bounded context to distinguish its purpose.`,
      supportKind: index % 2 === 0 ? "reminder" : "review",
      tags: [
        "assistant",
        "scheduled",
        "compact-inventory-fixture",
        `compact-inventory-segment-${fixtureIndex}`,
        supportSeriesTag,
      ],
      title: `Synthetic support inventory ${fixtureIndex}`,
      updatedAt: `2026-08-29T12:${fixtureIndex}:00.000Z`,
    });
    return {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      docType: AUTOMATION_DOC_TYPE,
      ...record,
    };
  });
  const firstFixtureRecord = fixtureRecords[0];
  if (firstFixtureRecord === undefined) {
    throw new Error("Expected at least one compact automation fixture.");
  }
  const foreignRecord: AutomationQueryRecord = {
    ...firstFixtureRecord,
    automationId: "automation_01ARZ3NDEKTSV4RRFFQ69G5FB0",
    contextReferences: [{
      entityId: "exp_foreign_fixture",
      entityKind: "experiment",
    }],
    relativePath: "bank/automations/compact-fixture-foreign.md",
    slug: "compact-fixture-foreign",
    tags: [
      "assistant",
      "scheduled",
      "compact-inventory-fixture",
      foreignSupportSeriesTag,
    ],
    title: "Synthetic support inventory foreign owner",
  };
  const records = [...fixtureRecords, foreignRecord];
  const listQueries: AutomationListPageOptions[] = [];

  registerAutomationCommands(cli, {
    async listAutomationPage(_fixtureVaultRoot, options = {}) {
      listQueries.push(options);
      const normalizedText = options.text?.toLocaleLowerCase("en-US");
      const matches = records
        .filter((record) =>
          options.exactTag === undefined || record.tags.includes(options.exactTag)
        )
        .filter((record) =>
          options.status === undefined || options.status.includes(record.status)
        )
        .filter((record) =>
          normalizedText === undefined
          || JSON.stringify(record).toLocaleLowerCase("en-US").includes(normalizedText)
        )
        .sort((left, right) => left.automationId.localeCompare(right.automationId));
      const afterCursor = options.cursor === undefined
        ? matches
        : matches.filter((record) =>
          record.automationId.localeCompare(options.cursor ?? "") > 0
        );
      const limit = options.limit ?? afterCursor.length;
      const items = afterCursor.slice(0, limit);
      return {
        items,
        nextCursor: afterCursor.length > limit
          ? items.at(-1)?.automationId ?? null
          : null,
        totalCount: matches.length,
      };
    },
    async showAutomation(_fixtureVaultRoot, lookup) {
      return records.find((record) =>
        record.automationId === lookup || record.slug === lookup
      ) ?? null;
    },
  });

  type ListEnvelope = {
    compact?: true;
    count: number;
    filters: {
      cursor: string | null;
      limit: number;
      status: string[] | null;
      supportSeriesId: string | null;
      text: string | null;
    };
    items: Array<Record<string, unknown> & {
      automationId: string;
    }>;
    nextCursor: string | null;
    totalCount: number;
  };
  const runList = async (input: {
    compact: boolean;
    cursor?: string;
    limit: number;
  }): Promise<ListEnvelope> => {
    const args = [
      "automation",
      "list",
      ...(input.compact ? ["--compact"] : []),
      "--support-series-id",
      seriesId,
      ...(input.cursor === undefined ? [] : ["--cursor", input.cursor]),
      "--limit",
      String(input.limit),
      "--vault",
      vaultRoot,
    ];
    const listed = await runInProcessJsonCli<ListEnvelope>(cli, args);
    assert.equal(listed.exitCode, null);
    assert.equal(listed.envelope.ok, true);
    if (listed.envelope.data === undefined) {
      throw new Error("Expected automation list data.");
    }
    return listed.envelope.data;
  };
  const assertPageParity = (
    full: ListEnvelope,
    compact: ListEnvelope,
  ): void => {
    assert.equal("compact" in full, false);
    assert.equal(compact.compact, true);
    assert.equal(compact.count, full.count);
    assert.equal(compact.totalCount, full.totalCount);
    assert.equal(compact.nextCursor, full.nextCursor);
    assert.deepEqual(compact.filters, full.filters);
    assert.deepEqual(
      compact.items.map((item) => item.automationId),
      full.items.map((item) => item.automationId),
    );
  };

  const [full, compact] = await Promise.all([
    runList({ compact: false, limit: 25 }),
    runList({ compact: true, limit: 25 }),
  ]);
  assertPageParity(full, compact);
  assert.equal(full.count, 25);
  assert.equal(full.totalCount, 25);
  assert.equal(full.nextCursor, null);
  assert.deepEqual(
    full.items.map((item) => item.automationId),
    fixtureRecords.map((record) => record.automationId),
  );
  assert.equal(
    full.items.some((item) => item.automationId === foreignRecord.automationId),
    false,
  );

  const compactItem = compact.items[0];
  const fullItem = full.items[0];
  assert.ok(compactItem);
  assert.ok(fullItem);
  assert.deepEqual(Object.keys(compactItem).sort(), [
    "activeUntil",
    "automationId",
    "schedule",
    "slug",
    "status",
    "summary",
    "supportKind",
    "title",
  ]);
  for (const retainedField of [
    "automationId",
    "slug",
    "title",
    "status",
    "summary",
    "activeUntil",
    "schedule",
    "supportKind",
  ]) {
    assert.deepEqual(compactItem[retainedField], fullItem[retainedField]);
  }
  for (const omittedField of [
    "route",
    "assistantTargetOverride",
    "plannedOccurrenceOffsetMs",
    "contextReferences",
    "continuityPolicy",
    "tags",
    "createdAt",
    "scheduleAnchorAt",
    "updatedAt",
    "relativePath",
    "instructions",
    "markdown",
  ]) {
    assert.equal(omittedField in compactItem, false, omittedField);
  }

  const fullBytes = Buffer.byteLength(JSON.stringify(full.items), "utf8");
  const compactBytes = Buffer.byteLength(JSON.stringify(compact.items), "utf8");
  assert.ok(
    compactBytes <= fullBytes * 0.55,
    `compact automation list emitted ${compactBytes} bytes versus ${fullBytes} full bytes`,
  );

  const paginatedFullItems: ListEnvelope["items"] = [];
  const paginatedCompactItems: ListEnvelope["items"] = [];
  let cursor: string | undefined;
  do {
    const cursorOptions = cursor === undefined ? {} : { cursor };
    const [fullPage, compactPage] = await Promise.all([
      runList({ compact: false, ...cursorOptions, limit: 10 }),
      runList({ compact: true, ...cursorOptions, limit: 10 }),
    ]);
    assertPageParity(fullPage, compactPage);
    assert.equal(fullPage.totalCount, 25);
    paginatedFullItems.push(...fullPage.items);
    paginatedCompactItems.push(...compactPage.items);
    cursor = fullPage.nextCursor ?? undefined;
  } while (cursor !== undefined);
  assert.deepEqual(
    paginatedFullItems.map((item) => item.automationId),
    full.items.map((item) => item.automationId),
  );
  assert.deepEqual(
    paginatedCompactItems.map((item) => item.automationId),
    compact.items.map((item) => item.automationId),
  );
  assert.equal(
    listQueries.every((query) => query.exactTag === supportSeriesTag),
    true,
  );

  const shown = await runInProcessJsonCli<{
    automation: {
      automationId: string;
      instructions: string;
      route: { deliveryTarget: string | null };
      tags: string[];
      updatedAt: string;
    } | null;
  }>(cli, [
    "automation",
    "show",
    compactItem.automationId,
    "--vault",
    vaultRoot,
  ]);
  assert.equal(shown.exitCode, null);
  assert.equal(shown.envelope.ok, true);
  assert.equal(
    shown.envelope.data?.automation?.automationId,
    compactItem.automationId,
  );
  assert.match(
    shown.envelope.data?.automation?.instructions ?? "",
    /scheduled assistant instructions/u,
  );
  assert.match(
    shown.envelope.data?.automation?.route.deliveryTarget ?? "",
    /^telegram:compact-fixture-/u,
  );
  assert.equal(
    shown.envelope.data?.automation?.tags.includes(supportSeriesTag),
    true,
  );
  assert.equal(
    shown.envelope.data?.automation?.updatedAt,
    firstFixtureRecord.updatedAt,
  );
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
      "telegram:daily",
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
        channel: "linq",
        deliveryTarget: "linq-chat-weekly-planning",
        identityId: null,
        participantId: null,
        threadId: "linq-thread-weekly-planning",
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
    assert.equal(shownData.automation.route.deliveryTarget, "telegram:daily");
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
      "telegram:daily",
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
      /Automation definition is invalid/u,
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
    cli.use(incurErrorBridge);
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
      /--device-source/u,
    );
    assert.equal(
      rejectedDeviceFlag.envelope.error.fieldErrors?.[0]?.path,
      "schedule.source",
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

test.each([
  ["garmin", "oura"],
  ["oura", "fitbit"],
  ["fitbit", "garmin"],
] as const)("automation saves %s and retargets the same owner to %s", async (source, nextSource) => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-source-");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-07T11:00:00.000Z"));
  try {
    const cli = Cli.create("vault-cli", { version: "0.0.0-test" });
    cli.use(incurErrorBridge);
    registerAutomationCommands(cli);
    const saved = await runInProcessJsonCli<{ automationId: string }>(cli, [
      "automation", "save", "Activity check-in", "--slug", "activity-check-in",
      "--instructions", "Ask how the activity felt.",
      "--trigger-kind", "deviceActivity", "--device-source", source,
      "--activity-kind", "running", "--channel", "telegram",
      "--delivery-target", "test-activity-thread", "--vault", vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);
    const automationId = saved.envelope.data?.automationId;
    assert.ok(automationId);
    const initial = await showAutomation(vaultRoot, automationId);
    assert.ok(initial);
    assert.deepEqual(initial.schedule, {
      kind: "deviceActivity", after: "2026-06-07T11:00:00.000Z", activityKind: "running", source,
    });
    const cursorInput = {
      lookup: automationId,
      vaultRoot,
      expectedActivityKind: "running",
      expectedContinuityPolicy: initial.continuityPolicy,
      expectedInstructions: initial.instructions,
      expectedRoute: initial.route,
      expectedSource: source,
      after: "2026-06-07T11:30:00.000Z",
      afterOccurredAt: "2026-06-07T11:25:00.000Z",
      afterEntityId: "evt_before_source_edit",
    };
    vi.setSystemTime(new Date("2026-06-07T11:31:00.000Z"));
    assert.equal((await advanceAutomationDeviceActivityCursor(cursorInput)).advanced, true);

    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    const edited = await runInProcessJsonCli<{ automationId: string; created: boolean }>(cli, [
      "automation", "edit", automationId, "--trigger-kind", "deviceActivity",
      "--device-source", nextSource, "--activity-kind", "running", "--vault", vaultRoot,
    ]);
    assert.equal(edited.exitCode, null);
    assert.equal(edited.envelope.ok, true);
    assert.equal(edited.envelope.data?.automationId, automationId);
    assert.equal(edited.envelope.data?.created, false);
    const updated = await showAutomation(vaultRoot, automationId);
    assert.ok(updated);
    assert.deepEqual(updated.schedule, {
      kind: "deviceActivity", after: "2026-06-07T12:00:00.000Z", activityKind: "running", source: nextSource,
    });
    assert.deepEqual(updated.route, initial.route);
    assert.equal(updated.instructions, initial.instructions);
    assert.equal(updated.continuityPolicy, initial.continuityPolicy);
    assert.equal((await listAutomations(vaultRoot)).length, 1);

    // The existing cursor owner fences an in-flight scan of the old selected source.
    const nextCursorInput = {
      ...cursorInput,
      after: "2026-06-07T12:30:00.000Z",
      afterOccurredAt: "2026-06-07T12:25:00.000Z",
      afterEntityId: "evt_after_source_edit",
    };
    vi.setSystemTime(new Date("2026-06-07T12:31:00.000Z"));
    assert.equal((await advanceAutomationDeviceActivityCursor(nextCursorInput)).advanced, false);
    assert.deepEqual((await showAutomation(vaultRoot, automationId))?.schedule, updated.schedule);
    const currentCursorInput = { ...nextCursorInput, expectedSource: nextSource };
    assert.equal((await advanceAutomationDeviceActivityCursor(currentCursorInput)).advanced, true);
    assert.equal((await advanceAutomationDeviceActivityCursor(currentCursorInput)).advanced, false);

    const beforeRejectedEdit = await showAutomation(vaultRoot, automationId);
    for (const unsupported of ["google_health", "google-health", "unknown-provider"]) {
      const rejected = await runInProcessJsonCli(cli, [
        "automation", "edit", automationId, "--trigger-kind", "deviceActivity",
        "--device-source", unsupported, "--vault", vaultRoot,
      ]);
      assert.equal(rejected.exitCode, 1);
      assert.equal(rejected.envelope.ok, false);
    }
    assert.deepEqual(await showAutomation(vaultRoot, automationId), beforeRejectedEdit);
  } finally {
    vi.useRealTimers();
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation rejects conflicting and irrelevant schedule flags before mutation", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-schedule-flag-conflicts-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation schedule flag validation test cli",
      version: "0.0.0-test",
    });
    cli.use(incurErrorBridge);
    registerAutomationCommands(cli);

    const rejectedSchedules: Array<{
      expectedPath: string;
      privateValues: string[];
      scheduleArgs: string[];
      slug: string;
    }> = [
      {
        expectedPath: "schedule.kind",
        privateValues: ["private-kind-conflict-instructions"],
        scheduleArgs: [
          "--trigger-kind",
          "at",
          "--schedule-kind",
          "every",
          "--trigger-at",
          "2099-01-01T00:00:00.000Z",
          "--schedule-every-ms",
          "3600000",
        ],
        slug: "kind-conflict",
      },
      {
        expectedPath: "schedule.at",
        privateValues: [
          "private-at-conflict-instructions",
          "2099-01-01T00:00:00.000Z",
          "2099-02-01T00:00:00.000Z",
        ],
        scheduleArgs: [
          "--trigger-kind",
          "at",
          "--schedule-kind",
          "at",
          "--trigger-at",
          "2099-01-01T00:00:00.000Z",
          "--schedule-at",
          "2099-02-01T00:00:00.000Z",
        ],
        slug: "at-alias-conflict",
      },
      {
        expectedPath: "schedule.expression",
        privateValues: [
          "private-irrelevant-cron-instructions",
          "private-irrelevant-cron-expression",
        ],
        scheduleArgs: [
          "--trigger-kind",
          "at",
          "--trigger-at",
          "2099-03-01T00:00:00.000Z",
          "--trigger-cron",
          "private-irrelevant-cron-expression",
        ],
        slug: "irrelevant-cron",
      },
    ];

    for (const rejectedSchedule of rejectedSchedules) {
      const result = await runInProcessJsonCli(cli, [
        "automation",
        "save",
        rejectedSchedule.slug,
        "--slug",
        rejectedSchedule.slug,
        "--instructions",
        rejectedSchedule.privateValues[0] ?? "private-schedule-instructions",
        "--status",
        "paused",
        ...rejectedSchedule.scheduleArgs,
        "--channel",
        "telegram",
        "--delivery-target",
        `telegram-thread-${rejectedSchedule.slug}`,
        "--vault",
        vaultRoot,
      ]);

      assert.equal(result.exitCode, 1);
      assert.equal(result.envelope.ok, false);
      if (result.envelope.ok) assert.fail("invalid schedule flags must fail");
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.equal(result.envelope.error.retryable, false);
      assert.equal(result.envelope.error.stage, "validation");
      assert.equal(
        result.envelope.error.fieldErrors?.[0]?.path,
        rejectedSchedule.expectedPath,
      );
      for (const privateValue of rejectedSchedule.privateValues) {
        assert.equal(JSON.stringify(result.envelope).includes(privateValue), false);
      }
    }

    const listedAfterRejectedSaves = await runInProcessJsonCli<{
      count: number;
      items: unknown[];
      totalCount: number;
    }>(cli, [
      "automation",
      "list",
      "--compact",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(listedAfterRejectedSaves.exitCode, null);
    assert.equal(listedAfterRejectedSaves.envelope.ok, true);
    assert.equal(listedAfterRejectedSaves.envelope.data?.count, 0);
    assert.equal(listedAfterRejectedSaves.envelope.data?.totalCount, 0);
    assert.deepEqual(listedAfterRejectedSaves.envelope.data?.items, []);

    const cronExpression = "0 9 * * 1";
    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Matching aliases",
      "--slug",
      "matching-aliases",
      "--instructions",
      "Keep the original instructions.",
      "--status",
      "paused",
      "--trigger-kind",
      "cron",
      "--schedule-kind",
      "cron",
      "--trigger-cron",
      cronExpression,
      "--schedule-cron",
      cronExpression,
      "--trigger-time-zone",
      "America/New_York",
      "--schedule-time-zone",
      "America/New_York",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram-thread-matching-aliases",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const rejectedEdit = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "matching-aliases",
      "--instructions",
      "private-edit-replacement",
      "--trigger-kind",
      "cron",
      "--trigger-cron",
      "0 10 * * 2",
      "--trigger-at",
      "private-irrelevant-at",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(rejectedEdit.exitCode, 1);
    assert.equal(rejectedEdit.envelope.ok, false);
    if (rejectedEdit.envelope.ok) assert.fail("irrelevant edit flags must fail");
    assert.equal(rejectedEdit.envelope.error.code, "invalid_option");
    assert.equal(rejectedEdit.envelope.error.stage, "validation");
    assert.equal(
      rejectedEdit.envelope.error.fieldErrors?.[0]?.path,
      "schedule.at",
    );
    assert.equal(
      JSON.stringify(rejectedEdit.envelope).includes("private-edit-replacement"),
      false,
    );
    assert.equal(
      JSON.stringify(rejectedEdit.envelope).includes("private-irrelevant-at"),
      false,
    );

    const shown = await runInProcessJsonCli<{
      automation: {
        instructions: string;
        schedule: unknown;
      } | null;
    }>(cli, [
      "automation",
      "show",
      "matching-aliases",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(
      shown.envelope.data?.automation?.instructions,
      "Keep the original instructions.",
    );
    assert.deepEqual(shown.envelope.data?.automation?.schedule, {
      expression: cronExpression,
      kind: "cron",
      timeZone: "America/New_York",
    });
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
