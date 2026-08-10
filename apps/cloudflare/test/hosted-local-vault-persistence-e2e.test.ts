import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  readHostedBundleTextFile,
} from "@murphai/runtime-state/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_DATABASE_URL,
} from "@murphai/hosted-local-harness/dev-hosted-local/constants";
import {
  buildHostedLocalRuntimeLogDatabaseNameForTest,
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

const execFileAsync = promisify(execFile);
const runId = Date.now();
const userId = `member_local_vault_persistence_${runId}`;
const chatId = `chat_local_vault_persistence_${runId}`;
const linqWebhookSecret = "linq-local-vault-persistence-secret";
const safeLiveAssistantModel =
  process.env.MURPH_HOSTED_LOCAL_LIVE_E2E_MODEL?.trim() || "gpt-5.6-terra";
const vaultRelativePath = `bank/hosted-e2e/vault-persistence-${runId}.md`;
const firstMarker = `first-marker-${randomUUID()}`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const cleanupPaths: string[] = [];
let databaseName: string | null = null;
let databaseUrl: string | null = null;
let persistDir: string | null = null;
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
const describeVaultPersistence = isLiveCodexAppServerEnvironment() ? describe : describe.skip;

beforeAll(async () => {
  if (!isLiveCodexAppServerEnvironment()) {
    return;
  }
  requireLiveCodexAppServerEnvironment();
  databaseName = buildDatabaseName();
  databaseUrl = await createDatabase(databaseName);
  persistDir = await mkdtemp(path.join(tmpdir(), "murph-hosted-vault-persistence-"));
  cleanupPaths.push(persistDir);
  linqStub = await startHostedLocalLinqStub();
}, 180_000);

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  if (databaseName) {
    await dropDatabase(databaseName).catch(() => {});
    databaseName = null;
    databaseUrl = null;
  }
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
}, 180_000);

describeVaultPersistence("hosted local vault persistence e2e", () => {
  it("persists real Codex vault file changes across hosted-local runner restarts", async () => {
    scenario = await startVaultPersistenceScenario({
      resetLocalDatabase: true,
      resetPersistDir: true,
    });

    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    await sendInboundLinqPrompt({
      eventId: `evt_vault_persistence_first_${runId}`,
      messageId: `msg_vault_persistence_first_${runId}`,
      text: [
        "Hosted vault persistence E2E setup.",
        "Use the shell in the current vault working directory.",
        `Create directory ${path.posix.dirname(vaultRelativePath)} if needed.`,
        `Write ${vaultRelativePath} with exactly these lines:`,
        "# Hosted vault persistence E2E",
        `first_marker: ${firstMarker}`,
        "Then send a brief Linq reply that the vault file was written.",
      ].join("\n"),
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const firstStatus = await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 600_000,
    });
    await expectVaultSnapshotText(firstStatus, {
      presentMarkers: [
        "# Hosted vault persistence E2E",
        `first_marker: ${firstMarker}`,
      ],
      summary: "first-run checkpoint did not contain the expected vault file",
    });
    const restartCryptoEnv = buildRestartCryptoEnv(
      requireScenario().harness.workerRuntimeEnv ?? requireScenario().runtimeEnv,
    );

    await scenario.stop();
    scenario = null;

    scenario = await startVaultPersistenceScenario({
      cryptoEnv: restartCryptoEnv,
      resetLocalDatabase: false,
      resetPersistDir: false,
    });
    const restoredStatus = await requireScenario().harness.readUserStatus(userId);
    await expectVaultSnapshotText(restoredStatus, {
      presentMarkers: [
        "# Hosted vault persistence E2E",
        `first_marker: ${firstMarker}`,
      ],
      summary: "restarted worker did not expose the first-run persisted vault file",
    });
  }, 900_000);
});

async function startVaultPersistenceScenario(input: {
  cryptoEnv?: NodeJS.ProcessEnv;
  resetLocalDatabase: boolean;
  resetPersistDir: boolean;
}): Promise<HostedLocalFullStackScenario> {
  return await startHostedLocalFullStackScenario({
    additionalEnv: {
      ...(input.cryptoEnv ?? {}),
      HOSTED_ASSISTANT_MODEL: safeLiveAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "low",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
    },
    assistantProviderMode: "live",
    assistantProviderStubModelId: safeLiveAssistantModel,
    localDatabaseUrl: requireDatabaseUrl(),
    persistDirOverride: requirePersistDir(),
    persistDirPrefix: "murph-hosted-local-vault-persistence-",
    resetLocalDatabase: input.resetLocalDatabase,
    resetPersistDir: input.resetPersistDir,
    requiredRunnerEnvProfile: "linq",
    reuseLocalDatabase: true,
    scenarioLabel: "Local hosted vault persistence e2e",
    streamLogs: streamDevLogs,
  });
}

function buildRestartCryptoEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cryptoEnv: NodeJS.ProcessEnv = {
    MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "1",
  };
  for (const key of HOSTED_LOCAL_RESTART_CRYPTO_ENV_KEYS) {
    const value = source[key]?.trim();
    if (value) {
      cryptoEnv[key] = value;
    }
  }
  for (const key of HOSTED_LOCAL_REQUIRED_RESTART_CRYPTO_ENV_KEYS) {
    if (!cryptoEnv[key]?.trim()) {
      throw new Error(`Hosted local restart crypto env is missing ${key}.`);
    }
  }
  return cryptoEnv;
}

