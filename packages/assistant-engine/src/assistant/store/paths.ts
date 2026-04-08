import { randomUUID } from 'node:crypto'
import path from 'node:path'
export {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'
import {
  type AssistantApprovalPolicy,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  resolveAssistantConversationKey,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  resolveConversationLocator,
} from '../conversation-ref.js'
import { normalizeNullableString } from '../shared.js'
import type { AssistantSessionLocator } from './types.js'

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
  const locator = resolveConversationLocator(input)
  if (locator.explicitAlias) {
    return locator.explicitAlias
  }

  return resolveAssistantConversationKey(
    bindingInputFromResolvedLocator(locator, input),
  )
}

export function resolveAssistantConversationLookupKey(
  input: AssistantSessionLocator,
): string | null {
  return resolveAssistantConversationKey(bindingInputFromLocator(input))
}

export function bindingInputFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  return bindingInputFromResolvedLocator(resolveConversationLocator(input), input)
}

function bindingInputFromResolvedLocator(
  locator: ReturnType<typeof resolveConversationLocator>,
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  return {
    actorId: locator.bindingFields.actorId,
    channel: locator.conversation.channel ?? null,
    deliveryKind: input.deliveryKind ?? null,
    identityId: locator.conversation.identityId ?? null,
    threadId: locator.conversation.threadId ?? null,
    threadIsDirect: locator.bindingFields.threadIsDirect,
  }
}

export function bindingPatchFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const locator = resolveConversationLocator(input)
  const patch: AssistantBindingPatch = {
    ...locator.bindingPatch,
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
  codexHome?: string | null
  headers?: Record<string, string> | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  zeroDataRetention?: boolean | null
}): AssistantProviderSessionOptions {
  return serializeAssistantProviderSessionOptions(input)
}

export function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}
