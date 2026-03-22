import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  resolveAssistantStatePaths as resolveRuntimeAssistantStatePaths,
  type AssistantStatePaths,
} from '@healthybob/runtime-state'
import {
  assistantProviderSessionOptionsSchema,
  type AssistantApprovalPolicy,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '../../assistant-cli-contracts.js'
import {
  resolveAssistantConversationKey,
  type AssistantBindingPatch,
} from '../bindings.js'
import { normalizeNullableString } from '../shared.js'
import type { AssistantSessionLocator } from './types.js'

export { type AssistantStatePaths } from '@healthybob/runtime-state'

export function resolveAssistantStatePaths(
  vaultRoot: string,
): AssistantStatePaths {
  return resolveRuntimeAssistantStatePaths(vaultRoot)
}

export function redactAssistantDisplayPath(filePath: string): string {
  const absolutePath = path.resolve(filePath)
  const homeDirectory = normalizeNullableString(process.env.HOME)
  if (!homeDirectory) {
    return absolutePath
  }

  const absoluteHome = path.resolve(homeDirectory)
  if (absolutePath === absoluteHome) {
    return '~'
  }

  if (!absolutePath.startsWith(`${absoluteHome}${path.sep}`)) {
    return absolutePath
  }

  return path.join('~', path.relative(absoluteHome, absolutePath))
}

export function resolveAssistantAliasKey(
  input: AssistantSessionLocator,
): string | null {
  const explicitAlias =
    normalizeNullableString(input.conversation?.alias) ??
    normalizeNullableString(input.alias)
  if (explicitAlias) {
    return explicitAlias
  }

  return resolveAssistantConversationKey(bindingInputFromLocator(input))
}

export function resolveAssistantConversationLookupKey(
  input: AssistantSessionLocator,
): string | null {
  return resolveAssistantConversationKey(bindingInputFromLocator(input))
}

export function bindingInputFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const conversation = normalizeConversationLocator(input)
  return {
    actorId: conversation.actorId,
    channel: normalizeNullableString(conversation.channel),
    deliveryKind: input.deliveryKind ?? null,
    identityId: normalizeNullableString(conversation.identityId),
    threadId: normalizeNullableString(conversation.threadId),
    threadIsDirect: conversation.threadIsDirect,
  }
}

export function bindingPatchFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const conversation = normalizeConversationLocator(input)
  const patch: AssistantBindingPatch = {}

  if (
    'conversation' in input ||
    'actorId' in input ||
    'participantId' in input ||
    'channel' in input ||
    'identityId' in input ||
    'threadId' in input ||
    'sourceThreadId' in input ||
    'threadIsDirect' in input
  ) {
    patch.actorId = conversation.actorId
    patch.channel = normalizeNullableString(conversation.channel)
    patch.identityId = normalizeNullableString(conversation.identityId)
    patch.threadId = normalizeNullableString(conversation.threadId)
    patch.threadIsDirect = conversation.threadIsDirect
  }
  if ('deliveryKind' in input) {
    patch.deliveryKind = input.deliveryKind ?? null
  }

  return patch
}

export function normalizeProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}): AssistantProviderSessionOptions {
  return assistantProviderSessionOptionsSchema.parse({
    model: normalizeNullableString(input.model),
    reasoningEffort: normalizeNullableString(input.reasoningEffort),
    sandbox: input.sandbox ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    profile: normalizeNullableString(input.profile),
    oss: input.oss ?? false,
    baseUrl: normalizeNullableString(input.baseUrl) ?? undefined,
    apiKeyEnv: normalizeNullableString(input.apiKeyEnv) ?? undefined,
    providerName: normalizeNullableString(input.providerName) ?? undefined,
  })
}

export function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}

function normalizeConversationLocator(input: AssistantSessionLocator): {
  actorId: string | null
  channel: string | null
  identityId: string | null
  threadId: string | null
  threadIsDirect: boolean | null
} {
  const conversation = input.conversation ?? null
  return {
    actorId:
      normalizeNullableString(conversation?.participantId) ??
      normalizeNullableString(input.actorId ?? input.participantId),
    channel:
      normalizeNullableString(conversation?.channel) ??
      normalizeNullableString(input.channel),
    identityId:
      normalizeNullableString(conversation?.identityId) ??
      normalizeNullableString(input.identityId),
    threadId:
      normalizeNullableString(conversation?.threadId) ??
      normalizeNullableString(input.threadId ?? input.sourceThreadId),
    threadIsDirect: normalizeConversationThreadDirectness(
      conversation?.directness,
      input.threadIsDirect,
    ),
  }
}

function normalizeConversationThreadDirectness(
  directness: string | null | undefined,
  threadIsDirect: boolean | null | undefined,
): boolean | null {
  if (typeof threadIsDirect === 'boolean') {
    return threadIsDirect
  }

  switch (normalizeNullableString(directness)) {
    case 'direct':
      return true
    case 'group':
      return false
    default:
      return null
  }
}
