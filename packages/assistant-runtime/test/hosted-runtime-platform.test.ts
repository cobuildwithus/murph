import assert from "node:assert/strict";

import { test } from "vitest";

import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  listPendingAssistantUsageRecords,
  resolveAssistantUsageCredentialSource,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";
import {
  HOSTED_AI_USAGE_BILLING_MODE_ENV,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";

import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import {
  HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV,
  HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV,
  parseHostedRuntimeBillingStripeCustomerResponse,
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "../src/hosted-runtime/platform.ts";
import {
  resolveHostedVercelAiGatewayStripeCustomerId,
} from "../src/hosted-runtime/billing.ts";
import { exportHostedPendingAssistantUsage } from "../src/hosted-runtime/usage.ts";
import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

function createHostedRuntimeTestWake() {
  return buildHostedExecutionRuntimeTimerWake({
    eventId: "evt_123",
    occurredAt: "2026-04-22T00:00:00.000Z",
    userId: "member_123",
    triggerKind: "runtime_timer",
  });
}

const HOSTED_STRIPE_METER_BILLING_ENV = {
  [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
  [HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV]: "rk_test_123",
  [HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV]: "true",
} as const;

test("hosted runtime config fails closed when the platform is not injected", () => {
  assert.throws(
    () => normalizeHostedAssistantRuntimeConfig(undefined, null),
    /platform must be injected/u,
  );
});

test("hosted runtime usage parser accepts a non-negative integer count and trims usage ids", () => {
  assert.deepEqual(
    parseHostedRuntimeUsageRecordResponse({
      recorded: 2,
      usageIds: [" usage_1 ", "usage_2"],
    }),
    {
      recorded: 2,
      usageIds: ["usage_1", "usage_2"],
    },
  );
});

test("hosted runtime Stripe customer parser accepts trimmed ids and nulls", () => {
  assert.deepEqual(
    parseHostedRuntimeBillingStripeCustomerResponse({
      stripeCustomerId: " cus_123 ",
    }),
    {
      stripeCustomerId: "cus_123",
    },
  );
  assert.deepEqual(
    parseHostedRuntimeBillingStripeCustomerResponse({
      stripeCustomerId: null,
    }),
    {
      stripeCustomerId: null,
    },
  );
});

test("hosted runtime Stripe customer parser rejects blank ids", () => {
  assert.throws(
    () => parseHostedRuntimeBillingStripeCustomerResponse({
      stripeCustomerId: "   ",
    }),
    /stripeCustomerId must be a non-empty string or null/u,
  );
});

test("hosted runtime usage parser rejects non-object payloads", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse(null),
    /must be an object/u,
  );
});

test("hosted runtime usage parser rejects fractional recorded counts", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1.5,
      usageIds: [],
    }),
    /recorded must be a non-negative integer/u,
  );
});

test("hosted runtime usage parser rejects non-string or blank usage ids", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1,
      usageIds: ["usage_1", 2],
    }),
    /usageIds must be a string array of non-empty values/u,
  );
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1,
      usageIds: ["   "],
    }),
    /usageIds must be a string array of non-empty values/u,
  );
});

test("hosted runtime usage parser rejects recorded counts that do not match usage ids", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1,
      usageIds: ["usage_1", "usage_2"],
    }),
    /recorded must equal usageIds\.length/u,
  );
});

test("hosted runtime delegated billing resolves the Stripe customer id only for Vercel AI Gateway requests", async () => {
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.deepEqual(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        VERCEL_AI_API_KEY: "platform-key",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    "cus_123",
  );
});

test("hosted runtime delegated billing skips lookup when the request is not using Vercel AI Gateway", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.deepEqual(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_BASE_URL: "https://api.example.test/v1",
        HOSTED_ASSISTANT_PROVIDER: "unsupported-provider",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup when the billing flag is disabled", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        [HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV]: "rk_test_123",
        [HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV]: "false",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup when usage billing mode is disabled", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "disabled",
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup for unsupported truthy flag aliases", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        [HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV]: "rk_test_123",
        [HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV]: "yes",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup when the restricted access key is missing", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        [HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV]: "true",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup when the configured provider key comes from member env", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        VERCEL_AI_API_KEY: "platform-key",
      },
      userEnv: {
        VERCEL_AI_API_KEY: "member-key",
      },
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup for lookalike Vercel AI Gateway hosts", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh.example.test/v1",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup for userinfo-bearing Vercel AI Gateway urls", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_BASE_URL: "https://user:pass@ai-gateway.vercel.sh/v1",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup for Vercel AI Gateway urls with non-default explicit ports", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  for (const baseUrl of ["https://ai-gateway.vercel.sh:444/v1"]) {
    assert.equal(
      await resolveHostedVercelAiGatewayStripeCustomerId({
        billingPort,
        forwardedEnv: {
          ...HOSTED_STRIPE_METER_BILLING_ENV,
          HOSTED_ASSISTANT_BASE_URL: baseUrl,
        },
        userEnv: {},
        wake: createHostedRuntimeTestWake(),
      }),
      null,
    );
  }

  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup when a custom base url conflicts with stale Vercel gateway markers", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_BASE_URL: "https://router.example.test/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        HOSTED_ASSISTANT_PROVIDER_NAME: "vercel-ai-gateway",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime delegated billing skips lookup when gateway metadata is present without a trusted base url", async () => {
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        HOSTED_ASSISTANT_PROVIDER_NAME: "vercel-ai-gateway",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
  assert.equal(called, false);
});

