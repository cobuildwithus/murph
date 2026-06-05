import {
  normalizeAssistantBackendTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import {
  compactAssistantProviderConfigInput,
  isAssistantCodexTargetConfig,
  resolveAssistantChatProviderFromConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
  resolveAssistantSession,
  type ResolveAssistantSessionInput,
  type ResolvedAssistantSession,
} from './store.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import {
  serializeAssistantConversationForPersistence,
} from './conversation-persistence.js'
import { normalizeNullableString } from './shared.js'

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
  const deliveryKind = input.deliveryKind ?? undefined
  const bindingDeliveryTarget = input.bindingDeliveryTarget ?? undefined

  const defaultSandbox = providerConfig.policy.sandbox ?? 'danger-full-access'
  const defaultApprovalPolicy = providerConfig.policy.approvalPolicy ?? 'never'

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
    ...(deliveryKind !== undefined ? { deliveryKind } : {}),
    ...(bindingDeliveryTarget !== undefined ? { bindingDeliveryTarget } : {}),
    target,
    provider: resolveAssistantChatProviderFromConfig(providerConfig),
    model: providerConfig.target.model,
    modelProvider: isAssistantCodexTargetConfig(providerConfig)
      ? providerConfig.target.modelProvider
      : null,
    sandbox: defaultSandbox,
    approvalPolicy: defaultApprovalPolicy,
    oss: isAssistantCodexTargetConfig(providerConfig) ? providerConfig.target.oss : false,
    profile:
      isAssistantCodexTargetConfig(providerConfig)
        ? providerConfig.target.profile
        : null,
    ...(isAssistantCodexTargetConfig(providerConfig) && providerConfig.target.codexHome
      ? { codexHome: providerConfig.target.codexHome }
      : {}),
    reasoningEffort: providerConfig.policy.reasoningEffort,
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
    const conversationValue = input.conversation[input.field]
    if (normalizeNullableString(conversationValue) !== null) {
      return conversationValue
    }
    if (input.field in input.input) {
      return input.input[input.field]
    }
    return conversationValue
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
  const resolved = await resolveAssistantSession(buildResolveAssistantSessionInput(
    input.message,
    input.defaults,
    input.boundaryDefaultTarget ?? null,
  ))
  const hostedDefaultTarget =
    normalizeAssistantExecutionContext(input.message.executionContext).hosted
      ?.defaultTarget ?? null

  return applyHostedDefaultTargetToResolvedSession(resolved, hostedDefaultTarget)
}

export function applyHostedDefaultTargetToResolvedSession(
  resolved: ResolvedAssistantSession,
  hostedDefaultTarget: AssistantModelTarget | null | undefined,
): ResolvedAssistantSession {
  const defaultTarget = normalizeAssistantBackendTarget(hostedDefaultTarget ?? null)
  if (!defaultTarget) {
    return resolved
  }

  const projectedSession = normalizeAssistantConversationSnapshot({
    ...resolved.session,
    codexTarget: defaultTarget,
    target: defaultTarget,
  })
  const continuityChanged =
    projectedSession.providerOptions.continuityFingerprint !==
    resolved.session.providerOptions.continuityFingerprint

  if (!continuityChanged) {
    return {
      ...resolved,
      session: projectedSession,
    }
  }

  return {
    ...resolved,
    session: normalizeAssistantConversationSnapshot({
      ...projectedSession,
      codexResume: null,
      resumeState: null,
    }),
  }
}

function normalizeAssistantConversationSnapshot(
  session: AssistantSession,
): AssistantSession {
  return parseAssistantSessionRecord(
    serializeAssistantConversationForPersistence(session),
  )
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
