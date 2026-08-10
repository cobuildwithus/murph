import {
  prepareAssistantDirectCliEnv,
} from '../../assistant-cli-access.js'
import {
  executeCodexAppServerTurn,
  preinitializeCodexAppServer,
  readCodexAppServerTurnFailureContext,
} from '../../assistant-codex.js'
import {
  createVoiceMemoToolRuntimeFromEnv,
} from '../../assistant-codex/generate-voice-memo-tool.js'
import {
  createAskGrokToolRuntimeFromEnv,
} from '../../assistant-codex/ask-grok-tool.js'
import {
  resolveSupportedCodexAppServerApprovalPolicy,
} from '../../assistant-codex/app-server-requests.js'
import {
  isAssistantCodexTargetConfig,
  resolveAssistantChatProviderFromConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
  resolveStrictAssistantCodexModelProvider,
} from '@murphai/operator-config/assistant/target-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_CODEX_MODELS,
} from './catalog.js'
import {
  getAssistantBindingContextLines,
} from '../bindings.js'
import {
  extractCodexAssistantProviderUsage,
  mergeCodexConfigOverrides,
  resolveAssistantProviderFlatPromptConversationHistorySection,
  resolveAssistantProviderPrompt,
} from './helpers.js'
import {
  supportsAnyAssistantRichUserMessageContent,
  type AssistantProviderCapabilities,
  type AssistantProviderTurnAttemptResult,
  type AssistantProviderTurnExecutionInput,
  type AssistantProviderUsage,
} from './types.js'
import {
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from '../codex-base-instructions.js'
import { normalizeNullableString } from '../shared.js'
import {
  isSensitiveAssistantFieldName,
  redactAssistantStateString,
  sanitizeAssistantPortableStateString,
} from '../redaction.js'
import type {
  AssistantModelImagePart,
  AssistantUserMessageContentPart,
} from '../content-types.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type {
  CodexAppServerImageInput,
  CodexAppServerPreinitialization,
  CodexAppServerTurnInput,
  CodexAppServerTurnFailureContext,
  CodexAppServerLiveTurn,
} from '../../assistant-codex.js'
import { fileURLToPath } from 'node:url'

const CODEX_INVALID_OUTPUT_TRACE_SCHEMA =
  'murph.assistant-codex-invalid-output-diagnostics.v1'
const CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE =
  'assistant.codex.invalid_output_resume_failure'
const CODEX_RESUME_FAILURE_TRACE_SCHEMA =
  'murph.assistant-codex-resume-failure-diagnostics.v1'
const CODEX_RESUME_FAILURE_TRACE_TYPE =
  'assistant.codex.resume_failure'
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA =
  'murph.assistant-provider-prompt-size-diagnostics.v1'
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_TYPE =
  'assistant.provider.prompt_size'
const CODEX_INVALID_OUTPUT_RECENT_EVENT_LIMIT = 12
const CODEX_INVALID_OUTPUT_DETAIL_ARRAY_LIMIT = 12
const CODEX_DIAGNOSTIC_ERROR_MESSAGE_MAX_LENGTH = 2048
const SAFE_CODEX_DIAGNOSTIC_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/u
const SAFE_CODEX_DIAGNOSTIC_METHODS = new Set([
  'initialize',
  'rpc.error',
  'rpc.response',
  'thread/resume',
  'thread/start',
  'turn/completed',
  'turn/interrupt',
  'turn/start',
  'turn/started',
  'turn/steer',
])
const SAFE_CODEX_RESUME_FAILURE_ERROR_PHRASES = new Set([
  'codex-turn-failed',
  'connection-lost',
  'credits-exhausted',
  'input-output-field',
  'invalid-input',
  'quota-exceeded',
  'rate-limit',
  'resume-stale',
  'status-failed',
  'timeout',
  'usage-limit',
])
const SAFE_CODEX_DIAGNOSTIC_STRUCTURAL_TOKENS = new Set([
  'array',
  'boolean',
  'cancelled',
  'canceled',
  'command.execution',
  'completed',
  'connection_lost',
  'dynamic.tool.call',
  'error',
  'failed',
  'file.change',
  'function_call',
  'function_call_output',
  'image',
  'in_progress',
  'input_image',
  'input_text',
  'interrupted',
  'message',
  'null',
  'number',
  'object',
  'other',
  'process_exit',
  'reasoning',
  'running',
  'string',
  'succeeded',
  'turn_failed',
  'undefined',
  'unknown',
])
const SAFE_CODEX_DIAGNOSTIC_STRUCTURAL_KEYS = new Set([
  'content',
  'id',
  'image_url',
  'kind',
  'method',
  'output',
  'params',
  'status',
  'text',
  'type',
])

export const CODEX_ASSISTANT_CAPABILITIES: AssistantProviderCapabilities = {
  supportedUserMessageContentTypes: ['text', 'image'],
  supportsNativeResume: true,
  supportsReasoningEffort: true,
  supportsRichUserMessageContent: supportsAnyAssistantRichUserMessageContent([
    'text',
    'image',
  ]),
}

type CodexAssistantProcessPreparationInput = Pick<
  AssistantProviderTurnExecutionInput,
  | 'codexConfigOverrides'
  | 'env'
  | 'providerConfig'
  | 'showThinkingTraces'
  | 'workingDirectory'
>

type CodexAssistantProcessLaunchInput = Pick<
  CodexAppServerTurnInput,
  | 'codexCommand'
  | 'codexHome'
  | 'configOverrides'
  | 'env'
  | 'oss'
  | 'profile'
  | 'workingDirectory'
>

export async function preinitializeCodexAssistantProcess(
  input: CodexAssistantProcessPreparationInput & {
    signal?: AbortSignal | null
  },
): Promise<CodexAppServerPreinitialization | null> {
  return await preinitializeCodexAppServer({
    ...resolveCodexAssistantProcessLaunchInput(input),
    signal: input.signal ?? undefined,
  })
}

