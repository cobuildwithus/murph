import assert from "node:assert/strict";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";

import {
  HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV,
  ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV,
} from "@murphai/operator-config/assistant/current-delivery-route";
import {
  automationRecordSchema,
  automationScaffoldResultSchema,
  createAutomationScaffoldPayload,
  registerAutomationCommands,
} from "../src/commands/automation.js";
import { createTempVaultContext, runInProcessJsonCli } from "./cli-test-helpers.js";

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

async function startAssistantCurrentRouteBridgeStub(input: {
  channel: string;
  deliveryTarget: string;
  token: string;
}): Promise<{
  requests: string[];
  stop(): Promise<void>;
  url: string;
}> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (request.url !== HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${input.token}`) {
      response.writeHead(401);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({
      route: {
        channel: input.channel,
        deliveryTarget: input.deliveryTarget,
      },
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected test bridge to bind a TCP port.");
  }

  return {
    requests,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    url: `http://127.0.0.1:${address.port}/`,
  };
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
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
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

test("automation record schema rejects recurring schedules with timeZone", () => {
  assert.throws(() => automationRecordSchema.parse({
    automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWX",
    slug: "legacy-weekly-check-in",
    title: "Legacy weekly check-in",
    status: "active",
    summary: "Legacy scheduled assistant notification instructions.",
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
    continuityPolicy: "preserve",
    tags: ["assistant", "scheduled"],
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    instructions: "Write the scheduled assistant instructions here.",
    relativePath: "bank/automations/legacy-weekly-check-in.md",
    markdown: "---\n...\n---\nWrite the scheduled assistant instructions here.\n",
  }), /timeZone/u);
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

test("automation save schema exposes typed fields while automation import-json is the JSON fallback", async () => {
  const cli = Cli.create("vault-cli", {
    description: "automation test cli",
    version: "0.0.0-test",
  });
  registerAutomationCommands(cli);

  const automationCommandNames = requireAutomationCommandNames(cli);
  assert.equal(automationCommandNames.includes("automation save"), true);
  assert.equal(automationCommandNames.includes("automation import-json"), true);
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
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field);
  }

  const importJsonSchema = await readCommandSchema(cli, ["automation", "import-json"]);
  assert.equal("input" in importJsonSchema.options.properties, true);
  assert.equal(importJsonSchema.options.required?.includes("input") ?? false, true);
  assert.deepEqual(importJsonSchema.args.required ?? [], []);
});

test("automation save injects the current private iMessage delivery route", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-route-");
  const bridge = await startAssistantCurrentRouteBridgeStub({
    channel: "linq",
    deliveryTarget: "linq_chat_real",
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli<{
      automationId: string;
      created: boolean;
      lookupId: string;
      path: string;
      vault: string;
    }>(
      cli,
      [
        "automation",
        "save",
        "Current route reminder",
        "--slug",
        "current-route-reminder",
        "--instructions",
        "Send the reminder.",
        "--schedule-kind",
        "at",
        "--schedule-at",
        "2026-12-06T12:00:00.000Z",
        "--vault",
        vaultRoot,
      ],
    );
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          channel: string;
          deliveryTarget: string | null;
          participantId: string | null;
          threadId: string | null;
        };
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      "current-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.channel, "linq");
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, "linq_chat_real");
    assert.equal(shown.envelope.data?.automation?.route.participantId, null);
    assert.equal(shown.envelope.data?.automation?.route.threadId, null);
    assert.deepEqual(bridge.requests, [
      HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
    ]);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save injects a hosted current messaging route without target flags", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-hosted-route-");
  const bridge = await startAssistantCurrentRouteBridgeStub({
    channel: "telegram",
    deliveryTarget: "telegram_thread_real",
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Hosted route reminder",
      "--slug",
      "hosted-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          channel: string;
          deliveryTarget: string | null;
          threadId: string | null;
        };
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      "hosted-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.channel, "telegram");
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, "telegram_thread_real");
    assert.equal(shown.envelope.data?.automation?.route.threadId, null);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save keeps local current route env support outside hosted runtime", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-local-route-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV, "linq");
    vi.stubEnv(ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV, "linq_chat_real");

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Local route reminder",
      "--slug",
      "local-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.envelope.ok, true);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          deliveryTarget: string | null;
          threadId: string | null;
        };
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      "local-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, "linq_chat_real");
    assert.equal(shown.envelope.data?.automation?.route.threadId, null);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation save rejects iMessage routes without a deliverable target", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-automation-route-required-");

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

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

    const realThreadFallback = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Broken real thread route reminder",
      "--slug",
      "broken-real-thread-route-reminder",
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
    assert.equal(realThreadFallback.exitCode, 1);
    assert.equal(realThreadFallback.envelope.ok, false);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
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
        deliveryTarget: null,
        identityId: null,
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
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("automation save maps each flattened schedule discriminator", async () => {
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
      ["at", "one-shot-check", ["--schedule-at", "2026-04-26T08:00:00.000Z"]],
      ["every", "hourly-check", ["--schedule-every-ms", "3600000"]],
      ["cron", "weekly-check", ["--schedule-cron", "0 9 * * 1"]],
      ["dailyLocal", "daily-check", ["--schedule-local-time", "08:30"]],
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
        "--schedule-kind",
        kind,
        ...scheduleArgs,
        "--channel",
        "telegram",
        "--vault",
        vaultRoot,
      ]);
      assert.equal(saved.exitCode, null);
      assert.equal(saved.envelope.ok, true);
      assert.equal(saved.envelope.data?.lookupId, slug);
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
