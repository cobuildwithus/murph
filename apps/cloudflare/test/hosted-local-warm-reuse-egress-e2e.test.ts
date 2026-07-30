import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";

import {
  listHostedRuntimeLogsForTest,
  queryHostedRuntimeWorkflowForTest,
  signalHostedRuntimeWakeRuntimeForTest,
  updateHostedMemberAssistantProviderForTest,
} from "#hosted-web-testing";

import {
  startHostedLocalLinqEgressScenario,
  type HostedLocalEgressScenario,
} from "./helpers/hosted-local-egress-scenario.js";

const runtimeLogLimit = 500;
// The hosted-local recorder observes Murph's canonical product model. The
// production Venice egress boundary owns provider-specific model translation.
const terraProductModel = "gpt-5.6-terra";

type RuntimeWakeObservation = Pick<
  HostedRuntimeWorkflowState,
  "lastExecutionAt" | "signalVersion"
>;

let egress: HostedLocalEgressScenario | null = null;

describe("hosted local warm-reuse egress e2e", () => {
  beforeAll(async () => {
    egress = await startHostedLocalLinqEgressScenario({
      additionalEnv: {
        HOSTED_VENICE_ENABLED: "1",
        HOSTED_VENICE_LUNA_MODEL: "qwen3-4b",
        HOSTED_VENICE_SOL_MODEL: "qwen3-vl-235b-a22b",
        HOSTED_VENICE_TERRA_MODEL: "zai-org-glm-4.7",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "30000",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        VENICE_API_KEY: "stub-local-venice-key",
      },
      persistDirPrefix: "murph-hosted-local-warm-reuse-egress-",
      scenarioLabel: "Local hosted warm reuse egress e2e",
      userIdPrefix: "member_local_warm_reuse_egress",
    });
    expect(egress.scenario.harness.workerRuntimeEnv?.VENICE_API_KEY).toBe(
      "stub-local-venice-key",
    );
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
    const secondTurn = await harness.sendInboundTurnUntilReply({
      eventSuffix: "warm_reuse_second",
      expectedReplyText: "Second warm-reuse turn completed.",
      text: "This is the second warm-reuse egress turn.",
    });

    expect(harness.countProviderRequests("/v1/responses")).toBeGreaterThanOrEqual(
      baselineResponses + 2,
    );
    await harness.assertHealthy({ expectAssistantProviderRequest: true });

    const providerRequestsBeforeSwitch =
      harness.countProviderRequests("/v1/responses");
    const switchStartedAt = new Date().toISOString();
    const workflowStateBeforeSwitch = await readRuntimeWorkflowState({
      environment: harness.scenario.runtimeEnv,
      userId: harness.userId,
    });
    await expect(updateHostedMemberAssistantProviderForTest({
      environment: harness.scenario.runtimeEnv,
      provider: "venice",
      userId: harness.userId,
    })).resolves.toMatchObject({
      effectiveProviderUpdated: true,
      provider: "venice",
      updated: true,
    });
    await expect(signalHostedRuntimeWakeRuntimeForTest({
      environment: harness.scenario.runtimeEnv,
      userId: harness.userId,
    })).resolves.toMatchObject({
      signalAccepted: true,
    });
    await waitForRuntimeWakeExecution({
      environment: harness.scenario.runtimeEnv,
      previousState: workflowStateBeforeSwitch,
      userId: harness.userId,
    });
    expect(harness.countProviderRequests("/v1/responses")).toBe(
      providerRequestsBeforeSwitch,
    );

    const thirdTurn = await harness.startInboundTurn({
      eventSuffix: "warm_reuse_third",
      expectedReplyText: "Venice reply after handoff.",
      text: "This is the first turn after the provider handoff.",
    });
    await waitForReplyAfterProviderSwitch({
      harness,
      reply: thirdTurn.send,
      startedAt: switchStartedAt,
    });
    const providerRequestsAfterSwitch = harness
      .listProviderRequests("/v1/responses")
      .slice(providerRequestsBeforeSwitch);
    expect(providerRequestsAfterSwitch).toHaveLength(1);
    expect(readProviderRequestModel(providerRequestsAfterSwitch[0]?.body ?? ""))
      .toBe(terraProductModel);

    await Promise.all([
      secondTurn.completion,
      thirdTurn.completion,
    ]);
    const runtimeLogsAfterSecondTurn = await listHostedRuntimeLogsForTest({
      environment: harness.scenario.runtimeEnv,
      limit: runtimeLogLimit,
      userId: harness.userId,
    });
    expect(runtimeLogsAfterSecondTurn.length).toBeLessThan(runtimeLogLimit);
    const codexTimingLogs = runtimeLogsAfterSecondTurn
      .filter((entry) =>
        entry.eventCode === "assistant.automation_detail"
        && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
      );
    expect(codexTimingLogs.map((entry) => entry.redactedJson?.codexTimingStage))
      .toContain("warm-reused");
    expect(codexTimingLogs.map((entry) =>
      entry.redactedJson?.codexTimingColdStartReason
    )).toContain("previous-launch-identity-change");
    expect(harness.countProviderRequests("/v1/responses")).toBe(
      providerRequestsBeforeSwitch + 1,
    );
  }, 420_000);
});

