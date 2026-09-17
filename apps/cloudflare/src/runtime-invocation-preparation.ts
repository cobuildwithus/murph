import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type {
  HostedAssistantModelOverride,
  HostedAssistantProviderOverride,
  HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
import type {
  HostedAssistantCustomInferenceOverride,
} from "@murphai/hosted-execution/assistant-inference";
import {
  HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV,
} from "@murphai/hosted-execution/env";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";

import type {
  HostedRuntimeLatencyPhaseBreakdown,
  HostedWorkspaceInvocationProcessingMode,
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedExecutionEnvironment,
} from "./env.js";
import {
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
  isHostedRunnerVeniceProvider,
} from "./hosted-env-policy.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
import {
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import {
  readHostedRunnerContainerIdentity,
} from "./hosted-runner-container-identity.js";
import {
  hostedRunnerSlotBindingMatchesTarget,
  isHostedRunnerTargetName,
  isHostedStandbyClaimId,
  requireHostedRunnerSlotLifecycle,
  isSupportedHostedRunnerRelease,
  type HostedStandbySlotBinding,
} from "./standby-runner-contract.js";
import {
  createHostedProviderEgressCredential,
} from "./hosted-provider-egress-credential.js";
import {
  parseHostedInferenceRuntimeTarget,
  type HostedInferenceRuntimeTarget,
} from "./hosted-inference-runtime-target.ts";
import {
  sealHostedInferenceRuntimeTarget,
} from "./hosted-inference-target-envelope.ts";
import {
  readHostedProviderCredentialDiagnosticKind,
} from "./hosted-provider-credential-diagnostics.js";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import {
  prepareHostedWorkspaceSnapshotRestore,
  type HostedWorkspaceSnapshotPreparedRestore,
} from "./workspace-snapshot-restore-preparation.ts";


import type {
  RuntimeProcessingCommandBudget,
} from "./user-runner/runtime-command-budget.js";
import {
  isRuntimeProcessingCommandBudgetTimeout,
  readRuntimeProcessingCommandStepTimeoutMs,
  runRuntimeProcessingCommandStep,
} from "./user-runner/runtime-command-budget.js";

import type {
  RunnerWriteFenceToken,
} from "./user-runner/runner-state-store.js";

import {
  RunnerStoreCache,
  type RunnerUserStores,
} from "./user-runner/runner-store-cache.js";


const HOSTED_INFERENCE_RUNTIME_TARGET_MAX_BODY_BYTES = 16 * 1024;
const HOSTED_INFERENCE_RUNTIME_TARGET_PATH = "/api/internal/hosted-inference/resolve";
const HOSTED_RUNNER_NATIVE_PROVIDER_EGRESS_ENV = {
  EXA_API_KEY: "exa",
  MAPBOX_ACCESS_TOKEN: "mapbox",
  MURPH_DATA_API_KEY: "murph_data_api",
  OPENAI_API_KEY: "openai",
  VENICE_API_KEY: "venice",
} as const;
const HOSTED_RUNNER_WORKERS_AI_TRANSCRIBE_PROVIDER_KIND = "workers_ai_transcribe";
const HOSTED_CUSTOM_INFERENCE_PROVIDER = "hosted-custom-inference";
const HOSTED_CUSTOM_INFERENCE_API_KEY_ENV = "MURPH_CUSTOM_INFERENCE_API_KEY";
const HOSTED_CUSTOM_INFERENCE_CONTEXT_WINDOW_ENV =
  "HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS";

type HostedRunnerNativeProviderCredentialEnvName =
  keyof typeof HOSTED_RUNNER_NATIVE_PROVIDER_EGRESS_ENV;

const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT =
  "murph.hosted.workspace-snapshot-path-hash.v1";
const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER = new TextEncoder();

export type RuntimeInvocationInput = {
  assistantExecutionBlocked?: true;
  orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
  orchestrationAttemptId: string;
  processingMode?: HostedWorkspaceInvocationProcessingMode | null;
  userId: string;
};

interface RuntimeInvocationPreparationInputs {
  workspaceRead: HostedWorkspaceReadResponse;
  workspaceReadElapsedMs: number;
  stores: RunnerUserStores;
  runtimeStoreEnsureElapsedMs: number;
}

export interface PreparedRuntimeInvocation {
  input: RuntimeInvocationInput;
  job: HostedExecutionWorkspaceInvocationJobInput;
  runnerContainerName: string;
  token: RunnerWriteFenceToken;
  workspaceCheckpointedAt: string | null;
  workspaceVersion: string;
}

export class RuntimeInvocationPreparation {
  constructor(private readonly input: {
    env: HostedExecutionEnvironment;
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
    runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
    runnerStoreCache: RunnerStoreCache;
    assertWorkspaceBelongsToRunnerUser(workspace: HostedWorkspaceState | null, userId: string): void;
    readHostedWebControlBaseUrl(): string;
    readHostedWorkspaceFromWeb(userId: string, input?: { timeoutMs?: number }): Promise<HostedWorkspaceReadResponse>;
    bindInvocation(input: {
      customInferenceEnvelope: string | null;
      platformAiUsageAllowed: boolean | null;
      processingMode?: HostedWorkspaceInvocationProcessingMode | null;
      token: RunnerWriteFenceToken;
      workspaceVersion: string;
    }): Promise<RunnerWriteFenceToken>;
  }) {}

  prepareForFreshStart(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    input: RuntimeInvocationInput;
  }): (token: RunnerWriteFenceToken, verifiedSlotBinding?: HostedStandbySlotBinding) => Promise<PreparedRuntimeInvocation> {
    const preparationInputs = this.prepareInputs(input);
    // Allocation can fail before consuming the reads. Observe rejection while
    // their original request deadlines bound any remaining read-only work.
    void preparationInputs.catch(() => undefined);
    return (token, verifiedSlotBinding) => this.prepareWithInputs({ ...input, token }, preparationInputs, verifiedSlotBinding);
  }

  private async prepareInputs(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    input: RuntimeInvocationInput;
  }): Promise<RuntimeInvocationPreparationInputs> {
    const timeoutMs = input.commandBudget
      ? readRuntimeProcessingCommandStepTimeoutMs({
          budget: input.commandBudget,
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        })
      : this.input.env.webControlTimeoutMs;
    const startedAtMs = Date.now();
    let workspaceReadElapsedMs = 0;
    let runtimeStoreEnsureElapsedMs = 0;
    // Both reads are admitted member inputs. Neither grants execution authority;
    // fenced preparation still requires the exact slot and write fence.
    const [workspaceRead, stores] = await Promise.all([
      this.input.readHostedWorkspaceFromWeb(input.input.userId, { timeoutMs })
        .finally(() => { workspaceReadElapsedMs = Math.max(0, Date.now() - startedAtMs); }),
      this.input.runnerStoreCache.ensure(input.input.userId, { webControlTimeoutMs: timeoutMs })
        .finally(() => { runtimeStoreEnsureElapsedMs = Math.max(0, Date.now() - startedAtMs); }),
    ]);
    this.input.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, input.input.userId);
    if (stores.userId !== input.input.userId) {
      throw new Error("Hosted runtime preparation stores belong to another user.");
    }
    return {
      workspaceRead,
      workspaceReadElapsedMs,
      stores,
      runtimeStoreEnsureElapsedMs,
    };
  }

  async prepareWithFence(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
  }): Promise<PreparedRuntimeInvocation> {
    return this.prepareWithInputs(input, this.prepareInputs(input));
  }

  private async prepareWithInputs(
    input: Parameters<RuntimeInvocationPreparation["prepareWithFence"]>[0],
    preparationInputs: Promise<RuntimeInvocationPreparationInputs>,
    verifiedSlotBinding?: HostedStandbySlotBinding,
  ): Promise<PreparedRuntimeInvocation> {
    const preparationStartedAtMs = Date.now();
    const preparation = await preparationInputs;
    if (input.commandBudget) {
      readRuntimeProcessingCommandStepTimeoutMs({
        budget: input.commandBudget,
        stepTimeoutMs: this.input.env.webControlTimeoutMs,
      });
    }
    const { workspaceRead, workspaceReadElapsedMs, stores, runtimeStoreEnsureElapsedMs } = preparation;
    const workspaceVersion = workspaceRead.workspace?.version ?? "0";
    const hostedAssistantCustomInferenceOverride =
      workspaceRead.hostedAssistantCustomInferenceOverride ?? null;
    const hostedAssistantSubagentModelOverridesAllowed =
      hostedAssistantCustomInferenceOverride === null
      && workspaceRead.hostedAssistantSubagentModelOverridesAllowed === true;
    const customInferenceTarget = hostedAssistantCustomInferenceOverride
      ? await this.readHostedInferenceRuntimeTargetFromWeb({
          override: hostedAssistantCustomInferenceOverride,
          timeoutMs: input.commandBudget
            ? readRuntimeProcessingCommandStepTimeoutMs({
                budget: input.commandBudget,
                stepTimeoutMs: this.input.env.webControlTimeoutMs,
              })
            : this.input.env.webControlTimeoutMs,
          userId: input.input.userId,
        })
      : null;
    const { platformAiUsageAllowed, assistantExecutionBlocked, invocationProcessingMode } =
      resolveInvocationAdmission(workspaceRead, input.input, Boolean(hostedAssistantCustomInferenceOverride));
    const customInferenceEnvelope = customInferenceTarget
      ? await sealHostedInferenceRuntimeTarget({
          source: this.input.runnerRuntimeEnvSource,
          target: customInferenceTarget,
        })
      : null;
    const token = await this.input.bindInvocation({
      customInferenceEnvelope,
      platformAiUsageAllowed,
      processingMode: invocationProcessingMode,
      token: input.token,
      workspaceVersion,
    });
    const workspaceRunnerInvocation = await this.prepareWorkspaceRunnerInvocation({
      stores,
      verifiedSlotBinding,
      commandBudget: input.commandBudget,
      hostedAssistantCustomInferenceOverride,
      hostedAssistantModelOverride:
        workspaceRead.hostedAssistantModelOverride ?? null,
      hostedAssistantProviderOverride:
        workspaceRead.hostedAssistantProviderOverride ?? null,
      hostedAssistantReasoningEffortOverride:
        workspaceRead.hostedAssistantReasoningEffortOverride ?? null,
      hostedAssistantSubagentModelOverridesAllowed,
      assistantExecutionBlocked,
      processingMode: invocationProcessingMode,
      token,
      userId: input.input.userId,
      workspace: workspaceRead.workspace,
      workspaceVersion,
    });

    return {
      input: {
        ...input.input,
        orchestration: {
          ...(input.input.orchestration ?? {}),
          runtimeInvocationPreparationElapsedMs:
            Math.max(0, Date.now() - preparationStartedAtMs),
          runtimeStoreEnsureElapsedMs,
          workspaceReadElapsedMs,
        },
      },
      ...workspaceRunnerInvocation,
      token,
      workspaceCheckpointedAt:
        workspaceRead.workspace?.checkpointedAt ?? null,
      workspaceVersion,
    };
  }

  private async readHostedInferenceRuntimeTargetFromWeb(input: {
    override: HostedAssistantCustomInferenceOverride;
    timeoutMs: number;
    userId: string;
  }): Promise<HostedInferenceRuntimeTarget> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.input.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.input.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.input.readHostedWebControlBaseUrl(),
      boundUserId: input.userId,
      callbackSigning: this.input.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_INFERENCE_RUNTIME_TARGET_PATH,
      search: `?revision=${input.override.revision}`,
      timeoutMs: input.timeoutMs,
    });
    if (!response.ok) {
      throw new Error(
        `Hosted custom inference resolution failed with HTTP ${response.status}.`,
      );
    }
    const text = await response.text();
    if (
      new TextEncoder().encode(text).byteLength
      > HOSTED_INFERENCE_RUNTIME_TARGET_MAX_BODY_BYTES
    ) {
      throw new RangeError("Hosted custom inference resolution response was too large.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TypeError("Hosted custom inference resolution response was invalid.");
    }
    const target = parseHostedInferenceRuntimeTarget(parsed);
    if (
      target.contextWindowTokens !== input.override.contextWindowTokens
      || target.protocol !== input.override.protocol
      || target.revision !== input.override.revision
      || target.supportsImages !== input.override.supportsImages
      || target.verificationProfile !== input.override.verificationProfile
    ) {
      throw new Error("Hosted custom inference resolution did not match workspace projection.");
    }
    return target;
  }

  private async prepareWorkspaceRunnerInvocation(input: {
    assistantExecutionBlocked: boolean;
    commandBudget?: RuntimeProcessingCommandBudget;
    hostedAssistantCustomInferenceOverride:
      HostedAssistantCustomInferenceOverride | null;
    hostedAssistantModelOverride: HostedAssistantModelOverride | null;
    hostedAssistantProviderOverride: HostedAssistantProviderOverride | null;
    hostedAssistantReasoningEffortOverride:
      HostedAssistantReasoningEffortOverride | null;
    hostedAssistantSubagentModelOverridesAllowed: boolean;
    processingMode?: HostedWorkspaceInvocationProcessingMode | null;
    stores: RunnerUserStores;
    verifiedSlotBinding?: HostedStandbySlotBinding;
    token: RunnerWriteFenceToken;
    userId: string;
    workspace: HostedWorkspaceState | null;
    workspaceVersion: string;
  }): Promise<{
    job: HostedExecutionWorkspaceInvocationJobInput;
    runnerContainerName: string;
  }> {
    if (!this.input.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.input.runnerRuntimeEnvSource,
    );
    forwardedEnv[HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV] =
      input.hostedAssistantSubagentModelOverridesAllowed ? "1" : "0";
    if (input.hostedAssistantCustomInferenceOverride !== null) {
      forwardedEnv.HOSTED_ASSISTANT_PROVIDER = HOSTED_CUSTOM_INFERENCE_PROVIDER;
      forwardedEnv.HOSTED_ASSISTANT_MODEL =
        input.hostedAssistantCustomInferenceOverride.modelAlias;
      forwardedEnv[HOSTED_CUSTOM_INFERENCE_API_KEY_ENV] =
        HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
      forwardedEnv[HOSTED_CUSTOM_INFERENCE_CONTEXT_WINDOW_ENV] =
        String(input.hostedAssistantCustomInferenceOverride.contextWindowTokens);
      delete forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT;
    } else {
      if (input.hostedAssistantProviderOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_PROVIDER =
          input.hostedAssistantProviderOverride;
      }
      if (input.hostedAssistantModelOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_MODEL =
          input.hostedAssistantModelOverride;
      }
      if (input.hostedAssistantReasoningEffortOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT =
          input.hostedAssistantReasoningEffortOverride;
      }
    }
    const configSource = this.input.runnerStoreCache.readRuntimeConfigSource();
    const stores = input.stores;
    const readRunnerSecrets = async () =>
      await stores.runnerSecrets.readRunnerSecrets(input.userId);
    const emitSnapshotRestorePreparationUnavailableLog = (error: unknown): void => {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          runtimeSnapshotRestorePreparationFailureCode:
            deriveHostedExecutionErrorCode(error),
          workspaceAttemptId: input.token.attemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted workspace snapshot restore preparation unavailable.",
        phase: "wake.running",
        userId: input.userId,
      });
    };
    const prepareSnapshotRestore = async () =>
      await prepareHostedWorkspaceSnapshotRestore({
        configSource,
        crypto: stores.crypto,
        onPreparationUnavailable: emitSnapshotRestorePreparationUnavailableLog,
        userId: input.userId,
        workspace: input.workspace,
      });
    const [runnerSecrets, workspaceSnapshotPathHashSecret, preparedSnapshotRestore, runnerContainerName] =
      await Promise.all([
        input.commandBudget
          ? runRuntimeProcessingCommandStep({
              budget: input.commandBudget,
              operation: readRunnerSecrets,
              stepTimeoutMs: this.input.env.webControlTimeoutMs,
            })
          : readRunnerSecrets(),
        deriveHostedWorkspaceSnapshotPathHashSecret(configSource),
        runHostedWorkspaceSnapshotRestorePreparationWithinBudget({
          budget: input.commandBudget ?? null,
          onBudgetTimeout: emitSnapshotRestorePreparationUnavailableLog,
          operation: prepareSnapshotRestore,
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        }),
        this.resolveInvocationRunnerContainerName({
          verifiedSlotBinding: input.verifiedSlotBinding,
          commandBudget: input.commandBudget ?? null,
          runnerContainerName: input.token.runnerContainerName,
          userId: input.userId,
        }),
      ]);
    const openAiCredentialBeforeMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.OPENAI_API_KEY);
    const veniceCredentialBeforeMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.VENICE_API_KEY);
    let openAiProviderCredentialMinted = false;
    let veniceProviderCredentialMinted = false;
    const createProviderCredential = async (providerKind: string) =>
      await createHostedProviderEgressCredential({
        providerKind,
        runnerContainerName,
        source: this.input.runnerRuntimeEnvSource,
        userId: input.userId,
      });
    for (const [envKey, providerKind] of Object.entries(
      HOSTED_RUNNER_NATIVE_PROVIDER_EGRESS_ENV,
    ) as Array<[HostedRunnerNativeProviderCredentialEnvName, string]>) {
      // OpenAI remains available as a separately scoped managed credential for
      // provider-specific tools such as image generation even when core
      // assistant inference runs through Venice.
      if (
        envKey === "VENICE_API_KEY"
        && !isHostedRunnerVeniceProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER)
      ) {
        continue;
      }
      if (typeof forwardedEnv[envKey] === "string" && forwardedEnv[envKey].length > 0) {
        forwardedEnv[envKey] = await createProviderCredential(providerKind);
        if (envKey === "OPENAI_API_KEY") {
          openAiProviderCredentialMinted = true;
        }
        if (envKey === "VENICE_API_KEY") {
          veniceProviderCredentialMinted = true;
        }
      }
    }
    const openAiCredentialAfterMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.OPENAI_API_KEY);
    const veniceCredentialAfterMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.VENICE_API_KEY);
    const workersAiTranscribeProviderEgressCredential = await createProviderCredential(
      HOSTED_RUNNER_WORKERS_AI_TRANSCRIBE_PROVIDER_KIND,
    );
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv,
      providerEgressCredentials: {
        workersAiTranscribe: workersAiTranscribeProviderEgressCredential,
      },
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
    const userEnv = runtimeConfig.userEnv ?? {};
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      ...(workspaceSnapshotPathHashSecret
        ? {
            diagnostics: {
              workspaceSnapshotPathHashSecret,
            },
          }
        : {}),
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      ...(preparedSnapshotRestore ? { preparedSnapshotRestore } : {}),
      request: {
        ...(input.assistantExecutionBlocked
          ? { assistantExecutionBlocked: true as const }
          : {}),
        attemptId: input.token.attemptId,
        runnerIdleTtlMs: this.input.env.runnerIdleTtlMs,
        leaseGeneration: input.token.generation,
        ...(input.processingMode
          ? { processingMode: input.processingMode }
          : {}),
        providerEgressToken: input.token.providerEgressToken,
        userId: input.userId,
        workspace: input.workspace,
        workspaceVersion: input.workspaceVersion,
      },
      runtime: runtimeConfig,
    };

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        assistantExecutionBlocked: input.assistantExecutionBlocked,
        forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
        hostedAssistantProviderConfigured:
          typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string"
          && forwardedEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
        hostedAssistantCustomInferenceConfigured:
          input.hostedAssistantCustomInferenceOverride !== null,
        hostedAssistantOpenAiConfigured:
          isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        hostedAssistantVeniceConfigured:
          isHostedRunnerVeniceProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        modelCredentialConfigured:
          hasHostedRunnerModelCredential({
            forwardedEnv,
            userEnv,
          }),
        openAiCredentialAfterMintKind,
        openAiCredentialBeforeMintKind,
        openAiProviderCredentialMinted,
        veniceCredentialAfterMintKind,
        veniceCredentialBeforeMintKind,
        veniceProviderCredentialMinted,
        preparedSnapshotRestorePresent: preparedSnapshotRestore !== null,
        processingMode: nullableRunnerValue(input.processingMode),
        runnerContainerWorkerVersionPresent: runnerContainerName !== input.userId,
        workspaceAttemptId: input.token.attemptId,
        workspaceWriteFenceGeneration: input.token.generation,
        workspaceVersion: input.workspaceVersion,
      },
      message: "Hosted runner prepared workspace invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    return {
      job,
      runnerContainerName,
    };
  }

  private async resolveInvocationRunnerContainerName(input: {
    verifiedSlotBinding?: HostedStandbySlotBinding;
    commandBudget: RuntimeProcessingCommandBudget | null;
    runnerContainerName: string | null;
    userId: string;
  }): Promise<string> {
    if (
      typeof input.runnerContainerName === "string"
      && isHostedRunnerTargetName(input.runnerContainerName)
    ) {
      const runnerContainerName = input.runnerContainerName;
      const namespace = this.input.runnerContainerNamespace;
      if (!namespace) {
        throw new Error("Hosted standby invocation binding is unavailable.");
      }
      const readBinding = async () =>
        await requireHostedRunnerSlotLifecycle(namespace.getByName(runnerContainerName)).readStandbySlotBinding();
      // Allocation or retained-slot resolution already checked this binding.
      // Reuse that request-local receipt; direct starts without one still read it.
      // The container independently authorizes its live binding at launch.
      const binding = input.verifiedSlotBinding ?? (input.commandBudget
        ? await runRuntimeProcessingCommandStep({
            budget: input.commandBudget,
            operation: readBinding,
            stepTimeoutMs: this.input.env.webControlTimeoutMs,
          })
        : await readBinding());
      if (
        !hostedRunnerSlotBindingMatchesTarget(binding, runnerContainerName)
        || binding.state !== "bound"
        || binding.userId !== input.userId
        || !isHostedStandbyClaimId(binding.claimId)
        || !isSupportedHostedRunnerRelease(this.input.runnerRuntimeEnvSource, binding.releaseId)
      ) {
        throw new Error("Hosted standby slot binding did not match the runtime invocation user.");
      }
      return binding.slotName;
    }

    const runnerContainerIdentity = readHostedRunnerContainerIdentity({
      containerName: input.runnerContainerName,
      source: this.input.runnerRuntimeEnvSource,
    });
    if (!runnerContainerIdentity || runnerContainerIdentity.userId !== input.userId) {
      throw new Error("Hosted runner container identity did not match the runtime invocation user.");
    }
    return runnerContainerIdentity.runnerContainerName;
  }

}

