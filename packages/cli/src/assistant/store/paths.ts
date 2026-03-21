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
  const explicitAlias = normalizeNullableString(input.alias)
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
  return {
    actorId: normalizeNullableString(input.actorId ?? input.participantId),
    channel: normalizeNullableString(input.channel),
    deliveryKind: input.deliveryKind ?? null,
    identityId: normalizeNullableString(input.identityId),
    threadId: normalizeNullableString(input.threadId ?? input.sourceThreadId),
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
  }
}

export function bindingPatchFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const patch: AssistantBindingPatch = {}

  if ('actorId' in input || 'participantId' in input) {
    patch.actorId = normalizeNullableString(input.actorId ?? input.participantId)
  }
  if ('channel' in input) {
    patch.channel = normalizeNullableString(input.channel)
  }
  if ('deliveryKind' in input) {
    patch.deliveryKind = input.deliveryKind ?? null
  }
  if ('identityId' in input) {
    patch.identityId = normalizeNullableString(input.identityId)
  }
  if ('threadId' in input || 'sourceThreadId' in input) {
    patch.threadId = normalizeNullableString(input.threadId ?? input.sourceThreadId)
  }
  if ('threadIsDirect' in input) {
    patch.threadIsDirect =
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null
  }

  return patch
}

export function normalizeProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  model?: string | null
  oss?: boolean
  profile?: string | null
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
  })
}

export function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}
