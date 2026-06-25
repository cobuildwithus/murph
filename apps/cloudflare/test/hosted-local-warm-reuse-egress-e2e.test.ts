import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalLinqEgressScenario,
  type HostedLocalEgressScenario,
} from "./helpers/hosted-local-egress-scenario.js";

let egress: HostedLocalEgressScenario | null = null;

describe("hosted local warm-reuse egress e2e", () => {
  beforeAll(async () => {
    egress = await startHostedLocalLinqEgressScenario({
      additionalEnv: {
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
      },
      persistDirPrefix: "murph-hosted-local-warm-reuse-egress-",
      scenarioLabel: "Local hosted warm reuse egress e2e",
      userIdPrefix: "member_local_warm_reuse_egress",
    });
  }, 300_000);

  afterAll(async () => {
    await egress?.stop();
    egress = null;
  }, 120_000);

  it("keeps OpenAI and delivery egress authorized across two same-user warm turns", async () => {
    const harness = requireEgress();
    await harness.seedActiveMemberAndChat();
    const baselineResponses = harness.countProviderRequests("/v1/responses");

    await harness.sendInboundTurn({
      eventSuffix: "warm_reuse_first",
      expectedReplyText: "First warm-reuse turn completed.",
      text: "This is the first warm-reuse egress turn.",
    });
    await harness.sendInboundTurn({
      eventSuffix: "warm_reuse_second",
      expectedReplyText: "Second warm-reuse turn completed.",
      text: "This is the second warm-reuse egress turn.",
    });

    expect(harness.countProviderRequests("/v1/responses")).toBeGreaterThanOrEqual(
      baselineResponses + 2,
    );
    await harness.assertHealthy({ expectAssistantProviderRequest: true });
  }, 420_000);
});

function requireEgress(): HostedLocalEgressScenario {
  if (!egress) {
    throw new Error("Hosted local egress scenario was not initialized.");
  }
  return egress;
}
