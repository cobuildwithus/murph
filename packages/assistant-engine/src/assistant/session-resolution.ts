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
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import {
  isAssistantSessionNotFoundError,
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
  readAssistantCodexResume,
  serializeAssistantConversationForPersistence,
} from './conversation-persistence.js'
import {
  bindAssistantResumeStateToThreadCompatibility,
} from './codex-resume-binding.js'
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
    provider: 'codex-cli',
    model: providerConfig.target.model,
    modelProvider: providerConfig.target.modelProvider,
    sandbox: defaultSandbox,
    approvalPolicy: defaultApprovalPolicy,
    oss: providerConfig.target.oss,
    profile: providerConfig.target.profile,
    ...(providerConfig.target.codexHome
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
  const messageOverride = compactAssistantProviderConfigInput(input.message)
  const sessionInput = buildResolveAssistantSessionInput(
    input.message,
    input.defaults,
    input.boundaryDefaultTarget ?? null,
  )
  const hostedDefaultTarget =
    normalizeAssistantBackendTarget(
      normalizeAssistantExecutionContext(input.message.executionContext).hosted
        ?.defaultTarget ?? null,
    )
  const resolved = await resolveAssistantSessionForMessageInput({
    hostedDefaultTarget,
    messageOverride,
    sessionInput,
  })
  const effectiveTarget = resolveEffectiveTargetForResolvedSession({
    hostedDefaultTarget,
    messageOverride,
    resolved,
  })
  return effectiveTarget
    ? applyEffectiveTargetToResolvedSession(resolved, effectiveTarget)
    : resolved
}

async function resolveAssistantSessionForMessageInput(input: {
  hostedDefaultTarget: AssistantModelTarget | null
  messageOverride: AssistantProviderConfigInput | null
  sessionInput: ResolveAssistantSessionInput
}): Promise<ResolvedAssistantSession> {
  if (!input.messageOverride) {
    return await resolveAssistantSession(input.sessionInput)
  }

  try {
    return await resolveAssistantSession(
      buildAssistantSessionLookupInputForMessageOverride(input),
    )
  } catch (error) {
    if (!isAssistantSessionNotFoundError(error)) {
      throw error
    }
  }

  return await resolveAssistantSession(input.sessionInput)
}

function buildAssistantSessionLookupInputForMessageOverride(input: {
  hostedDefaultTarget: AssistantModelTarget | null
  sessionInput: ResolveAssistantSessionInput
}): ResolveAssistantSessionInput {
  const locatorInput = stripAssistantSessionTargetResolutionInput(
    input.sessionInput,
  )
  return {
    ...locatorInput,
    ...(input.hostedDefaultTarget ? { target: input.hostedDefaultTarget } : {}),
    createIfMissing: false,
  }
}

function stripAssistantSessionTargetResolutionInput(
  input: ResolveAssistantSessionInput,
): ResolveAssistantSessionInput {
  const {
    approvalPolicy: _approvalPolicy,
    codexHome: _codexHome,
    model: _model,
    modelProvider: _modelProvider,
    oss: _oss,
    profile: _profile,
    provider: _provider,
    reasoningEffort: _reasoningEffort,
    sandbox: _sandbox,
    target: _target,
    ...locatorInput
  } = input
  return locatorInput
}

function resolveEffectiveTargetForResolvedSession(input: {
  hostedDefaultTarget: AssistantModelTarget | null
  messageOverride: AssistantProviderConfigInput | null
  resolved: ResolvedAssistantSession
}): AssistantModelTarget | null {
  if (!input.messageOverride) {
    return input.hostedDefaultTarget
  }

  const baseTarget =
    input.hostedDefaultTarget ??
    normalizeAssistantBackendTarget(input.resolved.session.target)
  if (!baseTarget) {
    return null
  }

  return resolveAssistantExecutionPlan({
    defaults: null,
    override: input.messageOverride,
    sessionTarget: baseTarget,
  }).primaryTarget
}

export function applyEffectiveTargetToResolvedSession(
  resolved: ResolvedAssistantSession,
  effectiveTarget: AssistantModelTarget | null | undefined,
): ResolvedAssistantSession {
  const target = normalizeAssistantBackendTarget(effectiveTarget ?? null)
  if (!target) {
    return resolved
  }

  const currentRoute = resolveAssistantExecutionPlan({
    defaults: null,
    sessionTarget: resolved.session.target,
  }).codexRoute
  const currentResumeState = bindAssistantResumeStateToThreadCompatibility({
    resumeState: readAssistantCodexResume(resolved.session),
    route: currentRoute,
  })
  const currentSession = normalizeAssistantConversationSnapshot({
    ...resolved.session,
    codexResume: currentResumeState,
    resumeState: currentResumeState,
  })
  const projectedSession = normalizeAssistantConversationSnapshot({
    ...currentSession,
    codexTarget: target,
    target,
  })
  const continuityChanged =
    projectedSession.providerOptions.continuityFingerprint !==
    currentSession.providerOptions.continuityFingerprint

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
