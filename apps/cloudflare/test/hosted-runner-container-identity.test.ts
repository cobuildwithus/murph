import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { parseHostedWorkspaceInvocationRequest } from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_DEFAULT_MODEL,
  type HostedAssistantModelOverride,
  type HostedAssistantProviderOverride,
  type HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
import type {
  HostedAssistantCustomInferenceOverride,
} from "@murphai/hosted-execution/assistant-inference";
import {
  HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV,
} from "@murphai/hosted-execution/env";

import {
  readHostedRunnerContainerIdentity,
  resolveHostedExecutionRunnerContainerName,
} from "../src/hosted-runner-container-identity.js";
import {
  readHostedExecutionEnvironment,
} from "../src/env.js";
import type {
  R2BucketLike,
} from "../src/bundle-store.js";
import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.js";
import {
  createHostedRunnerContainerNamespaceRouter,
  HOSTED_STANDBY_REGION,
  type HostedStandbyRunnerContainerNamespaceLike,
  type HostedStandbyRunnerContainerStubLike,
} from "../src/standby-runner-contract.js";

import { RunnerSlotBindingStore } from "../src/runner-slot-binding.js";

import {
  RunnerSecretsService,
} from "../src/user-runner/runner-secrets.js";
import {
  type RunnerWriteFenceToken,
} from "../src/runtime-invocation-token.ts";
import {
  RuntimeInvocationPreparation,
} from "../src/runtime-invocation-preparation.js";

import {
  openHostedInferenceRuntimeTarget,
} from "../src/hosted-inference-target-envelope.js";
import {
  RunnerStoreCache,
  type RunnerUserStores,
} from "../src/user-runner/runner-store-cache.js";

import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.js";
import {
  createTestHostedRuntimeCryptoContext,
  getTestHostedRuntimeRootKey,
} from "./hosted-runtime-crypto-fixtures.js";
import {
  createTestSqlStorage,
} from "./sql-storage.js";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