export async function executeCodexAssistantTurnAttempt(
  input: AssistantProviderTurnExecutionInput,
): Promise<AssistantProviderTurnAttemptResult> {
  const providerConfig = input.providerConfig
  const codexProcessLaunchInput =
    resolveCodexAssistantProcessLaunchInput(input)
  const modelProviderResolution = resolveStrictAssistantCodexModelProvider(
    providerConfig.target.modelProvider,
  )
  const modelProviderConfig = modelProviderResolution.config
  const providerFailureHint = modelProviderConfig?.failureHint ?? null
  const providerSecretValue =
    modelProviderConfig?.envKey
      ? normalizeNullableString(
          input.env?.[modelProviderConfig.envKey] ??
            process.env[modelProviderConfig.envKey],
        )
      : null
  const approvalPolicy = resolveSupportedCodexAppServerApprovalPolicy(
    providerConfig.policy.approvalPolicy,
  )
  const developerInstructions = normalizeNullableString(input.developerInstructions)

  const voiceMemoRuntime = createVoiceMemoToolRuntimeFromEnv({
    env: input.env ?? process.env,
    fetchImpl: input.providerFetch ?? fetch,
    preferredVoiceId: input.assistantPreferredElevenLabsVoiceId ?? null,
    publicFetchImpl: input.publicInternetFetch ?? null,
    voiceMemoDeliveryChannel: input.voiceMemoDeliveryChannel ?? null,
  })
  // Null when XAI_API_KEY is absent; the executor then fails closed with a
  // not-configured result instead of attempting a provider call.
  const askGrokRuntime = createAskGrokToolRuntimeFromEnv({
    env: input.env ?? process.env,
    fetchImpl: input.providerFetch ?? fetch,
  })

  const baseAppServerInput = {
    ...codexProcessLaunchInput,
    abortSignal: input.abortSignal,
    allowFinishWithoutReply: input.allowFinishWithoutReply ?? true,
    authorizeAcceptedMessageTarget:
      input.authorizeAcceptedMessageTarget ?? null,
    approvalPolicy,
    baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
    developerInstructions,
    dynamicTools: input.dynamicTools,
    environments: input.environments ?? undefined,
    ephemeral: input.providerThreadEphemeral ?? undefined,
    fetchImpl: input.providerFetch ?? undefined,
    ...(input.generateSongPolicy
      ? { generateSongPolicy: input.generateSongPolicy }
      : {}),
    groupConversation: input.groupConversation === true,
    groupRoomModelMaintenanceAuthorized:
      input.groupRoomModelMaintenanceAuthorized === true,
    hostedToolContext: input.hostedToolContext ?? null,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
    model: providerConfig.target.model ?? undefined,
    modelProvider: providerConfig.target.modelProvider ?? undefined,
    onFinishWithoutReplyAccepted: input.onFinishWithoutReplyAccepted ?? null,
    onFinishWithoutReplyRecorded: input.onFinishWithoutReplyRecorded ?? null,
    onboardingFirstReadCompletionTransitionAvailable:
      input.onboardingFirstReadCompletionTransitionAvailable ?? false,
    publicInternetFetch: input.publicInternetFetch ?? null,
    threadConfig: input.codexThreadConfig ?? null,
    onFirstAssistantResponseCompleted:
      input.activeTurnSteering
        ? () => input.activeTurnSteering?.closeInputAdmission()
        : undefined,
    onLiveTurn:
      input.activeTurnSteering
        ? (turn: CodexAppServerLiveTurn) => {
            const sessionId = normalizeNullableString(input.activeTurnSessionId)
            const murphTurnId = normalizeNullableString(input.activeTurnId)
            if (!sessionId || !murphTurnId) {
              return undefined
            }

            return input.activeTurnSteering?.registerLiveProviderTurn({
              interrupt: turn.interrupt,
              codexThreadId: turn.threadId,
              providerTurnId: turn.turnId,
              sessionId,
              steer: async (steerInput) => {
                await turn.steer({
                  images: extractCodexAppServerUserMessageImages(
                    steerInput.userMessageContent,
                  ),
                  prompt: steerInput.prompt,
                })
              },
              turnId: murphTurnId,
            })
          }
        : undefined,
    onProgress: input.onEvent ?? undefined,
    onProviderRequestStarted: input.onProviderRequestStarted ?? undefined,
    ...(input.providerStartCriticalPath
      ? { providerStartCriticalPath: input.providerStartCriticalPath }
      : {}),
    onTraceEvent: input.onTraceEvent,
    productFeedbackRecorder: input.productFeedbackRecorder ?? null,
    progressDelivery: input.progressDelivery ?? undefined,
    ...(input.processLifetime === 'one-shot'
      ? { processLifetime: 'one-shot' as const }
      : {}),
    permissions: input.permissions ?? null,
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
    requireHostedPrivateImageDelivery:
      input.requireHostedPrivateImageDelivery ?? false,
    images: extractCodexAppServerUserMessageImages(input.userMessageContent),
    excludeResumeTurns: true,
    reasoningEffort: providerConfig.policy.reasoningEffort ?? undefined,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
    sandbox: input.permissions
      ? undefined
      : providerConfig.policy.sandbox ?? undefined,
    serviceTier: input.serviceTier ?? null,
    vaultRoot: input.vaultRoot ?? null,
    voiceMemoRuntime,
    askGrokRuntime,
  } as const

  let result: Awaited<ReturnType<typeof executeCodexAppServerTurn>>
  const buildFailedProviderAttempt = (
    failureError: unknown,
    knownFailureContext?: CodexAppServerTurnFailureContext | null,
  ): AssistantProviderTurnAttemptResult => {
    const failureContext = knownFailureContext ??
      readCodexAppServerTurnFailureContext(failureError)
    const rawEvents = failureContext?.jsonEvents ?? []
    const usage = rawEvents.length > 0
      ? extractCodexAssistantProviderUsage({
          providerConfig,
          rawEvents,
          serviceTier: input.serviceTier ?? null,
        })
      : null
    const surfacedError = addCodexModelProviderFailureHint({
      error: failureError,
      failureHint: providerFailureHint,
      providerSecretValue,
    })
    return {
      additionalUsages: failureContext?.additionalUsages ?? [],
      error: surfacedError,
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        providerActionCount: failureContext?.providerActionCount ?? 0,
        rawToolEvents: [],
        runtimeIssueInputs: failureContext?.runtimeIssueInputs ?? [],
      },
      ok: false,
      ...(failureContext
        ? {
            acceptedNoReplyDeliveryContextOrdinals:
              failureContext.acceptedNoReplyDeliveryContextOrdinals,
            codexRolloutRelativePath: failureContext.rolloutRelativePath,
            reactions: failureContext.reactions,
            codexThreadId: failureContext.codexThreadId,
            providerTurnId: failureContext.providerTurnId,
            rawEvents,
          }
        : {}),
      ...(hasCodexAssistantProviderUsageData(usage) ? { usage } : {}),
    }
  }
  try {
    const primaryInput =
      input.resume
        ? {
            ...input,
            conversationHistoryMessages: undefined,
          }
        : input
    const prompt = resolveAssistantProviderPrompt(primaryInput)
    emitAssistantProviderPromptSizeTraceEvent({
      input: primaryInput,
      prompt,
    })
    result = await executeCodexAppServerTurn({
      ...baseAppServerInput,
      prompt,
      resumeSessionId: input.resume?.codexThreadId,
    })
  } catch (error) {
    const failureContext = readCodexAppServerTurnFailureContext(error)
    const invalidOutputResumeFailure =
      error instanceof VaultCliError && isCodexInvalidOutputResumeFailure(error)
    if (
      input.resume &&
      isCodexDiagnosticTraceError(error) &&
      !invalidOutputResumeFailure
    ) {
      emitCodexResumeFailureTraceEvent({
        onTraceEvent: input.onTraceEvent,
        rawEvent: buildCodexResumeFailureTraceEvent({
          error,
          failureContext,
          resumeCodexThreadId: input.resume.codexThreadId,
        }),
      })
    }

    if (
      input.resume &&
      error instanceof VaultCliError &&
      invalidOutputResumeFailure
    ) {
      emitCodexInvalidOutputTraceEvent({
        onTraceEvent: input.onTraceEvent,
        rawEvent: buildCodexInvalidOutputResumeFailureTraceEvent({
          error,
          failureContext,
          resumeCodexThreadId: input.resume.codexThreadId,
        }),
      })

    }
    return buildFailedProviderAttempt(error, failureContext)
  }

  const usage = extractCodexAssistantProviderUsage({
    providerConfig,
    rawEvents: result.jsonEvents,
    serviceTier: input.serviceTier ?? null,
  })
  const productFeedbackCandidate =
    input.productFeedbackRecorder?.readProductFeedback() ?? null
  const attemptResult: AssistantProviderTurnAttemptResult = {
    metadata: {
      activityLabels: [],
      executedToolCount: 0,
      providerActionCount: result.providerActionCount,
      rawToolEvents: [],
      runtimeIssueInputs: result.runtimeIssueInputs ?? [],
    },
    ok: true,
    result: {
      provider: resolveAssistantChatProviderFromConfig(providerConfig),
      additionalUsages: result.additionalUsages,
      ...(result.acceptedNoReplyDeliveryContextOrdinals === undefined
        ? {}
        : {
            acceptedNoReplyDeliveryContextOrdinals:
              result.acceptedNoReplyDeliveryContextOrdinals,
          }),
      codexThreadId: result.sessionId,
      ...(result.finalAction
        ? {
            finalAction: result.finalAction,
          }
        : {}),
      response: result.finalMessage,
      ...(result.providerAuthoredFinalMessage === undefined
        ? {}
        : {
            providerAuthoredResponse:
              result.providerAuthoredFinalMessage ?? result.finalMessage,
          }),
      transcriptResponse: result.transcriptMessage,
      responseDeliveryContextOrdinal: result.responseDeliveryContextOrdinal,
      ...(result.targetInputId === undefined
        ? {}
        : { targetInputId: result.targetInputId }),
      ...(result.reactions === undefined
        ? {}
        : { reactions: result.reactions }),
      precedingResponseSegments: result.precedingAgentMessageSegments.map((segment) => ({
        deliveryContextOrdinal: segment.deliveryContextOrdinal,
        media: segment.media,
        response: segment.response,
        ...(segment.transcriptResponse === undefined
          ? {}
          : { transcriptResponse: segment.transcriptResponse }),
        ...(segment.targetInputId
          ? { targetInputId: segment.targetInputId }
          : {}),
      })),
      ...(productFeedbackCandidate
        ? {
            productFeedbackCandidate,
          }
        : {}),
      responseMedia: result.responseMedia,
      ...(result.responseCard === undefined
        ? {}
        : { responseCard: result.responseCard }),
      stderr: result.stderr,
      stdout: result.stdout,
      rawEvents: result.jsonEvents,
      codexRolloutRelativePath: result.rolloutRelativePath,
      usage,
    },
  }
  return attemptResult
}