function nullableRunnerValue<T>(value: T | undefined): T | null {
  return value ?? null;
}

function isDueHostedAssistantDeliveryWake(
  workspace: HostedWorkspaceState | null,
  nowMs: number,
): boolean {
  if (
    workspace?.nextWakeReason !== HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON
    || typeof workspace.nextWakeAt !== "string"
  ) {
    return false;
  }
  const nextWakeAtMs = Date.parse(workspace.nextWakeAt);
  return Number.isFinite(nextWakeAtMs) && nextWakeAtMs <= nowMs;
}

// Budget-aware wrapper for `prepareHostedWorkspaceSnapshotRestore`. A
// control-plane stall that exceeds the per-command budget must not clear the
// runner write fence: warm-clean checkpoint markers can restore without R2
// access, key unwrap, or a prepared URL. The fenced cold path still fails
// closed because it re-attempts the same reads under the fence. Runner-secret
// preparation intentionally stays fatal — the container cannot start without
// it — so this wrapper is snapshot-prep specific.
export async function runHostedWorkspaceSnapshotRestorePreparationWithinBudget(input: {
  budget: RuntimeProcessingCommandBudget | null;
  onBudgetTimeout: (error: unknown) => void;
  operation: () => Promise<HostedWorkspaceSnapshotPreparedRestore | null>;
  stepTimeoutMs: number;
}): Promise<HostedWorkspaceSnapshotPreparedRestore | null> {
  if (!input.budget) {
    return await input.operation();
  }
  try {
    return await runRuntimeProcessingCommandStep({
      budget: input.budget,
      operation: input.operation,
      stepTimeoutMs: input.stepTimeoutMs,
    });
  } catch (error) {
    if (isRuntimeProcessingCommandBudgetTimeout(error)) {
      input.onBudgetTimeout(error);
      return null;
    }
    throw error;
  }
}

