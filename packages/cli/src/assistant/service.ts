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
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './store.js'

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
  })

  const providerOptions = resolveAssistantProviderOptions({
    model: input.model ?? defaults?.model ?? resolved.session.providerOptions.model,
    sandbox: input.sandbox ?? defaults?.sandbox ?? resolved.session.providerOptions.sandbox,
    approvalPolicy:
      input.approvalPolicy ??
      defaults?.approvalPolicy ??
      resolved.session.providerOptions.approvalPolicy,
    profile:
      input.profile ?? defaults?.profile ?? resolved.session.providerOptions.profile,
    oss: input.oss ?? defaults?.oss ?? resolved.session.providerOptions.oss,
  })

  const providerResult = await executeAssistantProviderTurn({
    provider: input.provider ?? defaults?.provider ?? resolved.session.provider,
    workingDirectory: input.workingDirectory ?? input.vault,
    env: cliAccess.env,
    userPrompt: input.prompt,
    systemPrompt:
      resolved.created || resolved.session.turnCount === 0
        ? buildAssistantSystemPrompt(cliAccess)
        : null,
    sessionContext:
      resolved.created || resolved.session.turnCount === 0
        ? {
            binding: resolved.session.binding,
          }
        : undefined,
    resumeProviderSessionId: resolved.session.providerSessionId,
    codexCommand: input.codexCommand ?? defaults?.codexCommand ?? undefined,
    model: providerOptions.model,
    reasoningEffort: input.reasoningEffort ?? null,
    sandbox: providerOptions.sandbox,
    approvalPolicy: providerOptions.approvalPolicy,
    profile: providerOptions.profile,
    oss: providerOptions.oss,
  })

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
): string {
  return [
    'You are Healthy Bob, a local-first health assistant operating over the current working directory as a file-native health vault.',
    'Use the workspace files as the source of truth when relevant.',
    'Default to read-only analysis and conversational answers.',
    'Do not modify files unless the user explicitly asks you to propose changes.',
    'When you reference evidence from the vault, mention relative file paths when practical.',
    buildAssistantCliGuidanceText(cliAccess),
  ].join('\n\n')
}
