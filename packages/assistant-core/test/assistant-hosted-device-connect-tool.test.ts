import assert from "node:assert/strict";

import { test } from "vitest";

import { createProviderTurnAssistantToolCatalog } from "../src/assistant-cli-tools.ts";

test("provider-turn tool catalogs expose murph.device.connect only when the hosted callback is available", async () => {
  const localCatalog = createProviderTurnAssistantToolCatalog({
    vault: "/tmp/murph-assistant-local",
  });
  const issueDeviceConnectLink = async ({ provider }: { provider: string }) => ({
    authorizationUrl: "https://provider.example.test/oauth/start",
    expiresAt: "2026-04-04T12:00:00.000Z",
    provider,
    providerLabel: "WHOOP",
  });
  const hostedCatalog = createProviderTurnAssistantToolCatalog({
    executionContext: {
      hosted: {
        issueDeviceConnectLink,
        memberId: "member_123",
        userEnvKeys: [],
      },
    },
    vault: "/tmp/murph-assistant-hosted",
  });

  assert.equal(localCatalog.hasTool("murph.device.connect"), false);
  assert.equal(hostedCatalog.hasTool("murph.device.connect"), true);

  const [result] = await hostedCatalog.executeCalls({
    calls: [
      {
        input: {
          provider: "whoop",
        },
        tool: "murph.device.connect",
      },
    ],
  });

  assert.deepEqual(result, {
    errorCode: null,
    errorMessage: null,
    input: {
      provider: "whoop",
    },
    result: {
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    },
    status: "succeeded",
    tool: "murph.device.connect",
  });
});
