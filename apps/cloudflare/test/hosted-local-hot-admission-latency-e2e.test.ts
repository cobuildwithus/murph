import { createHmac, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  listHostedRuntimeLogsForTest,
  readHostedIngressLatencyTraceForTest,
  readHostedMailboxItemForTest,
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { sha256HostedBundleHex, snapshotHostedExecutionContext } from "@murphai/runtime-state/node";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
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

const secret = "linq-local-hot-admission-secret";
const sampleCount = Number(process.env.MURPH_E2E_HOT_ADMISSION_SAMPLES ?? 10);
const privateVault = process.env.MURPH_E2E_HOT_ADMISSION_VAULT_DIR?.trim();
const roots: string[] = [];
let scenario: HostedLocalFullStackScenario | null = null;
let linq: HostedLocalLinqStub | null = null;

afterAll(async () => {
  const cleanup = await Promise.allSettled([
    scenario?.stop(),
    linq?.stop(),
    ...roots.map((root) => rm(root, { recursive: true, force: true })),
  ]);
  const failures = cleanup.filter((result) => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "Hot admission benchmark cleanup failed.");
}, 120_000);

describe("hosted local hot admission benchmark", () => {
  it("measures mailbox acceptance to native Codex start on the same warm attempt", async () => {
    expect(Number.isInteger(sampleCount) && sampleCount >= 3 && sampleCount <= 100).toBe(true);
    linq = await startHostedLocalLinqStub();
    const run = randomUUID().replaceAll("-", "");
    const memberId = `member_local_hot_admission_${run}`;
    const memberPhone = buildLinqRecipientPhoneNumber(memberId);
    const homePhone = buildLinqHomePhoneNumber(memberId);
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "180000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: memberPhone,
        LINQ_API_BASE_URL: linq.runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: secret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      assistantProviderMode: "stub",
      assistantProviderStubModelId: "gpt-5.6-terra",
      persistDirPrefix: "murph-hosted-local-hot-admission-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted hot admission benchmark",
      streamLogs: false,
      testControls: true,
    });
    const chatId = `chat_local_hot_admission_${run}`;
    await scenario.seedActiveHostedLinqMember({ homePhone, memberId, memberPhone });
    await scenario.bindActiveHostedLinqHomeChat({ chatId, memberId, recipientPhone: memberPhone });
    await seedVault(scenario, memberId);
    process.stdout.write("Hot admission benchmark: workspace seeded; starting warm-up.\n");
    const samples: Record<string, number>[] = [];
    let attempt: string | null = null;
    for (let index = 0; index < sampleCount + 2; index += 1) {
      const text = `Hot admission sample ${index}.`;
      const reply = `Acknowledged sample ${index}.`;
      const eventId = `evt_hot_admission_${run}_${index}`;
      const baselineCount = linq.countObservedSends(`/chats/${chatId}/messages`);
      scenario.queueAssistantResponses([reply], { matchInputContains: text });
      const body = JSON.stringify(buildHostedLinqInboundEvent(memberId, chatId, {
        eventId,
        messageId: `msg_hot_admission_${run}_${index}`,
        text,
      }));
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const response = await fetch(`${scenario.harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": `sha256=${signature}`,
          "x-webhook-timestamp": timestamp,
        },
        body,
      });
      expect(response.status).toBe(202);
      const sent = await linq.waitForAdditionalSend({
        baselineCount,
        expectedPath: `/chats/${chatId}/messages`,
        scenario,
        userId: memberId,
      });
      expect(linq.readObservedMessageText(sent)).toBe(reply);
      const item = await readHostedMailboxItemForTest({
        dedupeKey: eventId, environment: scenario.runtimeEnv, userId: memberId,
      });
      const trace = await waitForTrace(scenario, memberId, item.id);
      const accepted = Date.parse(trace.acceptedAt);
      const staged = Date.parse(trace.assistantInputStagedAt);
      const provider = Date.parse(trace.providerStartAt!);
      if (index === 0) attempt = trace.runtimeAttemptId;
      expect(trace.runtimeAttemptId).toBe(attempt);
      if (index < 2) process.stdout.write(`Hot admission warm-up ${index + 1}/2 completed.\n`);
      if (index >= 2) {
        expect(Date.parse(trace.runtimePhaseStartedAt!)).toBeLessThan(accepted);
        expect(trace.phaseBreakdown?.orchestration?.activeWakeAccepted).toBe(true);
        const sample: Record<string, number> = {
          acceptedToStagedMs: staged - accepted,
          stagedToCodexMs: provider - staged,
          acceptedToCodexMs: provider - accepted,
        };
        const p = trace.phaseBreakdown;
        addSlice(sample, "acceptedToSignalMs", Date.parse(trace.temporalSignalAcceptedAt!), accepted);
        addSlice(sample, "acceptedToWakeMs", p?.wake?.runtimeWakeNotifiedAtEpochMs, accepted);
        addSlice(sample, "wakeToImportMs", p?.wake?.foregroundImportStartedAtEpochMs, p?.wake?.runtimeWakeNotifiedAtEpochMs);
        addSlice(sample, "importToDecodeMs", p?.import?.decodeStartedAtEpochMs, p?.wake?.foregroundImportStartedAtEpochMs);
        addSlice(sample, "decodeMs", p?.import?.decodeDoneAtEpochMs, p?.import?.decodeStartedAtEpochMs);
        addSlice(sample, "pendingToExecutionMs", p?.assistant?.assistantInputAcceptedForExecutionAtEpochMs, p?.assistant?.pendingReplyAdmittedAtEpochMs);
        for (const phase of ["preProvider", "provider"] as const) {
          for (const [key, value] of Object.entries(p?.[phase] ?? {})) {
            if (key.endsWith("Ms") && typeof value === "number") sample[`${phase}.${key}`] = value;
          }
        }
        samples.push(sample);
        process.stdout.write(`Hot admission sample ${JSON.stringify({ cohort: privateVault ? "large-private" : "small-synthetic", index: index - 2, ...sample })}\n`);
      }
      // Delivery can precede turn completion. Wait for the actual pass boundary
      // so the next sample measures a new hot turn rather than active steering.
      await waitForAssistantPassFinished(scenario, memberId, trace);
      await sleep(300);
    }
    const summary: Record<string, { count: number; mean: number; p50: number; p95: number }> = {};
    for (const key of new Set(samples.flatMap((sample) => Object.keys(sample)))) {
      const values = samples.flatMap((sample) => typeof sample[key] === "number" ? [sample[key]!] : []).sort((a, b) => a - b);
      summary[key] = {
        count: values.length,
        mean: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
        p50: values[Math.ceil(values.length * 0.5) - 1]!,
        p95: values[Math.ceil(values.length * 0.95) - 1]!,
      };
    }
    process.stdout.write(`Hot admission summary ${JSON.stringify({ cohort: privateVault ? "large-private" : "small-synthetic", summary })}\n`);
  }, 900_000);
});

function addSlice(sample: Record<string, number>, key: string, end: number | undefined, start: number | undefined): void {
  if (typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && end >= start) sample[key] = end - start;
}

async function waitForAssistantPassFinished(
  active: HostedLocalFullStackScenario,
  userId: string,
  trace: Awaited<ReturnType<typeof waitForTrace>>,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const logs = await listHostedRuntimeLogsForTest({
      environment: active.runtimeEnv,
      fromAt: trace.providerStartAt,
      limit: 1_000,
      userId,
    });
    if (logs.some((entry) => entry.attemptId === trace.runtimeAttemptId
      && entry.component === "assistant"
      && entry.eventCode === "assistant.pass_finished"
      && entry.redactedJson?.progressed === true)) return;
    await sleep(500);
  }
  throw new Error("Hot admission benchmark timed out waiting for assistant pass completion.");
}

async function waitForTrace(active: HostedLocalFullStackScenario, userId: string, mailboxItemId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const trace = await readHostedIngressLatencyTraceForTest({ environment: active.runtimeEnv, userId, mailboxItemId });
      if (trace.providerStartAt && trace.runtimeAttemptId && trace.runtimePhaseStartedAt && trace.phaseBreakdown?.assistant?.assistantInputAcceptedForExecutionAtEpochMs) return trace;
    } catch { /* Best-effort telemetry can arrive after delivery. */ }
    await sleep(100);
  }
  throw new Error("Hot admission benchmark timed out waiting for complete timing evidence.");
}

async function seedVault(active: HostedLocalFullStackScenario, userId: string): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hot-admission-"));
  roots.push(root);
  const vaultRoot = path.join(root, "vault");
  const operatorHomeRoot = path.join(root, "operator-home");
  await mkdir(operatorHomeRoot);
  if (privateVault) {
    // Opt-in private input never becomes a committed fixture or printed payload.
    await cp(privateVault, vaultRoot, { recursive: true, errorOnExist: true });
  } else {
    await createIntegratedVaultServices().core.init({ requestId: "seed-hot-admission", timezone: "UTC", vault: vaultRoot });
  }
  const snapshot = await snapshotHostedExecutionContext({ operatorHomeRoot, vaultRoot });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    environment: active.runtimeEnv,
    userId,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: { seeded: true },
    snapshotRef: { hash, key: `cloudflare-workspace-snapshots/${hash}.bundle`, size: snapshot.bundle.byteLength, updatedAt: new Date().toISOString() },
    browserVaultReplicaRef: {
      byteLength: 256,
      dataVersion: `hot-admission-${hash.slice(0, 16)}`,
      generatedAt: new Date().toISOString(),
      keyId: "browser-vault-replica:hot-admission",
      objectKey: `browser-vault/hot-admission-${hash.slice(0, 32)}.json`,
      replicaSchema: "murph.browser-vault-replica",
      runtimeRootKeyId: "udrk:runtime:hot-admission",
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: hash,
    },
  });
  expect(checkpoint.status).toBe("updated");
  const upload = await active.harness.request(`/__test/artifacts?userId=${encodeURIComponent(userId)}&sha256=${hash}`, {
    method: "PUT", body: new Blob([new Uint8Array(snapshot.bundle)]), headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: userId },
  });
  expect(upload.ok).toBe(true);
}
