import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  listHostedAiUsageForTest,
  listHostedRuntimeLogsForTest,
  type HostedAiUsageForTestRow,
  type HostedRuntimeLogForTestRow,
} from "#hosted-web-testing";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedAssistantNotificationDecisionResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const linqWebhookSecret = "linq-local-webhook-secret";
const productionLikeAssistantModel = "gpt-5.5";
const providerRequestBodyFingerprintSecret = randomUUID();
const autoCompactInputTokenLimit = 12_000;
const usageInputTokenBudgetCeiling = 18_000;
const usageAllowanceCostBudgetUsdMicros = 100_000n;
const turnCount = readPositiveIntegerEnv("MURPH_E2E_CODEX_LONG_THREAD_TURN_COUNT", 75);
const userId = `member_local_codex_long_thread_${Date.now()}`;
const linqChatId = `chat_local_codex_long_thread_${Date.now()}`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Codex long-thread cost cap e2e", () => {
  beforeAll(async () => {
    await startLinqScenario();
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("keeps a real hosted Linq thread under the Codex compaction cost budget offline", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      billingPlanCode: "launch_edge_monthly",
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
      requireScenario().runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV],
    ).toBeUndefined();
    expect(
      requireScenario().runtimeEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    ).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/u);

    const turnSnapshots: TurnSnapshot[] = [];
    let completedTurns = 0;

    for (let index = 0; index < turnCount; index += 1) {
      const turnNumber = index + 1;
      requireScenario().queueAssistantResponses([
        buildHostedAssistantNotificationDecisionResponse({
          privateSummary: `local long-thread turn ${turnNumber}`,
          text: `ok ${turnNumber}`,
        }),
      ]);
      const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        userId,
        linqChatId,
        {
          eventId: `evt_codex_long_thread_${turnNumber}_${userId}`,
          messageId: `msg_codex_long_thread_${turnNumber}_${userId}`,
          text: `hello ${turnNumber}`,
        },
      ));
      expect(webhookResponse.status).toBe(202);
      await expect(webhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      await requireScenario().waitForLatestPendingWake(userId);
      await requireScenario().waitForHostedCompletion(userId, {
        timeoutMs: 180_000,
      });
      completedTurns = turnNumber;

      const providerSummary = summarizeProviderRequests(
        requireScenario().assistantProviderRequests,
      );
      turnSnapshots.push({
        maxRequestBodyBytes: providerSummary.maxRequestBodyBytes,
        providerRequestCount: providerSummary.requestCount,
        turn: turnNumber,
      });

      if (turnNumber % 10 === 0 || turnNumber === turnCount) {
        console.log(
          `[codex-long-thread] progress ${turnNumber}/${turnCount} providerRequests=${providerSummary.requestCount} maxBodyBytes=${providerSummary.maxRequestBodyBytes}`,
        );
      }
    }

    const usageRows = await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      limit: 1_000,
      memberId: userId,
    });
    const runtimeLogs = await listHostedRuntimeLogsForTest({
      environment: requireScenario().runtimeEnv,
      limit: 1_500,
      userId,
    });
    const providerSummary = summarizeProviderRequests(
      requireScenario().assistantProviderRequests,
    );
    const diagnostic = buildLongThreadDiagnostic({
      completedTurns,
      providerSummary,
      runtimeLogs,
      turnSnapshots,
      usageRows,
    });

    console.log("[codex-long-thread]", JSON.stringify(diagnostic, null, 2));
    await writeDiagnosticArtifact(diagnostic);

    expect(JSON.stringify(diagnostic)).not.toContain(process.cwd());
    expect(diagnostic.completedTurns).toBe(turnCount);
    expect(diagnostic.usageRowCount, JSON.stringify(diagnostic)).toBeGreaterThan(0);
    expect(
      diagnostic.maxUsageInputTokens,
      JSON.stringify(diagnostic),
    ).toBeLessThanOrEqual(usageInputTokenBudgetCeiling);
    expect(
      diagnostic.usageRowsOverBudget,
      JSON.stringify(diagnostic),
    ).toBe(0);
    expect(
      diagnostic.usageRowsMissingInputTokens,
      JSON.stringify(diagnostic),
    ).toBe(0);
    expect(
      diagnostic.usageRowsOverCostBudget,
      JSON.stringify(diagnostic),
    ).toBe(0);
    expect(
      diagnostic.providerSummary.compactRequestCount,
      JSON.stringify(diagnostic),
    ).toBeGreaterThan(0);
  }, 2_700_000);
});

