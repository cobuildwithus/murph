import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { completeAssistantOnboarding } from "@murphai/assistant-engine";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import {
  listHostedAiUsageForTest,
  listHostedRuntimeLogsForTest,
  readHostedMailboxConsumedSeqForTest,
  seedHostedLaunchConsentForTest,
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import { uploadHostedLocalWorkspaceSnapshot } from "./helpers/hosted-local-workspace-snapshot.js";

// Opt-in live-provider proof. Supply a synthetic WAV saying:
// "Read notes/synthetic-code.txt in my vault and tell me the code."
const audioPath = process.env.MURPH_E2E_VOICE_AUDIO_PATH;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const userId = `member_local_native_voice_${Date.now()}`;
const execFileAsync = promisify(execFile);
let scenario: HostedLocalFullStackScenario | null = null;
let seedRoot: string | null = null;

describe.skipIf(!audioPath)("hosted local native voice e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1000",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_DEV_WEB_HOST: "localhost",
      },
      assistantProviderMode: "live",
      assistantProviderRecorder: false,
      persistDirPrefix: "murph-hosted-local-native-voice-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted native voice proof",
      streamLogs: process.env.MURPH_E2E_STREAM_DEV_LOGS === "1",
    });
  }, 900_000);

  afterAll(async () => {
    await scenario?.stop();
    if (seedRoot) await rm(seedRoot, { recursive: true, force: true });
  }, 120_000);

  it("accepts spoken input durably, reads the vault, speaks, and settles trusted usage", async () => {
    if (!scenario || !audioPath) throw new Error("Voice proof was not initialized.");
    await scenario.seedActiveHostedMember({ memberId: userId });
    await seedHostedLaunchConsentForTest({ environment: scenario.runtimeEnv, memberId: userId });
    await seedWorkspace(scenario);
    const session = await scenario.issueHostedAppSession({
      memberId: userId, privyUserId: `did:privy:${userId}`,
    });
    const browserEnv: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "PLAYWRIGHT_BROWSERS_PATH"]) {
      if (process.env[key]) browserEnv[key] = process.env[key];
    }
    const { stdout } = await execFileAsync("pnpm", [
      "--dir", "apps/web", "exec", "tsx", "scripts/run-hosted-local-voice-proof.ts",
    ], {
      cwd: repoRoot,
      env: {
        ...browserEnv,
        MURPH_E2E_VOICE_AUDIO_PATH: audioPath,
        MURPH_E2E_HOSTED_SESSION_COOKIE: `${session.cookieName}=${encodeURIComponent(session.cookieValue)}`,
        MURPH_E2E_WEB_BASE_URL: scenario.harness.webBaseUrl,
      },
      maxBuffer: 1_000_000,
      timeout: 240_000,
    });
    const marker = stdout.split(/\r?\n/u).find((line) => line.startsWith("MURPH_E2E_RESULT="));
    expect(marker, "browser proof result").toBeDefined();
    expect(JSON.parse(marker!.slice("MURPH_E2E_RESULT=".length))).toMatchObject({
      ok: true, receivedAudio: true, providerConfirmed: true, microphoneStopped: true,
    });
    await scenario.waitForHostedCompletion(userId, { timeoutMs: 120_000 });
    const consumed = await readHostedMailboxConsumedSeqForTest({
      environment: scenario.runtimeEnv, lane: "conversation", userId,
    });
    expect(BigInt(consumed.consumedSeq)).toBeGreaterThan(0n);
    await expect.poll(async () => {
      const entries = await listHostedRuntimeLogsForTest({
        environment: scenario!.runtimeEnv, limit: 500, userId,
      });
      return entries.some(({ redactedJson }) => {
        const commandCount = redactedJson?.codexActionCommandCount;
        const dynamicCount = redactedJson?.codexActionDynamicToolCallCount;
        const mcpCount = redactedJson?.codexActionMcpToolCallCount;
        const toolCount = [commandCount, dynamicCount, mcpCount]
          .reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);
        return toolCount > 0 && redactedJson?.codexActionFailedCount === 0
          && redactedJson.codexActionFileChangeCount === 0;
      });
    }, { timeout: 20_000, interval: 500 }).toBe(true);
    const usage = await listHostedAiUsageForTest({
      environment: scenario.runtimeEnv, limit: 100, memberId: userId,
    });
    const voiceUsage = usage.filter((row) => row.requestedModel === "gpt-live-1");
    expect(voiceUsage.length).toBeGreaterThan(0);
    expect(voiceUsage.every((row) => row.allowanceCounted)).toBe(true);
    expect(voiceUsage.reduce((total, row) => total + BigInt(row.allowanceCostUsdMicros), 0n)).toBeGreaterThan(0n);
    process.stdout.write(`VOICE_HOSTED_PROOF=${JSON.stringify({
      acceptedConversationInputs: consumed.consumedSeq,
      trustedUsageRows: voiceUsage.length,
      browser: JSON.parse(marker!.slice("MURPH_E2E_RESULT=".length)),
    })}\n`);
  }, 420_000);
});

async function seedWorkspace(activeScenario: HostedLocalFullStackScenario): Promise<void> {
  seedRoot = await mkdtemp(path.join(tmpdir(), "murph-native-voice-seed-"));
  const operatorHomeRoot = path.join(seedRoot, "operator-home");
  const vaultRoot = path.join(seedRoot, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: "seed-native-voice", timezone: "America/New_York", vault: vaultRoot,
  });
  await completeAssistantOnboarding({
    completedAt: new Date().toISOString(), reason: "user_answered", vault: vaultRoot,
  });
  await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
  await writeFile(path.join(vaultRoot, "notes/synthetic-code.txt"), "The synthetic record code is BLUE-42.\n");
  const snapshotRef = await uploadHostedLocalWorkspaceSnapshot({
    environment: activeScenario.runtimeEnv, harness: activeScenario.harness,
    operatorHomeRoot, userId, vaultRoot,
  });
  const sourceBundleHash = snapshotRef.archive.encryptedObjectSha256;
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    environment: activeScenario.runtimeEnv, nextWakeAt: null, nextWakeReason: null,
    redactedStatusJson: { seededNativeVoice: true }, snapshotRef, userId,
    browserVaultReplicaRef: {
      byteLength: 256, dataVersion: `voice-${sourceBundleHash.slice(0, 16)}`,
      generatedAt: new Date().toISOString(), keyId: "browser-vault-replica:voice",
      objectKey: `browser-vault/voice-${sourceBundleHash.slice(0, 32)}.json`,
      replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:voice",
      schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash,
    },
  });
  expect(checkpoint.status).toBe("updated");
}