function emitAssistantProviderPromptSizeTraceEvent(input: {
  input: AssistantProviderTurnExecutionInput
  prompt: string
}): void {
  const onTraceEvent = input.input.onTraceEvent
  if (!onTraceEvent) {
    return
  }

  const developerInstructions = normalizeNullableString(
    input.input.developerInstructions,
  )
  const systemPrompt = normalizeNullableString(input.input.systemPrompt)
  const userPrompt = normalizeNullableString(input.input.userPrompt)
  const turnContextPrompt = normalizeNullableString(input.input.turnContextPrompt)
  const conversationHistoryPrompt =
    resolveAssistantProviderFlatPromptConversationHistorySection(input.input)
  const conversationHistoryCount = input.input.conversationHistoryMessages?.length ?? 0
  const conversationContextLines =
    input.input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.input.sessionContext.binding)
      : []
  const conversationContextPrompt =
    conversationContextLines.length > 0
      ? `Conversation context:\n${conversationContextLines.join('\n')}`
      : null
  const conversationContextPresent = conversationContextPrompt !== null
  const dynamicTools = input.input.dynamicTools
  const messageTargetDynamicToolsAvailable =
    dynamicTools.some(
      (tool) => tool.namespace === 'murph' && tool.name === 'select_reply_target',
    ) &&
    dynamicTools.some(
      (tool) => tool.namespace === 'murph' && tool.name === 'react_to_message',
    )

  try {
    onTraceEvent({
      codexThreadId: null,
      rawEvent: {
        schema: ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA,
        type: ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_TYPE,
        providerTraceKind: 'provider.prompt_size',
        providerPromptDiagnosticKind: 'primary',
        baseInstructionsBytes: byteLength(MURPH_CODEX_BASE_INSTRUCTIONS),
        providerPromptBytes: byteLength(input.prompt),
        systemPromptBytes: byteLength(systemPrompt),
        userPromptBytes: byteLength(userPrompt),
        turnContextPromptBytes: byteLength(turnContextPrompt),
        developerInstructionsBytes: byteLength(developerInstructions),
        conversationHistoryBytes: byteLength(conversationHistoryPrompt),
        dynamicToolCount: dynamicTools.length,
        developerInstructionsPresent: developerInstructions !== null,
        messageTargetDynamicToolsAvailable,
        voiceMemoGenerationAvailable: input.input.voiceMemoDeliveryChannel != null,
        conversationHistoryCount,
        conversationHistoryPresent: conversationHistoryCount > 0,
        conversationContextBytes: byteLength(conversationContextPrompt),
        conversationContextPresent,
        resumeCodexThreadIdPresent:
          normalizeNullableString(input.input.resume?.codexThreadId) !== null,
      },
      updates: [],
    })
  } catch {
    // Diagnostic traces are best-effort and must not affect assistant turns.
  }
}