const FIXED_NOW = "2026-06-03T00:00:00.000Z";
const TEST_USER_ID = "member_123";
describe("hosted runner container identity", () => {

  it("loads workspace metadata and runtime crypto concurrently before fenced preparation", async () => {
    const stateStore = createPreparationOwnerFixture();
    const token = await stateStore.beginWriteFence({
      runnerContainerName: TEST_USER_ID,
      userId: TEST_USER_ID,
    });
    const workspaceGate = createVoidGate();
    const cryptoGate = createVoidGate();
    const started: string[] = [];
    const originalEnsure = TestRunnerStoreCache.prototype.ensure;
    vi.spyOn(TestRunnerStoreCache.prototype, "ensure").mockImplementation(async function(this: TestRunnerStoreCache, userId) {
      started.push("crypto");
      await cryptoGate.promise;
      return originalEnsure.call(this, userId);
    });
    const service = createRuntimeInvocationPreparation({
      beforeWorkspaceRead: async () => {
        started.push("workspace");
        await workspaceGate.promise;
      },
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET: "synthetic-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const prepared = service.prepareWithFence({
      input: { orchestrationAttemptId: "parallel-inputs", userId: TEST_USER_ID },
      token,
    });
    try {
      await vi.waitFor(() => expect(started).toEqual(["workspace", "crypto"]), { timeout: 250 });
      expect((await stateStore.readWriteFenceToken())?.workspaceVersion).toBeNull();
    } finally {
      workspaceGate.resolve();
      cryptoGate.resolve();
      await prepared;
    }
    expect(started).toHaveLength(2);
  });

  it.each(["workspace failure", "crypto failure", "foreign crypto", "expired budget"] as const)(
    "rejects early preparation on %s without binding invocation facts",
    async (scenario) => {
        const stateStore = createPreparationOwnerFixture();
      const token = await stateStore.beginWriteFence({
        runnerContainerName: TEST_USER_ID,
        userId: TEST_USER_ID,
      });
      const stores = await new TestRunnerStoreCache({}).ensure(TEST_USER_ID);
      vi.spyOn(TestRunnerStoreCache.prototype, "ensure").mockImplementation(async () => {
        if (scenario === "crypto failure") throw new Error("Synthetic crypto unavailable.");
        return scenario === "foreign crypto" ? { ...stores, userId: "member_other" } : stores;
      });
      const budget = { deadlineAtMs: Date.now() + 1_000 };
      const invokedContainerNames: string[] = [];
      const service = createRuntimeInvocationPreparation({
        beforeWorkspaceRead: async () => {
          if (scenario === "workspace failure") throw new Error("Synthetic workspace unavailable.");
          if (scenario === "expired budget") budget.deadlineAtMs = Date.now() - 1;
        },
        invokedContainerNames,
        runnerRuntimeEnvSource: {},
          stateStore,
      });
      const consume = service.prepareForFreshStart({
        commandBudget: budget,
        input: { orchestrationAttemptId: "early-preparation-failure", userId: TEST_USER_ID },
      });
      const expected = {
        "workspace failure": "Synthetic workspace unavailable.",
        "crypto failure": "Synthetic crypto unavailable.",
        "foreign crypto": "Hosted runtime preparation stores belong to another user.",
        "expired budget": "Hosted runner runtime processing command budget timed out.",
      }[scenario];
      await expect(consume(token)).rejects.toThrow(expected);
      expect((await stateStore.readWriteFenceToken())?.workspaceVersion).toBeNull();
      expect(invokedContainerNames).toEqual([]);
    },
  );

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  it("does not interpret opaque fleet targets as member identities", () => {
    for (const prefix of ["runner", "standby"]) {
      for (const source of [{}, { CF_VERSION_METADATA: { id: "release_1" } }]) {
        expect(readHostedRunnerContainerIdentity({
          containerName: `${prefix}--v-release_1--0123456789abcdef0123456789abcdef`,
          source,
        })).toBeNull();
      }
    }
  });

  it("round-trips a versioned runner container identity", () => {
    const source = {
      CF_VERSION_METADATA: {
        id: " version/123 ",
      },
    };

    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source,
      userId: "member_123",
    });

    expect(runnerContainerName).toBe("member_123--v-version-123");
    expect(readHostedRunnerContainerIdentity({
      containerName: ` ${runnerContainerName} `,
      source,
    })).toEqual({
      runnerContainerName,
      userId: "member_123",
    });
  });

  it("derives the same user when the active worker version suffix differs", () => {
    expect(readHostedRunnerContainerIdentity({
      containerName: "member_123--v-version-a",
      source: {
        CF_VERSION_METADATA: {
          id: "version-b",
        },
      },
    })).toEqual({
      runnerContainerName: "member_123--v-version-a",
      userId: "member_123",
    });
  });

  it("keeps suffix-looking container names literal without worker version metadata", () => {
    expect(readHostedRunnerContainerIdentity({
      containerName: "member_123--v-version-a",
      source: {},
    })).toEqual({
      runnerContainerName: "member_123--v-version-a",
      userId: "member_123--v-version-a",
    });
  });

  it("returns null for missing or suffix-only container names", () => {
    const source = {
      CF_VERSION_METADATA: {
        id: "version-a",
      },
    };

    expect(readHostedRunnerContainerIdentity({
      containerName: "   ",
      source,
    })).toBeNull();
    expect(readHostedRunnerContainerIdentity({
      containerName: "--v-version-a",
      source,
    })).toBeNull();
  });

  it.each([
    {
      expectedModel: HOSTED_ASSISTANT_LUNA_MODEL,
      fleetModel: HOSTED_ASSISTANT_DEFAULT_MODEL,
      hostedAssistantModelOverride: HOSTED_ASSISTANT_LUNA_MODEL,
      name: "applies the saved Luna choice",
    },
    {
      expectedModel: HOSTED_ASSISTANT_SOL_MODEL,
      fleetModel: HOSTED_ASSISTANT_DEFAULT_MODEL,
      hostedAssistantModelOverride: HOSTED_ASSISTANT_SOL_MODEL,
      name: "applies the saved Sol choice",
    },
    {
      expectedModel: HOSTED_ASSISTANT_SOL_MODEL,
      fleetModel: "gpt-5.6-luna",
      hostedAssistantModelOverride: HOSTED_ASSISTANT_SOL_MODEL,
      name: "applies the saved Sol choice independently of the platform default",
    },
    {
      expectedModel: HOSTED_ASSISTANT_DEFAULT_MODEL,
      fleetModel: HOSTED_ASSISTANT_DEFAULT_MODEL,
      hostedAssistantModelOverride: null,
      name: "preserves Terra without an override",
    },
  ] as const)("$name", async ({
    expectedModel,
    fleetModel,
    hostedAssistantModelOverride,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const service = createRuntimeInvocationPreparation({
      ...(hostedAssistantModelOverride
        ? { hostedAssistantModelOverride }
        : {}),
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_MODEL: fleetModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_model_override",
        userId: TEST_USER_ID,
      },
      token,
    });

    expect(prepared.job.runtime?.forwardedEnv?.HOSTED_ASSISTANT_MODEL)
      .toBe(expectedModel);
  });

  it.each([
    { expected: "1", projected: true },
    { expected: "0", projected: false },
    { expected: "0", projected: undefined },
  ])("forwards subagent model authority as $expected when projection is $projected", async ({
    expected,
    projected,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const service = createRuntimeInvocationPreparation({
      hostedAssistantSubagentModelOverridesAllowed: projected,
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_subagent_model_authority",
        userId: TEST_USER_ID,
      },
      token,
    });

    expect(
      prepared.job.runtime?.forwardedEnv?.[
        HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV
      ],
    ).toBe(expected);
  });

  it("applies Venice per member while retaining a scoped OpenAI tool credential", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const sourceOpenAiKey = "test-openai-key";
    const sourceVeniceKey = "test-venice-key";
    const service = createRuntimeInvocationPreparation({
      hostedAssistantProviderOverride: "venice",
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: sourceOpenAiKey,
        VENICE_API_KEY: sourceVeniceKey,
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_provider_override",
        userId: TEST_USER_ID,
      },
      token,
    });
    const forwardedEnv = prepared.job.runtime?.forwardedEnv;

    expect(forwardedEnv?.HOSTED_ASSISTANT_PROVIDER).toBe("venice");
    expect(forwardedEnv?.OPENAI_API_KEY).toEqual(expect.any(String));
    expect(forwardedEnv?.OPENAI_API_KEY).not.toBe(sourceOpenAiKey);
    expect(forwardedEnv?.VENICE_API_KEY).toEqual(expect.any(String));
    expect(forwardedEnv?.VENICE_API_KEY).not.toBe(sourceVeniceKey);
  });

  it.each([false, true])("preserves first-day priority through invocation parsing (existing workspace: %s)", async (existing) => {
    const stateStore = createPreparationOwnerFixture();
    const workspace = existing ? {
      createdAt: FIXED_NOW,
      snapshotRef: null,
      updatedAt: FIXED_NOW,
      userId: TEST_USER_ID,
      version: "0",
    } : null;
    const beforeWorkspaceRead = vi.fn(async () => {});
    for (const hostedAssistantPriorityUntil of ["2026-06-04T00:00:00.000Z", undefined]) {
      const service = createRuntimeInvocationPreparation({
        beforeWorkspaceRead,
        hostedAssistantPriorityUntil,
        invokedContainerNames: [],
        runnerRuntimeEnvSource: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET: "synthetic-signing-secret",
          OPENAI_API_KEY: "test-openai-key",
        },
        stateStore,
        workspace,
      });
      const token = await stateStore.beginWriteFence({
        runnerContainerName: TEST_USER_ID,
        userId: TEST_USER_ID,
      });
      const prepared = await service.prepareWithFence({
        input: { orchestrationAttemptId: "priority-prefetch", userId: TEST_USER_ID },
        token,
      });
      const request = parseHostedWorkspaceInvocationRequest(JSON.parse(JSON.stringify(prepared.job.request)));
      expect(request.hostedAssistantPriorityUntil).toBe(hostedAssistantPriorityUntil);
      if (workspace) expect(request.workspace).toMatchObject(workspace);
      else expect(request.workspace).toBeNull();
      expect(Object.hasOwn(request, "workspace")).toBe(true);
      expect(prepared.job.runtime?.forwardedEnv).not.toHaveProperty("HOSTED_ASSISTANT_PRIORITY_UNTIL");
    }
    expect(beforeWorkspaceRead).toHaveBeenCalledTimes(2);
  });

  it("projects the saved reasoning effort into the next runtime invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const service = createRuntimeInvocationPreparation({
      hostedAssistantReasoningEffortOverride: "xhigh",
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_ASSISTANT_REASONING_EFFORT: "low",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_reasoning_override",
        userId: TEST_USER_ID,
      },
      token,
    });

    expect(
      prepared.job.runtime?.forwardedEnv?.HOSTED_ASSISTANT_REASONING_EFFORT,
    ).toBe("xhigh");
  });

  it("resolves a selected custom target once, pins it to the fence, and gives Codex only a sentinel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const override: HostedAssistantCustomInferenceOverride = {
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r7",
      protocol: "responses",
      revision: 7,
      supportsImages: false,
      verificationProfile: "murph-codex-0.151.0-portable-responses-v1",
    };
    const runtimeTarget = {
      auth: {
        kind: "bearer",
        secret: "synthetic-upstream-secret",
      },
      contextWindowTokens: override.contextWindowTokens,
      endpointUrl: "https://inference.example.com/v1/responses",
      model: "synthetic-upstream-model",
      protocol: override.protocol,
      revision: override.revision,
      schema: "murph.hosted-inference-runtime-target.v1",
      supportsImages: override.supportsImages,
      verificationProfile: override.verificationProfile,
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(runtimeTarget)
    );
    vi.stubGlobal("fetch", fetchMock);
    const runnerRuntimeEnvSource = {
      CF_VERSION_METADATA: { id: "version_1" },
      HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      OPENAI_API_KEY: "test-openai-key",
    };
    const service = createRuntimeInvocationPreparation({
      hostedAssistantCustomInferenceOverride: override,
      hostedAssistantSubagentModelOverridesAllowed: true,
      invokedContainerNames: [],
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource,
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_custom_inference",
        userId: TEST_USER_ID,
      },
      token,
    });
    const forwardedEnv = prepared.job.runtime?.forwardedEnv;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prepared.job.request.processingMode).toBeUndefined();
    expect(forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS: "131072",
      HOSTED_ASSISTANT_MODEL: "murph-custom-r7",
      HOSTED_ASSISTANT_PROVIDER: "hosted-custom-inference",
      MURPH_CUSTOM_INFERENCE_API_KEY: "__cloudflare_injected__",
    });
    expect(forwardedEnv).not.toHaveProperty("HOSTED_ASSISTANT_REASONING_EFFORT");
    expect(
      forwardedEnv?.[HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV],
    ).toBe("0");
    expect(JSON.stringify(prepared.job)).not.toContain(runtimeTarget.endpointUrl);
    expect(JSON.stringify(prepared.job)).not.toContain(runtimeTarget.auth.secret);

    if (!token.providerEgressToken) {
      throw new Error("Expected a provider egress token on the active fence.");
    }
    const validation = await stateStore.readBoundInvocation({
      providerEgressToken: token.providerEgressToken,
      userId: TEST_USER_ID,
    });
    expect(validation).not.toBeNull();
    if (!validation?.customInferenceEnvelope) {
      throw new Error("Expected the selected custom target on the active fence.");
    }
    await expect(openHostedInferenceRuntimeTarget({
      envelope: validation.customInferenceEnvelope,
      source: runnerRuntimeEnvSource,
    })).resolves.toEqual(runtimeTarget);
  });

  it("preserves an orchestration-owned assistant block with custom inference", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const override: HostedAssistantCustomInferenceOverride = {
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r7",
      protocol: "responses",
      revision: 7,
      supportsImages: false,
      verificationProfile: "murph-codex-0.151.0-portable-responses-v1",
    };
    const runtimeTarget = {
      auth: {
        kind: "bearer" as const,
        secret: "synthetic-upstream-secret",
      },
      contextWindowTokens: override.contextWindowTokens,
      endpointUrl: "https://inference.example.com/v1/responses",
      model: "synthetic-upstream-model",
      protocol: override.protocol,
      revision: override.revision,
      schema: "murph.hosted-inference-runtime-target.v1" as const,
      supportsImages: override.supportsImages,
      verificationProfile: override.verificationProfile,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      Response.json(runtimeTarget)
    ));
    const service = createRuntimeInvocationPreparation({
      hostedAssistantCustomInferenceOverride: override,
      invokedContainerNames: [],
      platformAiUsageAllowed: true,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        assistantExecutionBlocked: true,
        orchestrationAttemptId: "orchestration_attempt_blocked_custom_inference",
        processingMode: "system_mailbox",
        userId: TEST_USER_ID,
      },
      token,
    });

    expect(prepared.job.request).toMatchObject({
      assistantExecutionBlocked: true,
      processingMode: "system_mailbox",
    });
    expect(prepared.job.runtime?.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "murph-custom-r7",
      HOSTED_ASSISTANT_PROVIDER: "hosted-custom-inference",
    });
  });

  it("narrows a denied managed default wake to model-free system mailbox work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const invokedContainerNames: string[] = [];
    const service = createRuntimeInvocationPreparation({
      invokedContainerNames,
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_managed_denied",
        userId: TEST_USER_ID,
      },
      token,
    });
    expect(invokedContainerNames).toEqual([]);
    expect(prepared.job.request.processingMode).toBe("system_mailbox");
    if (!prepared.token.providerEgressToken) {
      throw new Error("Expected a provider egress token on the active fence.");
    }
    await expect(stateStore.readBoundInvocation({
      providerEgressToken: prepared.token.providerEgressToken,
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      platformAiUsageAllowed: false,
    });
  });

  it("keeps a due delivery-only wake on its outbox-owning phase while metered egress stays denied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const service = createRuntimeInvocationPreparation({
      invokedContainerNames: [],
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
      workspace: {
        createdAt: "2026-06-02T23:59:00.000Z",
        nextWakeAt: "2026-06-02T23:59:59.000Z",
        nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
        snapshotRef: null,
        updatedAt: "2026-06-02T23:59:59.000Z",
        userId: TEST_USER_ID,
        version: "5",
      },
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_delivery_denied",
        userId: TEST_USER_ID,
      },
      token,
    });

    expect(prepared.job.request.processingMode).toBeUndefined();
    expect(prepared.job.request.assistantExecutionBlocked).toBeUndefined();
    if (!prepared.token.providerEgressToken) {
      throw new Error("Expected a provider egress token on the active fence.");
    }
    await expect(stateStore.readBoundInvocation({
      providerEgressToken: prepared.token.providerEgressToken,
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      platformAiUsageAllowed: false,
    });
  });

  it("lets inbox media retention run under a denied allowance while metered egress stays blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const service = createRuntimeInvocationPreparation({
      invokedContainerNames: [],
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_DEFAULT_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    // System-mailbox work uses the same denied provider-egress fence as the
    // default runtime path.
    await expect(service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_system_mailbox_denied",
        processingMode: "system_mailbox",
        userId: TEST_USER_ID,
      },
      token,
    })).resolves.toMatchObject({
      workspaceVersion: "0",
    });

    await expect(service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_retention_denied",
        processingMode: "inbox_media_retention",
        userId: TEST_USER_ID,
      },
      token,
    })).resolves.toMatchObject({
      workspaceVersion: "0",
    });

    if (!token.providerEgressToken) {
      throw new Error("Expected a provider egress token on the active fence.");
    }
    const validation = await stateStore.readBoundInvocation({
      providerEgressToken: token.providerEgressToken,
      userId: TEST_USER_ID,
    });
    expect(validation).toMatchObject({
      platformAiUsageAllowed: false,
    });
  });

  it("fails closed when runtime invocation parses a different user from the write-fence token name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const invokedContainerNames: string[] = [];
    const service = createRuntimeInvocationPreparation({
      invokedContainerNames,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_456--v-version_1",
      userId: TEST_USER_ID,
    });

    await expect(service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_1",
        userId: TEST_USER_ID,
      },
      token,
    })).rejects.toThrow(
      "Hosted runner container identity did not match the runtime invocation user.",
    );
    expect(invokedContainerNames).toEqual([]);
  });

  it("accepts an opaque standby target only after its durable binding proves the exact member", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stateStore = createPreparationOwnerFixture();
    const slotName =
      "standby--v-release_1--0123456789abcdef0123456789abcdef";
    const readStandbySlotBinding = vi.fn<
      HostedStandbyRunnerContainerStubLike["readStandbySlotBinding"]
    >(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        claimId: "standby-claim-12345678-1234-4123-8123-123456789abc",
        releaseId: "release_1",
        region: HOSTED_STANDBY_REGION,
        slotName,
        state: "bound",
        userId: TEST_USER_ID,
      };
    });
    const service = createRuntimeInvocationPreparation({
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "release_1" },
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      standbyContainerNamespace: createStandbyNamespace({
        readStandbySlotBinding,
        slotName,
        userId: TEST_USER_ID,
      }),
      stateStore,
    });
    await stateStore.reserveRunnerContainerStopTarget({ runnerContainerName: slotName, userId: TEST_USER_ID });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: slotName,
      userId: TEST_USER_ID,
    });

    const prepared = service.prepareWithFence({
      commandBudget: { deadlineAtMs: Date.now() + 1_000 },
      input: {
        orchestrationAttemptId: "orchestration_attempt_1",
        userId: TEST_USER_ID,
      },
      token,
    });
    await vi.waitFor(() => expect(readStandbySlotBinding).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(300);
    await expect(prepared).resolves.toMatchObject({ runnerContainerName: slotName });

    const mismatchedService = createRuntimeInvocationPreparation({
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "release_1" },
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      standbyContainerNamespace: createStandbyNamespace({
        slotName,
        userId: "member_456",
      }),
      stateStore,
    });
    await expect(mismatchedService.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_2",
        userId: TEST_USER_ID,
      },
      token,
    })).rejects.toThrow(
      "Hosted standby slot binding did not match the runtime invocation user.",
    );
  });

});

