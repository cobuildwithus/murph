import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalLinqEgressScenario,
  type HostedLocalEgressScenario,
} from "./helpers/hosted-local-egress-scenario.js";

let egress: HostedLocalEgressScenario | null = null;

describe("hosted local provider-egress-token bridge e2e", () => {
  beforeAll(async () => {
    egress = await startHostedLocalLinqEgressScenario({
      persistDirPrefix: "murph-hosted-local-provider-egress-token-bridge-",
      scenarioLabel: "Local hosted provider egress token bridge e2e",
      userIdPrefix: "member_local_provider_egress_bridge",
    });
  }, 300_000);

  afterAll(async () => {
    await egress?.stop();
    egress = null;
  }, 120_000);

  it("composes runtime provider fetch headers with Worker-side Linq egress validation", async () => {
    const harness = requireEgress();
    await harness.seedActiveMemberAndChat();
    const reply = await harness.sendInboundTurn({
      eventSuffix: "provider_bridge",
      expectedReplyText: "Provider-token bridge delivered this reply.",
      text: "Please send a short reply so Linq delivery crosses provider egress.",
    });

    expect(reply.authorizationStatus).toBe("hosted-sentinel");
    expect(harness.linqStub.observedRequests.some((request) =>
      request.authorizationStatus === "hosted-sentinel"
      && request.url === `/chats/${encodeURIComponent(harness.chatId)}/messages`
    )).toBe(true);
    await harness.assertHealthy({ expectAssistantProviderRequest: true });
  }, 300_000);
});

function requireEgress(): HostedLocalEgressScenario {
  if (!egress) {
    throw new Error("Hosted local egress scenario was not initialized.");
  }
  return egress;
}
