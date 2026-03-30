import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  resolveAssistantUsageCredentialSource,
  writePendingAssistantUsageRecord,
} from '@murph/runtime-state'
import {
  assistantCanonicalWriteBlockSchema,
  assistantAskResultSchema,
  type AssistantSession,
  type AssistantApprovalPolicy,
  type AssistantAskResult,
  type AssistantChatProvider,
  type AssistantDeliveryError,
  type AssistantProviderFailoverRoute,
  type AssistantSandbox,
  type AssistantTurnTrigger,
} from '../assistant-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  type AssistantProviderProgressEvent,
} from '../assistant-provider.js'
import {
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  type AssistantOperatorDefaults,
} from '../operator-config.js'
import {
  type AssistantOutboxDispatchMode,
  normalizeAssistantDeliveryError,
} from './outbox.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import {
  buildAssistantFailoverRoutes,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import { refreshAssistantStatusSnapshotLocal } from './status.js'
import {
  appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError,
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  restoreAssistantSessionSnapshot,
  saveAssistantSession,
  type AssistantTranscriptEntryInput,
  type ResolvedAssistantSession,
} from './store.js'
import {
  resolveAssistantTurnSharedPlan as buildAssistantTurnSharedPlan,
} from './turn-plan.js'
import {
  buildResolveAssistantSessionInput,
  resolveAssistantSessionForMessage as resolveAssistantMessageSession,
} from './session-resolution.js'
import {
  deliverAssistantReply as dispatchAssistantReply,
  finalizeAssistantTurnFromDeliveryOutcome as finalizeDeliveredAssistantTurn,
} from './delivery-service.js'
import {
  persistAssistantTurnAndSession as finalizeAssistantTurnArtifacts,
} from './turn-finalizer.js'
import type { ConversationRef } from './conversation-ref.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
} from './turns.js'
import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigs,
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from './provider-config.js'
import {
  extractRecoveredAssistantSession,
} from './provider-turn-recovery.js'
import {
  normalizeAssistantSessionSnapshot,
} from './provider-state.js'
import { redactAssistantSessionForDisplay } from './redaction.js'
import {
  isAssistantCanonicalWriteBlockedError,
} from './canonical-write-guard.js'
import {
  executeProviderTurnWithRecovery,
  type ExecutedAssistantProviderTurnResult,
} from './provider-turn-runner.js'
import { normalizeNullableString } from './shared.js'
import { withAssistantTurnLock } from './turn-lock.js'
import {
  maybeOpenAssistantConversationViaDaemon,
  maybeSendAssistantMessageViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
} from '../assistant-daemon-client.js'

// Bump this when changing the durable Codex bootstrap prompt text so existing
// Codex provider sessions re-bootstrap cleanly on their next turn.
export const CURRENT_CODEX_PROMPT_VERSION = '2026-03-27.2'
export { buildResolveAssistantSessionInput } from './session-resolution.js'

interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  headers?: Record<string, string> | null
  identityId?: string | null
  model?: string | null
  maxSessionAgeMs?: number | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  abortSignal?: AbortSignal
  codexCommand?: string
  deliverResponse?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryReplyToMessageId?: string | null
  deliveryTarget?: string | null
  enableFirstTurnOnboarding?: boolean
  failoverRoutes?: readonly AssistantProviderFailoverRoute[] | null
  maxSessionAgeMs?: number | null
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  persistUserPromptOnFailure?: boolean
  prompt: string
  receiptMetadata?: Record<string, string> | null
  sessionSnapshot?: AssistantSession | null
  transcriptSnapshot?: readonly AssistantTranscriptEntryInput[] | null
  showThinkingTraces?: boolean
  turnTrigger?: AssistantTurnTrigger
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'deliverResponse' | 'deliveryTarget' | 'prompt'> {
  initialPrompt?: string | null
}

interface PersistedUserTurn {
  turnCreatedAt: string
  turnId: string
  userPersisted: boolean
}

async function persistUserTurn(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
  plan: {
    persistUserPromptOnFailure: boolean
  },
  turnId: string,
): Promise<PersistedUserTurn> {
  let turnCreatedAt = new Date().toISOString()
  let userPersisted = false
  if (plan.persistUserPromptOnFailure) {
    const userEntries = await appendAssistantTranscriptEntries(
      input.vault,
      resolved.session.sessionId,
      [
        {
          kind: 'user',
          text: input.prompt,
        },
      ],
    )
    turnCreatedAt = userEntries[0]?.createdAt ?? turnCreatedAt
    userPersisted = true
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId,
      kind: 'user.persisted',
      detail: 'user prompt persisted before provider execution',
      at: turnCreatedAt,
    })
  }

  return {
    turnCreatedAt,
    turnId,
    userPersisted,
  }
}

