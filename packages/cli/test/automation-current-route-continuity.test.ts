import assert from "node:assert/strict";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";

import { MURPH_ONBOARDING_FOLLOWUP_AUTOMATION } from "@murphai/assistant-engine";
import {
  HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import { upsertAutomation } from "@murphai/core";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import { registerAutomationCommands } from "../src/commands/automation.js";
import {
  createTempVaultContext,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

interface AssistantCurrentRouteBridgeResponse {
  route: {
    channel: string;
    deliveryTarget: string;
    identityId: string | null;
    participantId: string | null;
    threadId: string | null;
    threadIsDirect?: boolean | null;
  } | null;
}

async function startAssistantCurrentRouteBridgeStub(input: {
  response: AssistantCurrentRouteBridgeResponse;
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
    response.end(JSON.stringify(input.response));
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

test("automation save preserves hosted iMessage current-route continuity locators", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-current-route-continuity-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "h1_111111111111111111111111",
        participantId: "h1_222222222222222222222222",
        threadId: "h1_333333333333333333333333",
        threadIsDirect: true,
      },
    },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation current route continuity test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Current iMessage route reminder",
      "--slug",
      "current-imessage-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(
      saved.envelope.ok,
      true,
      saved.envelope.ok
        ? undefined
        : `${saved.envelope.error.code ?? "unknown"}: ${
            saved.envelope.error.message ?? "unknown error"
          }`,
    );
    assert.equal(saved.exitCode, null);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          channel: string;
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
          threadIsDirect?: boolean | null;
        };
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      "current-imessage-route-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.channel, "linq");
    assert.equal(
      shown.envelope.data?.automation?.route.deliveryTarget,
      "linq_chat_real",
    );
    assert.equal(
      shown.envelope.data?.automation?.route.identityId,
      "h1_111111111111111111111111",
    );
    assert.equal(
      shown.envelope.data?.automation?.route.participantId,
      "h1_222222222222222222222222",
    );
    assert.equal(
      shown.envelope.data?.automation?.route.threadId,
      "h1_333333333333333333333333",
    );
    assert.equal(shown.envelope.data?.automation?.route.threadIsDirect, true);
    assert.deepEqual(bridge.requests, [
      HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
    ]);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("a verified direct Linq automation follows participant-to-chat materialization", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-direct-route-materialization-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "hid_direct_identity",
        participantId: "hid_direct_participant",
        threadId: "hid_materialized_thread",
        threadIsDirect: true,
      },
    },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation direct route materialization test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    await upsertAutomation({
      continuityPolicy: "preserve",
      instructions: "Send the onboarding follow-up.",
      route: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "+15550123",
        identityId: "hid_direct_identity",
        participantId: "hid_direct_participant",
        threadId: null,
        threadIsDirect: true,
      },
      schedule: { kind: "cron", expression: "0 7 * * *" },
      slug: "materialized-direct-reminder",
      status: "active",
      tags: [],
      title: "Materialized direct reminder",
      vaultRoot,
    });

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Materialized direct reminder",
      "--slug",
      "materialized-direct-reminder",
      "--instructions",
      "Send the onboarding follow-up soon.",
      "--schedule-kind",
      "every",
      "--schedule-every-ms",
      "150000",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_chat_real",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(
      saved.envelope.ok,
      true,
      saved.envelope.ok ? undefined : JSON.stringify(saved.envelope.error),
    );

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
          threadIsDirect?: boolean | null;
        };
      } | null;
    }>(cli, [
      "automation",
      "show",
      "materialized-direct-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.route, {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "linq_chat_real",
      identityId: "hid_direct_identity",
      participantId: "hid_direct_participant",
      threadId: "hid_materialized_thread",
      threadIsDirect: true,
    });
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("the managed onboarding follow-up materializes its signup route into the current direct chat", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-onboarding-route-materialization-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "hid_current_line_identity",
        participantId: "hid_current_line_participant",
        threadId: "hid_materialized_thread",
        threadIsDirect: true,
      },
    },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation onboarding route materialization test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const managedFollowup = {
      continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      route: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: null,
        identityId: "hid_signup_contact_identity",
        participantId: "hid_signup_contact_participant",
        threadId: null,
      },
      schedule: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.schedule,
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: "active",
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vaultRoot,
    } as const;

    const saveArgs = [
      "automation",
      "save",
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      "--slug",
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      "--instructions",
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      "--schedule-kind",
      "every",
      "--schedule-every-ms",
      "150000",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_chat_real",
      "--vault",
      vaultRoot,
    ];

    await upsertAutomation({
      ...managedFollowup,
      tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags.filter(
        (tag) => tag !== "murph-managed:onboarding-followup",
      ),
    });
    const untaggedSave = await runInProcessJsonCli(cli, saveArgs);
    assert.equal(untaggedSave.envelope.ok, false);
    assert.match(untaggedSave.envelope.error.message ?? "", /current chat/i);

    await upsertAutomation({
      ...managedFollowup,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
    });
    const saved = await runInProcessJsonCli(cli, saveArgs);
    assert.equal(
      saved.envelope.ok,
      true,
      saved.envelope.ok ? undefined : JSON.stringify(saved.envelope.error),
    );

    const shown = await runInProcessJsonCli<{
      automation: { route: Record<string, unknown> } | null;
    }>(cli, [
      "automation",
      "show",
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.route, {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "linq_chat_real",
      identityId: "hid_current_line_identity",
      participantId: "hid_current_line_participant",
      threadId: "hid_materialized_thread",
      threadIsDirect: true,
    });
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

// Hosted linq conversation locators are hid_-blinded; an explicit delivery
// target naming the current conversation must still inherit them so the saved
// route can resolve that conversation's session at fire time.
test("automation save enriches an explicit same-conversation target with blinded locators", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-current-route-enrich-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "hid_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        participantId: "hid_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        threadId: "hid_cccccccccccccccccccccccccccccccc",
        threadIsDirect: false,
      },
    },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation current route enrichment test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Explicit current conversation reminder",
      "--slug",
      "explicit-current-conversation-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_chat_real",
      // Model-echoed placeholder flags are stripped and replaced by the
      // trusted bridge locators for the same conversation.
      "--thread-id",
      "hid_model_echoed_thread",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(
      saved.envelope.ok,
      true,
      saved.envelope.ok
        ? undefined
        : `${saved.envelope.error.code ?? "unknown"}: ${
            saved.envelope.error.message ?? "unknown error"
          }`,
    );
    assert.equal(saved.exitCode, null);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          channel: string;
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
          threadIsDirect?: boolean | null;
        };
      } | null;
      vault: string;
    }>(cli, [
      "automation",
      "show",
      "explicit-current-conversation-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.channel, "linq");
    assert.equal(
      shown.envelope.data?.automation?.route.deliveryTarget,
      "linq_chat_real",
    );
    assert.equal(
      shown.envelope.data?.automation?.route.identityId,
      "hid_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    assert.equal(
      shown.envelope.data?.automation?.route.participantId,
      "hid_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    assert.equal(
      shown.envelope.data?.automation?.route.threadId,
      "hid_cccccccccccccccccccccccccccccccc",
    );
    assert.equal(shown.envelope.data?.automation?.route.threadIsDirect, false);
    assert.deepEqual(bridge.requests, [
      HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
    ]);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("group automation writes are restricted to the current room", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-group-route-authority-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: {
      route: {
        channel: "linq",
        deliveryTarget: "linq_group_current",
        identityId: "hid_group_identity",
        participantId: "hid_group_participant",
        threadId: "hid_group_thread",
        threadIsDirect: false,
      },
    },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation group route authority test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    await upsertAutomation({
      automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWY",
      continuityPolicy: "preserve",
      instructions: "Send the other room reminder.",
      route: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "linq_group_other",
        identityId: null,
        participantId: null,
        threadId: null,
        threadIsDirect: false,
      },
      schedule: { kind: "at", at: "2026-12-06T12:00:00.000Z" },
      slug: "foreign-room-reminder",
      status: "active",
      tags: [],
      title: "Foreign room reminder",
      vaultRoot,
    });

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Current room reminder",
      "--slug",
      "current-room-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.envelope.ok, true);

    const alternateSave = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Other route reminder",
      "--slug",
      "other-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_group_other",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(alternateSave.envelope.ok, false);
    assert.equal(
      alternateSave.envelope.ok ? null : alternateSave.envelope.error.code,
      "UNKNOWN",
      JSON.stringify(alternateSave.envelope),
    );

    const alternateEdit = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "current-room-reminder",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_group_other",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(alternateEdit.envelope.ok, false);
    assert.equal(
      alternateEdit.envelope.ok ? null : alternateEdit.envelope.error.code,
      "UNKNOWN",
    );

    const importPath = path.join(parentRoot, "alternate-route.json");
    await writeFile(importPath, JSON.stringify({
      title: "Imported other route",
      slug: "imported-other-route",
      status: "active",
      continuityPolicy: "preserve",
      schedule: { kind: "at", at: "2026-12-06T12:00:00.000Z" },
      route: {
        channel: "linq",
        deliveryTarget: "linq_group_other",
        identityId: "hid_group_identity",
        participantId: "hid_group_participant",
        threadId: "hid_group_thread",
        threadIsDirect: true,
      },
      instructions: "Send the reminder.",
      tags: [],
    }));
    const imported = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${importPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.envelope.ok, false);
    assert.equal(
      imported.envelope.ok ? null : imported.envelope.error.code,
      "UNKNOWN",
    );

    const titleDerivedForeignCollisions = [
      {
        fileName: "foreign-title-only.json",
        payload: {
          title: "Foreign room reminder",
        },
      },
      {
        fileName: "foreign-title-with-fresh-id.json",
        payload: {
          automationId: "automation_fresh_title_collision",
          title: "Foreign room reminder",
        },
      },
      {
        fileName: "foreign-formatted-title.json",
        payload: {
          title: "Foreign---room reminder",
        },
      },
    ];
    for (const collision of titleDerivedForeignCollisions) {
      const collisionPath = path.join(parentRoot, collision.fileName);
      await writeFile(collisionPath, JSON.stringify({
        ...collision.payload,
        status: "active",
        continuityPolicy: "preserve",
        schedule: { kind: "at", at: "2026-12-06T12:00:00.000Z" },
        route: {
          channel: "linq",
          deliveryTarget: "linq_group_current",
          identityId: "hid_group_identity",
          participantId: "hid_group_participant",
          threadId: "hid_group_thread",
          threadIsDirect: false,
        },
        instructions: "Must not replace another room's automation.",
        tags: [],
      }));
      const collisionImport = await runInProcessJsonCli(cli, [
        "automation",
        "import-json",
        "--input",
        `@${collisionPath}`,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(collisionImport.envelope.ok, false);
    }

    for (const title of ["Current room reminder", "Unused group reminder"]) {
      const sameOrUnusedPath = path.join(
        parentRoot,
        `${title.toLowerCase().replaceAll(" ", "-")}.json`,
      );
      await writeFile(sameOrUnusedPath, JSON.stringify({
        title,
        status: "active",
        continuityPolicy: "preserve",
        schedule: { kind: "at", at: "2026-12-06T12:00:00.000Z" },
        route: {
          channel: "linq",
          deliveryTarget: "linq_group_current",
          identityId: "hid_group_identity",
          participantId: "hid_group_participant",
          threadId: "hid_group_thread",
          // Hosted imports cannot promote the current group to a direct chat;
          // the trusted bridge route owns this fact.
          threadIsDirect: true,
        },
        instructions: "Authorized current room automation.",
        tags: [],
      }));
      const sameOrUnusedImport = await runInProcessJsonCli(cli, [
        "automation",
        "import-json",
        "--input",
        `@${sameOrUnusedPath}`,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(
        sameOrUnusedImport.envelope.ok,
        true,
        sameOrUnusedImport.envelope.ok
          ? title
          : `${title}: ${sameOrUnusedImport.envelope.error.code ?? "unknown"}: ${
              sameOrUnusedImport.envelope.error.message ?? "unknown error"
            }`,
      );
    }

    const collidedSave = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Foreign room replacement",
      "--slug",
      "foreign-room-reminder",
      "--instructions",
      "Replace it.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(collidedSave.envelope.ok, false);

    const collidedEdit = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "foreign-room-reminder",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_group_current",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(collidedEdit.envelope.ok, false);

    const collidedImportPath = path.join(parentRoot, "collided-route.json");
    await writeFile(collidedImportPath, JSON.stringify({
      title: "Foreign room import replacement",
      automationId: "automation_01HZXW2Y6Y8QWQ8QWQ8QWQ8QWY",
      slug: "foreign-room-reminder",
      status: "active",
      continuityPolicy: "preserve",
      schedule: { kind: "at", at: "2026-12-06T12:00:00.000Z" },
      route: {
        channel: "linq",
        deliveryTarget: "linq_group_current",
        threadIsDirect: false,
      },
      instructions: "Replace it.",
      tags: [],
    }));
    const collidedImport = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${collidedImportPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(collidedImport.envelope.ok, false);

    const collidedStatus = await runInProcessJsonCli(cli, [
      "automation",
      "set-status",
      "foreign-room-reminder",
      "--status",
      "paused",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(collidedStatus.envelope.ok, false);

    for (const status of ["paused", "active"] as const) {
      const updated = await runInProcessJsonCli(cli, [
        "automation",
        "set-status",
        "current-room-reminder",
        "--status",
        status,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(updated.envelope.ok, true);
    }

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          channel: string;
          deliveryTarget: string | null;
          identityId: string | null;
          participantId: string | null;
          threadId: string | null;
          threadIsDirect?: boolean | null;
        };
      } | null;
    }>(cli, [
      "automation",
      "show",
      "current-room-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.deepEqual(shown.envelope.data?.automation?.route, {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "linq_group_current",
      identityId: "hid_group_identity",
      participantId: "hid_group_participant",
      threadId: "hid_group_thread",
      threadIsDirect: false,
    });
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("hosted direct-email automation writes follow a stable thread across changing reply envelopes", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-email-route-continuity-",
  );
  const firstEnvelope = serializeHostedEmailThreadTarget({
    cc: [],
    lastMessageId: "<first@example.test>",
    references: [],
    subject: "Weekly check-in",
    to: ["group@example.test"],
  });
  const laterEnvelope = serializeHostedEmailThreadTarget({
    cc: [],
    lastMessageId: "<later@example.test>",
    references: ["<first@example.test>"],
    subject: "Re: Weekly check-in",
    to: ["group@example.test"],
  });
  const bridgeResponse: AssistantCurrentRouteBridgeResponse = {
    route: {
      channel: "email",
      deliveryTarget: firstEnvelope,
      identityId: "email-sender-identity",
      participantId: null,
      threadId: "stable-email-thread",
      threadIsDirect: true,
    },
  };
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: bridgeResponse,
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation email route continuity test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const initialSave = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Email thread reminder",
      "--slug",
      "email-thread-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(initialSave.envelope.ok, true);

    bridgeResponse.route = {
      channel: "email",
      deliveryTarget: laterEnvelope,
      identityId: "email-sender-identity",
      participantId: null,
      threadId: "stable-email-thread",
      threadIsDirect: true,
    };

    const edited = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "email-thread-reminder",
      "--summary",
      "Updated after a reply.",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(edited.envelope.ok, true);

    const savedAgain = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Email thread reminder",
      "--slug",
      "email-thread-reminder",
      "--instructions",
      "Send the updated reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-07T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(savedAgain.envelope.ok, true);

    const statusUpdated = await runInProcessJsonCli(cli, [
      "automation",
      "set-status",
      "email-thread-reminder",
      "--status",
      "paused",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(statusUpdated.envelope.ok, true);

    const importPath = path.join(parentRoot, "same-email-thread.json");
    await writeFile(importPath, JSON.stringify({
      title: "Email thread reminder",
      slug: "email-thread-reminder",
      status: "active",
      continuityPolicy: "fresh",
      schedule: { kind: "at", at: "2026-12-08T12:00:00.000Z" },
      route: {
        channel: "email",
        deliveryTarget: firstEnvelope,
        identityId: "email-sender-identity",
        participantId: null,
        threadId: "stable-email-thread",
        threadIsDirect: true,
      },
      instructions: "Send the imported reminder.",
      tags: [],
    }));
    const imported = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${importPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(
      imported.envelope.ok,
      true,
      imported.envelope.ok
        ? undefined
        : `${imported.envelope.error.code ?? "unknown"}: ${
            imported.envelope.error.message ?? "unknown error"
          }`,
    );

    const shown = await runInProcessJsonCli<{
      automation: { route: { deliveryTarget: string | null } } | null;
    }>(cli, [
      "automation",
      "show",
      "email-thread-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation?.route.deliveryTarget, laterEnvelope);

    bridgeResponse.route = {
      channel: "email",
      deliveryTarget: laterEnvelope,
      identityId: "email-sender-identity",
      participantId: null,
      threadId: "different-email-thread",
      threadIsDirect: true,
    };
    const differentThreadEdit = await runInProcessJsonCli(cli, [
      "automation",
      "edit",
      "email-thread-reminder",
      "--summary",
      "Must not cross threads.",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(differentThreadEdit.envelope.ok, false);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("hosted group-email replies cannot mutate automations", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-group-email-authority-",
  );
  const deliveryTarget = serializeHostedEmailThreadTarget({
    cc: [],
    lastMessageId: "<group-reply@example.test>",
    references: [],
    subject: "Group newsletter reply",
    to: ["group@example.test"],
  });
  const route = {
    channel: "email" as const,
    deliverySource: null,
    deliveryTarget,
    identityId: "group-email-sender",
    participantId: null,
    threadId: "stable-group-email-thread",
    threadIsDirect: false,
  };
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: { route },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation group email authority test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Spoofable group email reminder",
      "--instructions",
      "Send it repeatedly.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.envelope.ok, false);

    await upsertAutomation({
      continuityPolicy: "preserve",
      instructions: "Existing group reminder.",
      route,
      schedule: { kind: "at", at: "2026-12-06T12:00:00.000Z" },
      slug: "existing-group-email-reminder",
      status: "active",
      tags: [],
      title: "Existing group email reminder",
      vaultRoot,
    });

    for (const args of [
      ["automation", "edit", "existing-group-email-reminder", "--summary", "Spoofed edit"],
      ["automation", "set-status", "existing-group-email-reminder", "--status", "paused"],
    ]) {
      const result = await runInProcessJsonCli(cli, [
        ...args,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(result.envelope.ok, false);
    }

    const importPath = path.join(parentRoot, "group-email-import.json");
    await writeFile(importPath, JSON.stringify({
      title: "Existing group email reminder",
      slug: "existing-group-email-reminder",
      status: "active",
      continuityPolicy: "preserve",
      schedule: { kind: "at", at: "2026-12-07T12:00:00.000Z" },
      route,
      instructions: "Spoofed import.",
      tags: [],
    }));
    const imported = await runInProcessJsonCli(cli, [
      "automation",
      "import-json",
      "--input",
      `@${importPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.envelope.ok, false);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("hosted automation save rejects an explicit different-conversation target", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-current-route-no-enrich-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: {
      route: {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "hid_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        participantId: "hid_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        threadId: "hid_cccccccccccccccccccccccccccccccc",
        threadIsDirect: true,
      },
    },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation current route no-enrichment test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Other conversation reminder",
      "--slug",
      "other-conversation-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_chat_other",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.envelope.ok, false);

    const shown = await runInProcessJsonCli<{
      automation: {
        route: {
          channel: string;
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
      "other-conversation-reminder",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.equal(shown.envelope.data?.automation, null);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("hosted automation writes fail closed when the current route is unavailable", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-current-route-unavailable-",
  );
  const bridge = await startAssistantCurrentRouteBridgeStub({
    response: { route: null },
    token: "test-bridge-token",
  });

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation unavailable current route test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);
    vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, "1");
    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "test-bridge-token");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, bridge.url);

    const saved = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Unavailable route reminder",
      "--slug",
      "unavailable-route-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_group_unverified",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.envelope.ok, false);
    assert.equal(
      saved.envelope.ok ? null : saved.envelope.error.message,
      "Hosted automation changes require one verified current conversation.",
    );

    vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, "");
    vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, "");
    const missingBridge = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Missing bridge reminder",
      "--slug",
      "missing-bridge-reminder",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-12-06T12:00:00.000Z",
      "--channel",
      "linq",
      "--delivery-target",
      "linq_group_unverified",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(missingBridge.envelope.ok, false);
    assert.equal(
      missingBridge.envelope.ok ? null : missingBridge.envelope.error.message,
      "Hosted automation changes require one verified current conversation.",
    );
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});
