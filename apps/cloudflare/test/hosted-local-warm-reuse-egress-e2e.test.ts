import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listHostedRuntimeLogsForTest,
  signalHostedRuntimeRecheckRuntimeForTest,
  updateHostedMemberAssistantProviderForTest,
} from "#hosted-web-testing";

import {
  startHostedLocalLinqEgressScenario,
  type HostedLocalEgressScenario,
} from "./helpers/hosted-local-egress-scenario.js";

const runtimeLogLimit = 2_000;

let egress: HostedLocalEgressScenario | null = null;

describe("hosted local warm-reuse egress e2e", () => {
  beforeAll(async () => {
    egress = await startHostedLocalLinqEgressScenario({
      additionalEnv: {
        HOSTED_VENICE_ENABLED: "1",
        HOSTED_VENICE_LUNA_MODEL: "qwen3-4b",
        HOSTED_VENICE_SOL_MODEL: "qwen3-vl-235b-a22b",
        HOSTED_VENICE_TERRA_MODEL: "zai-org-glm-4.7",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        VENICE_API_KEY: "stub-local-venice-key",
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

  it("keeps warm OpenAI egress authorized and hands a saved provider change to a fresh invocation", async () => {
    const harness = requireEgress();
    await harness.seedActiveMemberAndChat();
    const baselineResponses = harness.countProviderRequests("/v1/responses");

    await harness.sendInboundTurn({
      eventSuffix: "warm_reuse_first",
      expectedReplyText: "First warm-reuse turn completed.",
      text: "This is the first warm-reuse egress turn.",
    });
    const secondTurnStartedAt = new Date().toISOString();

    await harness.sendInboundTurn({
      eventSuffix: "warm_reuse_second",
      expectedReplyText: "Second warm-reuse turn completed.",
      text: "This is the second warm-reuse egress turn.",
    });
    const runtimeLogsAfterSecondTurn = await listHostedRuntimeLogsForTest({
      environment: harness.scenario.runtimeEnv,
      limit: runtimeLogLimit,
      userId: harness.userId,
    });
    expect(runtimeLogsAfterSecondTurn.length).toBeLessThan(runtimeLogLimit);
    const secondTurnTimingLogs = runtimeLogsAfterSecondTurn
      .filter((entry) =>
        entry.at > secondTurnStartedAt
        && entry.eventCode === "assistant.automation_detail"
        && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
      );
    expect(secondTurnTimingLogs.map((entry) => entry.redactedJson?.codexTimingStage))
      .toContain("warm-reused");
    expect(secondTurnTimingLogs.map((entry) =>
      entry.redactedJson?.codexTimingColdStartReason
    )).not.toContain("previous-launch-identity-change");

    expect(harness.countProviderRequests("/v1/responses")).toBeGreaterThanOrEqual(
      baselineResponses + 2,
    );
    await harness.assertHealthy({ expectAssistantProviderRequest: true });

    const providerRequestsBeforeSwitch =
      harness.countProviderRequests("/v1/responses");
    const switchStartedAt = new Date().toISOString();
    await expect(updateHostedMemberAssistantProviderForTest({
      environment: harness.scenario.runtimeEnv,
      provider: "venice",
      userId: harness.userId,
    })).resolves.toMatchObject({
      effectiveProviderUpdated: true,
      provider: "venice",
      updated: true,
    });
    await expect(signalHostedRuntimeRecheckRuntimeForTest({
      environment: harness.scenario.runtimeEnv,
      userId: harness.userId,
    })).resolves.toMatchObject({
      signalAccepted: true,
    });

    await waitForProviderHandoff({
      harness,
      startedAt: switchStartedAt,
    });
    expect(harness.countProviderRequests("/v1/responses")).toBe(
      providerRequestsBeforeSwitch,
    );
  }, 420_000);
});

async function waitForProviderHandoff(input: {
  harness: HostedLocalEgressScenario;
  startedAt: string;
}): Promise<void> {
  const deadlineMs = Date.now() + 180_000;
  let immediateRecheckObserved = false;
  let veniceInvocationObserved = false;

  while (Date.now() < deadlineMs) {
    const logs = await listHostedRuntimeLogsForTest({
      environment: input.harness.scenario.runtimeEnv,
      limit: runtimeLogLimit,
      userId: input.harness.userId,
    });
    expect(logs.length).toBeLessThan(runtimeLogLimit);
    const switchLogs = logs.filter((entry) => entry.at >= input.startedAt);
    immediateRecheckObserved ||= switchLogs.some((entry) =>
      entry.redactedJson?.runtimeResultImmediateRecheckRequested === true
    );
    veniceInvocationObserved ||= switchLogs.some((entry) =>
      entry.redactedJson?.hostedAssistantVeniceConfigured === true
    );
    if (immediateRecheckObserved && veniceInvocationObserved) {
      return;
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for provider handoff (immediate recheck: ${immediateRecheckObserved}; Venice invocation: ${veniceInvocationObserved}).`,
  );
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function requireEgress(): HostedLocalEgressScenario {
  if (!egress) {
    throw new Error("Hosted local egress scenario was not initialized.");
  }
  return egress;
}