function clampVaultBoundAssistantSandbox(
  sandbox: AssistantSandbox | null | undefined,
): AssistantSandbox | null | undefined {
  return sandbox === 'danger-full-access' ? 'workspace-write' : sandbox
}

function serializeAssistantSessionForResult(
  session: AssistantSession,
): AssistantSession {
  return redactAssistantSessionForDisplay(normalizeAssistantSessionSnapshot(session))
}

function normalizeAssistantAskResultForReturn<T extends AssistantAskResult>(
  result: T,
): T {
  return assistantAskResultSchema.parse({
    ...result,
    session: serializeAssistantSessionForResult(result.session),
  }) as T
}

function buildAssistantCanonicalWriteBlockedResult(input: {
  error: unknown
  prompt: string
  session: AssistantSession
  vault: string
}): AssistantAskResult | null {
  if (!isAssistantCanonicalWriteBlockedError(input.error)) {
    return null
  }

  const context =
    input.error.context &&
    typeof input.error.context === 'object' &&
    !Array.isArray(input.error.context)
      ? (input.error.context as Record<string, unknown>)
      : {}
  const blockedPaths = Array.isArray(context.paths)
    ? context.paths.filter((value): value is string => typeof value === 'string')
    : []

  return normalizeAssistantAskResultForReturn(assistantAskResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    status: 'blocked',
    prompt: input.prompt,
    response: '',
    session: serializeAssistantSessionForResult(input.session),
    delivery: null,
    deliveryDeferred: false,
    deliveryIntentId: null,
    deliveryError: null,
    blocked: assistantCanonicalWriteBlockSchema.parse({
      code: input.error.code,
      message: input.error.message,
      paths: blockedPaths,
      pathCount:
        typeof context.pathCount === 'number' && Number.isFinite(context.pathCount)
          ? Math.max(0, Math.trunc(context.pathCount))
          : blockedPaths.length,
      guardFailureReason:
        context.guardFailureReason === 'invalid_committed_payload' ||
        context.guardFailureReason === 'invalid_write_operation_metadata'
          ? context.guardFailureReason
          : null,
      guardFailurePath:
        typeof context.guardFailurePath === 'string' ? context.guardFailurePath : null,
      guardFailureMessage:
        typeof context.guardFailureMessage === 'string'
          ? context.guardFailureMessage
          : null,
      guardFailureCode:
        typeof context.guardFailureCode === 'string' ? context.guardFailureCode : null,
      guardFailureOperationId:
        typeof context.guardFailureOperationId === 'string'
          ? context.guardFailureOperationId
          : null,
      guardFailureTargetPath:
        typeof context.guardFailureTargetPath === 'string'
          ? context.guardFailureTargetPath
          : null,
      guardFailureActionKind:
        context.guardFailureActionKind === 'jsonl_append' ||
        context.guardFailureActionKind === 'text_write'
          ? context.guardFailureActionKind
          : null,
      providerErrorCode:
        typeof context.providerErrorCode === 'string' ? context.providerErrorCode : null,
      providerErrorMessage:
        typeof context.providerErrorMessage === 'string'
          ? context.providerErrorMessage
          : null,
    }),
  }))
}

async function finalizeBlockedAssistantTurn(input: {
  error: unknown
  prompt: string
  response: string | null
  session: AssistantSession
  turnId: string
  vault: string
}): Promise<AssistantAskResult> {
  const blockedResult = buildAssistantCanonicalWriteBlockedResult({
    error: input.error,
    prompt: input.prompt,
    session: input.session,
    vault: input.vault,
  })
  if (!blockedResult) {
    throw input.error
  }

  const blockedAt = new Date().toISOString()
  const blockedError = blockedResult.blocked
    ? {
        code: blockedResult.blocked.code,
        message: blockedResult.blocked.message,
      }
    : {
        code: 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED',
        message: 'Assistant turn was blocked by the canonical write guard.',
      }

  await runAssistantTurnBestEffort(() =>
    finalizeAssistantTurnReceipt({
      vault: input.vault,
      turnId: input.turnId,
      status: 'blocked',
      deliveryDisposition: 'blocked',
      error: blockedError,
      response: input.response,
      completedAt: blockedAt,
    }),
  )

  await runAssistantTurnBestEffort(() =>
    recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'assistant',
      kind: 'turn.blocked',
      level: 'warn',
      message: blockedError.message,
      code: blockedError.code,
      sessionId: blockedResult.session.sessionId,
      turnId: input.turnId,
      data: blockedResult.blocked,
      at: blockedAt,
    }),
  )

  return blockedResult
}

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  const remote = await maybeOpenAssistantConversationViaDaemon(input)
  if (remote) {
    return remote
  }

  return openAssistantConversationLocal(input)
}