class TestRunnerStoreCache extends RunnerStoreCache {
  private readonly source: Readonly<Record<string, unknown>>;
  private readonly runnerSecrets = new EmptyRunnerSecretsService();

  constructor(source: Readonly<Record<string, unknown>>) {
    super({
      bucket: createEmptyR2Bucket(),
      env: createHostedExecutionEnvironment(),
      runnerRuntimeEnvSource: source,
    });
    this.source = source;
  }

  override async ensure(userId: string): Promise<RunnerUserStores> {
    const cryptoContext = await createTestHostedRuntimeCryptoContext(userId);
    const rootKeyId = "udrk:runtime:test-root";
    const rootKey = getTestHostedRuntimeRootKey("runtime");
    return {
      crypto: {
        cacheMaxAgeMs: 60_000,
        cryptoContextVersion: null,
        domain: "runtime",
        envelope: cryptoContext.envelopes.runtime,
        fetchedAtMs: Date.now(),
        keysById: {
          [rootKeyId]: rootKey,
        },
        resolveKeyById: async (keyId) => keyId === rootKeyId ? rootKey : null,
        rootKey,
        rootKeyId,
      },
      runnerSecrets: this.runnerSecrets,
      userId,
    };
  }

  override readRuntimeConfigSource(): Readonly<Record<string, string | undefined>> {
    return Object.fromEntries(
      Object.entries(this.source).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      ),
    );
  }
}

