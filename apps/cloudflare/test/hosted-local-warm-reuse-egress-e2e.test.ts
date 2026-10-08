import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalLinqEgressScenario,
  type HostedLocalEgressScenario,
} from "./helpers/hosted-local-egress-scenario.js";

const defaultProductModel = "gpt-6.1-sol";

let egress: HostedLocalEgressScenario | null = null;

describe("hosted local resident-container egress e2e", () => {
  beforeAll(async () => {
    egress = await startHostedLocalLinqEgressScenario({
      additionalEnv: {
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "30000",
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

  it("keeps OpenAI egress authorized across consecutive resident-container turns", async () => {
    const harness = requireEgress();
    await harness.seedActiveMemberAndChat();
    const baselineResponses = harness.countProviderRequests("/v1/responses");

    await harness.sendInboundTurn({
      eventSuffix: "warm_reuse_first",
      expectedReplyText: "First warm-reuse turn completed.",
      text: "This is the first warm-reuse egress turn.",
    });
    const secondTurn = await harness.sendInboundTurnUntilReply({
      eventSuffix: "warm_reuse_second",
      expectedReplyText: "Second warm-reuse turn completed.",
      text: "This is the second warm-reuse egress turn.",
    });
    const thirdTurn = await harness.sendInboundTurnUntilReply({
      eventSuffix: "warm_reuse_third",
      expectedReplyText: "Third warm-reuse turn completed.",
      text: "This is the third warm-reuse egress turn.",
    });

    await Promise.all([secondTurn.completion, thirdTurn.completion]);
    const providerRequests = harness
      .listProviderRequests("/v1/responses")
      .slice(baselineResponses);
    expect(providerRequests.length).toBeGreaterThanOrEqual(3);
    for (const request of providerRequests) {
      const providerRequestBody = request.body ?? "";
      expect(readProviderRequestModel(providerRequestBody)).toBe(defaultProductModel);
      expectCurrentResponsesLiteToolEnvelope(providerRequestBody);
    }
    await harness.assertHealthy({ expectAssistantProviderRequest: true });
  }, 420_000);
});

function readProviderRequestModel(body: string): unknown {
  const payload: unknown = JSON.parse(body);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? Reflect.get(payload, "model")
    : null;
}

function expectCurrentResponsesLiteToolEnvelope(body: string): void {
  const payload: unknown = JSON.parse(body);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Expected the provider request to be a JSON object.");
  }
  expect(Reflect.has(payload, "tools")).toBe(false);

  const input: unknown = Reflect.get(payload, "input");
  if (!Array.isArray(input)) {
    throw new TypeError("Expected the provider request input to be an array.");
  }
  const additionalToolsItems = input.filter((item) =>
    Boolean(
      item
      && typeof item === "object"
      && !Array.isArray(item)
      && Reflect.get(item, "type") === "additional_tools",
    )
  );
  expect(additionalToolsItems).toHaveLength(1);
  const additionalTools = additionalToolsItems[0];
  if (
    !additionalTools
    || typeof additionalTools !== "object"
    || Array.isArray(additionalTools)
  ) {
    throw new TypeError("Expected one Responses Lite tool envelope.");
  }
  expect(Reflect.get(additionalTools, "id")).toEqual(
    expect.stringMatching(/^at_.+/u),
  );
  expect(Reflect.get(additionalTools, "role")).toBe("developer");
  const tools: unknown = Reflect.get(additionalTools, "tools");
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new TypeError(
      "Expected the Responses Lite envelope to contain tool definitions.",
    );
  }
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new TypeError(
        "Expected each Responses Lite tool definition to be a JSON object.",
      );
    }
    expect(Reflect.get(tool, "type")).toEqual(expect.any(String));
  }
}

function requireEgress(): HostedLocalEgressScenario {
  if (!egress) {
    throw new Error("Hosted local egress scenario was not initialized.");
  }
  return egress;
}