export async function openAssistantConversationLocal(
  input: AssistantSessionResolutionFields,
) {
  const defaults = await resolveAssistantOperatorDefaults()
  return resolveAssistantSession(buildResolveAssistantSessionInput(input, defaults))
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const remote = await maybeSendAssistantMessageViaDaemon(input)
  if (remote) {
    return remote
  }

  return sendAssistantMessageLocal(input)
}

export async function sendAssistantMessageLocal(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const defaults = await resolveAssistantOperatorDefaults()
  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const resolved = await resolveAssistantMessageSession({
        currentCodexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
        defaults,
        message: input,
      })
      const sharedPlan = await buildAssistantTurnSharedPlan(input, resolved)
      const routes = resolveAssistantTurnRoutes(input, defaults, resolved)
      const primaryRoute = routes[0] ?? null
      const receipt = await createAssistantTurnReceipt({
        vault: input.vault,
        sessionId: resolved.session.sessionId,
        provider: primaryRoute?.provider ?? resolved.session.provider,
        providerModel: primaryRoute?.providerOptions.model ?? null,
        metadata: input.receiptMetadata ?? null,
        prompt: input.prompt,
        deliveryRequested: input.deliverResponse === true,
      })

      await recordAssistantDiagnosticEvent({
        vault: input.vault,
        component: 'assistant',
        kind: 'turn.started',
        message: `Started assistant turn for session ${resolved.session.sessionId}.`,
        sessionId: resolved.session.sessionId,
        turnId: receipt.turnId,
        counterDeltas: {
          turnsStarted: 1,
        },
      })

      let responseText: string | null = null
      let userTurn: PersistedUserTurn | null = null

      try {
        userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
        const providerOutcome = await executeProviderTurnWithRecovery({
          currentCodexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
          input,
          routes,
          plan: sharedPlan,
          resolvedSession: resolved.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        if (providerOutcome.kind === 'blocked') {
          return finalizeBlockedAssistantTurn({
            error: providerOutcome.error,
            prompt: input.prompt,
            response: responseText,
            session: providerOutcome.session,
            turnId: receipt.turnId,
            vault: input.vault,
          })
        }
        if (providerOutcome.kind === 'failed_terminal') {
          throw providerOutcome.error
        }

        const providerResult = providerOutcome.providerTurn
        responseText = providerResult.response
        await persistPendingAssistantUsageEvent({
          providerResult,
          session: providerResult.session,
          turnId: userTurn.turnId,
          vault: input.vault,
        })
        const session = await finalizeAssistantTurnArtifacts({
          currentCodexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
          input,
          plan: sharedPlan,
          providerResult,
          session: providerResult.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        const deliveryOutcome = await dispatchAssistantReply({
          input,
          response: providerResult.response,
          session,
          sharedPlan,
          turnId: userTurn.turnId,
        })

        await finalizeDeliveredAssistantTurn({
          outcome: deliveryOutcome,
          response: providerResult.response,
          turnId: userTurn.turnId,
          vault: input.vault,
        })

        return normalizeAssistantAskResultForReturn(assistantAskResultSchema.parse({
          vault: redactAssistantDisplayPath(input.vault),
          status: 'completed',
          prompt: input.prompt,
          response: providerResult.response,
          session: serializeAssistantSessionForResult(deliveryOutcome.session),
          delivery: deliveryOutcome.kind === 'sent' ? deliveryOutcome.delivery : null,
          deliveryDeferred: deliveryOutcome.kind === 'queued',
          deliveryIntentId:
            deliveryOutcome.kind === 'sent' ||
            deliveryOutcome.kind === 'queued' ||
            deliveryOutcome.kind === 'failed'
              ? deliveryOutcome.intentId
              : null,
          deliveryError:
            deliveryOutcome.kind === 'queued' || deliveryOutcome.kind === 'failed'
              ? deliveryOutcome.error
              : null,
          blocked: null,
        }))
      } catch (error) {
        const blockedResult = buildAssistantCanonicalWriteBlockedResult({
          error,
          prompt: input.prompt,
          session: extractRecoveredAssistantSession(error) ?? resolved.session,
          vault: input.vault,
        })

        if (blockedResult) {
          return finalizeBlockedAssistantTurn({
            error,
            prompt: input.prompt,
            response: responseText,
            session: blockedResult.session,
            turnId: receipt.turnId,
            vault: input.vault,
          })
        }

        const normalizedError = normalizeAssistantDeliveryError(error)
        const failedAt = new Date().toISOString()
        const failedSession =
          extractRecoveredAssistantSession(error) ?? resolved.session

        await runAssistantTurnBestEffort(() =>
          persistFailedAssistantPromptAttempt({
            plan: sharedPlan,
            prompt: input.prompt,
            session: failedSession,
            turnCreatedAt: userTurn?.turnCreatedAt ?? failedAt,
            turnTrigger: input.turnTrigger ?? 'manual-ask',
            vault: input.vault,
          }),
        )

        await runAssistantTurnBestEffort(() =>
          finalizeAssistantTurnReceipt({
            vault: input.vault,
            turnId: receipt.turnId,
            status: 'failed',
            deliveryDisposition:
              input.deliverResponse === true ? 'failed' : 'not-requested',
            error: normalizedError,
            response: responseText,
            completedAt: failedAt,
          }),
        )

        await runAssistantTurnBestEffort(() =>
          recordAssistantDiagnosticEvent({
            vault: input.vault,
            component: 'assistant',
            kind: 'turn.failed',
            level: 'error',
            message: normalizedError.message,
            code: normalizedError.code,
            sessionId: failedSession.sessionId,
            turnId: receipt.turnId,
            counterDeltas: {
              turnsFailed: 1,
            },
            at: failedAt,
          }),
        )

        throw error
      } finally {
        await runAssistantTurnBestEffort(() =>
          refreshAssistantStatusSnapshotLocal(input.vault),
        )
      }
    },
  })
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const remote = await maybeUpdateAssistantSessionOptionsViaDaemon(input)
  if (remote) {
    return remote
  }

  return updateAssistantSessionOptionsLocal(input)
}

export async function updateAssistantSessionOptionsLocal(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const session = await resolveAssistantSession({
    vault: input.vault,
    conversation: {
      sessionId: input.sessionId,
    },
    createIfMissing: false,
  })

  const providerConfig = mergeAssistantProviderConfigsForProvider(
    session.session.provider,
    {
      provider: session.session.provider,
      ...session.session.providerOptions,
    },
    {
      provider: session.session.provider,
      ...input.providerOptions,
    },
  )

  return saveAssistantSession(input.vault, {
    ...session.session,
    providerOptions: serializeAssistantProviderSessionOptions({
      ...providerConfig,
      sandbox: clampVaultBoundAssistantSandbox(providerConfig.sandbox),
    }),
    updatedAt: new Date().toISOString(),
  })
}

function resolveAssistantTurnRoutes(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): ResolvedAssistantFailoverRoute[] {
  const provider = mergeAssistantProviderConfigs(
    defaults,
    { provider: resolved.session.provider, ...resolved.session.providerOptions },
    input,
  ).provider
  const providerDefaults = resolveAssistantProviderDefaults(defaults, provider)
  const providerOptions = serializeAssistantProviderSessionOptions(
    mergeAssistantProviderConfigsForProvider(
      provider,
      providerDefaults ? { provider, ...providerDefaults } : null,
      { provider, ...resolved.session.providerOptions },
      compactAssistantProviderConfigInput({
        provider,
        ...input,
        sandbox: clampVaultBoundAssistantSandbox(input.sandbox),
      }),
    ),
  )
  const executionConfig = mergeAssistantProviderConfigsForProvider(
    provider,
    providerDefaults ? { provider, ...providerDefaults } : null,
    compactAssistantProviderConfigInput({ provider, ...input }),
  )
  return buildAssistantFailoverRoutes({
    backups: input.failoverRoutes ?? defaults?.failoverRoutes ?? null,
    codexCommand: executionConfig.codexCommand,
    defaults,
    provider,
    providerOptions,
  }).map((route) => ({
    ...route,
    providerOptions: serializeAssistantProviderSessionOptions({
      ...route.providerOptions,
      sandbox: clampVaultBoundAssistantSandbox(route.providerOptions.sandbox),
    }),
  }))
}

async function persistPendingAssistantUsageEvent(input: {
  providerResult: ExecutedAssistantProviderTurnResult
  session: AssistantSession
  turnId: string
  vault: string
}): Promise<void> {
  const usage = input.providerResult.usage
  const hostedMemberId = normalizeNullableString(process.env.HOSTED_MEMBER_ID)
  const apiKeyEnv = normalizeNullableString(
    usage?.apiKeyEnv ?? input.providerResult.providerOptions.apiKeyEnv,
  )

  if (!usage || !hostedMemberId) {
    return
  }

  await writePendingAssistantUsageRecord({
    vault: input.vault,
    record: {
      schema: ASSISTANT_USAGE_SCHEMA,
      usageId: createAssistantUsageId({
        attemptCount: input.providerResult.attemptCount,
        turnId: input.turnId,
      }),
      memberId: hostedMemberId,
      sessionId: input.session.sessionId,
      turnId: input.turnId,
      attemptCount: input.providerResult.attemptCount,
      occurredAt: new Date().toISOString(),
      provider: input.providerResult.provider,
      routeId: input.providerResult.route.routeId,
      requestedModel: usage.requestedModel ?? input.providerResult.providerOptions.model,
      servedModel: usage.servedModel ?? null,
      providerName: normalizeNullableString(
        usage.providerName ?? input.providerResult.providerOptions.providerName,
      ),
      baseUrl: normalizeNullableString(
        usage.baseUrl ?? input.providerResult.providerOptions.baseUrl,
      ),
      apiKeyEnv,
      credentialSource: resolveAssistantUsageCredentialSource({
        apiKeyEnv,
        provider: input.providerResult.provider,
        userEnvKeys: readHostedUserEnvKeysFromProcessEnv(process.env),
      }),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      totalTokens: usage.totalTokens,
      providerSessionId: input.providerResult.providerSessionId,
      providerRequestId: usage.providerRequestId,
      providerMetadataJson: usage.providerMetadataJson,
      rawUsageJson: usage.rawUsageJson,
    },
  })
}

function readHostedUserEnvKeysFromProcessEnv(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const raw = normalizeNullableString(env.HOSTED_EXECUTION_USER_ENV_KEYS)

  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((key) => normalizeNullableString(key))
    .filter((key): key is string => key !== null)
}

async function persistFailedAssistantPromptAttempt(input: {
  plan: {
    persistUserPromptOnFailure: boolean
  }
  prompt: string
  session: AssistantSession
  turnCreatedAt: string
  turnTrigger: AssistantTurnTrigger
  vault: string
}): Promise<void> {
  if (input.plan.persistUserPromptOnFailure) {
    return
  }

  const text = buildFailedAssistantPromptAttemptText({
    prompt: input.prompt,
    turnTrigger: input.turnTrigger,
  })
  const existing = await listAssistantTranscriptEntries(
    input.vault,
    input.session.sessionId,
  )
  const lastEntry = existing.at(-1)
  if (lastEntry?.kind === 'error' && lastEntry.text === text) {
    return
  }

  await appendAssistantTranscriptEntries(
    input.vault,
    input.session.sessionId,
    [
      {
        kind: 'error',
        text,
        createdAt: input.turnCreatedAt,
      },
    ],
  )
}

async function runAssistantTurnBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  await task().catch(() => undefined)
}

function buildFailedAssistantPromptAttemptText(input: {
  prompt: string
  turnTrigger: AssistantTurnTrigger
}): string {
  const prompt =
    input.turnTrigger === 'automation-auto-reply'
      ? extractAssistantAutoReplyFailedPromptText(input.prompt)
      : input.prompt
  return `Failed assistant prompt attempt [${input.turnTrigger}]: ${prompt}`
}

function extractAssistantAutoReplyFailedPromptText(prompt: string): string {
  const matched = Array.from(
    prompt.matchAll(
      /(?:^|\n)(?:Capture \d+:\n)?(?:Reply context:\n[\s\S]*?\n\n)?Message text:\n([\s\S]*?)(?=\n\n(?:Capture \d+:|Attachment context:|Reply context:|$)|$)/gu,
    ),
    (match) => match[1]?.trim() ?? '',
  ).filter((value) => value.length > 0)

  if (matched.length === 0) {
    return prompt
  }

  return matched.length === 1 ? matched[0] : matched.join('\n\n')
}