class EmptyRunnerSecretsService extends RunnerSecretsService {
  constructor() {
    const rootKey = new Uint8Array(32);
    super(
      createEmptyR2Bucket(),
      rootKey,
      "test-root",
      { "test-root": rootKey },
      async () => null,
      {},
    );
  }

  override async readRunnerSecrets(): Promise<Record<string, string>> {
    return {};
  }
}

function createRuntimeInvocationPreparation(input: {
  runnerContainerNamespace?: HostedExecutionContainerNamespaceLike;
  beforeWorkspaceRead?: () => Promise<void>;
  hostedAssistantCustomInferenceOverride?: HostedAssistantCustomInferenceOverride;
  hostedAssistantPriorityUntil?: string;
  hostedAssistantModelOverride?: HostedAssistantModelOverride;
  hostedAssistantProviderOverride?: HostedAssistantProviderOverride;
  hostedAssistantReasoningEffortOverride?: HostedAssistantReasoningEffortOverride;
  hostedAssistantSubagentModelOverridesAllowed?: boolean;
  invokedContainerNames: string[];
  platformAiUsageAllowed?: boolean;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  standbyContainerNamespace?: HostedStandbyRunnerContainerNamespaceLike;
  stateStore: ReturnType<typeof createPreparationOwnerFixture>;
  workspace?: HostedWorkspaceState | null;
}): RuntimeInvocationPreparation {
  return new RuntimeInvocationPreparation({
    assertWorkspaceBelongsToRunnerUser(workspace, userId) {
      if (workspace && workspace.userId !== userId) {
        throw new Error("Workspace belonged to a different user.");
      }
    },
    env: createHostedExecutionEnvironment(),
    readHostedWebControlBaseUrl: () => "https://web.example.test",
    readHostedWorkspaceFromWeb: async () => {
      await input.beforeWorkspaceRead?.();
      return ({
      fetchedAt: FIXED_NOW,
      ...(input.hostedAssistantPriorityUntil
        ? { hostedAssistantPriorityUntil: input.hostedAssistantPriorityUntil }
        : {}),
      ...(input.platformAiUsageAllowed === undefined
        ? {}
        : { platformAiUsageAllowed: input.platformAiUsageAllowed }),
      ...(input.hostedAssistantCustomInferenceOverride
        ? {
            hostedAssistantCustomInferenceOverride:
              input.hostedAssistantCustomInferenceOverride,
            ...(input.platformAiUsageAllowed === undefined
              ? { platformAiUsageAllowed: false }
              : {}),
          }
        : {}),
      ...(input.hostedAssistantModelOverride
        ? { hostedAssistantModelOverride: input.hostedAssistantModelOverride }
        : {}),
      ...(input.hostedAssistantProviderOverride
        ? { hostedAssistantProviderOverride: input.hostedAssistantProviderOverride }
        : {}),
      ...(input.hostedAssistantReasoningEffortOverride
        ? {
            hostedAssistantReasoningEffortOverride:
              input.hostedAssistantReasoningEffortOverride,
          }
        : {}),
      ...(input.hostedAssistantSubagentModelOverridesAllowed === undefined
        ? {}
        : {
            hostedAssistantSubagentModelOverridesAllowed:
              input.hostedAssistantSubagentModelOverridesAllowed,
          }),
      workspace: input.workspace ?? null,
      });
    },
    runnerContainerNamespace: input.runnerContainerNamespace ?? createHostedRunnerContainerNamespaceRouter({
      exactUser: createRunnerContainerNamespace({ invokedContainerNames: input.invokedContainerNames }),
      standby: input.standbyContainerNamespace ?? null,
    }),
    runnerRuntimeEnvSource: input.runnerRuntimeEnvSource,
    runnerStoreCache: new TestRunnerStoreCache(input.runnerRuntimeEnvSource),
    bindInvocation: input.stateStore.bindInvocation,
  });
}