export async function deriveHostedWorkspaceSnapshotPathHashSecret(
  source: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const rawSecret = normalizeHostedRunnerStringEnvValue(
    source.HOSTED_LOG_FINGERPRINT_SECRET,
  );
  if (!rawSecret) {
    return null;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER.encode(rawSecret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER.encode(
        WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT,
      ),
    ));
    return Array.from(signature)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function normalizeHostedRunnerStringEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}


function resolveInvocationAdmission(workspaceRead: HostedWorkspaceReadResponse, runtimeInput: RuntimeInvocationInput, hasCustomInference: boolean) {
    let platformAiUsageAllowed: boolean | null = null;
    let assistantExecutionBlocked = runtimeInput.assistantExecutionBlocked === true;
    let invocationProcessingMode = runtimeInput.processingMode ?? null;
    if (hasCustomInference) {
      if (typeof workspaceRead.platformAiUsageAllowed !== "boolean") {
        throw new Error(
          "Hosted custom inference workspace projection omitted the platform AI usage decision.",
        );
      }
      platformAiUsageAllowed = workspaceRead.platformAiUsageAllowed;
    } else if (workspaceRead.platformAiUsageAllowed === false) {
      // A payloadless direct wake can win the race with Temporal's usage-block
      // reconciliation. Keep that expected product block out of transport
      // failure state and keep restored assistant work out of provider-failure
      // handling. A due delivery-only wake must retain the default assistant
      // phase because that phase owns outbox delivery, while the bound fence
      // still rejects every metered provider egress if one is reached
      // unexpectedly. Other default work remains narrowed to system-mailbox
      // processing, and explicit retention-only work can proceed without a
      // model call.
      platformAiUsageAllowed = false;
      const isDefaultDeliveryOnlyWake =
        (invocationProcessingMode ?? "default") === "default"
        && isDueHostedAssistantDeliveryWake(
          workspaceRead.workspace,
          Date.now(),
        );
      assistantExecutionBlocked = !isDefaultDeliveryOnlyWake;
      if (
        !isDefaultDeliveryOnlyWake
        && (invocationProcessingMode ?? "default") === "default"
      ) {
        invocationProcessingMode = "system_mailbox";
      }
    }
    return { platformAiUsageAllowed, assistantExecutionBlocked, invocationProcessingMode };
}