function resolveCodexAssistantProcessLaunchInput(
  input: CodexAssistantProcessPreparationInput,
): CodexAssistantProcessLaunchInput {
  const providerConfig = input.providerConfig
  if (!isAssistantCodexTargetConfig(providerConfig)) {
    throw new VaultCliError(
      'ASSISTANT_PROVIDER_UNSUPPORTED',
      'Codex app-server execution requires a Codex provider config.',
    )
  }
  const configOverrides = [
    ...(mergeCodexConfigOverrides({
      modelProvider: providerConfig.target.modelProvider,
      showThinkingTraces: input.showThinkingTraces ?? false,
    }) ?? []),
    ...(input.codexConfigOverrides ?? []),
  ]

  return {
    codexCommand: providerConfig.target.codexCommand ?? undefined,
    codexHome: providerConfig.target.codexHome ?? undefined,
    configOverrides: configOverrides.length > 0 ? configOverrides : undefined,
    env: prepareAssistantDirectCliEnv(input.env),
    oss: providerConfig.target.oss,
    profile: providerConfig.target.profile ?? undefined,
    workingDirectory: input.workingDirectory,
  }
}

function byteLength(value: string | null): number {
  return value ? Buffer.byteLength(value, 'utf8') : 0
}

function addCodexModelProviderFailureHint(input: {
  error: unknown
  failureHint?: string | null
  providerSecretValue?: string | null
}): unknown {
  const failureHint = normalizeNullableString(input.failureHint)
  if (!failureHint) {
    return redactCodexProviderFailureError({
      error: input.error,
      providerSecretValue: input.providerSecretValue,
    })
  }

  const redactedError = redactCodexProviderFailureError({
    error: input.error,
    providerSecretValue: input.providerSecretValue,
  })

  if (
    redactedError instanceof Error &&
    redactedError.message.includes(failureHint)
  ) {
    return redactedError
  }

  if (redactedError instanceof VaultCliError) {
    return new VaultCliError(
      redactedError.code,
      `${redactedError.message} ${failureHint}`,
      redactedError.context,
    )
  }

  if (redactedError instanceof Error) {
    setCodexProviderFailureErrorMessage(
      redactedError,
      `${redactedError.message} ${failureHint}`,
    )
    return redactedError
  }

  return new VaultCliError(
    'ASSISTANT_CODEX_FAILED',
    failureHint,
  )
}

function redactCodexProviderFailureError(input: {
  error: unknown
  providerSecretValue?: string | null
}): unknown {
  if (!(input.error instanceof Error)) {
    return input.error
  }

  Object.defineProperty(input.error, 'message', {
    configurable: true,
    value: redactCodexProviderFailureText({
      providerSecretValue: input.providerSecretValue,
      text: input.error.message,
    }),
  })
  return input.error
}

function setCodexProviderFailureErrorMessage(error: Error, message: string): void {
  Object.defineProperty(error, 'message', {
    configurable: true,
    value: message,
  })
}

function redactCodexProviderFailureText(input: {
  providerSecretValue?: string | null
  text: string
}): string {
  let redacted = redactAssistantStateString(input.text)
  const providerSecretValue = normalizeNullableString(input.providerSecretValue)
  if (providerSecretValue) {
    redacted = redacted.split(providerSecretValue).join('[REDACTED]')
  }

  return redacted
}

function hasCodexAssistantProviderUsageData(
  usage: AssistantProviderUsage | null,
): boolean {
  if (!usage) {
    return false
  }

  return (
    usage.cacheWriteTokens !== null ||
    usage.cachedInputTokens !== null ||
    usage.inputTokens !== null ||
    usage.outputTokens !== null ||
    usage.reasoningTokens !== null ||
    usage.totalTokens !== null
  )
}

function isCodexInvalidOutputResumeFailure(error: unknown): boolean {
  return (
    readCodexDiagnosticErrorCode(error) === 'ASSISTANT_CODEX_FAILED' &&
    /\binput\.\d+\.output:\s*Invalid input\b/iu.test(
      readCodexDiagnosticErrorMessage(error) ?? '',
    )
  )
}

type CodexInvalidOutputTraceScalar = boolean | number | string | null
type CodexInvalidOutputTraceValue =
  | CodexInvalidOutputTraceScalar
  | readonly (number | string)[]
type CodexInvalidOutputTraceRawEvent = Record<string, CodexInvalidOutputTraceValue>

