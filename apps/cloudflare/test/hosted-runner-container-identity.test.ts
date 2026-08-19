import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  type HostedAssistantModelOverride,
  type HostedAssistantProviderOverride,
  type HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
import type {
  HostedAssistantCustomInferenceOverride,
} from "@murphai/hosted-execution/assistant-inference";

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
  buildHostedRunnerJobRuntimeConfig,
} from "../src/runner-env.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.js";
import {
  RunnerSecretsService,
} from "../src/user-runner/runner-secrets.js";
import {
  RunnerStateStore,
  type RunnerWriteFenceToken,
} from "../src/user-runner/runner-state-store.js";
import {
  RuntimeInvocationService,
  type PreparedRuntimeInvocation,
} from "../src/user-runner/runtime-invocation.js";
import {
  RuntimeProcessingController,
} from "../src/user-runner/runtime-processing-controller.js";
import {
  openHostedInferenceRuntimeTarget,
} from "../src/hosted-inference-target-envelope.js";
import {
  RunnerStoreCache,
  type RunnerUserStores,
} from "../src/user-runner/runner-store-cache.js";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.js";
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

const FIXED_NOW = "2026-06-03T00:00:00.000Z";
const TEST_USER_ID = "member_123";
describe("hosted runner container identity", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("stores the helper-derived versioned runner container name in the runtime write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invocationService = new RecordingRuntimeInvocationService();
    const readyContainerNames: string[] = [];
    const runnerRuntimeEnvSource = {
      CF_VERSION_METADATA: {
        id: "worker version/current",
      },
    };
    const controller = new RuntimeProcessingController({
      env: createHostedExecutionEnvironment(),
      invocationService,
      runnerContainerNamespace: createRunnerContainerNamespace({
        readyContainerNames,
      }),
      runnerRuntimeEnvSource,
      stateStore,
    });

    await expect(controller.ensureForUser({
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    const expectedRunnerContainerName = "member_123--v-worker-version-current";
    expect(invocationService.prepareTokens).toHaveLength(1);
    expect(invocationService.prepareTokens[0]?.runnerContainerName)
      .toBe(expectedRunnerContainerName);
    expect(readyContainerNames).toEqual([expectedRunnerContainerName]);
    await expect(stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        runnerContainerName: expectedRunnerContainerName,
        userId: TEST_USER_ID,
      }),
    );
  });

  it("fails closed when runtime start parses a different user from the helper-derived name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invocationService = new RecordingRuntimeInvocationService();
    const readyContainerNames: string[] = [];
    const controller = new RuntimeProcessingController({
      env: createHostedExecutionEnvironment(),
      invocationService,
      runnerContainerNamespace: createRunnerContainerNamespace({
        readyContainerNames,
      }),
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
      },
      stateStore,
    });

    await expect(controller.ensureForUser({
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: " member_123 ",
    })).rejects.toThrow(
      "Hosted runner container identity did not match the runtime start user.",
    );

    expect(invocationService.prepareTokens).toHaveLength(0);
    expect(readyContainerNames).toEqual([]);
    await expect(stateStore.readWriteFenceToken()).resolves.toBeNull();
  });

  it("uses the write-fence token's stored runner container name for runtime invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invokedContainerNames: string[] = [];
    const runnerRuntimeEnvSource = {
      CF_VERSION_METADATA: {
        id: "version_1",
      },
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      OPENAI_API_KEY: "test-openai-key",
    };
    const service = createRuntimeInvocationService({
      invokedContainerNames,
      runnerRuntimeEnvSource,
      stateStore,
      state: durable.state,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_1",
        userId: TEST_USER_ID,
      },
      token,
    });
    expect(prepared.runnerContainerName).toBe("member_123--v-version_1");

    await expect(service.invokePreparedWithFence({
      acceptedProcessingAttempt: false,
      prepared,
      runtimeWakeStartedAt: Date.now(),
    })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invokedContainerNames).toEqual(["member_123--v-version_1"]);
  });

  it.each([
    {
      expectedModel: HOSTED_ASSISTANT_LUNA_MODEL,
      fleetModel: HOSTED_ASSISTANT_TERRA_MODEL,
      hostedAssistantModelOverride: HOSTED_ASSISTANT_LUNA_MODEL,
      name: "applies the saved Luna choice",
    },
    {
      expectedModel: HOSTED_ASSISTANT_SOL_MODEL,
      fleetModel: HOSTED_ASSISTANT_TERRA_MODEL,
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
      expectedModel: HOSTED_ASSISTANT_TERRA_MODEL,
      fleetModel: HOSTED_ASSISTANT_TERRA_MODEL,
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
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const service = createRuntimeInvocationService({
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
      state: durable.state,
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

  it("applies Venice per member while retaining a scoped OpenAI tool credential", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const sourceOpenAiKey = "test-openai-key";
    const sourceVeniceKey = "test-venice-key";
    const service = createRuntimeInvocationService({
      hostedAssistantProviderOverride: "venice",
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_TERRA_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: sourceOpenAiKey,
        VENICE_API_KEY: sourceVeniceKey,
      },
      stateStore,
      state: durable.state,
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

  it("projects the saved reasoning effort into the next runtime invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const service = createRuntimeInvocationService({
      hostedAssistantReasoningEffortOverride: "xhigh",
      invokedContainerNames: [],
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_TERRA_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_ASSISTANT_REASONING_EFFORT: "low",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
      state: durable.state,
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
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const override: HostedAssistantCustomInferenceOverride = {
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r7",
      protocol: "responses",
      revision: 7,
      supportsImages: false,
      verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
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
      HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_TERRA_MODEL,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      OPENAI_API_KEY: "test-openai-key",
    };
    const service = createRuntimeInvocationService({
      hostedAssistantCustomInferenceOverride: override,
      invokedContainerNames: [],
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource,
      stateStore,
      state: durable.state,
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
    expect(JSON.stringify(prepared.job)).not.toContain(runtimeTarget.endpointUrl);
    expect(JSON.stringify(prepared.job)).not.toContain(runtimeTarget.auth.secret);

    if (!token.providerEgressToken) {
      throw new Error("Expected a provider egress token on the active fence.");
    }
    const validation = await stateStore.validateProviderEgressToken({
      providerEgressToken: token.providerEgressToken,
      userId: TEST_USER_ID,
    });
    expect(validation).toMatchObject({ owns: true });
    if (!validation.owns || !validation.customInferenceEnvelope) {
      throw new Error("Expected the selected custom target on the active fence.");
    }
    await expect(openHostedInferenceRuntimeTarget({
      envelope: validation.customInferenceEnvelope,
      source: runnerRuntimeEnvSource,
    })).resolves.toEqual(runtimeTarget);
  });

  it("narrows a denied managed default wake to model-free system mailbox work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invokedContainerNames: string[] = [];
    const service = createRuntimeInvocationService({
      invokedContainerNames,
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_TERRA_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
      state: durable.state,
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
    await expect(stateStore.validateProviderEgressToken({
      providerEgressToken: prepared.token.providerEgressToken,
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      owns: true,
      platformAiUsageAllowed: false,
    });
  });

  it("keeps a due delivery-only wake on its outbox-owning phase while metered egress stays denied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const service = createRuntimeInvocationService({
      invokedContainerNames: [],
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_TERRA_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
      state: durable.state,
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
    await expect(stateStore.validateProviderEgressToken({
      providerEgressToken: prepared.token.providerEgressToken,
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      owns: true,
      platformAiUsageAllowed: false,
    });
  });

  it("lets inbox media retention run under a denied allowance while metered egress stays blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const service = createRuntimeInvocationService({
      invokedContainerNames: [],
      platformAiUsageAllowed: false,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "version_1" },
        HOSTED_ASSISTANT_MODEL: HOSTED_ASSISTANT_TERRA_MODEL,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "provider-egress-signing-secret",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
      state: durable.state,
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
    const validation = await stateStore.validateProviderEgressToken({
      providerEgressToken: token.providerEgressToken,
      userId: TEST_USER_ID,
    });
    expect(validation).toMatchObject({
      owns: true,
      platformAiUsageAllowed: false,
    });
  });

  it("wakes an active runtime through the write fence's stored runner container name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    await stateStore.bindUser(TEST_USER_ID);
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version-a",
      userId: TEST_USER_ID,
    });
    const ensuredContainerNames: string[] = [];
    const controller = new RuntimeProcessingController({
      env: createHostedExecutionEnvironment(),
      invocationService: new RecordingRuntimeInvocationService(),
      runnerContainerNamespace: createRunnerContainerNamespace({
        ensuredContainerNames,
      }),
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version-b",
        },
      },
      stateStore,
    });

    await expect(controller.ensureForUser({
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "already_running",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: token.attemptId,
    });

    expect(ensuredContainerNames).toEqual(["member_123--v-version-a"]);
  });

  it("fails closed when runtime invocation parses a different user from the write-fence token name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invokedContainerNames: string[] = [];
    const service = createRuntimeInvocationService({
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
      state: durable.state,
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
});

class RecordingRuntimeInvocationService extends RuntimeInvocationService {
  readonly prepareTokens: RunnerWriteFenceToken[] = [];

  constructor() {
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    super({
      assertWorkspaceBelongsToRunnerUser() {},
      env: createHostedExecutionEnvironment(),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [],
        userId,
        workspace: null,
      }),
      readHostedWebControlBaseUrl: () => "https://web.example.test",
      readHostedWorkspaceFromWeb: async () => ({
        fetchedAt: FIXED_NOW,
        workspace: null,
      }),
      runnerContainerNamespace: createRunnerContainerNamespace({}),
      runnerRuntimeEnvSource: {},
      runnerStoreCache: new TestRunnerStoreCache({}),
      stateStore,
    });
  }

  override async prepareWithFence(input: {
    input: PreparedRuntimeInvocation["input"];
    token: RunnerWriteFenceToken;
  }): Promise<PreparedRuntimeInvocation> {
    this.prepareTokens.push(input.token);
    return {
      input: input.input,
      job: createWorkspaceInvocationJob({
        token: input.token,
        userId: input.input.userId,
      }),
      runnerContainerName: input.token.runnerContainerName ?? input.input.userId,
      token: input.token,
      workspaceCheckpointedAt: null,
      workspaceVersion: "0",
    };
  }

  override async invokePreparedWithFence(): Promise<HostedWorkspaceInvocationResult> {
    return {
      nextWakeAt: null,
      status: "idle",
    };
  }
}

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

function createRuntimeInvocationService(input: {
  hostedAssistantCustomInferenceOverride?: HostedAssistantCustomInferenceOverride;
  hostedAssistantModelOverride?: HostedAssistantModelOverride;
  hostedAssistantProviderOverride?: HostedAssistantProviderOverride;
  hostedAssistantReasoningEffortOverride?: HostedAssistantReasoningEffortOverride;
  invokedContainerNames: string[];
  platformAiUsageAllowed?: boolean;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  state: DurableObjectStateLike;
  stateStore: RunnerStateStore;
  workspace?: HostedWorkspaceState | null;
}): RuntimeInvocationService {
  return new RuntimeInvocationService({
    assertWorkspaceBelongsToRunnerUser(workspace, userId) {
      if (workspace && workspace.userId !== userId) {
        throw new Error("Workspace belonged to a different user.");
      }
    },
    env: createHostedExecutionEnvironment(),
    readHostedRuntimeStatusFromWeb: async (userId) => ({
      mailboxLag: [],
      userId,
      workspace: input.workspace ?? null,
    }),
    readHostedWebControlBaseUrl: () => "https://web.example.test",
    readHostedWorkspaceFromWeb: async () => ({
      fetchedAt: FIXED_NOW,
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
      workspace: input.workspace ?? null,
    }),
    runnerContainerNamespace: createRunnerContainerNamespace({
      invokedContainerNames: input.invokedContainerNames,
    }),
    runnerRuntimeEnvSource: input.runnerRuntimeEnvSource,
    runnerStoreCache: new TestRunnerStoreCache(input.runnerRuntimeEnvSource),
    stateStore: input.stateStore,
  });
}

function createHostedExecutionEnvironment() {
  return readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "54000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "35000",
  }));
}

