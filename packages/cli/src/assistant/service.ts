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
  buildAssistantMemoryMcpConfig,
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import {
  executeAssistantProviderTurn,
  resolveAssistantProviderOptions,
  type AssistantProviderProgressEvent,
  type AssistantProviderTurnResult,
} from '../chat-provider.js'
import { deliverAssistantMessage } from '../outbound-channel.js'
import {
  resolveAssistantOperatorDefaults,
  type AssistantOperatorDefaults,
} from '../operator-config.js'
import {
  appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
  type ResolveAssistantSessionInput,
} from './store.js'
import {
  createAssistantMemoryTurnContextEnv,
  loadAssistantMemoryPromptBlock,
} from './memory.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'

interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  channel?: string | null
  identityId?: string | null
  model?: string | null
  maxSessionAgeMs?: number | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  codexCommand?: string
  deliverResponse?: boolean
  deliveryTarget?: string | null
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

export function buildResolveAssistantSessionInput(
  input: AssistantSessionResolutionFields,
  defaults: AssistantOperatorDefaults | null,
): ResolveAssistantSessionInput {
  return {
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId ?? defaults?.identityId ?? null,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
    provider: input.provider ?? defaults?.provider ?? undefined,
    model: input.model ?? defaults?.model ?? null,
    sandbox: input.sandbox ?? defaults?.sandbox ?? 'workspace-write',
    approvalPolicy:
      input.approvalPolicy ?? defaults?.approvalPolicy ?? 'on-request',
    oss: input.oss ?? defaults?.oss ?? false,
    profile: input.profile ?? defaults?.profile ?? null,
    reasoningEffort:
      input.reasoningEffort ??
      defaults?.reasoningEffort ??
      null,
    maxSessionAgeMs: input.maxSessionAgeMs ?? null,
  }
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const defaults = await resolveAssistantOperatorDefaults()
  const cliAccess = resolveAssistantCliAccessContext()
  const resolved = await resolveAssistantSessionForMessage(input, defaults)

  const provider = input.provider ?? defaults?.provider ?? resolved.session.provider
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
  })

  const shouldInjectBootstrapContext =
    resolved.created ||
    resolved.session.turnCount === 0 ||
    resolved.session.providerSessionId === null
  const allowSensitiveHealthContext = shouldExposeSensitiveHealthContext(
    resolved.session.binding,
  )
  const assistantMemoryPrompt = shouldInjectBootstrapContext
    ? await loadAssistantMemoryPromptBlock({
        includeSensitiveHealthContext: allowSensitiveHealthContext,
        vault: input.vault,
      })
    : null

  const persistUserPromptOnFailure = input.persistUserPromptOnFailure ?? true
  let turnCreatedAt = new Date().toISOString()
  if (persistUserPromptOnFailure) {
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
  const memoryTurnEnv = createAssistantMemoryTurnContextEnv({
    allowSensitiveHealthContext,
    sessionId: resolved.session.sessionId,
    sourcePrompt: input.prompt,
    turnId: `${resolved.session.sessionId}:${turnCreatedAt}`,
    vault: input.vault,
  })
  const memoryMcpConfig = buildAssistantMemoryMcpConfig(
    input.workingDirectory ?? input.vault,
  )

  let providerResult: AssistantProviderTurnResult
  try {
    providerResult = await executeAssistantProviderTurn({
      provider,
      workingDirectory: input.workingDirectory ?? input.vault,
      configOverrides: memoryMcpConfig?.configOverrides,
      env: {
        ...cliAccess.env,
        ...memoryTurnEnv,
      },
      userPrompt: input.prompt,
      systemPrompt: shouldInjectBootstrapContext
        ? buildAssistantSystemPrompt(cliAccess, assistantMemoryPrompt)
        : null,
      sessionContext: shouldInjectBootstrapContext
        ? {
            binding: resolved.session.binding,
          }
        : undefined,
      resumeProviderSessionId: resolved.session.providerSessionId,
      codexCommand: input.codexCommand ?? defaults?.codexCommand ?? undefined,
      model: providerOptions.model,
      reasoningEffort: providerOptions.reasoningEffort,
      sandbox: providerOptions.sandbox,
      approvalPolicy: providerOptions.approvalPolicy,
      onEvent: input.onProviderEvent ?? undefined,
      profile: providerOptions.profile,
      oss: providerOptions.oss,
      onTraceEvent: input.onTraceEvent,
      showThinkingTraces: input.showThinkingTraces ?? false,
    })
  } catch (error) {
    const recoveredSession = await recoverAssistantSessionAfterProviderFailure({
      error,
      provider,
      providerOptions,
      session: resolved.session,
      vault: input.vault,
    })
    attachRecoveredAssistantSession(error, recoveredSession)
    throw error
  }

  if (!persistUserPromptOnFailure) {
    await appendAssistantTranscriptEntries(input.vault, resolved.session.sessionId, [
      {
        kind: 'user',
        text: input.prompt,
        createdAt: turnCreatedAt,
      },
    ])
  }

  await appendAssistantTranscriptEntries(input.vault, resolved.session.sessionId, [
    {
      kind: 'assistant',
      text: providerResult.response,
    },
  ])

  const updatedAt = new Date().toISOString()
  let session = await saveAssistantSession(input.vault, {
    ...resolved.session,
    provider: providerResult.provider,
    providerSessionId:
      providerResult.providerSessionId ?? resolved.session.providerSessionId,
    providerOptions,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: resolved.session.turnCount + 1,
  })

  let delivery: AssistantAskResult['delivery'] = null
  let deliveryError: AssistantDeliveryError | null = null

  if (input.deliverResponse) {
    try {
      const delivered = await deliverAssistantMessage({
        vault: input.vault,
        sessionId: session.sessionId,
        channel: session.binding.channel,
        identityId: session.binding.identityId,
        actorId: session.binding.actorId,
        threadId: session.binding.threadId,
        threadIsDirect: session.binding.threadIsDirect,
        target: input.deliveryTarget ?? null,
        message: providerResult.response,
      })
      session = delivered.session
      delivery = delivered.delivery
    } catch (error) {
      deliveryError = {
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
  }

  return assistantAskResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    prompt: input.prompt,
    response: providerResult.response,
    session,
    delivery,
    deliveryError,
  })
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

  const requestedSessionId = input.sessionInput.sessionId
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

function buildAssistantSystemPrompt(
  cliAccess: {
    rawCommand: 'vault-cli'
    setupCommand: 'healthybob'
  },
  assistantMemoryPrompt: string | null,
): string {
  return [
    'You are Healthy Bob, a local-first health assistant operating over the current working directory as a file-native health vault.',
    'Use the workspace files as the source of truth when relevant.',
    'Default to read-only analysis and conversational answers.',
    'Start with the smallest relevant context. Do not scan the whole vault or broad CLI manifests unless the task actually requires that coverage.',
    'Do not modify vault files unless the user explicitly asks you to propose changes. Typed assistant-memory commits through the Healthy Bob memory tools are the only exception for conversational continuity.',
    'When you reference evidence from the vault, mention relative file paths when practical.',
    assistantMemoryPrompt,
    buildAssistantMemoryGuidanceText(cliAccess),
    buildAssistantCliGuidanceText(cliAccess),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}

function buildAssistantMemoryGuidanceText(
  cliAccess: {
    rawCommand: 'vault-cli'
  },
): string {
  return [
    'Assistant memory is available as native Codex MCP tools from the Healthy Bob CLI subtree. Prefer those `assistant memory ...` tools over shelling out, and do not edit `assistant-state/` files directly.',
    'When a Healthy Bob memory tool asks for `vault`, pass the current working directory unless the user explicitly targets a different vault.',
    `Use \`${cliAccess.rawCommand} assistant memory ...\` only as a fallback when the MCP tools are unavailable in this session.`,
    'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
    'Use `assistant memory forget` to remove mistaken or obsolete memory instead of appending a contradiction.',
    'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
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