function createStandbyNamespace(input: {
  readStandbySlotBinding?: HostedStandbyRunnerContainerStubLike["readStandbySlotBinding"];
  resolveRetainedStandbySlot?: HostedStandbyRunnerContainerStubLike[
    "resolveRetainedStandbySlot"
  ];
  slotName: string;
  userId: string;
}): HostedStandbyRunnerContainerNamespaceLike {
  return {
    getByName(name) {
      return {
        async bindStandbySlot(binding) {
          return { bound: true, ...binding };
        },
        async destroyInstance() {},
        async invoke() {
          throw new Error("Invocation was not expected in this test.");
        },
        async prepareStandbySlot(preparation) {
          return { prepared: true, ...preparation };
        },
        async readStandbySlotBinding() {
          if (input.readStandbySlotBinding) {
            return await input.readStandbySlotBinding();
          }
          return {
            claimId: "standby-claim-12345678-1234-4123-8123-123456789abc",
            releaseId: "release_1",
            region: HOSTED_STANDBY_REGION,
            slotName: input.slotName,
            state: "bound" as const,
            userId: input.userId,
          };
        },
        async readStandbySlotCoordinatorState() {
          return {
            coordinatorOwned: false,
            releaseId: "release_1",
            slotName: input.slotName,
            state: "bound" as const,
          };
        },
        async resolveRetainedStandbySlot(resolution) {
          if (input.resolveRetainedStandbySlot) {
            return await input.resolveRetainedStandbySlot(resolution);
          }
          return {
            claimId: "standby-claim-12345678-1234-4123-8123-123456789abc",
            releaseId: resolution.currentReleaseId,
            region: resolution.region,
            slotName: resolution.slotName,
            state: "bound" as const,
            userId: resolution.userId,
          };
        },
        async retireStandbySlot() {
          return { retired: true } as const;
        },
        async smokeHealth() {
          return {
            ok: true,
            runnerBundle: null,
            service: "test",
            status: 200,
          };
        },
      };
    },
  };
}