function readProviderRequestModel(body: string): unknown {
  const payload: unknown = JSON.parse(body);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? Reflect.get(payload, "model")
    : null;
}

async function readRuntimeWorkflowState(input: {
  environment: NodeJS.ProcessEnv;
  userId: string;
}): Promise<RuntimeWakeObservation> {
  const value = await queryHostedRuntimeWorkflowForTest({
    environment: input.environment,
    queryName: HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
    workflowId: `hosted-user-runtime:${input.userId}`,
  });
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime workflow query returned an invalid state.");
  }
  const lastExecutionAt: unknown = Reflect.get(value, "lastExecutionAt");
  const signalVersion: unknown = Reflect.get(value, "signalVersion");
  if (
    (lastExecutionAt !== null && typeof lastExecutionAt !== "string")
    || !Number.isSafeInteger(signalVersion)
    || typeof signalVersion !== "number"
    || signalVersion < 0
  ) {
    throw new TypeError("Hosted runtime workflow query returned an invalid state.");
  }
  return {
    lastExecutionAt,
    signalVersion,
  };
}

async function waitForRuntimeWakeExecution(input: {
  environment: NodeJS.ProcessEnv;
  previousState: RuntimeWakeObservation;
  userId: string;
}): Promise<void> {
  const deadlineMs = Date.now() + 30_000;
  let latestState = input.previousState;

  while (Date.now() < deadlineMs) {
    latestState = await readRuntimeWorkflowState(input);
    if (
      latestState.signalVersion > input.previousState.signalVersion
      && latestState.lastExecutionAt !== input.previousState.lastExecutionAt
    ) {
      return;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for the provider wake to reach Cloudflare. Temporal state: ${JSON.stringify(latestState)}.`,
  );
}

async function waitForReplyAfterProviderSwitch(input: {
  harness: HostedLocalEgressScenario;
  reply: Promise<unknown>;
  startedAt: string;
}): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      input.reply,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for the first reply after provider switch."));
        }, 60_000);
      }),
    ]);
  } catch (error) {
    void input.reply.catch(() => undefined);
    const logs = await listHostedRuntimeLogsForTest({
      environment: input.harness.scenario.runtimeEnv,
      limit: runtimeLogLimit,
      userId: input.harness.userId,
    });
    const switchLogs = logs
      .filter((entry) => entry.at >= input.startedAt)
      .map((entry) => ({
        at: entry.at,
        component: entry.component,
        eventCode: entry.eventCode,
        phase: entry.phase,
        redactedJson: entry.redactedJson ?? null,
      }));
    throw new Error(await input.harness.scenario.buildFailureMessage(
      input.harness.userId,
      [
        error instanceof Error ? error.message : String(error),
        `provider-switch runtime logs: ${JSON.stringify(switchLogs)}`,
      ],
    ));
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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
