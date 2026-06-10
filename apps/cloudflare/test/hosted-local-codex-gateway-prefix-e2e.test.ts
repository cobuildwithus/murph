import { createHash, createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const linqWebhookSecret = "linq-local-webhook-secret";
const productionLikeAssistantModel = "gpt-5.5";
const userId = `member_local_codex_gateway_prefix_${Date.now()}`;
const linqChatId = `chat_local_codex_gateway_prefix_${Date.now()}`;
const cacheablePrefixFloor = 8_000;
const maxRecordedResponsesApiRequestBodies = 9;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const fastDeployGate = process.env.MURPH_HOSTED_LOCAL_E2E_FAST_GATE === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
type AssistantProviderRequest = HostedLocalFullStackScenario["assistantProviderRequests"][number];

describe("hosted local Codex Gateway prefix e2e", () => {
  beforeAll(async () => {
    await startLinqScenario();
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("captures real Codex app-server Responses API bodies across resumed Linq turns", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: linqChatId,
      memberId: userId,
      recipientPhone: buildLinqRecipientPhoneNumber(userId),
    });

    expect(requireScenario().runtimeEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "stub-local-openai-key",
    });
    expect(
      requireScenario().runtimeEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    ).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/u);

    const assistantProviderResponseCountBefore = countAssistantProviderResponsesApiRequests();
    const completionOutcomes: Array<Record<string, unknown>> = [];
    const turnResponseRequestRanges: Array<{ count: number; startIndex: number }> = [];
    const turnResponseRequestCounts: number[] = [];
    const fullTurns = [
      {
        inboundText: "First cache-prefix probe. Please acknowledge this briefly.",
        replyText: "First probe acknowledged.",
      },
      {
        inboundText: "Second cache-prefix probe on the same Linq thread.",
        replyText: "Second probe acknowledged.",
      },
      {
        inboundText: "Third cache-prefix probe on the same Linq thread.",
        replyText: "Third probe acknowledged.",
      },
    ] as const;
    const turns = fastDeployGate ? fullTurns.slice(0, 2) : fullTurns;

    for (const [index, turn] of turns.entries()) {
      const responseRequestCountBeforeTurn = countAssistantProviderResponsesApiRequests();
      requireScenario().queueAssistantResponses([turn.replyText]);
      const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        userId,
        linqChatId,
        {
          eventId: `evt_codex_gateway_prefix_${index}_${userId}`,
          messageId: `msg_codex_gateway_prefix_${index}_${userId}`,
          text: turn.inboundText,
        },
      ));
      expect(webhookResponse.status).toBe(202);
      await expect(webhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      await requireScenario().waitForLatestPendingWake(userId);
      try {
        const finalStatus = await requireScenario().waitForHostedCompletion(userId, {
          timeoutMs: 120_000,
        });
        completionOutcomes.push({
          lastErrorCode: finalStatus.lastErrorCode ?? null,
          mailboxLag: finalStatus.mailboxLag.map((lane) => ({
            lag: lane.lag,
            lane: lane.lane,
          })),
        });
      } catch (error) {
        completionOutcomes.push({
          error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
        });
        break;
      } finally {
        const responseRequestCountAfterTurn = countAssistantProviderResponsesApiRequests();
        const count = responseRequestCountAfterTurn - responseRequestCountBeforeTurn;
        turnResponseRequestCounts.push(count);
        turnResponseRequestRanges.push({
          count,
          startIndex: responseRequestCountBeforeTurn - assistantProviderResponseCountBefore,
        });
      }
    }

    const responseRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.method === "POST" && request.url === "/v1/responses")
      .slice(assistantProviderResponseCountBefore);
    const representativeRequests = selectFirstResponsesApiRequestPerTurn(
      responseRequests,
      turnResponseRequestRanges,
    );
    const serializedInputs = representativeRequests
      .map((entry) => serializeProviderRequestInput(entry.request.body));
    const diagnostic = buildPrefixDiagnostic({
      completionOutcomes,
      representativeRequestIndexes: representativeRequests.map((entry) => entry.index),
      responseRequests,
      serializedInputs,
      turnResponseRequestCounts,
    });

    console.log("[codex-gateway-prefix]", JSON.stringify(diagnostic, null, 2));
    await writeDiagnosticArtifact(diagnostic);

    expect(
      responseRequests.length,
      JSON.stringify(diagnostic),
    ).toBeLessThanOrEqual(maxRecordedResponsesApiRequestBodies);
    expect(
      turnResponseRequestCounts.every((count) => count > 0),
      JSON.stringify(diagnostic),
    ).toBe(true);
    expect(serializedInputs.length, JSON.stringify(diagnostic)).toBeGreaterThanOrEqual(
      turns.length,
    );
    expect(JSON.stringify(diagnostic), JSON.stringify(diagnostic)).not.toContain(
      "/tmp/hosted-runner-launch-",
    );
    expect(
      diagnostic.cacheablePrefixLengths.every((length) => length === cacheablePrefixFloor),
      JSON.stringify(diagnostic),
    ).toBe(true);
    expect(
      diagnostic.cacheablePrefixUniqueSha256,
      JSON.stringify(diagnostic),
    ).toHaveLength(1);
    expect(
      diagnostic.prefix01Length,
      JSON.stringify(diagnostic),
    ).toBeGreaterThan(cacheablePrefixFloor);
    if (turns.length > 2) {
      expect(
        diagnostic.prefix12Length,
        JSON.stringify(diagnostic),
      ).toBeGreaterThan(cacheablePrefixFloor);
    }
  }, 420_000);
});

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_codex_gateway_prefix`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, rawBody, timestamp);

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.method === "POST" && request.url === "/v1/responses"
  ).length;
}

function serializeProviderRequestInput(body: string): string {
  const parsed = parseJsonObject(body);
  const providerInput = parsed.input ?? parsed.messages ?? parsed;
  const serialized = JSON.stringify(providerInput);
  if (typeof serialized !== "string") {
    throw new Error("Expected provider request input to serialize.");
  }

  return serialized;
}

function parseJsonObject(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected provider request body to parse to a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function selectFirstResponsesApiRequestPerTurn(
  responseRequests: readonly AssistantProviderRequest[],
  turnResponseRequestRanges: readonly { count: number; startIndex: number }[],
): Array<{ index: number; request: AssistantProviderRequest }> {
  const representatives: Array<{ index: number; request: AssistantProviderRequest }> = [];

  for (const range of turnResponseRequestRanges) {
    if (range.count <= 0) {
      continue;
    }

    const request = responseRequests[range.startIndex];
    if (!request) {
      continue;
    }

    representatives.push({
      index: range.startIndex,
      request,
    });
  }

  return representatives;
}

function buildPrefixDiagnostic(input: {
  completionOutcomes: readonly Record<string, unknown>[];
  representativeRequestIndexes: readonly number[];
  responseRequests: readonly AssistantProviderRequest[];
  serializedInputs: readonly string[];
  turnResponseRequestCounts: readonly number[];
}) {
  const first = input.serializedInputs[0] ?? "";
  const second = input.serializedInputs[1] ?? "";
  const third = input.serializedInputs[2] ?? "";
  const prefix01Length = longestCommonPrefixLength(first, second);
  const prefix12Length = longestCommonPrefixLength(second, third);
  const firstFullBody = input.responseRequests[input.representativeRequestIndexes[0] ?? -1]?.body ?? "";
  const secondFullBody = input.responseRequests[input.representativeRequestIndexes[1] ?? -1]?.body ?? "";
  const thirdFullBody = input.responseRequests[input.representativeRequestIndexes[2] ?? -1]?.body ?? "";
  const fullBodyPrefix01Length = longestCommonPrefixLength(firstFullBody, secondFullBody);
  const fullBodyPrefix12Length = longestCommonPrefixLength(secondFullBody, thirdFullBody);
  const cacheablePrefixes = input.serializedInputs.map((value) =>
    value.slice(0, cacheablePrefixFloor)
  );
  const cacheablePrefixSha256 = cacheablePrefixes.map(hashText);

  return {
    cacheablePrefixFloor,
    cacheablePrefixLengths: cacheablePrefixes.map((value) => value.length),
    cacheablePrefixSha256,
    cacheablePrefixUniqueSha256: [...new Set(cacheablePrefixSha256)],
    completionOutcomes: input.completionOutcomes,
    firstDiff01: describeFirstDiff(first, second, prefix01Length),
    firstDiff12: describeFirstDiff(second, third, prefix12Length),
    fullBodyFirstDiff01: describeFirstDiff(
      firstFullBody,
      secondFullBody,
      fullBodyPrefix01Length,
    ),
    fullBodyFirstDiff12: describeFirstDiff(
      secondFullBody,
      thirdFullBody,
      fullBodyPrefix12Length,
    ),
    fullBodyPrefix01Length,
    fullBodyPrefix12Length,
    prefix01Length,
    prefix01Sha256: hashText(first.slice(0, prefix01Length)),
    prefix12Length,
    prefix12Sha256: hashText(second.slice(0, prefix12Length)),
    representativeRequestIndexes: input.representativeRequestIndexes,
    requestBodyGroups: summarizeResponseRequestBodyGroups(input.responseRequests),
    requestLengths: input.serializedInputs.map((value) => value.length),
    requestSha256: input.serializedInputs.map(hashText),
    responseRequestCount: input.responseRequests.length,
    turnResponseRequestCounts: input.turnResponseRequestCounts,
  };
}

function longestCommonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1;
  }

  return index;
}

function describeFirstDiff(left: string, right: string, index: number) {
  const leftWindow = buildDiagnosticWindow(left, index);
  const rightWindow = buildDiagnosticWindow(right, index);

  return {
    index,
    leftAtEnd: index >= left.length,
    leftCodeUnit: readCodeUnit(left, index),
    leftSnippet: sanitizeDiagnosticText(leftWindow),
    leftWindowLength: leftWindow.length,
    leftWindowSha256: hashText(leftWindow),
    rightAtEnd: index >= right.length,
    rightCodeUnit: readCodeUnit(right, index),
    rightSnippet: sanitizeDiagnosticText(rightWindow),
    rightWindowLength: rightWindow.length,
    rightWindowSha256: hashText(rightWindow),
  };
}

function buildDiagnosticWindow(value: string, index: number): string {
  const contextLength = 500;
  const start = Math.max(0, index - contextLength);
  const end = Math.min(value.length, index + contextLength);
  return value.slice(start, end);
}

function summarizeResponseRequestBodyGroups(
  responseRequests: readonly AssistantProviderRequest[],
): Array<{ bodyBytes: number; bodySha256: string; count: number; firstIndex: number }> {
  const groups = new Map<string, {
    bodyBytes: number;
    bodySha256: string;
    count: number;
    firstIndex: number;
  }>();

  for (const [index, request] of responseRequests.entries()) {
    const bodySha256 = hashText(request.body);
    const existing = groups.get(bodySha256);
    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.set(bodySha256, {
      bodyBytes: Buffer.byteLength(request.body, "utf8"),
      bodySha256,
      count: 1,
      firstIndex: index,
    });
  }

  return [...groups.values()];
}

function sanitizeDiagnosticText(value: string): string {
  const repoRoot = process.cwd();
  return value
    .replace(new RegExp(escapeRegExp(repoRoot), "gu"), "<REPO_ROOT>")
    .replace(/\/Users\/[^/"\\\s]+\/startup1\/murph/gu, "<REPO_ROOT>")
    .replace(/\/Users\/[^/"\\\s]+/gu, "<HOME_DIR>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer <REDACTED>")
    .replace(/(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}/gu, "<REDACTED_KEY>")
    .replace(/stub-local-openai-key/gu, "<REDACTED_KEY>")
    .replace(/linq-local-(?:test-token|webhook-secret)/gu, "<REDACTED>")
    .replace(/member_local_codex_gateway_prefix_\d+/gu, "<TEST_MEMBER>")
    .replace(/chat_local_codex_gateway_prefix_\d+/gu, "<TEST_CHAT>")
    .replace(/evt_codex_gateway_prefix_\d+_[A-Za-z0-9_]+/gu, "<TEST_EVENT>")
    .replace(/msg_codex_gateway_prefix_\d+_[A-Za-z0-9_]+/gu, "<TEST_MESSAGE>");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function writeDiagnosticArtifact(diagnostic: Record<string, unknown>): Promise<void> {
  const artifactDir = process.env.MURPH_HOSTED_LOCAL_ARTIFACT_DIR?.trim();
  if (!artifactDir) {
    return;
  }

  const diagnosticPath = path.join(artifactDir, "codex-gateway-prefix-diagnostic.json");
  await writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
}

function readCodeUnit(value: string, index: number): string | null {
  if (index >= value.length) {
    return null;
  }

  return `0x${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }

  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

async function startLinqScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "low",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_E2E_ASSISTANT_PROVIDER_MODE: "live",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderMode: "live",
    assistantProviderMaxResponsesApiRequestBodies: maxRecordedResponsesApiRequestBodies,
    assistantProviderRecorder: true,
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-codex-gateway-prefix-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Codex Gateway prefix e2e",
    streamLogs: streamDevLogs,
  });
}
