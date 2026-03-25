import {
  assistantAskResultSchema,
  type AssistantSession,
  type AssistantApprovalPolicy,
  type AssistantAskResult,
  type AssistantChatProvider,
  type AssistantDeliveryError,
  type AssistantSandbox,
} from '../assistant-cli-contracts.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  buildAssistantCronMcpConfig,
  buildAssistantMemoryMcpConfig,
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import {
  executeAssistantProviderTurn,
  resolveAssistantProviderCapabilities,
  resolveAssistantProviderOptions,
  type AssistantProviderProgressEvent,
  type AssistantProviderTurnResult,
} from '../chat-provider.js'
import { deliverAssistantMessageOverBinding } from '../outbound-channel.js'
import {
  resolveAssistantOperatorDefaults,
  type AssistantOperatorDefaults,
} from '../operator-config.js'
import {
  appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError,
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
  type ResolveAssistantSessionInput,
  type ResolvedAssistantSession,
} from './store.js'
import {
  createAssistantMemoryTurnContextEnv,
  loadAssistantMemoryPromptBlock,
} from './memory.js'
import {
  type AssistantOnboardingSummary,
  updateAssistantOnboardingSummary,
} from './onboarding.js'
import type { ConversationRef } from './conversation-ref.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'

interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  identityId?: string | null
  model?: string | null
  maxSessionAgeMs?: number | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  abortSignal?: AbortSignal
  codexCommand?: string
  deliverResponse?: boolean
  deliveryTarget?: string | null
  enableFirstTurnOnboarding?: boolean
  maxSessionAgeMs?: number | null
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  persistUserPromptOnFailure?: boolean
  prompt: string
  sessionSnapshot?: AssistantSession | null
  showThinkingTraces?: boolean
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'deliverResponse' | 'deliveryTarget' | 'prompt'> {
  initialPrompt?: string | null
}

interface AssistantTurnPlan {
  allowSensitiveHealthContext: boolean
  cliEnv: NodeJS.ProcessEnv
  configOverrides?: readonly string[]
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  persistUserPromptOnFailure: boolean
  provider: AssistantChatProvider
  providerOptions: ReturnType<typeof resolveAssistantProviderOptions>
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  systemPrompt: string | null
  workingDirectory: string
}

interface PersistedUserTurn {
  turnCreatedAt: string
}

type AssistantDeliveryOutcome =
  | {
      kind: 'failed'
      error: AssistantDeliveryError
    }
  | {
      kind: 'not-requested'
    }
  | {
      kind: 'sent'
      delivery: NonNullable<AssistantAskResult['delivery']>
      session: AssistantSession
    }

