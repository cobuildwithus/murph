import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalLinqEgressScenario,
  type HostedLocalEgressScenario,
} from "./helpers/hosted-local-egress-scenario.js";

let egress: HostedLocalEgressScenario | null = null;

describe("hosted local OpenAI egress authority e2e", () => {
  beforeAll(async () => {
    egress = await startHostedLocalLinqEgressScenario({
      persistDirPrefix: "murph-hosted-local-openai-egress-authority-",
      scenarioLabel: "Local hosted OpenAI egress authority e2e",
      userIdPrefix: "member_local_openai_egress_authority",
    });
  }, 300_000);

  afterAll(async () => {
    await egress?.stop();
    egress = null;
  }, 120_000);

  it("routes a real hosted Codex Responses call through the production Worker egress boundary", async () => {
    const harness = requireEgress();
    await harness.seedActiveMemberAndChat();
    const baselineResponses = harness.countProviderRequests("/v1/responses");

    await harness.sendInboundTurn({
      eventSuffix: "openai_authority",
      expectedReplyText: "OpenAI egress authority is healthy.",
      text: "Please confirm you can reply through the hosted OpenAI path.",
    });

    expect(harness.countProviderRequests("/v1/responses")).toBeGreaterThan(baselineResponses);
    await harness.assertHealthy({ expectAssistantProviderRequest: true });
  }, 300_000);
});

function requireEgress(): HostedLocalEgressScenario {
  if (!egress) {
    throw new Error("Hosted local egress scenario was not initialized.");
  }
  return egress;
}