function createRunnerDurableState(): {
  state: DurableObjectStateLike;
} {
  const sql = createTestSqlStorage();
  const values = new Map<string, unknown>();
  const storage: DurableObjectStorageLike = {
    delete: async (key) => values.delete(key),
    deleteAlarm: async () => {},
    get: async <T,>(key: string): Promise<T | undefined> =>
      values.get(key) as T | undefined,
    getAlarm: async () => null,
    put: async <T,>(key: string, value: T): Promise<void> => {
      values.set(key, value);
    },
    setAlarm: async () => {},
    sql,
  };
  return {
    state: {
      storage,
      waitUntil() {},
    },
  };
}

function createRunnerContainerNamespace(input: {
  ensuredContainerNames?: string[];
  invokedContainerNames?: string[];
  readyContainerNames?: string[];
}): HostedExecutionContainerNamespaceLike {
  return {
    getByName(name) {
      return createRunnerContainerStub({
        ensuredContainerNames: input.ensuredContainerNames,
        name,
        invokedContainerNames: input.invokedContainerNames,
        readyContainerNames: input.readyContainerNames,
      });
    },
  };
}

function createRunnerContainerStub(input: {
  ensuredContainerNames?: string[];
  invokedContainerNames?: string[];
  name: string;
  readyContainerNames?: string[];
}): HostedExecutionContainerStubLike {
  return {
    destroyInstance: async () => {},
    ensureReadyForProcessing: async () => {
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

function createWorkspaceInvocationJob(input: {
  token: RunnerWriteFenceToken;
  userId: string;
}): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
    request: {
      attemptId: input.token.attemptId,
      idleCheckpointDelayMs: 54_000,
      leaseGeneration: input.token.generation,
      userId: input.userId,
      workspace: null,
      workspaceVersion: input.token.workspaceVersion ?? "0",
    },
    runtime: buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {},
      runnerSecrets: {},
    }),
  };
}

function createEmptyR2Bucket(): R2BucketLike {
  return {
    get: async () => null,
    put: async () => {},
  };
}
