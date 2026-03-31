import type {
  AssistantSandbox,
  AssistantSession,
} from '../assistant-cli-contracts.js'
import { resolveAssistantProviderTraits } from '../assistant-provider.js'
import type { AssistantOperatorDefaults } from '../operator-config.js'
import { resolveAssistantProviderDefaults } from '../operator-config.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigs,
  mergeAssistantProviderConfigsForProvider,
} from './provider-config.js'
import {
  normalizeAssistantSessionSnapshot,
  readAssistantCodexPromptVersion,
  readAssistantProviderBinding,
  writeAssistantCodexPromptVersion,
} from './provider-state.js'
import {
  isAssistantSessionNotFoundError,
  resolveAssistantSession,
  restoreAssistantSessionSnapshot,
  type ResolveAssistantSessionInput,
} from './store.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'

export function clampVaultBoundAssistantSandbox(
  sandbox: AssistantSandbox | null | undefined,
): AssistantSandbox | null | undefined {
  return sandbox === 'danger-full-access' ? 'workspace-write' : sandbox
}

export function buildResolveAssistantSessionInput(
  input: AssistantSessionResolutionFields,
  defaults: AssistantOperatorDefaults | null,
): ResolveAssistantSessionInput {
  const inferredProvider = mergeAssistantProviderConfigs(defaults, input).provider
  const providerDefaults = resolveAssistantProviderDefaults(defaults, inferredProvider)
  const providerConfig = mergeAssistantProviderConfigsForProvider(
    inferredProvider,
    providerDefaults ? { provider: inferredProvider, ...providerDefaults } : null,
    compactAssistantProviderConfigInput({
      provider: inferredProvider,
      ...input,
    }),
  )
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
    provider: providerConfig.provider,
    model: providerConfig.model,
    sandbox: clampVaultBoundAssistantSandbox(providerConfig.sandbox) ?? 'workspace-write',
    approvalPolicy: providerConfig.approvalPolicy ?? 'on-request',
    oss: providerConfig.oss ?? false,
    profile: providerConfig.profile,
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
  currentCodexPromptVersion: string
  defaults: AssistantOperatorDefaults | null
  message: AssistantMessageInput
}) {
  const sessionInput = buildResolveAssistantSessionInput(
    input.message,
    input.defaults,
  )

  try {
    return await resolveAssistantSession(sessionInput)
  } catch (error) {
    const restored = await restoreMissingAssistantSessionSnapshot({
      currentCodexPromptVersion: input.currentCodexPromptVersion,
      error,
      message: input.message,
      sessionInput,
    })
    if (!restored) {
      throw error
    }

    return resolveAssistantSession({
      ...sessionInput,
      createIfMissing: false,
    })
  }
}

async function restoreMissingAssistantSessionSnapshot(input: {
  currentCodexPromptVersion: string
  error: unknown
  message: AssistantMessageInput
  sessionInput: ResolveAssistantSessionInput
}): Promise<boolean> {
  if (!isAssistantSessionNotFoundError(input.error)) {
    return false
  }

  const requestedSessionId =
    input.sessionInput.conversation?.sessionId ?? input.sessionInput.sessionId
  const snapshot = input.message.sessionSnapshot
  if (
    typeof requestedSessionId !== 'string' ||
    requestedSessionId.trim().length === 0 ||
    !snapshot ||
    snapshot.sessionId !== requestedSessionId
  ) {
    return false
  }

  const normalizedSnapshot = normalizeRestoredAssistantSessionSnapshot({
    currentCodexPromptVersion: input.currentCodexPromptVersion,
    snapshot,
  })
  const transcriptSnapshot = input.message.transcriptSnapshot ?? null
  const transcriptExists = readAssistantSessionNotFoundTranscriptExists(input.error)

  if (
    resolveAssistantProviderTraits(normalizedSnapshot.provider).transcriptContextMode ===
      'local-transcript' &&
    transcriptExists !== true &&
    transcriptSnapshot === null
  ) {
    throw new VaultCliError(
      'ASSISTANT_SESSION_TRANSCRIPT_RESTORE_REQUIRED',
      'Restoring this transcript-backed assistant session requires a local transcript snapshot. Resume from the original live chat or start a new session.',
    )
  }

  await restoreAssistantSessionSnapshot({
    vault: input.message.vault,
    session: normalizedSnapshot,
    transcriptEntries: transcriptExists === true ? null : transcriptSnapshot,
  })
  return true
}

function normalizeRestoredAssistantSessionSnapshot(input: {
  currentCodexPromptVersion: string
  snapshot: AssistantSession
}): AssistantSession {
  const normalized = normalizeAssistantSessionSnapshot(input.snapshot)
  const providerBinding = readAssistantProviderBinding(normalized)
  if (providerBinding?.provider !== 'codex-cli') {
    return normalized
  }

  return {
    ...normalized,
    providerBinding: writeAssistantCodexPromptVersion(
      providerBinding,
      readAssistantCodexPromptVersion(normalized) ?? input.currentCodexPromptVersion,
    ),
  }
}

function readAssistantSessionNotFoundTranscriptExists(error: unknown): boolean | null {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return null
  }

  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null
  }

  return typeof (context as { transcriptExists?: unknown }).transcriptExists === 'boolean'
    ? (context as { transcriptExists: boolean }).transcriptExists
    : null
}