interface CodexInvalidOutputEventShapeSummary {
  eventKinds: string[]
  eventMethods: string[]
  eventStatuses: string[]
  outputArrayLengths: number[]
  outputKinds: string[]
  outputObjectKeys: string[]
  outputPartTypes: string[]
  outputStringLengths: number[]
  paramKeys: string[]
}

function buildCodexResumeFailureTraceEvent(input: {
  error: unknown
  failureContext: CodexAppServerTurnFailureContext | null
  resumeCodexThreadId: string
}): CodexInvalidOutputTraceRawEvent {
  const failureContext = input.failureContext
  const errorContext = readCodexDiagnosticErrorContext(input.error)
  const summary = summarizeCodexInvalidOutputEventShapes(
    failureContext?.jsonEvents ?? [],
  )
  const resumeSessionId = normalizeNullableString(input.resumeCodexThreadId)
  const failureSessionId = normalizeNullableString(failureContext?.codexThreadId)
  const errorMessage = readCodexDiagnosticErrorMessage(input.error)
  const errorMessageLength = readCodexDiagnosticErrorMessageLength(input.error)

  return {
    codexResumeFailureCodexFailureStage:
      normalizeSafeCodexDiagnosticStructuralToken(
        readDiagnosticString(errorContext, 'codexFailureStage'),
      ),
    codexResumeFailureCodexTurnStatus:
      normalizeSafeCodexDiagnosticStructuralToken(
        readDiagnosticString(errorContext, 'codexTurnStatus'),
      ),
    codexResumeFailureCodexAbortRequested:
      readDiagnosticBoolean(errorContext, 'codexAbortRequested'),
    codexResumeFailureCodexExitSignal:
      normalizeSafeCodexDiagnosticToken(
        readDiagnosticString(errorContext, 'codexExitSignal'),
      ),
    codexResumeFailureCodexJsonEventCount:
      readDiagnosticNonnegativeNumber(errorContext, 'codexJsonEventCount'),
    codexResumeFailureCodexLifecycleStage:
      normalizeSafeCodexDiagnosticToken(
        readDiagnosticString(errorContext, 'codexLifecycleStage'),
      ),
    codexResumeFailureCodexLiveTurnOpen:
      readDiagnosticBoolean(errorContext, 'codexLiveTurnOpen'),
    codexResumeFailureCodexPendingRpcCount:
      readDiagnosticNonnegativeNumber(errorContext, 'codexPendingRpcCount'),
    codexResumeFailureCodexPendingRpcMethod:
      normalizeSafeCodexDiagnosticMethod(
        readDiagnosticString(errorContext, 'codexPendingRpcMethod'),
      ),
    codexResumeFailureCodexProcessGroupPresent:
      readDiagnosticBoolean(errorContext, 'codexProcessGroupPresent'),
    codexResumeFailureCodexProcessLifetimeMs:
      readDiagnosticNonnegativeNumber(errorContext, 'codexProcessLifetimeMs'),
    codexResumeFailureCodexProviderRequestStarted:
      readDiagnosticBoolean(errorContext, 'codexProviderRequestStarted'),
    codexResumeFailureCodexShutdownRequested:
      readDiagnosticBoolean(errorContext, 'codexShutdownRequested'),
    codexResumeFailureCodexStderrBytes:
      readDiagnosticNonnegativeNumber(errorContext, 'codexStderrBytes'),
    codexResumeFailureCodexTerminationSignalSent:
      normalizeSafeCodexDiagnosticToken(
        readDiagnosticString(errorContext, 'codexTerminationSignalSent'),
      ),
    codexResumeFailureErrorCode: readCodexDiagnosticErrorCode(input.error),
    codexResumeFailureErrorKind: classifyCodexResumeFailureErrorKind(input.error),
    codexResumeFailureErrorMessage:
      sanitizeCodexDiagnosticErrorMessage(errorMessage),
    codexResumeFailureErrorMessageLength: errorMessageLength,
    codexResumeFailureErrorMessagePresent: errorMessageLength !== null,
    codexResumeFailureErrorPhrases:
      collectCodexResumeFailureErrorPhrases(
        errorMessage ?? '',
      ),
    codexResumeFailureEventCount: failureContext?.jsonEvents.length ?? null,
    codexResumeFailureEventKinds: summary.eventKinds,
    codexResumeFailureEventMethods: summary.eventMethods,
    codexResumeFailureEventStatuses: summary.eventStatuses,
    codexResumeFailureOutputArrayLengths: summary.outputArrayLengths,
    codexResumeFailureOutputKinds: summary.outputKinds,
    codexResumeFailureOutputObjectKeys: summary.outputObjectKeys,
    codexResumeFailureOutputPartTypes: summary.outputPartTypes,
    codexResumeFailureOutputStringLengths: summary.outputStringLengths,
    codexResumeFailureParamKeys: summary.paramKeys,
    codexResumeFailurePhase: 'resume-failed',
    codexResumeFailureProviderActionCount:
      failureContext?.providerActionCount ?? null,
    codexResumeFailureRetryable: readDiagnosticBoolean(errorContext, 'retryable'),
    codexResumeFailureResumeMatchesFailureSession:
      resumeSessionId && failureSessionId ? resumeSessionId === failureSessionId : null,
    codexResumeFailureResumeSessionPresent: resumeSessionId !== null,
    codexResumeFailureSessionPresent: failureSessionId !== null,
    codexResumeFailureTraceType: 'failure',
    codexResumeFailureTurnPresent:
      normalizeNullableString(failureContext?.providerTurnId) !== null,
    providerTraceKind: 'codex.resume_failure',
    schema: CODEX_RESUME_FAILURE_TRACE_SCHEMA,
    type: CODEX_RESUME_FAILURE_TRACE_TYPE,
  }
}

function sanitizeCodexDiagnosticErrorMessage(value: string | null): string | null {
  if (!value) {
    return null
  }

  const redacted = sanitizeAssistantPortableStateString(
    value
      .replace(/\r\n?/gu, '\n')
      .replace(/\+\d[\d().\s-]{7,}\d/gu, '[phone]')
      .replace(/(^|[\s(])\/[^\s)]+/gu, '$1[path]'),
    CODEX_DIAGNOSTIC_ERROR_MESSAGE_MAX_LENGTH,
  )

  return normalizeNullableString(redacted)
}