function createHostedExecutionEnvironment() {
  return readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "54000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "35000",
  }));
}

function createRunnerContainerNamespace(input: {
  ensuredContainerNames?: string[];
  invokedContainerNames?: string[];
  readyContainerNames?: string[];
}): HostedExecutionContainerNamespaceLike {
  const stubs = new Map<string, HostedExecutionContainerStubLike>();
  return {
    getByName(name) {
      const existing = stubs.get(name);
      if (existing) return existing;
      const stub = createRunnerContainerStub({
        ensuredContainerNames: input.ensuredContainerNames,
        name,
        invokedContainerNames: input.invokedContainerNames,
        readyContainerNames: input.readyContainerNames,
      });
      stubs.set(name, stub);
      return stub;
    },
  };
}

function createRunnerContainerStub(input: {
  ensuredContainerNames?: string[];
  invokedContainerNames?: string[];
  name: string;
  readyContainerNames?: string[];
}): HostedExecutionContainerStubLike {
  const bindings = new RunnerSlotBindingStore(createTestSqlStorage());
  let warm = false;
  return {
    async bindStandbySlot(claim) {
      bindings.initialize(claim);
      bindings.bind(claim);
      return { bound: true, ...claim };
    },
    async prepareStandbySlot(preparation) {
      bindings.initialize(preparation);
      warm = true;
      return { prepared: true, ...preparation };
    },
    async readStandbySlotBinding() { return bindings.read(); },
    async readStandbySlotCoordinatorState() {
      const binding = bindings.read();
      return { coordinatorOwned: binding.userId === null, releaseId: binding.releaseId, slotName: binding.slotName, state: binding.state };
    },
    async resolveRetainedStandbySlot(request) {
      const binding = bindings.read();
      if (binding.state === "bound" && warm && binding.releaseId === request.currentReleaseId) return binding;
      bindings.beginRetirement(binding.claimId === null ? {} : { claimId: binding.claimId });
      bindings.finishRetirement();
      return bindings.read();
    },
    async retireStandbySlot(request) {
      const binding = bindings.read();
      bindings.beginRetirement(request.claimId ? { claimId: request.claimId } : binding.claimId ? { claimId: binding.claimId } : {});
      bindings.finishRetirement();
      warm = false;
      return { retired: true };
    },
    destroyInstance: async () => { warm = false; },
    ensureReadyForProcessing: async () => {
      warm = true;
      input.readyContainerNames?.push(input.name);
      return { kind: "ready" };
    },
    ...(input.ensuredContainerNames
      ? {
          ensureProcessing: async () => {
            input.ensuredContainerNames?.push(input.name);
            return {
              action: "already_running",
              kind: "accepted",
            };
          },
        }
      : {}),
    invoke: async () => {
      input.invokedContainerNames?.push(input.name);
      return {
        nextWakeAt: null,
        status: "idle",
      };
    },
    smokeHealth: async () => ({
      ok: true,
      runnerBundle: null,
      service: "runner",
      status: 200,
    }),
  };
}

