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
  createAnalyzeVideoToolRuntimeFromEnv,
} from '../../assistant-codex/analyze-video-tool.js'
import {
  resolveStrictAssistantCodexModelProvider,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_API_KEY_ENV,
} from '@murphai/hosted-execution/assistant-capabilities'
import {
  getAssistantBindingContextLines,
} from '../bindings.js'
import {
  extractCodexAssistantProviderUsage,
  resolveAssistantProviderFlatPromptConversationHistorySection,
  resolveAssistantProviderPrompt,
} from './helpers.js'
import {
  type AssistantProviderTurnAttemptResult,
  type AssistantProviderTurnExecutionInput,
  type AssistantProviderUsage,
} from './types.js'
import {
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from '../codex-base-instructions.js'
import { normalizeNullableString } from '../shared.js'
import { redactAssistantStateString } from '../redaction.js'
import type {
  CodexAppServerPreinitialization,
  CodexAppServerTurnInput,
  CodexAppServerTurnFailureContext,
  CodexAppServerLiveTurn,
} from '../../assistant-codex.js'
import { extractCodexAppServerUserMessageImages } from '../../assistant-codex/images.js'
import { isAssistantProviderCapacityError } from '../automation/auto-reply-retry.js'

const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA =
  'murph.assistant-provider-prompt-size-diagnostics.v1'
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_TYPE =
  'assistant.provider.prompt_size'

type CodexAssistantProcessPreparationInput = Pick<
  AssistantProviderTurnExecutionInput,
  | 'env'
  | 'providerConfig'
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
  const providerSecretValue =
    modelProviderConfig?.envKey
      ? normalizeNullableString(
          input.env?.[modelProviderConfig.envKey] ??
            process.env[modelProviderConfig.envKey],
        )
      : null
  const developerInstructions = normalizeNullableString(input.developerInstructions)

  const voiceMemoRuntime = createVoiceMemoToolRuntimeFromEnv({
    env: input.env ?? process.env,
    fetchImpl: input.providerFetch ?? fetch,
    preferredVoiceId: input.assistantPreferredElevenLabsVoiceId ?? null,
    publicFetchImpl: input.publicInternetFetch ?? null,
    voiceMemoDeliveryChannel: input.voiceMemoDeliveryChannel ?? null,
  })
  // Null when GEMINI_API_KEY is absent; the executor then fails closed with a
  // not-configured result instead of attempting a provider call.
  const analyzeVideoRuntime = createAnalyzeVideoToolRuntimeFromEnv({
    env: input.env ?? process.env,
    fetchImpl: input.providerFetch ?? fetch,
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
    askGrokTurnState: input.askGrokTurnState,
    analyzeVideoTurnState: input.analyzeVideoTurnState ?? null,
    automationRelativeDateReferenceWindow:
      input.automationRelativeDateReferenceWindow ?? null,
    authorizeAcceptedMessageTarget:
      input.authorizeAcceptedMessageTarget ?? null,
    approvalPolicy: providerConfig.policy.approvalPolicy,
    baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
    developerInstructions,
    currentStatePrompt: input.currentStatePrompt,
    dynamicTools: input.dynamicTools,
    environments: input.environments ?? undefined,
    ephemeral: input.providerThreadEphemeral ?? undefined,
    fetchImpl: input.providerFetch ?? undefined,
    followUpAttachmentAllowed: input.followUpAttachmentAllowed === true,
    groupConversation: input.groupConversation === true,
    groupRoomModelMaintenanceAuthorized:
      input.groupRoomModelMaintenanceAuthorized === true,
    memberMemoryMaintenanceAuthorized:
      input.memberMemoryMaintenanceAuthorized === true,
    hostedToolContext: input.hostedToolContext ?? null,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
    model: providerConfig.target.model ?? undefined,
    modelProvider: providerConfig.target.modelProvider ?? 'openai',
    onAdditionalUsage: input.onAdditionalUsage ?? null,
    onFinishWithoutReplyAccepted: input.onFinishWithoutReplyAccepted ?? null,
    onFinishWithoutReplyRecorded: input.onFinishWithoutReplyRecorded ?? null,
    onboardingFirstReadCompletionTransitionAvailable:
      input.onboardingFirstReadCompletionTransitionAvailable ?? false,
    publicInternetFetch: input.publicInternetFetch ?? null,
    threadConfig: resolveCodexAssistantThreadConfig(input),
    trustedContextReferences: input.trustedContextReferences ?? null,
    onFinalAnswerStarted: () => input.activeTurnSteering?.onFinalAnswerStarted?.(),
    onFirstAssistantResponseCompleted:
      input.activeTurnSteering
        ? () => input.activeTurnSteering?.onFirstAssistantResponseCompleted()
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
                  relativeDateReferenceWindow:
                    steerInput.relativeDateReferenceWindow,
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
    reasoningEffort: providerConfig.policy.reasoningEffort ?? undefined,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
    sandbox: input.permissions
      ? undefined
      : providerConfig.policy.sandbox ?? undefined,
    serviceTier: input.serviceTier ?? null,
    promptCacheRetention: input.promptCacheRetention,
    turnTrigger: input.turnTrigger,
    vaultRoot: input.vaultRoot ?? null,
    voiceMemoRuntime,
    analyzeVideoRuntime,
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
    const recapCapacityRefusal = isRecapCapacityRefusal(input, failureError)
    const usage = rawEvents.length > 0 || recapCapacityRefusal
      ? extractCodexAssistantProviderUsage({
          providerConfig,
          rawEvents,
          serviceTier: input.serviceTier ?? null,
        })
      : null
    const surfacedError = redactCodexProviderFailureError({
      error: failureError,
      providerSecretValue,
    })
    return {
      additionalUsages: failureContext?.additionalUsages ?? [],
      error: surfacedError,
      metadata: {
        activityLabels: [],
        providerActionCount: failureContext?.providerActionCount ?? 0,
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
      ...(hasCodexAssistantProviderUsageData(usage) || recapCapacityRefusal ? { usage } : {}),
    }
  }
  try {
    const prompt = resolveAssistantProviderPrompt(input)
    emitAssistantProviderPromptSizeTraceEvent({
      input,
      prompt,
    })
    result = await executeCodexAppServerTurn({
      ...baseAppServerInput,
      prompt,
      resumeSessionId: input.resume?.codexThreadId,
    })
  } catch (error) {
    const failureContext = readCodexAppServerTurnFailureContext(error)
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
      providerActionCount: result.providerActionCount,
      runtimeIssueInputs: result.runtimeIssueInputs ?? [],
    },
    ok: true,
    result: {
      provider: 'codex-cli',
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
      finalResponseCompletion: result.finalResponseCompletion,
      ...(result.providerAuthoredFinalMessage === undefined
        ? {}
        : {
            providerAuthoredResponse:
              result.providerAuthoredFinalMessage ?? result.finalMessage,
          }),
      transcriptResponse: result.transcriptMessage,
      responseDeliveryContextOrdinal: result.responseDeliveryContextOrdinal,
      ...(result.responseContextReferences === undefined
        ? {}
        : { responseContextReferences: result.responseContextReferences }),
      ...(result.targetInputId === undefined
        ? {}
        : { targetInputId: result.targetInputId }),
      ...(result.reactions === undefined
        ? {}
        : { reactions: result.reactions }),
      precedingResponseSegments: result.precedingAgentMessageSegments.map((segment) => ({
        ...(segment.contextReferences === undefined
          ? {}
          : { contextReferences: segment.contextReferences }),
        deliveryContextOrdinal: segment.deliveryContextOrdinal,
        followUpRequest: segment.followUpRequest,
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
      followUpRequest: result.followUpRequest,
      responseMedia: result.responseMedia,
      ...(result.responseCard === undefined
        ? {}
        : { responseCard: result.responseCard }),
      stderr: result.stderr,
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
  return {
    codexCommand: providerConfig.target.codexCommand ?? undefined,
    codexHome: providerConfig.target.codexHome ?? undefined,
    env: prepareCodexProcessEnv(input.env ?? process.env),
    oss: providerConfig.target.oss,
    profile: providerConfig.target.profile ?? undefined,
    workingDirectory: input.workingDirectory,
  }
}

function resolveCodexAssistantThreadConfig(
  input: Pick<
    AssistantProviderTurnExecutionInput,
    'codexThreadConfig' | 'showThinkingTraces'
  >,
): Readonly<Record<string, unknown>> | null {
  const config = {
    ...(input.codexThreadConfig ?? {}),
    ...(input.showThinkingTraces
      ? {
          hide_agent_reasoning: false,
          model_reasoning_summary: 'auto',
        }
      : {}),
  }
  return Object.keys(config).length > 0 ? config : null
}

function prepareCodexProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const prepared = prepareAssistantDirectCliEnv(env)
  const {
    [HOSTED_GEMINI_VIDEO_ANALYSIS_API_KEY_ENV]: _geminiApiKey,
    ...processEnv
  } = prepared
  return processEnv
}

function byteLength(value: string | null): number {
  return value ? Buffer.byteLength(value, 'utf8') : 0
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

function isRecapCapacityRefusal(input: AssistantProviderTurnExecutionInput, error: unknown): boolean {
  // Keep tier evidence even for a refusal with no billable token counters.
  // If earlier requests produced usage, extraction above still preserves it.
  return input.hostedToolContext?.currentGameRecapScope?.()?.show === true
    && isAssistantProviderCapacityError(error)
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