test("hosted runtime treats blank configured user API key overrides as platform-funded execution", async () => {
  const platform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
  } satisfies HostedRuntimePlatform;
  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
      },
      userEnv: {
        VERCEL_AI_API_KEY: "   ",
      },
    },
    platform,
  );
  let called = false;
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      called = true;
      return {
        stripeCustomerId: "cus_123",
      };
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.deepEqual(normalized.userEnv, {});
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "VERCEL_AI_API_KEY",
      provider: "codex-cli",
      userEnvKeys: Object.keys(normalized.userEnv),
    }),
    "platform",
  );
  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        VERCEL_AI_API_KEY: "platform-key",
      },
      userEnv: {
        VERCEL_AI_API_KEY: "   ",
      },
      wake: createHostedRuntimeTestWake(),
    }),
    "cus_123",
  );
  assert.equal(called, true);
});

test("hosted runtime delegated billing fails closed when the Stripe customer lookup throws", async () => {
  const billingPort = {
    async resolveVercelAiGatewayStripeCustomerId() {
      throw new Error("lookup failed");
    },
  } satisfies NonNullable<HostedRuntimePlatform["billingPort"]>;

  assert.equal(
    await resolveHostedVercelAiGatewayStripeCustomerId({
      billingPort,
      forwardedEnv: {
        ...HOSTED_STRIPE_METER_BILLING_ENV,
        HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      },
      userEnv: {},
      wake: createHostedRuntimeTestWake(),
    }),
    null,
  );
});

test("hosted runtime issue parser accepts a non-negative integer count and trims issue ids", () => {
  assert.deepEqual(
    parseHostedRuntimeIssueRecordResponse({
      issueIds: [" issue_1 ", "issue_2"],
      recorded: 2,
    }),
    {
      issueIds: ["issue_1", "issue_2"],
      recorded: 2,
    },
  );
});

test("hosted runtime issue parser rejects non-array issue ids", () => {
  assert.throws(
    () => parseHostedRuntimeIssueRecordResponse({
      issueIds: "issue_1",
      recorded: 1,
    }),
    /issueIds must be a string array of non-empty values/u,
  );
});

test("hosted usage export stays non-fatal and leaves records pending when no usage port is injected", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-platform-");

  try {
    const usageId = createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_missing_port",
    });
    await writePendingAssistantUsageRecord({
      record: {
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
        featureKey: null,
        gatewayTags: [],
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: "2026-04-07T00:00:00.000Z",
        outputTokens: 5,
        provider: "codex-cli",
        providerName: "Vercel AI Gateway",
        providerRequestId: null,
        rawUsageJson: null,
        rawUsageJsonHash: null,
        reasoningTokens: null,
        reportingUserId: null,
        requestedModel: "gpt-5.5",
        routeId: "primary",
        schema: ASSISTANT_USAGE_SCHEMA,
        servedModel: "gpt-5.5",
        sessionId: "asst_123",
        stripeMeterSource: "murph",
        surface: null,
        totalTokens: 15,
        triggerKind: null,
        turnId: "turn_missing_port",
        usageId,
        usageExtractionSourcePath: null,
        usageExtractionVersion: "legacy",
      },
      vault: vaultRoot,
    });

    assert.deepEqual(
      await exportHostedPendingAssistantUsage({
        usageExportPort: null,
        vaultRoot,
      }),
      {
        exported: 0,
        failed: 0,
        invalid: 0,
        invalidIssueRecorded: false,
        pending: 1,
      },
    );

    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.usageId, usageId);
  } finally {
    await cleanup();
  }
});

test("hosted usage export deletes only the usage ids acknowledged by the injected usage port", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-platform-");

  try {
    const firstUsageId = createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_ack_1",
    });
    const secondUsageId = createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_ack_2",
    });

    for (const [usageId, turnId] of [
      [firstUsageId, "turn_ack_1"],
      [secondUsageId, "turn_ack_2"],
    ] as const) {
      await writePendingAssistantUsageRecord({
        record: {
          apiKeyEnv: null,
          attemptCount: 1,
          baseUrl: null,
          cacheWriteTokens: null,
          cachedInputTokens: null,
          credentialSource: "platform",
          featureKey: null,
          gatewayTags: [],
          inputTokens: 10,
          memberId: "member_123",
          occurredAt: "2026-04-07T00:00:00.000Z",
          outputTokens: 5,
          provider: "codex-cli",
          providerName: "Vercel AI Gateway",
          providerRequestId: null,
          rawUsageJson: null,
          rawUsageJsonHash: null,
          reasoningTokens: null,
          reportingUserId: null,
          requestedModel: "gpt-5.5",
          routeId: "primary",
          schema: ASSISTANT_USAGE_SCHEMA,
          servedModel: "gpt-5.5",
          sessionId: "asst_123",
          stripeMeterSource: "murph",
          surface: null,
          totalTokens: 15,
          triggerKind: null,
          turnId,
          usageId,
          usageExtractionSourcePath: null,
          usageExtractionVersion: "legacy",
        },
        vault: vaultRoot,
      });
    }

    const usageExportPort: NonNullable<HostedRuntimePlatform["usageExportPort"]> = {
      async recordUsage(usage) {
        assert.equal(usage.length, 2);
        return {
          recorded: 1,
          usageIds: [firstUsageId],
        };
      },
    };

    assert.deepEqual(
      await exportHostedPendingAssistantUsage({
        usageExportPort,
        vaultRoot,
      }),
      {
        exported: 1,
        failed: 1,
        invalid: 0,
        invalidIssueRecorded: false,
        pending: 1,
      },
    );

    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });
    assert.deepEqual(
      remaining.map((record) => record.usageId),
      [secondUsageId],
    );
  } finally {
    await cleanup();
  }
});