function createEmptyR2Bucket(): R2BucketLike {
  return {
    get: async () => null,
    put: async () => {},
  };
}

function createVoidGate(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function createPreparationOwnerFixture() {
  let token: RunnerWriteFenceToken | null = null;
  let bound: { platformAiUsageAllowed: boolean | null; customInferenceEnvelope: string | null } | null = null;
  return {
    reserveRunnerContainerStopTarget: async (_input: { runnerContainerName: string; userId: string }) => true,
    async beginWriteFence(input: { runnerContainerName?: string; userId: string; processingMode?: RunnerWriteFenceToken["processingMode"] }): Promise<RunnerWriteFenceToken> {
      token = { attemptId: "synthetic-attempt", generation: "1", kind: "runtime", processingMode: input.processingMode ?? "default", providerEgressToken: "synthetic-egress-token", runnerContainerName: input.runnerContainerName ?? null, startedAt: FIXED_NOW, userId: input.userId, workspaceVersion: null };
      return token;
    },
    readWriteFenceToken: async (_userId?: string) => token,
    bindInvocation: async (input: Parameters<ConstructorParameters<typeof RuntimeInvocationPreparation>[0]["bindInvocation"]>[0]) => {
      bound = input;
      token = { ...input.token, workspaceVersion: input.workspaceVersion, processingMode: input.processingMode ?? input.token.processingMode };
      return token;
    },
    readBoundInvocation: async (_input: unknown) => bound,
  };
}