function buildCodexInvalidOutputResumeFailureTraceEvent(input: {
  error: VaultCliError
  failureContext: CodexAppServerTurnFailureContext | null
  resumeCodexThreadId: string
}): CodexInvalidOutputTraceRawEvent {
  return {
    ...buildCodexInvalidOutputBaseTraceEvent(input),
    codexInvalidOutputPhase: 'resume-failed',
    codexInvalidOutputTraceType: 'failure',
    providerTraceKind: 'codex.invalid_output_resume_failure',
    schema: CODEX_INVALID_OUTPUT_TRACE_SCHEMA,
    type: CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE,
  }
}

function buildCodexInvalidOutputBaseTraceEvent(input: {
  error: VaultCliError
  failureContext: CodexAppServerTurnFailureContext | null
  resumeCodexThreadId: string
}): CodexInvalidOutputTraceRawEvent {
  const failureContext = input.failureContext
  const errorInputIndex = readCodexInvalidOutputInputIndex(input.error.message)
  const summary = summarizeCodexInvalidOutputEventShapes(
    failureContext?.jsonEvents ?? [],
  )
  const resumeSessionId = normalizeNullableString(input.resumeCodexThreadId)
  const failureSessionId = normalizeNullableString(failureContext?.codexThreadId)

  return {
    codexInvalidOutputErrorCode: readCodexDiagnosticErrorCode(input.error),
    codexInvalidOutputErrorField:
      errorInputIndex !== null ? `input.${errorInputIndex}.output` : null,
    codexInvalidOutputErrorKind:
      errorInputIndex !== null ? 'invalid-input-output' : 'invalid-output',
    codexInvalidOutputErrorMessageLength:
      readCodexDiagnosticErrorMessageLength(input.error),
    codexInvalidOutputFailureEventCount: failureContext?.jsonEvents.length ?? null,
    codexInvalidOutputFailureEventKinds: summary.eventKinds,
    codexInvalidOutputFailureEventMethods: summary.eventMethods,
    codexInvalidOutputFailureEventStatuses: summary.eventStatuses,
    codexInvalidOutputFailureOutputArrayLengths: summary.outputArrayLengths,
    codexInvalidOutputFailureOutputKinds: summary.outputKinds,
    codexInvalidOutputFailureOutputObjectKeys: summary.outputObjectKeys,
    codexInvalidOutputFailureOutputPartTypes: summary.outputPartTypes,
    codexInvalidOutputFailureOutputStringLengths: summary.outputStringLengths,
    codexInvalidOutputFailureParamKeys: summary.paramKeys,
    codexInvalidOutputFailureProviderActionCount:
      failureContext?.providerActionCount ?? null,
    codexInvalidOutputFailureSessionPresent: failureSessionId !== null,
    codexInvalidOutputFailureTurnPresent:
      normalizeNullableString(failureContext?.providerTurnId) !== null,
    codexInvalidOutputInputIndex: errorInputIndex,
    codexInvalidOutputResumeMatchesFailureSession:
      resumeSessionId && failureSessionId ? resumeSessionId === failureSessionId : null,
    codexInvalidOutputResumeSessionPresent: resumeSessionId !== null,
  }
}

function emitCodexInvalidOutputTraceEvent(input: {
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  rawEvent: CodexInvalidOutputTraceRawEvent
}): void {
  if (!input.onTraceEvent) {
    return
  }

  try {
    input.onTraceEvent({
      codexThreadId: null,
      rawEvent: input.rawEvent,
      updates: [],
    })
  } catch {
    // Diagnostic traces are best-effort and must not affect assistant turns.
  }
}

function emitCodexResumeFailureTraceEvent(input: {
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  rawEvent: CodexInvalidOutputTraceRawEvent
}): void {
  emitCodexInvalidOutputTraceEvent(input)
}

function readCodexInvalidOutputInputIndex(message: string): number | null {
  const match = /\binput\.(\d+)\.output:\s*Invalid input\b/iu.exec(message)
  if (!match?.[1]) {
    return null
  }

  const value = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function classifyCodexResumeFailureErrorKind(error: unknown): string {
  if (isCodexInvalidOutputResumeFailure(error)) {
    return 'invalid-input-output'
  }
  if (readCodexDiagnosticErrorCode(error) === 'ASSISTANT_CODEX_RESUME_STALE') {
    return 'resume-stale'
  }

  const context = readCodexDiagnosticErrorContext(error)
  const stage = readDiagnosticString(context, 'codexFailureStage')
  if (stage === 'turn_failed') {
    return 'turn-failed'
  }
  if (stage === 'connection_lost') {
    return 'connection-lost'
  }

  const errorCode = readCodexDiagnosticErrorCode(error)
  if (errorCode === 'ASSISTANT_CODEX_APP_SERVER_TIMEOUT') {
    return 'timeout'
  }
  if (errorCode === 'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED') {
    return 'rpc-failed'
  }
  if (errorCode === 'ASSISTANT_CODEX_USAGE_LIMIT') {
    return 'usage-limit'
  }
  if (errorCode === 'ASSISTANT_CODEX_FAILED') {
    return 'codex-failed'
  }
  if (errorCode === 'ASSISTANT_PROVIDER_UNSUPPORTED') {
    return 'provider-unsupported'
  }

  return 'unknown'
}

function collectCodexResumeFailureErrorPhrases(message: string): string[] {
  const phrases: string[] = []
  const normalized = message.toLowerCase()
  const add = (phrase: string, present: boolean) => {
    if (present && SAFE_CODEX_RESUME_FAILURE_ERROR_PHRASES.has(phrase)) {
      appendUniqueDiagnosticString(phrases, phrase)
    }
  }

  add('codex-turn-failed', normalized.includes('codex app-server turn failed'))
  add('status-failed', /\bstatus\s+failed\b/u.test(normalized))
  add('input-output-field', /\binput\.\d+\.output\b/u.test(normalized))
  add('invalid-input', normalized.includes('invalid input'))
  add('resume-stale', normalized.includes('resume') && normalized.includes('stale'))
  add('usage-limit', normalized.includes('usage limit'))
  add('quota-exceeded', normalized.includes('quota exceeded') || normalized.includes('current quota'))
  add('credits-exhausted', normalized.includes('purchase more credits') || normalized.includes('out of credits') || normalized.includes('credit balance'))
  add('rate-limit', normalized.includes('rate limit') || normalized.includes('429'))
  add('timeout', normalized.includes('timeout') || normalized.includes('timed out'))
  add('connection-lost', normalized.includes('connection lost'))

  return phrases
}

function isCodexDiagnosticTraceError(error: unknown): boolean {
  const code = readCodexDiagnosticErrorCode(error)
  return (
    code === 'ASSISTANT_CODEX_FAILED' ||
    code === 'ASSISTANT_CODEX_USAGE_LIMIT' ||
    code === 'ASSISTANT_CODEX_RESUME_STALE' ||
    code === 'ASSISTANT_CODEX_APP_SERVER_TIMEOUT' ||
    code === 'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED' ||
    code === 'ASSISTANT_PROVIDER_UNSUPPORTED'
  )
}

function readCodexDiagnosticErrorCode(error: unknown): string | null {
  if (error instanceof VaultCliError) {
    return normalizeSafeCodexDiagnosticToken(error.code)
  }

  const record = asDiagnosticRecord(error)
  return normalizeSafeCodexDiagnosticToken(readDiagnosticString(record, 'code'))
}

function readCodexDiagnosticErrorContext(
  error: unknown,
): Record<string, unknown> | null {
  if (error instanceof VaultCliError) {
    return asDiagnosticRecord(error.context)
  }

  return asDiagnosticRecord(asDiagnosticRecord(error)?.context)
}

function readCodexDiagnosticErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return readDiagnosticString(asDiagnosticRecord(error), 'message')
}

