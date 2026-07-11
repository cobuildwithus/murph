import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  completeHostedComputerHandoffForTest,
  proveHostedComputerHandoffCompletionCasForTest,
  readHostedComputerRunHandoffForTest,
  seedHostedComputerRunForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAssistantProviderMurphToolCall,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  requireLinqPhoneLookupKey,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

vi.mock("server-only", () => ({}));

const runNonce = Date.now();
const memberId = `member_local_computer_handoff_${runNonce}`;
const computerRunId = `hcr_local_computer_handoff_${runNonce}`;
const chatId = `chat_local_computer_handoff_${runNonce}`;
const assistantModel = "gpt-5.5";
const linqApiToken = "linq-local-computer-handoff-token";
const firstInboundText = "Pause the synthetic browser task so I can take over.";
const secondInboundText = "Done. Continue from the handoff.";
const pausedReplyText = "The computer task is paused for your input.";
const resumedReplyText = "Thanks — I resumed the task from this chat.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let kernelStub: HostedLocalKernelStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

interface HostedLocalKernelStub {
  baseUrl: string;
  observedPlaywrightCalls: string[];
  stop(): Promise<void>;
}

describe("hosted local computer handoff Linq roundtrip e2e", () => {
  beforeAll(async () => {
    kernelStub = await startHostedLocalKernelStub();
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        KERNEL_API_KEY: "kernel-local-computer-handoff-key",
        KERNEL_BASE_URL: requireKernelStub().baseUrl,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-computer-handoff-linq-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted computer handoff Linq roundtrip e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
    await kernelStub?.stop();
    kernelStub = null;
  }, 180_000);

  it("binds the handoff to the direct text return contact and resumes once", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(memberId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(memberId),
      memberId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(), memberId);
    await requireScenario().waitForHostedCompletion(memberId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId,
      recipientPhone: memberPhone,
    });
    await seedHostedComputerRunForTest({
      environment: requireScenario().runtimeEnv,
      memberId,
      runId: computerRunId,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const firstReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("computer_pause_for_user", {
        handoffPurpose: "manual_browser_help",
        reason: "other",
        runId: computerRunId,
        suggestedReply: "Done",
      }),
      pausedReplyText,
    ], {
      matchInputContains: firstInboundText,
    });

    await requireScenario().runWake(buildInboundWake({
      eventId: `evt_computer_handoff_pause_${runNonce}`,
      messageId: `msg_computer_handoff_pause_${runNonce}`,
      text: firstInboundText,
    }), memberId);
    const pausedReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: firstReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId: memberId,
    });
    expect(requireLinqStub().readObservedMessageText(pausedReply)).toMatch(
      new RegExp(
        `^${escapeRegExp(pausedReplyText)}\\n\\nTake over here: http://127\\.0\\.0\\.1:\\d+/computer/handoff/[A-Za-z0-9_-]+$`,
        "u",
      ),
    );
    await requireScenario().waitForHostedCompletion(memberId);

    const awaiting = await readHostedComputerRunHandoffForTest({
      environment: requireScenario().runtimeEnv,
      runId: computerRunId,
    });
    expect(awaiting.run).toMatchObject({
      awaitingReason: "other",
      pendingHandoffId: awaiting.handoff?.id,
      status: "awaiting_user",
    });
    expect(readLinqCheckpointConversationParts(
      awaiting.run?.checkpointContext?.conversationId ?? null,
    )).toEqual([
      "linq",
      "linq",
      expect.stringMatching(/^hid_[0-9a-f]{32}$/u),
      expect.stringMatching(/^hid_[0-9a-f]{32}$/u),
      true,
    ]);
    expect(awaiting.handoff).toMatchObject({
      memberId,
      purpose: "manual_browser_help",
      returnContactKind: "text",
      status: "open",
      suggestedReply: "Done",
    });

    const handoff = requireValue(awaiting.handoff, "computer handoff");
    const casProof = await proveHostedComputerHandoffCompletionCasForTest({
      environment: requireScenario().runtimeEnv,
      handoffId: handoff.id,
      memberId,
      staleUpdatedAt: new Date(Date.parse(handoff.updatedAt) - 1),
    });
    expect(casProof.staleCompletionRejected).toBe(true);

    const token = readComputerHandoffToken(requireScenario().assistantProviderRequests);
    const firstCompletion = await completeHostedComputerHandoffForTest({
      environment: requireScenario().runtimeEnv,
      memberId,
      token,
    });
    expect(firstCompletion).toMatchObject({
      returnContactKind: "text",
      status: "completed",
      suggestedReply: "Done",
    });
    const completedOnce = await readHostedComputerRunHandoffForTest({
      environment: requireScenario().runtimeEnv,
      runId: computerRunId,
    });
    const secondCompletion = await completeHostedComputerHandoffForTest({
      environment: requireScenario().runtimeEnv,
      memberId,
      token,
    });
    const completedTwice = await readHostedComputerRunHandoffForTest({
      environment: requireScenario().runtimeEnv,
      runId: computerRunId,
    });
    expect(secondCompletion).toEqual(firstCompletion);
    expect(completedTwice.handoff?.completedAt).toBe(completedOnce.handoff?.completedAt);
    expect(completedTwice.handoff?.updatedAt).toBe(completedOnce.handoff?.updatedAt);

    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("computer_open", {
        startUrl: null,
      }),
      resumedReplyText,
    ], {
      matchInputContains: secondInboundText,
    });
    const secondReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    await requireScenario().runWake(buildInboundWake({
      eventId: `evt_computer_handoff_resume_${runNonce}`,
      messageId: `msg_computer_handoff_resume_${runNonce}`,
      text: secondInboundText,
    }), memberId);
    const resumedReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: secondReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId: memberId,
    });
    expect(requireLinqStub().readObservedMessageText(resumedReply)).toBe(resumedReplyText);
    await requireScenario().waitForHostedCompletion(memberId);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(secondReplyBaseline + 1);
    const resumed = await readHostedComputerRunHandoffForTest({
      environment: requireScenario().runtimeEnv,
      runId: computerRunId,
    });
    expect(resumed.run).toMatchObject({
      checkpointContext: null,
      pendingHandoffId: null,
      status: "running",
    });
    expect(readComputerOpenSucceeded(requireScenario().assistantProviderRequests)).toBe(true);
    expect(requireKernelStub().observedPlaywrightCalls).toHaveLength(2);
  }, 420_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:computer-handoff`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundWake(input: {
  eventId: string;
  messageId: string;
  text: string;
}) {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: input.eventId,
    linqMessage: {
      chatId,
      from: buildLinqRecipientPhoneNumber(memberId),
      isFromMe: false,
      messageId: input.messageId,
      parts: [{
        type: "text",
        value: input.text,
      }],
      service: "SMS",
    },
    occurredAt: new Date().toISOString(),
    phoneLookupKey: requireLinqPhoneLookupKey(memberId),
    userId: memberId,
  });
}

function readComputerHandoffToken(
  requests: HostedLocalFullStackScenario["assistantProviderRequests"],
): string {
  for (const request of [...requests].reverse()) {
    const strings = collectJsonStrings(JSON.parse(request.body));
    for (const value of strings) {
      const match = /\/computer\/handoff\/([A-Za-z0-9_-]+)/u.exec(value);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  }
  throw new Error("Hosted computer pause tool output did not include a handoff token.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readComputerOpenSucceeded(
  requests: HostedLocalFullStackScenario["assistantProviderRequests"],
): boolean {
  return requests
    .flatMap((request) => collectJsonStrings(JSON.parse(request.body)))
    .some((value) =>
      value.includes(computerRunId)
      && value.includes('"status":"running"')
      && value.includes('"visibleText":"Synthetic browser checkpoint"')
    );
}

async function startHostedLocalKernelStub(): Promise<HostedLocalKernelStub> {
  const observedPlaywrightCalls: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    if (
      request.method === "POST"
      && /^\/browsers\/[^/]+\/playwright\/execute$/u.test(path)
    ) {
      observedPlaywrightCalls.push(path);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        result: {
          title: "Synthetic checkpoint",
          url: "https://example.test/synthetic-checkpoint",
          visibleText: "Synthetic browser checkpoint",
        },
        success: true,
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo | null;
  if (!address) {
    await stopHttpServer(server);
    throw new Error("Hosted local Kernel stub did not bind a TCP address.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    observedPlaywrightCalls,
    stop: async () => await stopHttpServer(server),
  };
}

async function stopHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonStrings);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value).flatMap(collectJsonStrings);
}

function readLinqCheckpointConversationParts(value: string | null): unknown[] {
  if (!value) {
    throw new Error("Computer handoff omitted its checkpoint conversation identity.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Computer handoff checkpoint conversation identity was not JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Computer handoff checkpoint conversation identity was not an array.");
  }
  return parsed;
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local computer handoff scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}

function requireKernelStub(): HostedLocalKernelStub {
  if (!kernelStub) {
    throw new Error("Hosted local Kernel stub was not started.");
  }
  return kernelStub;
}
