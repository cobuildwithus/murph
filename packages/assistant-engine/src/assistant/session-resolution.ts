import {
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import {
  compactAssistantProviderConfigInput,
} from './provider-config.js'
import { resolveAssistantSession, type ResolveAssistantSessionInput } from './store.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'

export function buildResolveAssistantSessionInput(
  input: AssistantSessionResolutionFields,
  defaults: AssistantOperatorDefaults | null,
  boundaryDefaultTarget: AssistantModelTarget | null = null,
): ResolveAssistantSessionInput {
  const executionPlan = resolveAssistantExecutionPlan({
    boundaryDefaultTarget,
    defaults,
    override: compactAssistantProviderConfigInput(input),
  })
  const target = executionPlan.primaryTarget
  const providerConfig = executionPlan.primaryProviderConfig
  const conversation =
    typeof input.conversation === 'object' && input.conversation !== null
      ? input.conversation
      : null
  const sessionId = readAssistantSessionResolutionField({
    input,
    conversation,
    field: 'sessionId',
  })
  const alias = readAssistantSessionResolutionField({
    input,
    conversation,
    field: 'alias',
  })
  const channel = readAssistantSessionResolutionField({
    input,
    conversation,
    field: 'channel',
  })
  const identityId =
    readAssistantSessionResolutionField({
      input,
      conversation,
      field: 'identityId',
    }) ??
    defaults?.identityId ??
    undefined
  const participantId = readAssistantSessionResolutionParticipant(input, conversation)
  const threadId = readAssistantSessionResolutionThread(input, conversation)
  const directness = readAssistantSessionResolutionDirectness(input, conversation)
  const threadIsDirect =
    typeof input.threadIsDirect === 'boolean'
      ? input.threadIsDirect
      : directness === 'direct'
        ? true
        : directness === 'group'
          ? false
          : undefined

  const defaultSandbox =
    providerConfig.provider === 'codex-cli'
      ? (providerConfig.sandbox ?? 'danger-full-access')
      : providerConfig.sandbox
  const defaultApprovalPolicy =
    providerConfig.provider === 'codex-cli'
      ? (providerConfig.approvalPolicy ?? 'never')
      : providerConfig.approvalPolicy

  return {
    vault: input.vault,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(alias !== undefined ? { alias } : {}),
    ...(input.allowBindingRebind === true ? { allowBindingRebind: true } : {}),
    ...(channel !== undefined ? { channel } : {}),
    ...(identityId !== undefined ? { identityId } : {}),
    ...(participantId !== undefined ? { actorId: participantId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(threadIsDirect !== undefined ? { threadIsDirect } : {}),
    target,
    provider: providerConfig.provider,
    model: providerConfig.model,
    sandbox: defaultSandbox,
    approvalPolicy: defaultApprovalPolicy,
    oss: providerConfig.oss ?? false,
    profile: providerConfig.profile,
    ...(providerConfig.codexHome ? { codexHome: providerConfig.codexHome } : {}),
    baseUrl: providerConfig.baseUrl,
    apiKeyEnv: providerConfig.apiKeyEnv,
    providerName: providerConfig.providerName,
    headers:
      providerConfig.provider === 'openai-compatible' ? providerConfig.headers : null,
    reasoningEffort: providerConfig.reasoningEffort,
    maxSessionAgeMs: input.maxSessionAgeMs ?? null,
  }
}

function readAssistantSessionResolutionField(
  input: {
    conversation: NonNullable<AssistantSessionResolutionFields['conversation']> | null
    field: 'alias' | 'channel' | 'identityId' | 'sessionId'
    input: AssistantSessionResolutionFields
  },
): string | null | undefined {
  if (input.conversation && input.field in input.conversation) {
    return input.conversation[input.field]
  }
  if (input.field in input.input) {
    return input.input[input.field]
  }
  return undefined
}

function readAssistantSessionResolutionParticipant(
  input: AssistantSessionResolutionFields,
  conversation: NonNullable<AssistantSessionResolutionFields['conversation']> | null,
): string | null | undefined {
  if (conversation && 'participantId' in conversation) {
    return conversation.participantId
  }
  if ('actorId' in input) {
    return input.actorId
  }
  if ('participantId' in input) {
    return input.participantId
  }
  return undefined
}

function readAssistantSessionResolutionThread(
  input: AssistantSessionResolutionFields,
  conversation: NonNullable<AssistantSessionResolutionFields['conversation']> | null,
): string | null | undefined {
  if (conversation && 'threadId' in conversation) {
    return conversation.threadId
  }
  if ('threadId' in input) {
    return input.threadId
  }
  if ('sourceThreadId' in input) {
    return input.sourceThreadId
  }
  return undefined
}

function readAssistantSessionResolutionDirectness(
  input: AssistantSessionResolutionFields,
  conversation: NonNullable<AssistantSessionResolutionFields['conversation']> | null,
) {
  if (typeof input.threadIsDirect === 'boolean') {
    return input.threadIsDirect ? 'direct' : 'group'
  }
  if (conversation && 'directness' in conversation) {
    return conversation.directness ?? null
  }
  return null
}

export async function resolveAssistantSessionForMessage(input: {
  boundaryDefaultTarget?: AssistantModelTarget | null
  defaults: AssistantOperatorDefaults | null
  message: AssistantMessageInput
}) {
  return resolveAssistantSession(buildResolveAssistantSessionInput(
    input.message,
    input.defaults,
    input.boundaryDefaultTarget ?? null,
  ))
}

export function resolveAssistantSessionTarget(input: {
  boundaryDefaultTarget?: AssistantModelTarget | null
  defaults: AssistantOperatorDefaults | null
  input: AssistantSessionResolutionFields
}): AssistantModelTarget {
  return resolveAssistantExecutionPlan({
    boundaryDefaultTarget: input.boundaryDefaultTarget ?? null,
    defaults: input.defaults,
    override: compactAssistantProviderConfigInput(input.input),
  }).primaryTarget
}
