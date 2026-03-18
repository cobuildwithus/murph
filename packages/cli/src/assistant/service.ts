import {
  assistantAskResultSchema,
  type AssistantApprovalPolicy,
  type AssistantAskResult,
  type AssistantChatProvider,
  type AssistantDeliveryError,
  type AssistantSandbox,
} from '../assistant-cli-contracts.js'
import {
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import { executeAssistantProviderTurn, resolveAssistantProviderOptions } from '../chat-provider.js'
import { deliverAssistantMessage } from '../outbound-channel.js'
import { resolveAssistantOperatorDefaults } from '../operator-config.js'
import {
  appendAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './store.js'
import {
  loadAssistantMemoryPromptBlock,
} from './memory.js'
import { withAssistantMemoryBridge } from './memory-bridge.js'

export interface AssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  channel?: string | null
  codexCommand?: string
  deliverResponse?: boolean
  deliveryTarget?: string | null
  identityId?: string | null
  model?: string | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  prompt: string
  provider?: AssistantChatProvider
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'deliverResponse' | 'deliveryTarget' | 'prompt'> {
  initialPrompt?: string | null
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const defaults = await resolveAssistantOperatorDefaults()
  const cliAccess = resolveAssistantCliAccessContext()
  const resolved = await resolveAssistantSession({
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
    sandbox: input.sandbox ?? defaults?.sandbox ?? 'read-only',
    approvalPolicy:
      input.approvalPolicy ?? defaults?.approvalPolicy ?? 'never',
    oss: input.oss ?? defaults?.oss ?? false,
    profile: input.profile ?? defaults?.profile ?? null,
    reasoningEffort:
      input.reasoningEffort ??
      defaults?.reasoningEffort ??
      null,
  })

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

  await appendAssistantTranscriptEntries(input.vault, resolved.session.sessionId, [
    {
      kind: 'user',
      text: input.prompt,
    },
  ])

  const providerResult = await withAssistantMemoryBridge(
    {
      allowSensitiveHealthContext,
      vault: input.vault,
    },
    async (memoryBridgeEnv) =>
      executeAssistantProviderTurn({
        provider: input.provider ?? defaults?.provider ?? resolved.session.provider,
        workingDirectory: input.workingDirectory ?? input.vault,
        env: {
          ...cliAccess.env,
          ...memoryBridgeEnv,
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
        profile: providerOptions.profile,
        oss: providerOptions.oss,
      }),
  )

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
    'Do not modify vault files unless the user explicitly asks you to propose changes. Typed assistant-memory upserts through the CLI are the only exception for conversational continuity.',
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
    'Assistant memory is available through explicit CLI tool calls. Do not edit `assistant-state/` files directly.',
    `Use \`${cliAccess.rawCommand} assistant memory search --scope long-term --limit 5\` for durable naming/preferences/instructions, \`${cliAccess.rawCommand} assistant memory search --scope daily --limit 5\` for recent project context, and \`${cliAccess.rawCommand} assistant memory get <memoryId>\` when you need one cited memory item.`,
    `Use \`${cliAccess.rawCommand} assistant memory upsert <text> --scope long-term|daily|both --section ... --sourcePrompt ...\` only when the user wants something remembered or when a stable identity/preference/instruction clearly should persist.`,
    'If several memory lookups or writes are independent, you may run those assistant-memory CLI calls in parallel.',
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