export function buildResolveAssistantSessionInput(
  input: AssistantSessionResolutionFields,
  defaults: AssistantOperatorDefaults | null,
): ResolveAssistantSessionInput {
  const sessionId = input.conversation?.sessionId ?? input.sessionId
  const alias = input.conversation?.alias ?? input.alias
  const channel = input.conversation?.channel ?? input.channel
  const identityId =
    input.conversation?.identityId ??
    input.identityId ??
    defaults?.identityId ??
    null
  const participantId =
    input.conversation?.participantId ??
    input.actorId ??
    input.participantId ??
    null
  const threadId =
    input.conversation?.threadId ?? input.threadId ?? input.sourceThreadId ?? null
  const directness =
    typeof input.threadIsDirect === 'boolean'
      ? input.threadIsDirect
        ? 'direct'
        : 'group'
      : input.conversation?.directness ?? null

  return {
    vault: input.vault,
    sessionId,
    alias,
    channel,
    identityId,
    actorId: participantId,
    threadId,
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean'
        ? input.threadIsDirect
        : directness === 'direct'
          ? true
          : directness === 'group'
            ? false
            : undefined,
    provider: input.provider ?? defaults?.provider ?? undefined,
    model: input.model ?? defaults?.model ?? null,
    sandbox: input.sandbox ?? defaults?.sandbox ?? 'workspace-write',
    approvalPolicy:
      input.approvalPolicy ?? defaults?.approvalPolicy ?? 'on-request',
    oss: input.oss ?? defaults?.oss ?? false,
    profile: input.profile ?? defaults?.profile ?? null,
    baseUrl: input.baseUrl ?? defaults?.baseUrl ?? null,
    apiKeyEnv: input.apiKeyEnv ?? defaults?.apiKeyEnv ?? null,
    providerName: input.providerName ?? defaults?.providerName ?? null,
    reasoningEffort:
      input.reasoningEffort ??
      defaults?.reasoningEffort ??
      null,
    maxSessionAgeMs: input.maxSessionAgeMs ?? null,
  }
}

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  const defaults = await resolveAssistantOperatorDefaults()
  return resolveAssistantSession(buildResolveAssistantSessionInput(input, defaults))
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const defaults = await resolveAssistantOperatorDefaults()
  const resolved = await resolveAssistantSessionForMessage(input, defaults)
  const plan = await resolveAssistantTurnPlan(input, defaults, resolved)
  const userTurn = await persistUserTurn(input, resolved, plan)
  const providerResult = await executeProviderTurnWithRecovery({
    defaults,
    input,
    plan,
    resolved,
    turnCreatedAt: userTurn.turnCreatedAt,
  })
  const session = await persistAssistantTurnAndSession({
    input,
    plan,
    providerResult,
    resolved,
    turnCreatedAt: userTurn.turnCreatedAt,
  })
  const deliveryOutcome = await deliverAssistantReply({
    input,
    response: providerResult.response,
    session,
  })

  return assistantAskResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    prompt: input.prompt,
    response: providerResult.response,
    session: deliveryOutcome.kind === 'sent' ? deliveryOutcome.session : session,
    delivery: deliveryOutcome.kind === 'sent' ? deliveryOutcome.delivery : null,
    deliveryError:
      deliveryOutcome.kind === 'failed' ? deliveryOutcome.error : null,
  })
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const session = await resolveAssistantSession({
    vault: input.vault,
    conversation: {
      sessionId: input.sessionId,
    },
    createIfMissing: false,
  })

  return saveAssistantSession(input.vault, {
    ...session.session,
    providerOptions: {
      ...session.session.providerOptions,
      ...input.providerOptions,
    },
    updatedAt: new Date().toISOString(),
  })
}