interface TurnSnapshot {
  maxRequestBodyBytes: number;
  providerRequestCount: number;
  turn: number;
}

interface ProviderRequestSummary {
  compactRequestCount: number;
  contextCompactionStreamRequestCount: number;
  maxEstimatedBodyTokens: number;
  maxRequestBodyBytes: number;
  requestBodyByteDrops: Array<{
    dropBytes: number;
    fromBodyBytes: number;
    fromOrdinal: number;
    fromUrl: string;
    toBodyBytes: number;
    toOrdinal: number;
    toUrl: string;
  }>;
  requestBodyGroups: Array<{
    bodyBytes: number;
    bodyFingerprint: string;
    count: number;
    firstIndex: number;
    firstUrl: string;
  }>;
  requestCount: number;
  responsesRequestCount: number;
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_codex_long_thread`,
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

function summarizeProviderRequests(
  requests: readonly HostedLocalFullStackScenario["assistantProviderRequests"][number][],
): ProviderRequestSummary {
  const responseRequests = requests.filter((request) =>
    request.method === "POST"
    && (request.url === "/v1/responses" || request.url === "/v1/responses/compact")
  );
  const normalResponseRequests = responseRequests.filter((request) =>
    request.url === "/v1/responses"
  );
  const bodyBytes = responseRequests.map((request) =>
    Buffer.byteLength(request.body, "utf8")
  );
  const maxRequestBodyBytes = Math.max(0, ...bodyBytes);
  const requestBodyGroups = summarizeRequestBodyGroups(responseRequests);

  return {
    compactRequestCount: responseRequests.filter((request) =>
      request.url === "/v1/responses/compact"
    ).length,
    contextCompactionStreamRequestCount: responseRequests.filter((request) =>
      request.url === "/v1/responses" && request.body.includes('"type":"context_compaction"')
    ).length,
    maxEstimatedBodyTokens: estimateTokensFromUtf8Bytes(maxRequestBodyBytes),
    maxRequestBodyBytes,
    requestBodyByteDrops: summarizeRequestBodyByteDrops(normalResponseRequests),
    requestBodyGroups,
    requestCount: responseRequests.length,
    responsesRequestCount: responseRequests.filter((request) =>
      request.url === "/v1/responses"
    ).length,
  };
}

function summarizeRequestBodyGroups(
  requests: readonly HostedLocalFullStackScenario["assistantProviderRequests"][number][],
): ProviderRequestSummary["requestBodyGroups"] {
  const groups = new Map<string, {
    bodyBytes: number;
    bodyFingerprint: string;
    count: number;
    firstIndex: number;
    firstUrl: string;
  }>();

  for (const [index, request] of requests.entries()) {
    const bodyFingerprint = fingerprintText(request.body);
    const existing = groups.get(bodyFingerprint);
    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.set(bodyFingerprint, {
      bodyBytes: Buffer.byteLength(request.body, "utf8"),
      bodyFingerprint,
      count: 1,
      firstIndex: index,
      firstUrl: request.url,
    });
  }

  return [...groups.values()].slice(0, 20);
}

function summarizeRequestBodyByteDrops(
  requests: readonly HostedLocalFullStackScenario["assistantProviderRequests"][number][],
): ProviderRequestSummary["requestBodyByteDrops"] {
  const drops: ProviderRequestSummary["requestBodyByteDrops"] = [];
  let previous: {
    bodyBytes: number;
    ordinal: number;
    url: string;
  } | null = null;

  for (const [index, request] of requests.entries()) {
    const current = {
      bodyBytes: Buffer.byteLength(request.body, "utf8"),
      ordinal: index + 1,
      url: request.url,
    };
    if (previous && current.bodyBytes < previous.bodyBytes * 0.6) {
      drops.push({
        dropBytes: previous.bodyBytes - current.bodyBytes,
        fromBodyBytes: previous.bodyBytes,
        fromOrdinal: previous.ordinal,
        fromUrl: previous.url,
        toBodyBytes: current.bodyBytes,
        toOrdinal: current.ordinal,
        toUrl: current.url,
      });
    }
    previous = current;
  }

  return drops;
}

function buildLongThreadDiagnostic(input: {
  completedTurns: number;
  providerSummary: ProviderRequestSummary;
  runtimeLogs: readonly HostedRuntimeLogForTestRow[];
  turnSnapshots: readonly TurnSnapshot[];
  usageRows: readonly HostedAiUsageForTestRow[];
}) {
  const inputTokens = input.usageRows
    .map((row) => row.inputTokens)
    .filter((value): value is number => typeof value === "number");
  const cachedInputTokens = input.usageRows
    .map((row) => row.cachedInputTokens)
    .filter((value): value is number => typeof value === "number");
  const totalTokens = input.usageRows
    .map((row) => row.totalTokens)
    .filter((value): value is number => typeof value === "number");
  const missingInputTokenIndex = input.usageRows.findIndex(
    (row) => typeof row.inputTokens !== "number",
  );
  const overBudgetIndex = input.usageRows.findIndex((row) =>
    (row.inputTokens ?? 0) > usageInputTokenBudgetCeiling
  );
  const costMicros = input.usageRows.map((row) => BigInt(row.allowanceCostUsdMicros));
  const overCostBudgetIndex = input.usageRows.findIndex(
    (row) => BigInt(row.allowanceCostUsdMicros) > usageAllowanceCostBudgetUsdMicros,
  );
  const egressLogs = input.runtimeLogs.filter((log) =>
    log.eventCode === "runner.provider_egress_diagnostic"
  );

  return {
    autoCompactInputTokenLimit,
    completedTurns: input.completedTurns,
    egressLogCount: egressLogs.length,
    firstUsageRowOverBudgetOrdinal: overBudgetIndex >= 0 ? overBudgetIndex + 1 : null,
    firstUsageRowMissingInputTokensOrdinal:
      missingInputTokenIndex >= 0 ? missingInputTokenIndex + 1 : null,
    firstUsageRowOverCostBudgetOrdinal:
      overCostBudgetIndex >= 0 ? overCostBudgetIndex + 1 : null,
    localProviderDiagnosticsMode: "responses-api-recorder",
    maxCachedInputTokens: maxNumber(cachedInputTokens),
    maxEstimatedBodyTokens: input.providerSummary.maxEstimatedBodyTokens,
    maxRequestBodyBytes: input.providerSummary.maxRequestBodyBytes,
    maxTotalTokens: maxNumber(totalTokens),
    maxUsageAllowanceCostUsdMicros: maxBigInt(costMicros).toString(),
    maxUsageInputTokens: maxNumber(inputTokens),
    providerSummary: input.providerSummary,
    recentEgressLogs: egressLogs.slice(-10).map(summarizeEgressLog),
    turnCount,
    turnSnapshots: input.turnSnapshots.filter((snapshot) =>
      snapshot.turn % 10 === 0 || snapshot.turn === input.completedTurns
    ),
    usageInputTokenCheckpoints: summarizeUsageInputTokenCheckpoints(input.usageRows),
    usageInputTokenDrops: summarizeUsageInputTokenDrops(input.usageRows),
    usageAllowanceCostBudgetUsdMicros: usageAllowanceCostBudgetUsdMicros.toString(),
    usageInputTokenBudgetCeiling,
    usageRowCount: input.usageRows.length,
    usageRowsOverAutoCompactLimit: input.usageRows.filter((row) =>
      (row.inputTokens ?? 0) > autoCompactInputTokenLimit
    ).length,
    usageRowsOverBudget: input.usageRows.filter((row) =>
      (row.inputTokens ?? 0) > usageInputTokenBudgetCeiling
    ).length,
    usageRowsMissingInputTokens: input.usageRows.filter(
      (row) => typeof row.inputTokens !== "number",
    ).length,
    usageRowsOverCostBudget: costMicros.filter(
      (value) => value > usageAllowanceCostBudgetUsdMicros,
    ).length,
    usageTotalAllowanceCostUsdMicros: costMicros
      .reduce((sum, value) => sum + value, 0n)
      .toString(),
    workerOpenAiEgressDiagnosticsExpected: false,
  };
}

function summarizeUsageInputTokenCheckpoints(
  usageRows: readonly HostedAiUsageForTestRow[],
): Array<{
  allowanceCostUsdMicros: string | null;
  cachedInputTokens: number | null;
  inputTokens: number | null;
  ordinal: number;
  totalTokens: number | null;
}> {
  const ordinals = new Set<number>();
  const firstOverBudgetIndex = usageRows.findIndex((row) =>
    (row.inputTokens ?? 0) > usageInputTokenBudgetCeiling
  );
  const firstOverBudgetOrdinal =
    firstOverBudgetIndex >= 0 ? firstOverBudgetIndex + 1 : null;

  for (const ordinal of [1, usageRows.length]) {
    if (ordinal >= 1 && ordinal <= usageRows.length) {
      ordinals.add(ordinal);
    }
  }
  for (let ordinal = 10; ordinal <= usageRows.length; ordinal += 10) {
    ordinals.add(ordinal);
  }
  if (firstOverBudgetOrdinal !== null) {
    for (const ordinal of [
      firstOverBudgetOrdinal - 1,
      firstOverBudgetOrdinal,
      firstOverBudgetOrdinal + 1,
    ]) {
      if (ordinal >= 1 && ordinal <= usageRows.length) {
        ordinals.add(ordinal);
      }
    }
  }

  return [...ordinals]
    .sort((a, b) => a - b)
    .map((ordinal) => {
      const row = usageRows[ordinal - 1];
      return {
        allowanceCostUsdMicros: row?.allowanceCostUsdMicros ?? null,
        cachedInputTokens: row?.cachedInputTokens ?? null,
        inputTokens: row?.inputTokens ?? null,
        ordinal,
        totalTokens: row?.totalTokens ?? null,
      };
    });
}

function summarizeUsageInputTokenDrops(
  usageRows: readonly HostedAiUsageForTestRow[],
): Array<{
  dropInputTokens: number;
  fromInputTokens: number;
  fromOrdinal: number;
  toInputTokens: number;
  toOrdinal: number;
}> {
  const drops: Array<{
    dropInputTokens: number;
    fromInputTokens: number;
    fromOrdinal: number;
    toInputTokens: number;
    toOrdinal: number;
  }> = [];

  for (let index = 1; index < usageRows.length; index += 1) {
    const previousInputTokens = usageRows[index - 1]?.inputTokens;
    const currentInputTokens = usageRows[index]?.inputTokens;
    if (
      typeof previousInputTokens === "number" &&
      typeof currentInputTokens === "number" &&
      currentInputTokens < previousInputTokens * 0.6
    ) {
      drops.push({
        dropInputTokens: previousInputTokens - currentInputTokens,
        fromInputTokens: previousInputTokens,
        fromOrdinal: index,
        toInputTokens: currentInputTokens,
        toOrdinal: index + 1,
      });
    }
  }

  return drops;
}

function summarizeEgressLog(log: HostedRuntimeLogForTestRow) {
  const payload = log.redactedJson ?? {};

  return {
    at: log.at,
    cacheNamespacePresent: readBoolean(payload, "cacheNamespacePresent"),
    endpointKind: readString(payload, "endpointKind"),
    instructionsBytes: readNumber(payload, "instructionsBytes"),
    previousResponsePresent: readBoolean(payload, "previousResponsePresent"),
    requestBytes: readNumber(payload, "requestBytes"),
    toolCount: readNumber(payload, "toolCount"),
  };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function maxNumber(values: readonly number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

function maxBigInt(values: readonly bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

function estimateTokensFromUtf8Bytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

async function writeDiagnosticArtifact(diagnostic: Record<string, unknown>): Promise<void> {
  const artifactDir = process.env.MURPH_HOSTED_LOCAL_ARTIFACT_DIR?.trim();
  if (!artifactDir) {
    return;
  }

  await mkdir(artifactDir, { recursive: true });
  const diagnosticPath = path.join(artifactDir, "codex-long-thread-diagnostic.json");
  await writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
}

function fingerprintText(value: string): string {
  return createHmac("sha256", providerRequestBodyFingerprintSecret)
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
      [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: undefined,
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_E2E_ASSISTANT_PROVIDER_MODE: "live",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderMode: "live",
    assistantProviderRecorder: true,
    assistantProviderStubModelId: productionLikeAssistantModel,
    assistantProviderStubUsageMode: "request-body-estimate",
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-codex-long-thread-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Codex long-thread e2e",
    streamLogs: streamDevLogs,
  });
}