function readCodexDiagnosticErrorMessageLength(error: unknown): number | null {
  return readCodexDiagnosticErrorMessage(error)?.length ?? null
}

function summarizeCodexInvalidOutputEventShapes(
  events: readonly unknown[],
): CodexInvalidOutputEventShapeSummary {
  const summary: CodexInvalidOutputEventShapeSummary = {
    eventKinds: [],
    eventMethods: [],
    eventStatuses: [],
    outputArrayLengths: [],
    outputKinds: [],
    outputObjectKeys: [],
    outputPartTypes: [],
    outputStringLengths: [],
    paramKeys: [],
  }

  for (const event of events.slice(-CODEX_INVALID_OUTPUT_RECENT_EVENT_LIMIT)) {
    summarizeCodexInvalidOutputEventShape(event, summary)
  }

  return summary
}

function summarizeCodexInvalidOutputEventShape(
  event: unknown,
  summary: CodexInvalidOutputEventShapeSummary,
): void {
  const record = asDiagnosticRecord(event)
  appendUniqueDiagnosticString(
    summary.eventMethods,
    describeCodexDiagnosticEventMethod(record),
  )
  collectCodexDiagnosticStructuralTokens(record, summary)
  collectCodexDiagnosticOutputShapes(event, summary, 0)

  const params = asDiagnosticRecord(record?.params)
  if (!params) {
    return
  }

  appendUniqueDiagnosticString(
    summary.paramKeys,
    summarizeDiagnosticKeySet(Object.keys(params)),
  )

  const turn = asDiagnosticRecord(params.turn)
  appendUniqueDiagnosticString(
    summary.eventStatuses,
    normalizeSafeCodexDiagnosticStructuralToken(
      readDiagnosticString(turn, 'status') ?? readDiagnosticString(params, 'status'),
    ),
  )
}

function describeCodexDiagnosticEventMethod(
  record: Record<string, unknown> | null,
): string | null {
  const method = normalizeSafeCodexDiagnosticMethod(readDiagnosticString(record, 'method'))
  if (method) {
    return method
  }

  if (!record) {
    return 'unknown'
  }

  if ('error' in record) {
    return 'rpc.error'
  }

  if ('result' in record) {
    return 'rpc.response'
  }

  return 'unknown'
}

function collectCodexDiagnosticStructuralTokens(
  record: Record<string, unknown> | null,
  summary: CodexInvalidOutputEventShapeSummary,
): void {
  if (!record) {
    return
  }

  for (const source of [
    record,
    asDiagnosticRecord(record.params),
    asDiagnosticRecord(asDiagnosticRecord(record.params)?.event),
    asDiagnosticRecord(asDiagnosticRecord(record.params)?.item),
    asDiagnosticRecord(asDiagnosticRecord(record.params)?.turn),
  ]) {
    if (!source) {
      continue
    }
    for (const key of ['kind', 'status', 'type'] as const) {
      appendUniqueDiagnosticString(
        summary.eventKinds,
        normalizeSafeCodexDiagnosticStructuralToken(readDiagnosticString(source, key)),
      )
    }
  }
}

function collectCodexDiagnosticOutputShapes(
  value: unknown,
  summary: CodexInvalidOutputEventShapeSummary,
  depth: number,
): void {
  if (depth > 4) {
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, CODEX_INVALID_OUTPUT_DETAIL_ARRAY_LIMIT)) {
      collectCodexDiagnosticOutputShapes(entry, summary, depth + 1)
    }
    return
  }

  const record = asDiagnosticRecord(value)
  if (!record) {
    return
  }

  for (const [key, entry] of Object.entries(record)) {
    if (key === 'output') {
      summarizeCodexDiagnosticOutputValue(entry, summary)
      continue
    }
    collectCodexDiagnosticOutputShapes(entry, summary, depth + 1)
  }
}

