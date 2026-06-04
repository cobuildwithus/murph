import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const execFileAsync = promisify(execFile);

const resetSmokeMemberId =
  process.env.MURPH_RESET_SMOKE_MEMBER_ID?.trim()
  || `member_local_reset_smoke_${Date.now()}`;
const linqApiToken = "linq-local-reset-smoke-token";
const linqWebhookSecret = "linq-local-reset-smoke-webhook-secret";
const oldHomeChatId = `chat_old_reset_smoke_${Date.now()}`;
const newHomeChatId = `chat_new_reset_smoke_${Date.now()}`;
const resetSmokeExternalIdSuffix = randomUUID().replace(/-/gu, "");
const resetSmokeStripeCustomerId = `cus_reset_smoke_${resetSmokeExternalIdSuffix.slice(0, 24)}`;
const resetSmokeStripeSubscriptionId = `sub_reset_smoke_${resetSmokeExternalIdSuffix.slice(8, 32)}`;
const resetSmokePrivyUserId = `did:privy:reset-smoke-${resetSmokeExternalIdSuffix.slice(0, 24)}`;
const resetSmokeWalletAddress = `0x${resetSmokeExternalIdSuffix}${resetSmokeExternalIdSuffix.slice(0, 8)}`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local member reset smoke", () => {
  beforeAll(async () => {
    await ensureScenario();
  }, 300_000);

  it("resets a production-shaped paid Linq member and accepts the first sparse post-reset text", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(resetSmokeMemberId);
    const homePhone = buildLinqHomePhoneNumber(resetSmokeMemberId);

    await requireScenario().seedActiveHostedLinqMember({
      billingPlanCode: "launch_monthly",
      homePhone,
      memberId: resetSmokeMemberId,
      memberPhone,
      privyUserId: resetSmokePrivyUserId,
      stripeCustomerId: resetSmokeStripeCustomerId,
      stripeSubscriptionId: resetSmokeStripeSubscriptionId,
      walletAddress: resetSmokeWalletAddress,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: oldHomeChatId,
      memberId: resetSmokeMemberId,
      recipientPhone: homePhone,
    });
    await requireScenario().runWake(buildActivationWake(resetSmokeMemberId), resetSmokeMemberId);
    await requireScenario().waitForHostedCompletion(resetSmokeMemberId);
    await seedProductionShapedResidue({
      environment: requireScenario().runtimeEnv,
      memberId: resetSmokeMemberId,
    });

    const beforeCounts = await readResetSmokeCounts({
      environment: requireScenario().runtimeEnv,
      memberId: resetSmokeMemberId,
    });
    expect(beforeCounts.deviceConnection).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.deviceAgentSession).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.deviceBrowserAssertionNonce).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.deviceOauthSession).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.deviceSyncDirtyPayload).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.hostedAiUsage).toBeGreaterThanOrEqual(2_170);
    expect(beforeCounts.hostedMailboxPayload).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.hostedRuntimeLog).toBeGreaterThanOrEqual(12_900);
    expect(beforeCounts.hostedWebInternalRequestNonce).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.deviceTokenAudit).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.deviceWebhookTraceOwners).toBeGreaterThanOrEqual(1);
    expect(beforeCounts.linqHomeRows).toBe(1);
    expect(beforeCounts.linqRecipientRows).toBe(1);

    const dryRun = await runResetScript({
      args: [
        "--member-id",
        resetSmokeMemberId,
        "--dry-run",
        "--environment",
        "local-reset-smoke",
      ],
      environment: requireScenario().runtimeEnv,
    });
    const fingerprint = readResetFingerprint(dryRun.stdout);

    const execute = await runResetScript({
      args: [
        "--member-id",
        resetSmokeMemberId,
        "--execute",
        "--confirm-member-id",
        resetSmokeMemberId,
        "--environment",
        "local-reset-smoke",
        "--confirm-environment",
        "local-reset-smoke",
        "--confirm-target-fingerprint",
        fingerprint,
        "--unsuspend-after-reset",
        "--confirm-unsuspend-after-reset",
        resetSmokeMemberId,
      ],
      environment: requireScenario().runtimeEnv,
    });
    expect(readResetStep(execute.stdout, "member-unsuspended")).not.toBeNull();
    expect(readResetStep(execute.stdout, "bootstrap-signal-complete")).not.toBeNull();

    const dbResetPostCounts = readObject(readResetStep(execute.stdout, "db-reset-complete")?.postCounts);
    expect(dbResetPostCounts).toMatchObject({
      deviceAgentSession: 0,
      deviceBrowserAssertionNonce: 0,
      deviceConnection: 0,
      deviceOauthSession: 0,
      deviceSyncDirtyPayload: 0,
      deviceSyncSignal: 0,
      deviceTokenAudit: 0,
      deviceWebhookTraceOwners: 0,
      hostedAiUsage: 0,
      hostedAiUsagePeriod: 0,
      hostedIngressLatencyTrace: 0,
      hostedInvite: 0,
      hostedLinqDailyState: 0,
      hostedMailboxPayload: 0,
      hostedWebInternalRequestNonce: 0,
      hostedWebSession: 0,
    });

    await requireScenario().waitForHostedCompletion(resetSmokeMemberId);

    const verificationMember = readObject(readResetStep(execute.stdout, "verification")?.member);
    expect(verificationMember).toMatchObject({
      billingStatus: "active",
      hasBillingRef: true,
      hasIdentity: true,
      hasPhoneIdentity: true,
      suspended: false,
    });

    const afterCounts = await readResetSmokeCounts({
      environment: requireScenario().runtimeEnv,
      memberId: resetSmokeMemberId,
    });
    expect(afterCounts.memberSuspended).toBe(0);
    expect(afterCounts.deviceConnection).toBe(0);
    expect(afterCounts.deviceSyncSignal).toBe(0);
    expect(afterCounts.hostedAiUsage).toBe(0);
    expect(afterCounts.hostedAiUsagePeriod).toBe(0);
    expect(afterCounts.hostedIngressLatencyTrace).toBe(0);
    expect(afterCounts.hostedInvite).toBe(0);
    expect(afterCounts.hostedLinqDailyState).toBe(0);
    expect(afterCounts.hostedMailboxItem).toBe(1);
    expect(afterCounts.hostedMailboxPayload).toBe(0);
    expect(afterCounts.hostedRuntimeLog).toBeGreaterThanOrEqual(1);
    expect(afterCounts.hostedWebSession).toBe(0);
    expect(afterCounts.hostedWorkspace).toBe(1);
    expect(afterCounts.deviceAgentSession).toBe(0);
    expect(afterCounts.deviceBrowserAssertionNonce).toBe(0);
    expect(afterCounts.deviceOauthSession).toBe(0);
    expect(afterCounts.deviceSyncDirtyPayload).toBe(0);
    expect(afterCounts.deviceTokenAudit).toBe(0);
    expect(afterCounts.deviceWebhookTraceOwners).toBe(0);
    expect(afterCounts.linqRecipientRows).toBe(1);
    expect(afterCounts.linqHomeRows).toBe(0);

    requireScenario().queueAssistantResponses([HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT]);
    const replyPath = `/chats/${encodeURIComponent(newHomeChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(replyPath);
    const webhookResponse = await postSignedLinqWebhook(
      buildSparsePostResetLinqInboundEvent({
        chatId: newHomeChatId,
        eventId: `evt_reset_smoke_${Date.now()}`,
        memberId: resetSmokeMemberId,
        messageId: `msg_reset_smoke_${Date.now()}`,
      }),
    );

    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(resetSmokeMemberId);
    const completionPromise = requireScenario().waitForHostedCompletion(resetSmokeMemberId);
    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId: resetSmokeMemberId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT,
    );

    const finalStatus = await completionPromise;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const finalCounts = await readResetSmokeCounts({
      environment: requireScenario().runtimeEnv,
      memberId: resetSmokeMemberId,
    });
    expect(finalCounts.linqHomeRows).toBe(1);
  }, 360_000);
});

async function ensureScenario(): Promise<void> {
  if (scenario) {
    return;
  }

  linqStub = await startHostedLocalLinqStub({
    expectedAuthorizationToken: linqApiToken,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(resetSmokeMemberId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: "gpt-5.5",
    persistDirPrefix: "murph-hosted-local-member-reset-smoke-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted member reset smoke e2e",
    streamLogs: streamDevLogs,
  });
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local-reset-smoke:${Date.now()}`,
    memberChannels: {
      email: true,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

async function runResetScript(input: {
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
}): Promise<{
  stderr: string;
  stdout: string;
}> {
  try {
    return await execFileAsync(
      "pnpm",
      [
        "--dir",
        "apps/web",
        "admin:reset-member",
        "--",
        ...input.args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...input.environment,
          NODE_ENV: "test",
          VITEST: "1",
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch (error) {
    throw new Error(formatResetScriptFailure(error));
  }
}

function formatResetScriptFailure(error: unknown): string {
  const failure = readObject(error);
  const code = typeof failure?.code === "number" || typeof failure?.code === "string"
    ? String(failure.code)
    : "unknown";
  const signal = typeof failure?.signal === "string" ? failure.signal : "none";
  const stdout = redactResetSmokeMemberId(readString(failure?.stdout) ?? "");
  const stderr = redactResetSmokeMemberId(readString(failure?.stderr) ?? "");
  return [
    `Reset script failed with code ${code} and signal ${signal}.`,
    stdout ? `stdout tail:\n${tailLines(stdout, 20)}` : "stdout tail: <empty>",
    stderr ? `stderr tail:\n${tailLines(stderr, 20)}` : "stderr tail: <empty>",
  ].join("\n");
}

function redactResetSmokeMemberId(value: string): string {
  return resetSmokeMemberId
    ? value.split(resetSmokeMemberId).join("<member-id>")
    : value;
}

function tailLines(value: string, maxLines: number): string {
  return value.trim().split(/\r?\n/gu).slice(-maxLines).join("\n");
}

function readResetFingerprint(stdout: string): string {
  const start = readResetStep(stdout, "start");
  const targets = readObject(start?.targets);
  const fingerprint = readString(targets?.executionTargetFingerprint);
  if (!fingerprint) {
    throw new Error("Reset dry-run did not print an execution target fingerprint.");
  }
  return fingerprint;
}

function readResetStep(stdout: string, step: string): Record<string, unknown> | null {
  return parseJsonLines(stdout).find((line) => line.step === step) ?? null;
}

function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout.split(/\r?\n/gu).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const record = readObject(parsed);
      return record ? [record] : [];
    } catch {
      return [];
    }
  });
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function buildSparsePostResetLinqInboundEvent(input: {
  chatId: string;
  eventId: string;
  memberId: string;
  messageId: string;
}): Record<string, unknown> {
  const event = buildHostedLinqInboundEvent(input.memberId, input.chatId, {
    eventId: input.eventId,
    messageId: input.messageId,
    text: "hello after reset",
  });
  const data = readObject(event.data);
  const chat = readObject(data?.chat);
  if (!data || !chat) {
    throw new Error("Expected hosted Linq inbound event data.");
  }
  delete data.recipient_phone;
  delete data.recipient_handle;
  delete chat.owner_handle;
  return event;
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

interface ResetSmokePrismaClient {
  $disconnect(): Promise<void>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
}

interface ResetSmokePrismaModule {
  createPrismaClient(input: {
    databaseUrl: string;
    poolMax?: number;
  }): ResetSmokePrismaClient;
}

async function withResetSmokePrisma<T>(
  environment: NodeJS.ProcessEnv,
  callback: (prisma: ResetSmokePrismaClient) => Promise<T>,
): Promise<T> {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Hosted member reset smoke requires DATABASE_URL.");
  }
  const module = await import("../../web/src/lib/prisma.ts") as ResetSmokePrismaModule;
  const prisma = module.createPrismaClient({
    databaseUrl,
    poolMax: 1,
  });
  try {
    return await callback(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function seedProductionShapedResidue(input: {
  environment: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<void> {
  await withResetSmokePrisma(input.environment, async (prisma) => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_mailbox_item (
        id, user_id, lane, lane_seq, dedupe_key, kind, occurred_at,
        payload_schema, payload_inline_ciphertext, created_at, updated_at
      )
      SELECT
        'reset_smoke_mailbox_' || gs::text,
        $1,
        'conversation',
        gs::bigint + 1000,
        'reset-smoke-mailbox-' || gs::text,
        'conversation.message',
        NOW() - (gs::text || ' seconds')::interval,
        'murph.hosted.reset-smoke',
        'reset-smoke-ciphertext',
        NOW(),
        NOW()
      FROM generate_series(1, 1663) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_mailbox_payload (
        mailbox_item_id, user_id, payload_ciphertext, payload_schema, created_at
      )
      SELECT
        'reset_smoke_mailbox_' || gs::text,
        $1,
        'reset-smoke-sidecar-ciphertext-' || gs::text,
        'murph.hosted.reset-smoke.sidecar',
        NOW()
      FROM generate_series(1, 5) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_ingress_latency_trace (
        id, user_id, source, mailbox_item_id, mailbox_lane, mailbox_lane_seq,
        accepted_at, created_at, updated_at
      )
      SELECT
        'reset_smoke_latency_' || gs::text,
        $1,
        'linq',
        'reset_smoke_mailbox_' || gs::text,
        'conversation',
        gs::bigint + 1000,
        NOW(),
        NOW(),
        NOW()
      FROM generate_series(1, 180) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_mailbox_lane_counter (user_id, lane, next_seq, updated_at)
      VALUES
        ($1, 'conversation', 4000, NOW()),
        ($1, 'device', 300, NOW())
      ON CONFLICT (user_id, lane) DO UPDATE
        SET next_seq = EXCLUDED.next_seq,
            updated_at = NOW()
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_runtime_log (
        id, user_id, at, level, component, phase, event_code, redacted_json, created_at
      )
      SELECT
        'reset_smoke_runtime_log_' || gs::text,
        $1,
        NOW() - (gs::text || ' seconds')::interval,
        'info',
        'reset-smoke',
        'before-reset',
        'reset_smoke_old_runtime',
        jsonb_build_object('shape', 'prod-like'),
        NOW()
      FROM generate_series(1, 12900) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_ai_usage (
        id, member_id, session_id, turn_id, attempt_count, provider_request_ordinal,
        occurred_at, provider, requested_model, served_model, stripe_meter_status,
        input_tokens, output_tokens, total_tokens, allowance_counted,
        allowance_accounted_at, allowance_period_start, allowance_period_end,
        allowance_cost_usd_micros, created_at, updated_at
      )
      SELECT
        'reset_smoke_usage_' || gs::text,
        $1,
        'reset_smoke_session',
        'reset_smoke_turn_' || gs::text,
        1,
        0,
        NOW() - (gs::text || ' minutes')::interval,
        'openai',
        'gpt-5.5',
        'gpt-5.5',
        CASE WHEN gs % 2 = 0 THEN 'pending' ELSE 'skipped' END,
        10,
        5,
        15,
        true,
        NOW(),
        date_trunc('month', NOW()),
        date_trunc('month', NOW()) + interval '1 month',
        1000,
        NOW(),
        NOW()
      FROM generate_series(1, 2170) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_ai_usage_period (
        member_id, period_start, period_end, billing_plan_code, limit_usd_micros,
        spent_usd_micros, blocked_at, limit_notice_sent_at, last_usage_at,
        created_at, updated_at
      )
      SELECT
        $1,
        date_trunc('month', NOW()) - (gs::text || ' months')::interval,
        date_trunc('month', NOW()) - ((gs - 1)::text || ' months')::interval,
        'launch_monthly',
        10000000,
        9000000,
        CASE WHEN gs = 1 THEN NOW() ELSE NULL END,
        CASE WHEN gs = 1 THEN NOW() ELSE NULL END,
        NOW(),
        NOW(),
        NOW()
      FROM generate_series(1, 3) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_linq_daily_state (
        member_id, day_utc, inbound_count, outbound_count,
        first_seen_at, last_seen_at, created_at, updated_at
      )
      SELECT
        $1,
        date_trunc('day', NOW()) - (gs::text || ' days')::interval,
        10,
        4,
        NOW(),
        NOW(),
        NOW(),
        NOW()
      FROM generate_series(1, 30) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_invite (
        id, member_id, invite_code, channel, sent_at, expires_at, created_at, updated_at
      )
      SELECT
        'reset_smoke_invite_' || gs::text,
        $1,
        'reset-smoke-invite-' || gs::text,
        'linq',
        NOW(),
        NOW() + interval '1 day',
        NOW(),
        NOW()
      FROM generate_series(1, 2) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_web_session (
        id, token_hash, member_id, privy_user_id, expires_at, last_seen_at,
        created_at, updated_at
      )
      SELECT
        'reset_smoke_session_' || gs::text,
        'reset_smoke_token_hash_' || gs::text,
        $1,
        'reset_smoke_privy',
        NOW() + interval '1 day',
        NOW(),
        NOW(),
        NOW()
      FROM generate_series(1, 4) AS gs
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_connection (
        id, user_id, provider, provider_account_blind_index, status,
        credential_kind, connected_at, created_at, updated_at
      )
      VALUES (
        'reset_smoke_device_connection',
        $1,
        'reset-smoke-provider',
        'reset-smoke-provider-account',
        'active',
        'oauth_tokens',
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_token_audit (
        user_id, connection_id, provider, action, channel, session_id,
        token_version, key_version, expected_token_version, force_refresh,
        refresh_outcome, token_version_changed, created_at
      )
      VALUES (
        $1,
        'reset_smoke_device_connection',
        'reset-smoke-provider',
        'read',
        'reset-smoke',
        'reset_smoke_session',
        1,
        'reset-smoke-key',
        1,
        false,
        'success',
        false,
        NOW()
      )
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_oauth_session (
        state, user_id, provider, return_to, metadata_json, created_at, expires_at
      )
      VALUES (
        'reset_smoke_oauth_state',
        $1,
        'reset-smoke-provider',
        '/devices',
        '{"shape":"prod-like"}'::jsonb,
        NOW(),
        NOW() + interval '1 hour'
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_agent_session (
        id, user_id, label, token_hash, created_at, updated_at, expires_at, last_seen_at
      )
      VALUES (
        'reset_smoke_agent_session',
        $1,
        'reset smoke',
        'reset_smoke_agent_token_hash',
        NOW(),
        NOW(),
        NOW() + interval '1 day',
        NOW()
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_browser_assertion_nonce (
        nonce_hash, user_id, method, path, created_at, expires_at
      )
      VALUES (
        'reset_smoke_browser_nonce',
        $1,
        'POST',
        '/api/devices/assert',
        NOW(),
        NOW() + interval '5 minutes'
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO hosted_web_internal_request_nonce (
        nonce_hash, user_id, method, path, search, created_at, expires_at
      )
      VALUES (
        'reset_smoke_internal_nonce',
        $1,
        'POST',
        '/api/internal/hosted-mailbox/email-ingress',
        '',
        NOW(),
        NOW() + interval '5 minutes'
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_sync_dirty_connection (
        connection_id, user_id, provider, dirty_revision, processed_revision,
        first_dirty_at, latest_dirty_at, event_count, created_at, updated_at
      )
      VALUES (
        'reset_smoke_device_connection',
        $1,
        'reset-smoke-provider',
        2,
        1,
        NOW(),
        NOW(),
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_sync_dirty_payload (
        id, connection_id, user_id, provider, dirty_revision, resource_encrypted, created_at
      )
      VALUES (
        'reset_smoke_dirty_payload',
        'reset_smoke_device_connection',
        $1,
        'reset-smoke-provider',
        2,
        'reset-smoke-resource-ciphertext',
        NOW()
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_sync_signal (
        user_id, connection_id, provider, kind, occurred_at, event_type, created_at
      )
      SELECT
        $1,
        'reset_smoke_device_connection',
        'reset-smoke-provider',
        'webhook',
        NOW(),
        'reset-smoke',
        NOW()
      FROM generate_series(1, 276) AS gs
    `, input.memberId);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_webhook_trace (
        provider, trace_id, provider_account_blind_index, event_type,
        claim_token, status, processing_expires_at, received_at, created_at
      )
      VALUES (
        'reset-smoke-provider',
        'reset_smoke_trace',
        'reset-smoke-provider-account',
        'reset-smoke',
        NULL,
        'processed',
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO device_connect_intent (
        claim_hash, member_id, provider, connect_source_id, connect_target,
        created_at, expires_at
      )
      VALUES (
        'reset_smoke_claim_hash',
        $1,
        'reset-smoke-provider',
        'reset-smoke-source',
        'member',
        NOW(),
        NOW() + interval '1 hour'
      )
      ON CONFLICT DO NOTHING
    `, input.memberId);
  });
}

interface ResetSmokeCounts {
  deviceAgentSession: number;
  deviceBrowserAssertionNonce: number;
  deviceConnection: number;
  deviceOauthSession: number;
  deviceSyncDirtyPayload: number;
  deviceSyncSignal: number;
  deviceTokenAudit: number;
  deviceWebhookTraceOwners: number;
  hostedAiUsage: number;
  hostedAiUsagePeriod: number;
  hostedIngressLatencyTrace: number;
  hostedInvite: number;
  hostedLinqDailyState: number;
  hostedMailboxItem: number;
  hostedMailboxPayload: number;
  hostedRuntimeLog: number;
  hostedWebInternalRequestNonce: number;
  hostedWebSession: number;
  hostedWorkspace: number;
  linqHomeRows: number;
  linqRecipientRows: number;
  memberSuspended: number;
}

async function readResetSmokeCounts(input: {
  environment: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<ResetSmokeCounts> {
  return await withResetSmokePrisma(input.environment, async (prisma) => {
    const rows = await prisma.$queryRawUnsafe<Array<Record<keyof ResetSmokeCounts, bigint>>>(`
      SELECT
        (SELECT COUNT(*) FROM hosted_member WHERE id = $1 AND suspended_at IS NOT NULL) AS "memberSuspended",
        (SELECT COUNT(*) FROM device_agent_session WHERE user_id = $1) AS "deviceAgentSession",
        (SELECT COUNT(*) FROM device_browser_assertion_nonce WHERE user_id = $1) AS "deviceBrowserAssertionNonce",
        (SELECT COUNT(*) FROM device_connection WHERE user_id = $1) AS "deviceConnection",
        (SELECT COUNT(*) FROM device_oauth_session WHERE user_id = $1) AS "deviceOauthSession",
        (SELECT COUNT(*) FROM device_sync_dirty_payload WHERE user_id = $1) AS "deviceSyncDirtyPayload",
        (SELECT COUNT(*) FROM device_sync_signal WHERE user_id = $1) AS "deviceSyncSignal",
        (SELECT COUNT(*) FROM device_token_audit WHERE user_id = $1) AS "deviceTokenAudit",
        (SELECT COUNT(*) FROM device_webhook_trace trace
          WHERE EXISTS (
            SELECT 1
            FROM device_connection connection
            WHERE connection.user_id = $1
              AND connection.provider = trace.provider
              AND connection.provider_account_blind_index = trace.provider_account_blind_index
          )
        ) AS "deviceWebhookTraceOwners",
        (SELECT COUNT(*) FROM hosted_ai_usage WHERE member_id = $1) AS "hostedAiUsage",
        (SELECT COUNT(*) FROM hosted_ai_usage_period WHERE member_id = $1) AS "hostedAiUsagePeriod",
        (SELECT COUNT(*) FROM hosted_ingress_latency_trace WHERE user_id = $1) AS "hostedIngressLatencyTrace",
        (SELECT COUNT(*) FROM hosted_invite WHERE member_id = $1) AS "hostedInvite",
        (SELECT COUNT(*) FROM hosted_linq_daily_state WHERE member_id = $1) AS "hostedLinqDailyState",
        (SELECT COUNT(*) FROM hosted_mailbox_item WHERE user_id = $1) AS "hostedMailboxItem",
        (SELECT COUNT(*) FROM hosted_mailbox_payload WHERE user_id = $1) AS "hostedMailboxPayload",
        (SELECT COUNT(*) FROM hosted_runtime_log WHERE user_id = $1) AS "hostedRuntimeLog",
        (SELECT COUNT(*) FROM hosted_web_internal_request_nonce WHERE user_id = $1) AS "hostedWebInternalRequestNonce",
        (SELECT COUNT(*) FROM hosted_web_session WHERE member_id = $1) AS "hostedWebSession",
        (SELECT COUNT(*) FROM hosted_workspace WHERE user_id = $1) AS "hostedWorkspace",
        (SELECT COUNT(*) FROM hosted_member_routing
          WHERE member_id = $1
            AND (linq_chat_lookup_key IS NOT NULL OR linq_chat_id_encrypted IS NOT NULL)
        ) AS "linqHomeRows",
        (SELECT COUNT(*) FROM hosted_member_routing
          WHERE member_id = $1
            AND (linq_recipient_phone_lookup_key IS NOT NULL OR linq_recipient_phone_encrypted IS NOT NULL)
        ) AS "linqRecipientRows"
    `, input.memberId);
    const row = rows[0];
    if (!row) {
      throw new Error("Reset smoke count query returned no rows.");
    }
    return {
      deviceAgentSession: Number(row.deviceAgentSession),
      deviceBrowserAssertionNonce: Number(row.deviceBrowserAssertionNonce),
      deviceConnection: Number(row.deviceConnection),
      deviceOauthSession: Number(row.deviceOauthSession),
      deviceSyncDirtyPayload: Number(row.deviceSyncDirtyPayload),
      deviceSyncSignal: Number(row.deviceSyncSignal),
      deviceTokenAudit: Number(row.deviceTokenAudit),
      deviceWebhookTraceOwners: Number(row.deviceWebhookTraceOwners),
      hostedAiUsage: Number(row.hostedAiUsage),
      hostedAiUsagePeriod: Number(row.hostedAiUsagePeriod),
      hostedIngressLatencyTrace: Number(row.hostedIngressLatencyTrace),
      hostedInvite: Number(row.hostedInvite),
      hostedLinqDailyState: Number(row.hostedLinqDailyState),
      hostedMailboxItem: Number(row.hostedMailboxItem),
      hostedMailboxPayload: Number(row.hostedMailboxPayload),
      hostedRuntimeLog: Number(row.hostedRuntimeLog),
      hostedWebInternalRequestNonce: Number(row.hostedWebInternalRequestNonce),
      hostedWebSession: Number(row.hostedWebSession),
      hostedWorkspace: Number(row.hostedWorkspace),
      linqHomeRows: Number(row.linqHomeRows),
      linqRecipientRows: Number(row.linqRecipientRows),
      memberSuspended: Number(row.memberSuspended),
    };
  });
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
