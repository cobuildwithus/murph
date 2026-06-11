import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";

import {
  HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
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
  };
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
    assert.deepEqual(bridge.requests, [
      HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
    ]);
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
    assert.deepEqual(bridge.requests, [
      HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
    ]);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});

// A different conversation's explicit target must not absorb the current
// conversation's locators.
test("automation save does not enrich an explicit different-conversation target", async () => {
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
    assert.equal(saved.envelope.ok, true);
    assert.equal(saved.exitCode, null);

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
    assert.equal(shown.exitCode, null);
    assert.equal(shown.envelope.ok, true);
    assert.equal(
      shown.envelope.data?.automation?.route.deliveryTarget,
      "linq_chat_other",
    );
    assert.equal(shown.envelope.data?.automation?.route.identityId, null);
    assert.equal(shown.envelope.data?.automation?.route.participantId, null);
    assert.equal(shown.envelope.data?.automation?.route.threadId, null);
  } finally {
    await bridge.stop();
    await rm(parentRoot, { recursive: true, force: true });
  }
});
