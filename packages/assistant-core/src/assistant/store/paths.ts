import { randomUUID } from 'node:crypto'
import path from 'node:path'
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

export interface AssistantStatePaths {
  absoluteVaultRoot: string
  assistantStateRoot: string
  automationStatePath: string
  cronDirectory: string
  cronAutomationStatePath: string
  cronJobsPath: string
  cronRunsDirectory: string
  diagnosticsDirectory: string
  diagnosticEventsPath: string
  diagnosticSnapshotPath: string
  failoverStatePath: string
  indexesPath: string
  journalsDirectory: string
  outboxDirectory: string
  outboxQuarantineDirectory: string
  providerRouteRecoveryDirectory: string
  providerRouteRecoverySecretsDirectory: string
  quarantineDirectory: string
  resourceBudgetPath: string
  runtimeEventsPath: string
  secretsDirectory: string
  sessionSecretsDirectory: string
  sessionsDirectory: string
  stateDirectory: string
  statusPath: string
  transcriptsDirectory: string
  turnsDirectory: string
  usageDirectory: string
  usagePendingDirectory: string
}

export function resolveAssistantStatePaths(
  vaultRoot: string,
): AssistantStatePaths {
  const absoluteVaultRoot = path.resolve(vaultRoot)
  const assistantStateRoot = path.join(
    absoluteVaultRoot,
    '.runtime',
    'operations',
    'assistant',
  )
  const cronDirectory = path.join(assistantStateRoot, 'cron')
  const diagnosticsDirectory = path.join(assistantStateRoot, 'diagnostics')
  const journalsDirectory = path.join(assistantStateRoot, 'journals')
  const outboxDirectory = path.join(assistantStateRoot, 'outbox')
  const turnsDirectory = path.join(assistantStateRoot, 'receipts')
  const secretsDirectory = path.join(assistantStateRoot, 'secrets')
  const sessionSecretsDirectory = path.join(secretsDirectory, 'sessions')
  const providerRouteRecoverySecretsDirectory = path.join(
    secretsDirectory,
    'provider-route-recovery',
  )
  const usageDirectory = path.join(assistantStateRoot, 'usage')

  return {
    absoluteVaultRoot,
    assistantStateRoot,
    automationStatePath: path.join(assistantStateRoot, 'automation-state.json'),
    cronDirectory,
    cronAutomationStatePath: path.join(cronDirectory, 'automation-runtime.json'),
    cronJobsPath: path.join(cronDirectory, 'jobs.json'),
    cronRunsDirectory: path.join(cronDirectory, 'runs'),
    diagnosticsDirectory,
    diagnosticEventsPath: path.join(diagnosticsDirectory, 'events.jsonl'),
    diagnosticSnapshotPath: path.join(diagnosticsDirectory, 'snapshot.json'),
    failoverStatePath: path.join(assistantStateRoot, 'failover.json'),
    indexesPath: path.join(assistantStateRoot, 'indexes.json'),
    journalsDirectory,
    outboxDirectory,
    outboxQuarantineDirectory: path.join(outboxDirectory, '.quarantine'),
    providerRouteRecoveryDirectory: path.join(
      assistantStateRoot,
      'provider-route-recovery',
    ),
    providerRouteRecoverySecretsDirectory,
    quarantineDirectory: path.join(assistantStateRoot, 'quarantine'),
    resourceBudgetPath: path.join(assistantStateRoot, 'runtime-budgets.json'),
    runtimeEventsPath: path.join(journalsDirectory, 'runtime-events.jsonl'),
    secretsDirectory,
    sessionSecretsDirectory,
    sessionsDirectory: path.join(assistantStateRoot, 'sessions'),
    stateDirectory: path.join(assistantStateRoot, 'state'),
    statusPath: path.join(assistantStateRoot, 'status.json'),
    transcriptsDirectory: path.join(assistantStateRoot, 'transcripts'),
    turnsDirectory,
    usageDirectory,
    usagePendingDirectory: path.join(usageDirectory, 'pending'),
  }
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