async function resolveAssistantTurnPlan(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnPlan> {
  const provider = input.provider ?? resolved.session.provider ?? defaults?.provider
  const providerOptions = resolveAssistantProviderOptions({
    model: input.model ?? resolved.session.providerOptions.model ?? defaults?.model,
    reasoningEffort:
      input.reasoningEffort ??
      resolved.session.providerOptions.reasoningEffort ??
      defaults?.reasoningEffort,
    sandbox:
      input.sandbox ??
      resolved.session.providerOptions.sandbox ??
      defaults?.sandbox,
    approvalPolicy:
      input.approvalPolicy ??
      resolved.session.providerOptions.approvalPolicy ??
      defaults?.approvalPolicy,
    profile:
      input.profile ??
      resolved.session.providerOptions.profile ??
      defaults?.profile,
    oss:
      input.oss ??
      resolved.session.providerOptions.oss ??
      defaults?.oss,
    baseUrl:
      input.baseUrl ??
      resolved.session.providerOptions.baseUrl ??
      defaults?.baseUrl,
    apiKeyEnv:
      input.apiKeyEnv ??
      resolved.session.providerOptions.apiKeyEnv ??
      defaults?.apiKeyEnv,
    providerName:
      input.providerName ??
      resolved.session.providerOptions.providerName ??
      defaults?.providerName,
  })
  const shouldInjectBootstrapContext =
    resolved.created ||
    resolved.session.turnCount === 0 ||
    provider === 'openai-compatible' ||
    provider !== resolved.session.provider ||
    resolved.session.providerSessionId === null
  const shouldInjectFirstTurnOnboarding =
    input.enableFirstTurnOnboarding === true &&
    (resolved.created || resolved.session.turnCount === 0)
  const conversationMessages = shouldUseLocalTranscriptContext(provider)
    ? await loadAssistantConversationMessages({
        limit: 20,
        sessionId: resolved.session.sessionId,
        vault: input.vault,
      })
    : undefined
  const onboardingSummary =
    input.enableFirstTurnOnboarding === true
      ? await updateAssistantOnboardingSummary({
          prompt: input.prompt,
          vault: input.vault,
        })
      : null
  const allowSensitiveHealthContext = shouldExposeSensitiveHealthContext(
    resolved.session.binding,
  )
  const assistantMemoryPrompt = shouldInjectBootstrapContext
    ? await loadAssistantMemoryPromptBlock({
        includeSensitiveHealthContext: allowSensitiveHealthContext,
        vault: input.vault,
      })
    : null
  const cliAccess = resolveAssistantCliAccessContext()
  const workingDirectory = input.workingDirectory ?? input.vault
  const providerCapabilities = resolveAssistantProviderCapabilities(provider)
  const supportsDirectCliExecution = providerCapabilities.supportsDirectCliExecution
  const memoryMcpConfig = buildAssistantMemoryMcpConfig(workingDirectory)
  const cronMcpConfig = buildAssistantCronMcpConfig(workingDirectory)
  const assistantMemoryMcpAvailable =
    supportsDirectCliExecution && memoryMcpConfig !== null
  const assistantCronMcpAvailable =
    supportsDirectCliExecution && cronMcpConfig !== null
  const configOverrides = [
    ...(memoryMcpConfig?.configOverrides ?? []),
    ...(cronMcpConfig?.configOverrides ?? []),
  ]

  return {
    allowSensitiveHealthContext,
    cliEnv: cliAccess.env,
    configOverrides: configOverrides.length > 0 ? configOverrides : undefined,
    conversationMessages,
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    provider,
    providerOptions,
    resumeProviderSessionId:
      provider === resolved.session.provider
        ? resolved.session.providerSessionId
        : null,
    sessionContext: shouldInjectBootstrapContext
      ? {
          binding: resolved.session.binding,
        }
      : undefined,
    systemPrompt: shouldInjectBootstrapContext
      ? buildAssistantSystemPrompt({
          assistantCronMcpAvailable,
          cliAccess,
          assistantMemoryMcpAvailable,
          assistantMemoryPrompt,
          channel: input.channel ?? resolved.session.binding.channel,
          onboardingSummary:
            shouldInjectFirstTurnOnboarding && onboardingSummary
              ? onboardingSummary
              : null,
          supportsDirectCliExecution,
        })
      : null,
    workingDirectory,
  }
}

async function persistUserTurn(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
  plan: AssistantTurnPlan,
): Promise<PersistedUserTurn> {
  let turnCreatedAt = new Date().toISOString()
  if (plan.persistUserPromptOnFailure) {
    const userEntries = await appendAssistantTranscriptEntries(
      input.vault,
      resolved.session.sessionId,
      [
        {
          kind: 'user',
          text: input.prompt,
        },
      ],
    )
    turnCreatedAt = userEntries[0]?.createdAt ?? turnCreatedAt
  }

  return {
    turnCreatedAt,
  }
}

async function executeProviderTurnWithRecovery(input: {
  defaults: AssistantOperatorDefaults | null
  input: AssistantMessageInput
  plan: AssistantTurnPlan
  resolved: ResolvedAssistantSession
  turnCreatedAt: string
}): Promise<AssistantProviderTurnResult> {
  const memoryTurnEnv = createAssistantMemoryTurnContextEnv({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    sessionId: input.resolved.session.sessionId,
    sourcePrompt: input.input.prompt,
    turnId: `${input.resolved.session.sessionId}:${input.turnCreatedAt}`,
    vault: input.input.vault,
  })

  try {
    return await executeAssistantProviderTurn({
      abortSignal: input.input.abortSignal,
      provider: input.plan.provider,
      workingDirectory: input.plan.workingDirectory,
      configOverrides: input.plan.configOverrides,
      env: {
        ...input.plan.cliEnv,
        ...memoryTurnEnv,
      },
      userPrompt: input.input.prompt,
      systemPrompt: input.plan.systemPrompt,
      sessionContext: input.plan.sessionContext,
      resumeProviderSessionId: input.plan.resumeProviderSessionId,
      codexCommand:
        input.input.codexCommand ?? input.defaults?.codexCommand ?? undefined,
      model: input.plan.providerOptions.model,
      reasoningEffort: input.plan.providerOptions.reasoningEffort,
      sandbox: input.plan.providerOptions.sandbox,
      approvalPolicy: input.plan.providerOptions.approvalPolicy,
      baseUrl: input.plan.providerOptions.baseUrl,
      apiKeyEnv: input.plan.providerOptions.apiKeyEnv,
      providerName: input.plan.providerOptions.providerName,
      conversationMessages: input.plan.conversationMessages,
      onEvent: input.input.onProviderEvent ?? undefined,
      profile: input.plan.providerOptions.profile,
      oss: input.plan.providerOptions.oss,
      onTraceEvent: input.input.onTraceEvent,
      showThinkingTraces: input.input.showThinkingTraces ?? false,
    })
  } catch (error) {
    const recoveredSession = await recoverAssistantSessionAfterProviderFailure({
      error,
      provider: input.plan.provider,
      providerOptions: input.plan.providerOptions,
      session: input.resolved.session,
      vault: input.input.vault,
    })
    attachRecoveredAssistantSession(error, recoveredSession)
    throw error
  }
}

async function persistAssistantTurnAndSession(input: {
  input: AssistantMessageInput
  plan: AssistantTurnPlan
  providerResult: AssistantProviderTurnResult
  resolved: ResolvedAssistantSession
  turnCreatedAt: string
}): Promise<AssistantSession> {
  if (!input.plan.persistUserPromptOnFailure) {
    await appendAssistantTranscriptEntries(
      input.input.vault,
      input.resolved.session.sessionId,
      [
        {
          kind: 'user',
          text: input.input.prompt,
          createdAt: input.turnCreatedAt,
        },
      ],
    )
  }

  await appendAssistantTranscriptEntries(
    input.input.vault,
    input.resolved.session.sessionId,
    [
      {
        kind: 'assistant',
        text: input.providerResult.response,
      },
    ],
  )

  const updatedAt = new Date().toISOString()
  return saveAssistantSession(input.input.vault, {
    ...input.resolved.session,
    provider: input.providerResult.provider,
    providerSessionId: resolveNextProviderSessionId({
      provider: input.providerResult.provider,
      providerSessionId: input.providerResult.providerSessionId,
      previousProvider: input.resolved.session.provider,
      previousProviderSessionId: input.resolved.session.providerSessionId,
    }),
    providerOptions: input.plan.providerOptions,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.resolved.session.turnCount + 1,
  })
}

async function deliverAssistantReply(input: {
  input: AssistantMessageInput
  response: string
  session: AssistantSession
}): Promise<AssistantDeliveryOutcome> {
  if (!input.input.deliverResponse) {
    return {
      kind: 'not-requested',
    }
  }

  try {
    const delivered = await deliverAssistantMessageOverBinding({
      message: sanitizeAssistantOutboundReply(
        input.response,
        input.session.binding.channel,
      ),
      channel: input.session.binding.channel,
      identityId: input.session.binding.identityId,
      actorId: input.session.binding.actorId,
      threadId: input.session.binding.threadId,
      threadIsDirect: input.session.binding.threadIsDirect,
      sessionId: input.session.sessionId,
      target: input.input.deliveryTarget ?? null,
      vault: input.input.vault,
    })

    return {
      kind: 'sent',
      delivery: delivered.delivery,
      session:
        delivered.session ??
        await persistAssistantDeliverySession({
          delivery: delivered.delivery,
          session: input.session,
          vault: input.input.vault,
        }),
    }
  } catch (error) {
    return {
      kind: 'failed',
      error: normalizeAssistantDeliveryError(error),
    }
  }
}

async function persistAssistantDeliverySession(input: {
  delivery: NonNullable<AssistantAskResult['delivery']>
  session: AssistantSession
  vault: string
}): Promise<AssistantSession> {
  const deliveredAt = input.delivery.sentAt
  return saveAssistantSession(input.vault, {
    ...input.session,
    binding: {
      ...input.session.binding,
      channel: input.delivery.channel,
    },
    updatedAt: deliveredAt,
    lastTurnAt: deliveredAt,
  })
}

function normalizeAssistantDeliveryError(
  error: unknown,
): AssistantDeliveryError {
  return {
    code:
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null,
    message:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error),
  }
}