const HOSTED_LOCAL_REQUIRED_RESTART_CRYPTO_ENV_KEYS = [
  "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

const HOSTED_LOCAL_RESTART_CRYPTO_ENV_KEYS = [
  "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

async function sendInboundLinqPrompt(input: {
  eventId: string;
  messageId: string;
  text: string;
}): Promise<void> {
  const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
    userId,
    chatId,
    {
      eventId: input.eventId,
      messageId: input.messageId,
      text: input.text,
    },
  ));
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    reason: "wake-appended-active-member",
  });
}

async function expectVaultSnapshotText(
  status: HostedRunnerStatusResponse,
  input: {
    absentMarkers?: readonly string[];
    presentMarkers: readonly string[];
    summary: string;
  },
): Promise<void> {
  const actualText = await readVaultSnapshotText(status, vaultRelativePath);
  expect(actualText, input.summary).not.toBeNull();
  for (const marker of input.presentMarkers) {
    expect(actualText, input.summary).toContain(marker);
  }
  for (const marker of input.absentMarkers ?? []) {
    expect(actualText, input.summary).not.toContain(marker);
  }
}

async function readVaultSnapshotText(
  status: HostedRunnerStatusResponse,
  relativePath: string,
): Promise<string | null> {
  const snapshotRef = status.workspace?.snapshotRef ?? null;
  const candidateRefs = [
    readHostedExecutionSnapshotHotRef(snapshotRef),
    readHostedExecutionSnapshotBaseRef(snapshotRef),
  ].filter((ref): ref is HostedExecutionBundleRef => ref !== null);

  for (const ref of candidateRefs) {
    const bytes = await readHostedBundleBytes(ref);
    const text = readHostedBundleTextFile({
      bytes,
      expectedKind: "vault",
      path: relativePath,
      root: "vault",
    });
    if (text !== null) {
      return text;
    }
  }

  return null;
}

async function readHostedBundleBytes(ref: HostedExecutionBundleRef): Promise<Uint8Array> {
  const search = new URLSearchParams({
    key: ref.key,
    sha256: ref.hash,
    size: String(ref.size),
    userId,
  });
  const response = await requireScenario().harness.request(
    `/__test/artifacts?${search.toString()}`,
    {
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "GET",
    },
  );
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
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

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:vault-persistence:${memberId}`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function isLiveCodexAppServerEnvironment(): boolean {
  return (
    process.env.MURPH_E2E_ASSISTANT_PROVIDER_MODE === "live"
    && Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

function requireLiveCodexAppServerEnvironment(): void {
  if (process.env.MURPH_E2E_ASSISTANT_PROVIDER_MODE !== "live") {
    throw new Error(
      "hosted-local vault-persistence requires --profile e2e:live so it uses the real Codex app-server path.",
    );
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "hosted-local vault-persistence requires OPENAI_API_KEY for the live Codex app-server run.",
    );
  }
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local vault persistence scenario is not running.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub is not running.");
  }
  return linqStub;
}

function requireDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("Hosted local vault persistence database was not created.");
  }
  return databaseUrl;
}

function requirePersistDir(): string {
  if (!persistDir) {
    throw new Error("Hosted local vault persistence directory was not created.");
  }
  return persistDir;
}

function buildDatabaseName(): string {
  return `murph_e2e_vault_persistence_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
}

async function createDatabase(name: string): Promise<string> {
  const adminUrl = new URL(DEFAULT_DATABASE_URL);
  const commandArgs = buildPostgresDatabaseCommandArgs(adminUrl, name);
  await execFileAsync("createdb", commandArgs, {
    env: buildPostgresDatabaseCommandEnv(adminUrl),
  });

  const targetUrl = new URL(DEFAULT_DATABASE_URL);
  targetUrl.pathname = `/${name}`;
  return targetUrl.toString();
}

async function dropDatabase(name: string): Promise<void> {
  const adminUrl = new URL(DEFAULT_DATABASE_URL);
  const commandEnv = buildPostgresDatabaseCommandEnv(adminUrl);
  await Promise.all([
    name,
    buildHostedLocalRuntimeLogDatabaseNameForTest(name),
  ].map(async (databaseName) =>
    await execFileAsync("dropdb", [
      "--if-exists",
      "--force",
      ...buildPostgresDatabaseCommandArgs(adminUrl, databaseName),
    ], { env: commandEnv })
  ));
}

function buildPostgresDatabaseCommandArgs(url: URL, databaseName: string): string[] {
  const args: string[] = [];

  if (url.hostname) {
    args.push("--host", url.hostname);
  }
  if (url.port) {
    args.push("--port", url.port);
  }
  if (url.username) {
    args.push("--username", decodeURIComponent(url.username));
  }
  args.push(databaseName);
  return args;
}

function buildPostgresDatabaseCommandEnv(url: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
  };
}
