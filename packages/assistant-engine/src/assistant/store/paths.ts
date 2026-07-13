import { randomUUID } from 'node:crypto'
import path from 'node:path'
export {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'
import {
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  resolveAssistantConversationKey,
  resolveLegacyAssistantConversationKey,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  resolveConversationLocator,
} from '../conversation-ref.js'
import { normalizeNullableString } from '../shared.js'
import type { AssistantSessionLocator } from './types.js'

export interface AssistantConversationLookupKeyEntry {
  key: string
  scope: 'actor' | 'thread'
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

export function resolveAssistantConversationLookupKeys(
  input: AssistantSessionLocator,
): string[] {
  return resolveAssistantConversationLookupKeyEntries(input).map((entry) => entry.key)
}

export function resolveAssistantConversationLookupKeyEntries(
  input: AssistantSessionLocator,
): AssistantConversationLookupKeyEntry[] {
  const primary = bindingInputFromLocator(input)
  const entries = [
    createAssistantConversationLookupKeyEntry(primary),
  ]

  if (primary.threadId !== null && primary.threadId !== undefined) {
    entries.push(createAssistantConversationLookupKeyEntry({
      ...primary,
      threadId: null,
    }))
  }

  const uniqueEntries: AssistantConversationLookupKeyEntry[] = []
  const seenKeys = new Set<string>()
  for (const entry of entries) {
    if (!entry || seenKeys.has(entry.key)) {
      continue
    }
    seenKeys.add(entry.key)
    uniqueEntries.push(entry)
  }

  return uniqueEntries
}

export function resolveLegacyAssistantConversationLookupKeyEntries(
  input: AssistantSessionLocator,
): AssistantConversationLookupKeyEntry[] {
  const primary = bindingInputFromLocator(input)
  const inputs = [primary]

  if (primary.threadId !== null && primary.threadId !== undefined) {
    inputs.push({
      ...primary,
      threadId: null,
    })
  }

  const uniqueEntries: AssistantConversationLookupKeyEntry[] = []
  const seenKeys = new Set<string>()
  for (const bindingInput of inputs) {
    const key = resolveLegacyAssistantConversationKey(bindingInput)
    const scope = resolveAssistantConversationLookupScope(bindingInput)
    if (!key || !scope || seenKeys.has(key)) {
      continue
    }
    seenKeys.add(key)
    uniqueEntries.push({ key, scope })
  }

  return uniqueEntries
}

function createAssistantConversationLookupKeyEntry(
  input: AssistantBindingPatch,
): AssistantConversationLookupKeyEntry | null {
  const key = resolveAssistantConversationKey(input)
  const scope = resolveAssistantConversationLookupScope(input)
  return key && scope ? { key, scope } : null
}

function resolveAssistantConversationLookupScope(
  input: AssistantBindingPatch,
): AssistantConversationLookupKeyEntry['scope'] | null {
  if (normalizeNullableString(input.threadId)) {
    return 'thread'
  }

  if (
    normalizeNullableString(input.actorId) &&
    normalizeNullableString(input.channel) &&
    input.threadIsDirect !== false
  ) {
    return 'actor'
  }

  return null
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
  const patch: AssistantBindingPatch = {
    actorId: locator.bindingFields.actorId,
    channel: locator.conversation.channel ?? null,
    deliveryKind: input.deliveryKind ?? null,
    identityId: locator.conversation.identityId ?? null,
    threadId: locator.conversation.threadId ?? null,
    threadIsDirect: locator.bindingFields.threadIsDirect,
  }

  if ('bindingDeliveryTarget' in input) {
    patch.deliveryTarget = input.bindingDeliveryTarget ?? null
  }

  return patch
}

export function bindingPatchFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const locator = resolveConversationLocator(input)
  const patch: AssistantBindingPatch = {
    ...locator.bindingPatch,
  }
  const directThreadDeliveryPatch = resolveDirectThreadDeliveryPatch({
    channel: locator.conversation.channel ?? null,
    threadId: locator.conversation.threadId ?? null,
    threadIsDirect: locator.bindingFields.threadIsDirect,
  })
  if (directThreadDeliveryPatch) {
    patch.deliveryKind = directThreadDeliveryPatch.deliveryKind
    patch.deliveryTarget = directThreadDeliveryPatch.deliveryTarget
  }
  if ('deliveryKind' in input) {
    patch.deliveryKind = input.deliveryKind ?? null
  }
  if ('bindingDeliveryTarget' in input) {
    patch.deliveryTarget = input.bindingDeliveryTarget ?? null
  }

  return patch
}

function resolveDirectThreadDeliveryPatch(input: {
  channel: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}): Pick<AssistantBindingPatch, 'deliveryKind' | 'deliveryTarget'> | null {
  if (input.threadId === null || input.threadIsDirect !== true) {
    return null
  }

  switch (input.channel) {
    case 'email':
    case 'linq':
    case 'telegram':
      return {
        deliveryKind: 'thread',
        deliveryTarget: input.threadId,
      }
    default:
      return null
  }
}

export function normalizeProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  codexHome?: string | null
  model?: string | null
  modelProvider?: string | null
  oss?: boolean
  profile?: string | null
  provider?: AssistantChatProvider | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}): AssistantProviderSessionOptions {
  return serializeAssistantProviderSessionOptions(input)
}

export function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}