function shouldUseLocalTranscriptContext(
  provider: AssistantChatProvider,
): boolean {
  return provider === 'openai-compatible'
}

async function loadAssistantConversationMessages(input: {
  limit: number
  sessionId: string
  vault: string
}): Promise<Array<{
  content: string
  role: 'assistant' | 'user'
}>> {
  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    input.sessionId,
  )

  return transcript
    .slice(-input.limit)
    .flatMap((entry) =>
      isAssistantConversationTranscriptEntry(entry)
        ? [{
            role: entry.kind,
            content: entry.text,
          }]
        : [],
    )
}

function isAssistantConversationTranscriptEntry(entry: {
  kind: string
  text: string
}): entry is {
  kind: 'assistant' | 'user'
  text: string
} {
  return entry.kind === 'assistant' || entry.kind === 'user'
}

function resolveNextProviderSessionId(input: {
  previousProvider: AssistantChatProvider
  previousProviderSessionId: string | null
  provider: AssistantChatProvider
  providerSessionId: string | null
}): string | null {
  if (input.provider !== input.previousProvider) {
    return input.providerSessionId
  }

  return input.providerSessionId ?? input.previousProviderSessionId
}

async function resolveAssistantSessionForMessage(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
) {
  const sessionInput = buildResolveAssistantSessionInput(input, defaults)

  try {
    return await resolveAssistantSession(sessionInput)
  } catch (error) {
    const restored = await restoreMissingAssistantSessionSnapshot({
      error,
      input,
      sessionInput,
    })
    if (!restored) {
      throw error
    }

    return resolveAssistantSession({
      ...sessionInput,
      createIfMissing: false,
    })
  }
}

