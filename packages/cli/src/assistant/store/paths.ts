import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  resolveAssistantStatePaths as resolveRuntimeAssistantStatePaths,
  type AssistantStatePaths,
} from '@healthybob/runtime-state'
import {
  type AssistantApprovalPolicy,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '../../assistant-cli-contracts.js'
import { serializeAssistantProviderSessionOptions } from '../provider-config.js'
import {
  resolveAssistantConversationKey,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  conversationRefFromLocator,
  conversationRefToBindingFields,
} from '../conversation-ref.js'
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
  const conversation = conversationRefFromLocator(input)
  const bindingFields = conversationRefToBindingFields(conversation)
  return {
    actorId: bindingFields.actorId,
    channel: conversation.channel ?? null,
    deliveryKind: input.deliveryKind ?? null,
    identityId: conversation.identityId ?? null,
    threadId: conversation.threadId ?? null,
    threadIsDirect: bindingFields.threadIsDirect,
  }
}

export function bindingPatchFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const conversation = conversationRefFromLocator(input)
  const bindingFields = conversationRefToBindingFields(conversation)
  const patch: AssistantBindingPatch = {}

  if (hasConversationLocatorFields(input)) {
    patch.actorId = bindingFields.actorId
    patch.channel = conversation.channel ?? null
    patch.identityId = conversation.identityId ?? null
    patch.threadId = conversation.threadId ?? null
    patch.threadIsDirect = bindingFields.threadIsDirect
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
  return serializeAssistantProviderSessionOptions(input)
}

export function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}

function hasConversationLocatorFields(
  input: AssistantSessionLocator,
): boolean {
  return (
    'conversation' in input ||
    'actorId' in input ||
    'participantId' in input ||
    'channel' in input ||
    'identityId' in input ||
    'threadId' in input ||
    'sourceThreadId' in input ||
    'threadIsDirect' in input
  )
}
