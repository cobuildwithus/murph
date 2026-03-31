import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  resolveAssistantStatePaths as resolveRuntimeAssistantStatePaths,
  type AssistantStatePaths as RuntimeAssistantStatePaths,
} from '@murph/runtime-state'
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
  resolveConversationLocator,
} from '../conversation-ref.js'
import { normalizeNullableString } from '../shared.js'
import type { AssistantSessionLocator } from './types.js'

export type AssistantStatePaths = RuntimeAssistantStatePaths

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
  headers?: Record<string, string> | null
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