async function restoreMissingAssistantSessionSnapshot(input: {
  error: unknown
  input: AssistantMessageInput
  sessionInput: ResolveAssistantSessionInput
}): Promise<boolean> {
  if (!isAssistantSessionNotFoundError(input.error)) {
    return false
  }

  const requestedSessionId =
    input.sessionInput.conversation?.sessionId ?? input.sessionInput.sessionId
  const snapshot = input.input.sessionSnapshot
  if (
    typeof requestedSessionId !== 'string' ||
    requestedSessionId.trim().length === 0 ||
    !snapshot ||
    snapshot.sessionId !== requestedSessionId
  ) {
    return false
  }

  // Live Ink chat already has the hydrated session in memory, so recreate the
  // missing local session file and retry the normal resolution path once.
  await saveAssistantSession(input.input.vault, snapshot)
  return true
}

function buildAssistantSystemPrompt(input: {
  assistantCronMcpAvailable: boolean
  assistantMemoryMcpAvailable: boolean
  cliAccess: {
    rawCommand: 'vault-cli'
    setupCommand: 'healthybob'
  }
  assistantMemoryPrompt: string | null
  channel: string | null
  onboardingSummary: AssistantOnboardingSummary | null
  supportsDirectCliExecution: boolean
}): string {
  return [
    'You are Healthy Bob, a local-first health assistant bound to one active vault for this session.',
    'The active vault is already selected for this turn. The shell working directory and `VAULT` environment variable both point at it. Unless the user explicitly targets another vault, operate on this bound vault only.',
    [
      'Choose the right mode before acting:',
      '- Vault operator mode (default): inspect or change Healthy Bob vault/runtime state through `vault-cli` semantics and any Healthy Bob assistant tools exposed in this session. This is not repo coding work.',
      '- Repo coding mode: only when the user explicitly asks to change repository code, tests, or docs.',
    ].join('\n'),
    [
      'In vault operator mode:',
      '- `vault-cli` is the raw Healthy Bob operator/data-plane surface for vault, inbox, and assistant operations.',
      '- `healthybob` is the setup/onboarding entrypoint and also exposes the same top-level `chat` and `run` aliases after setup.',
      '- `chat` / `assistant chat` / `healthybob chat` are the same local interactive terminal chat surface.',
      '- `run` / `assistant run` / `healthybob run` are the long-lived automation loop for inbox watch, scheduled prompts, and configured channel auto-reply; with a model they can also triage inbox captures into structured vault updates.',
      '- Default to read-only inspection. Only write canonical vault data when the user is clearly asking to log, create, update, or delete something in the vault. Treat capture-style requests like meal logging as explicit permission to use the matching CLI write surface.',
      '- Do not run repo tests, typechecks, coverage, coordination-ledger updates, or auto-commit workflows just because a vault CLI command changed data. Only use repo coding workflows when you edit repo code/docs or the user explicitly asks for software changes.',
    ].join('\n'),
    'Start with the smallest relevant context. Do not scan the whole vault or broad CLI manifests unless the task actually requires that coverage.',
    'Use canonical vault records and structured CLI output as the source of truth for health data. Read raw files directly only when the CLI lacks the view you need or the user explicitly asks for file-level inspection.',
    buildAssistantVaultEvidenceFormattingGuidance(input.channel),
    buildOutboundReplyFormattingGuidance(input.channel),
    buildAssistantFirstTurnOnboardingGuidanceText(input.onboardingSummary),
    input.assistantMemoryPrompt,
    buildAssistantMemoryGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantMemoryMcpAvailable: input.assistantMemoryMcpAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantCronGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantCronMcpAvailable: input.assistantCronMcpAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantCliGuidanceText(input.cliAccess, {
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}

function buildAssistantVaultEvidenceFormattingGuidance(
  channel: string | null,
): string | null {
  if (isAssistantOutboundReplyChannel(channel)) {
    return null
  }

  return 'When you reference evidence from the vault, mention relative file paths when practical.'
}

function buildAssistantFirstTurnOnboardingGuidanceText(
  summary: AssistantOnboardingSummary | null,
): string | null {
  if (!summary || summary.missingSlots.length === 0) {
    return null
  }

  const known = [
    summary.answered.name ? `Name: ${summary.answered.name}` : null,
    summary.answered.tone ? `Tone/style: ${summary.answered.tone}` : null,
    summary.answered.goals.length > 0
      ? `Goals: ${summary.answered.goals.join(' | ')}`
      : null,
  ].filter((value): value is string => value !== null)
  const missing = summary.missingSlots.map((slot) => {
    switch (slot) {
      case 'name':
        return 'whether they want to give you a name'
      case 'tone':
        return 'what tone or response style they want'
      case 'goals':
        return 'what goals they want help with'
    }
  })

  return [
    known.length > 0
      ? `Known onboarding answers from prior sessions or the current message:\n- ${known.join('\n- ')}`
      : null,
    `On the first reply of a brand-new interactive chat session, include one short optional onboarding check-in only for the still-missing items:\n- ${missing.join('\n- ')}`,
    'If the first user message already asks for something concrete, answer that request first and then add the optional check-in as a brief closing note.',
    'Ask only about the missing items above, make it clear they are optional, and skip anything the user already told you.',
    'Stop asking once all onboarding items are filled. Do not repeat answered items or turn the check-in into a longer interview.',
  ].join('\n\n')
}

function buildOutboundReplyFormattingGuidance(channel: string | null): string | null {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return null
  }

  return [
    'You are replying through a user-facing messaging channel, not the local terminal chat UI.',
    'Never include citations, source lists, footnotes, bracketed references, or appended file-path/source callouts in the reply unless the user explicitly asks for them.',
    'Do not mention internal vault paths, ledger filenames, JSONL files, or other implementation-level storage details unless the user explicitly asks for that detail.',
    'Do not surface raw machine timestamps such as ISO-8601 values by default. Prefer natural phrasing in the user-facing time context, such as "last night," "yesterday evening," or an explicit local date/time only when that precision is actually helpful.',
    'Reply naturally in plain conversational prose that fits the channel.',
  ].join('\n')
}

function isAssistantOutboundReplyChannel(channel: string | null): boolean {
  return (
    channel === 'email' ||
    channel === 'imessage' ||
    channel === 'linq' ||
    channel === 'telegram'
  )
}

function buildAssistantMemoryGuidanceText(
  input: {
    assistantMemoryMcpAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantMemoryMcpAvailable) {
    return [
      'Assistant memory MCP tools are exposed in this session. Prefer `assistant memory ...` tools over shelling out, and do not edit `assistant-state/` files directly.',
      'When the current request depends on prior preferences, ongoing goals, recurring health context, or earlier plans, search assistant memory before answering.',
      'When a Healthy Bob memory tool asks for `vault`, pass the current working directory unless the user explicitly targets a different vault.',
      `Use \`${input.rawCommand} assistant memory ...\` only as a fallback when the MCP tools are unavailable in this session.`,
      'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
      'After a substantive conversation that surfaces a stable identity, preference, standing instruction, or durable health baseline, consider offering one short remember suggestion and only upsert after explicit user intent or acceptance.',
      'When manually upserting durable memory outside a live assistant turn, phrase `text` as the exact stored sentence you want committed, such as `Call the user Alex.`, `User prefers the default assistant tone.`, or `Keep responses brief.`',
      'Use `assistant memory forget` to remove mistaken or obsolete memory instead of appending a contradiction.',
      'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Assistant memory MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available.',
      `Use \`${input.rawCommand} assistant memory search|get|upsert|forget\` when you need stored memory, and do not edit \`assistant-state/\` files directly.`,
      'When the current request depends on prior preferences, ongoing goals, recurring health context, or earlier plans, search assistant memory before answering.',
      'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
      'After a substantive conversation that surfaces a stable identity, preference, standing instruction, or durable health baseline, consider offering one short remember suggestion and only upsert after explicit user intent or acceptance.',
      'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Healthy Bob assistant-memory tools or direct shell access.',
    'Use the injected core memory block if present, but do not claim you searched, updated, or forgot assistant memory unless a real tool call happened.',
    `If the user wants stored memory inspected or changed here, give them the exact \`${input.rawCommand} assistant memory ...\` command to run or switch to a Codex-backed Healthy Bob chat session.`,
    'When prior continuity would matter and you cannot search memory in this session, ask a brief clarifying question instead of inventing recall.',
    'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
  ].join('\n\n')
}

function buildAssistantCronGuidanceText(
  input: {
    assistantCronMcpAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantCronMcpAvailable) {
    return [
      'Scheduled assistant automation MCP tools are exposed in this session. Prefer `assistant cron ...` tools over shelling out, and do not edit `assistant-state/cron/` files directly.',
      'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
      'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
      'Use `assistant cron add` for one-shot reminders with `--at` and recurring jobs with `--every` or `--cron`.',
      'Inspect the scheduler with `assistant cron status`, `assistant cron list`, `assistant cron show`, and `assistant cron runs` before changing an existing job.',
      'Cron schedules execute while `assistant run` is active for the vault.',
      'When a user or cron prompt asks for research on a complex topic or a broad current-evidence scan, default to `research` so the tool runs `review:gpt --deep-research --send --wait`. Use `deepthink` only when the task is a GPT Pro synthesis without Deep Research.',
      'Deep Research can legitimately take 10 to 60 minutes, sometimes longer, so keep waiting on the tool unless it actually errors or times out. Healthy Bob defaults the overall timeout to 40m.',
      '`--timeout` is the normal control. `--wait-timeout` is only for the uncommon case where you want the assistant-response wait cap different from the overall timeout.',
      'Cron prompts may explicitly tell you to use the research tool. In that case, run `research` for Deep Research or `deepthink` for GPT Pro before composing the final cron reply.',
      'Both research commands wait for completion and save a markdown note under `research/` inside the vault.',
      `Use \`${input.rawCommand} assistant cron ...\` only as a fallback when the MCP tools are unavailable in this session.`,
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Scheduled assistant automation MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available.',
      `Use \`${input.rawCommand} assistant cron ...\` when you need to inspect or change scheduled automation, and do not edit \`assistant-state/cron/\` files directly.`,
      'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
      'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
      'Use `assistant cron add` for one-shot reminders with `--at` and recurring jobs with `--every` or `--cron`.',
      'Inspect the scheduler with `assistant cron status`, `assistant cron list`, `assistant cron show`, and `assistant cron runs` before changing an existing job.',
      'Cron schedules execute while `assistant run` is active for the vault.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Healthy Bob cron tools or direct shell access.',
    `If the user wants automation here, explain the relevant \`${input.rawCommand} assistant cron ...\` command or suggest switching to a Codex-backed Healthy Bob chat session.`,
    'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
    'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
    'Do not claim you created, changed, or inspected a cron job in this session unless a real tool call happened.',
    'Cron schedules execute while `assistant run` is active for the vault.',
  ].join('\n\n')
}

function shouldExposeSensitiveHealthContext(binding: {
  channel: string | null
  threadIsDirect: boolean | null
}): boolean {
  if (binding.channel === null) {
    return true
  }

  return binding.threadIsDirect === true
}

const ASSISTANT_LOCAL_MARKDOWN_LINK_PATTERN =
  /\[([^\]\n]+)\]\(((?:\/|file:\/\/)[^)]+)\)/gu

function sanitizeAssistantOutboundReply(
  message: string,
  channel: string | null,
): string {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return message
  }

  const withoutLocalMarkdownLinks = message.replace(
    ASSISTANT_LOCAL_MARKDOWN_LINK_PATTERN,
    '$1',
  )
  const normalizedLines = withoutLocalMarkdownLinks
    .split('\n')
    .map((line) => stripAssistantSourceCalloutPrefix(line))

  return normalizedLines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function stripAssistantSourceCalloutPrefix(line: string): string {
  const match = /^(\s*(?:[-*]\s+)?)(?:In|From)\s+(.+?):\s+/u.exec(line)
  if (!match) {
    return line
  }

  const prefix = match[1] ?? ''
  const referenceClause = match[2] ?? ''
  if (!looksLikeAssistantSourceReferenceClause(referenceClause)) {
    return line
  }

  return `${prefix}${line.slice(match[0].length)}`
}

function looksLikeAssistantSourceReferenceClause(value: string): boolean {
  const parts = value
    .split(/\s+(?:and|or)\s+|,\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return parts.length > 0 && parts.every((part) => isAssistantSourceReference(part))
}

function isAssistantSourceReference(value: string): boolean {
  const normalized = value.trim().replace(/^`|`$/gu, '')
  if (normalized.length === 0) {
    return false
  }

  if (normalized.startsWith('/') || normalized.startsWith('file://')) {
    return true
  }

  if (
    /^(?:journal|ledger|raw|derived|research|experiments|assistant-state)(?:\/|$)/u.test(
      normalized,
    )
  ) {
    return true
  }

  return /(?:^|\/)[A-Za-z0-9._-]+\.(?:md|jsonl|json|txt|csv|ya?ml)$/u.test(
    normalized,
  )
}