function summarizeCodexDiagnosticOutputValue(
  value: unknown,
  summary: CodexInvalidOutputEventShapeSummary,
): void {
  const kind = resolveCodexDiagnosticValueKind(value)
  appendUniqueDiagnosticString(summary.outputKinds, kind)

  if (typeof value === 'string') {
    appendUniqueDiagnosticNumber(summary.outputStringLengths, value.length)
    return
  }

  if (Array.isArray(value)) {
    appendUniqueDiagnosticNumber(summary.outputArrayLengths, value.length)
    for (const entry of value.slice(0, CODEX_INVALID_OUTPUT_DETAIL_ARRAY_LIMIT)) {
      const partType = normalizeSafeCodexDiagnosticStructuralToken(
        readDiagnosticString(asDiagnosticRecord(entry), 'type'),
      )
      appendUniqueDiagnosticString(
        summary.outputPartTypes,
        partType ?? resolveCodexDiagnosticValueKind(entry),
      )
    }
    return
  }

  const record = asDiagnosticRecord(value)
  if (record) {
    appendUniqueDiagnosticString(
      summary.outputObjectKeys,
      summarizeDiagnosticKeySet(Object.keys(record)),
    )
  }
}

function resolveCodexDiagnosticValueKind(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array'
  }

  if (value === null) {
    return 'null'
  }

  const valueType = typeof value
  switch (valueType) {
    case 'boolean':
    case 'number':
    case 'string':
    case 'undefined':
      return valueType
    case 'object':
      return 'object'
    case 'bigint':
    case 'function':
    case 'symbol':
      return 'other'
  }
}

function summarizeDiagnosticKeySet(keys: readonly string[]): string | null {
  const normalizedKeys = keys
    .map((key) => classifyCodexDiagnosticKey(key))
    .slice(0, 8)
  if (normalizedKeys.length === 0) {
    return null
  }

  return normalizedKeys.join(',')
}

function appendUniqueDiagnosticString(
  output: string[],
  value: string | null,
): void {
  if (
    !value ||
    output.includes(value) ||
    output.length >= CODEX_INVALID_OUTPUT_DETAIL_ARRAY_LIMIT
  ) {
    return
  }

  output.push(value)
}

function appendUniqueDiagnosticNumber(output: number[], value: number): void {
  if (
    !Number.isFinite(value) ||
    output.includes(value) ||
    output.length >= CODEX_INVALID_OUTPUT_DETAIL_ARRAY_LIMIT
  ) {
    return
  }

  output.push(value)
}

function normalizeSafeCodexDiagnosticToken(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || !SAFE_CODEX_DIAGNOSTIC_TOKEN_PATTERN.test(normalized)) {
    return null
  }

  return normalized
}

function normalizeSafeCodexDiagnosticMethod(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }

  return SAFE_CODEX_DIAGNOSTIC_METHODS.has(normalized) ? normalized : 'other'
}

function normalizeSafeCodexDiagnosticStructuralToken(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeSafeCodexDiagnosticToken(value)
  if (!normalized) {
    return null
  }

  return SAFE_CODEX_DIAGNOSTIC_STRUCTURAL_TOKENS.has(normalized)
    ? normalized
    : 'other'
}

function classifyCodexDiagnosticKey(key: string): string {
  if (isSensitiveAssistantFieldName(key)) {
    return '[sensitive-key]'
  }

  const normalized = normalizeSafeCodexDiagnosticToken(key)
  if (!normalized) {
    return '[key]'
  }

  return SAFE_CODEX_DIAGNOSTIC_STRUCTURAL_KEYS.has(normalized) ? normalized : '[key]'
}

function readDiagnosticString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function readDiagnosticBoolean(
  record: Record<string, unknown> | null | undefined,
  key: string,
): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function readDiagnosticNonnegativeNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function asDiagnosticRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function resolveCodexAssistantLabel(
  config: AssistantProviderTurnExecutionInput['providerConfig'],
): string {
  return config.target.kind === 'codex-cli' && config.target.oss
    ? 'Codex OSS app-server'
    : 'Codex app-server'
}

export function resolveCodexStaticModels(): typeof DEFAULT_CODEX_MODELS {
  return DEFAULT_CODEX_MODELS
}

function extractCodexAppServerUserMessageImages(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): readonly CodexAppServerImageInput[] | undefined {
  const images: CodexAppServerImageInput[] = []

  for (const part of userMessageContent ?? []) {
    if (part.type !== 'image') {
      continue
    }

    images.push(
      toCodexAppServerImageInput({
        image: part.image,
        mimeType: part.mimeType ?? part.mediaType ?? null,
      }),
    )
  }

  return images.length > 0 ? images : undefined
}

function toCodexAppServerImageInput(input: {
  image: AssistantModelImagePart['image']
  mimeType: string | null
}): CodexAppServerImageInput {
  if (typeof input.image === 'string') {
    if (input.image.startsWith('data:')) {
      return {
        bytes: decodeCodexDataUrlToBytes(input.image),
        mimeType: input.mimeType,
      }
    }

    return {
      path: input.image,
      mimeType: input.mimeType,
    }
  }

  if (input.image instanceof URL) {
    if (input.image.protocol === 'data:') {
      return {
        bytes: decodeCodexDataUrlToBytes(input.image.href),
        mimeType: input.mimeType,
      }
    }

    if (input.image.protocol === 'file:') {
      return {
        path: fileURLToPath(input.image),
        mimeType: input.mimeType,
      }
    }

    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      `Codex app-server image input does not support URL scheme "${input.image.protocol}".`,
    )
  }

  if (input.image instanceof ArrayBuffer) {
    return {
      bytes: new Uint8Array(input.image),
      mimeType: input.mimeType,
    }
  }

  return {
    bytes: input.image,
    mimeType: input.mimeType,
  }
}

function decodeCodexDataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:([^,]*?),(.*)$/su.exec(dataUrl)
  if (!match) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      'Codex app-server image input data URL is malformed.',
    )
  }

  const metadata = match[1] ?? ''
  const payload = match[2] ?? ''
  const metadataParts = metadata
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (metadataParts.includes('base64')) {
    return Uint8Array.from(Buffer.from(payload, 'base64'))
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_IMAGE_INVALID',
    'Codex app-server image input data URLs must use base64 encoding.',
  )
}
