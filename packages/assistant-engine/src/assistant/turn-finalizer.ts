import {
  reportHostedAssistantPersistenceTiming,
  type HostedAssistantPersistenceTiming,
  type HostedAssistantPersistenceTimingSink,
} from './hosted-turn-timing.js'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  type AssistantTranscriptEntry,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  compactAssistantProviderConfigInput,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { buildCodexResumeState, type TranscriptSeenThrough } from '@murphai/operator-config/assistant/codex-resume-state'
import { advanceBookmarkOverOwnEntries } from './transcript-bookmark.js'
import {
  doesAssistantResumeBindingMatchRoute,
} from './codex-resume-binding.js'
import {
  readAssistantCodexResume,
} from './conversation-persistence.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
import {
  buildAssistantGeneratedImageDeliveryTranscriptMarkerText,
  matchesExactAssistantVaultImageResponseMedia,
  readAssistantGeneratedImageDeliveryTranscriptMarker,
  type AssistantGeneratedImageDeliveryTranscriptMarker,
} from './response-media.js'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
} from './codex-thread-route.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'
import {
  compactAutomationAssistantTargetOverride,
} from './automation/target-override.js'
import type { AssistantCodexThreadScope } from './codex-turn/planning.js'
import { normalizeNullableString } from './shared.js'

export const ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX =
  'murph.assistant-no-reply.v1 '
export const ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT =
  'I completed that turn without sending a user-visible reply.'
const ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_VERSION = 1

export function buildAssistantNoReplyTranscriptMarkerText(input: {
  deliveryContextOrdinal: number
  turnId: string
}): string {
  return [
    ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
    JSON.stringify({
      deliveryContextOrdinal: input.deliveryContextOrdinal,
      turnId: input.turnId,
      version: ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_VERSION,
    }),
    ' ',
    ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
  ].join('')
}

export function normalizeAssistantNoReplyDeliveryContextOrdinals(
  values: readonly number[] | null | undefined,
): number[] {
  const ordinals = new Set<number>()
  for (const value of values ?? []) {
    if (Number.isInteger(value) && value >= 0) {
      ordinals.add(value)
    }
  }
  return [...ordinals].sort((left, right) => left - right)
}

export async function persistAssistantNoReplyTranscriptMarkers(input: {
  deliveryContextOrdinals: readonly number[] | null | undefined
  sessionId: string
  turnCreatedAt: string
  turnId: string
  vault: string
}): Promise<AssistantTranscriptEntry[]> {
  const ordinals = normalizeAssistantNoReplyDeliveryContextOrdinals(
    input.deliveryContextOrdinals,
  )
  if (ordinals.length === 0) {
    return []
  }

  const state = createAssistantRuntimeStateService(input.vault)
  const existingOrdinals = new Set<number>()
  for (const entry of await state.transcripts.list(input.sessionId)) {
    const marker = readAssistantNoReplyTranscriptMarker(entry)
    if (!marker) {
      continue
    }
    const matchesCurrentTurn =
      marker.turnId === input.turnId ||
      (marker.turnId === null && entry.createdAt === input.turnCreatedAt)
    if (matchesCurrentTurn) {
      existingOrdinals.add(marker.deliveryContextOrdinal)
    }
  }
  const entries = ordinals
    .filter((ordinal) => !existingOrdinals.has(ordinal))
    .map((ordinal) => ({
      createdAt: input.turnCreatedAt,
      kind: 'status' as const,
      text: buildAssistantNoReplyTranscriptMarkerText({
        deliveryContextOrdinal: ordinal,
        turnId: input.turnId,
      }),
    }))
  if (entries.length > 0) {
    return await state.transcripts.append(input.sessionId, entries)
  }
  return []
}

function readAssistantNoReplyTranscriptMarker(
  entry: AssistantTranscriptEntry,
): { deliveryContextOrdinal: number; turnId: string | null } | null {
  if (
    entry.kind !== 'status' ||
    !entry.text.startsWith(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX)
  ) {
    return null
  }

  const markerPayload = entry.text
    .slice(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX.length)
    .trimStart()
  if (!markerPayload.startsWith('{')) {
    return {
      deliveryContextOrdinal: 0,
      turnId: null,
    }
  }

  const markerEnd = markerPayload.indexOf('}')
  if (markerEnd < 0) {
    return {
      deliveryContextOrdinal: 0,
      turnId: null,
    }
  }

  try {
    const parsed = JSON.parse(markerPayload.slice(0, markerEnd + 1)) as {
      deliveryContextOrdinal?: unknown
      turnId?: unknown
    }
    const ordinal = parsed.deliveryContextOrdinal
    return {
      deliveryContextOrdinal:
        typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0
          ? ordinal
          : 0,
      turnId:
        typeof parsed.turnId === 'string' && parsed.turnId.length > 0
          ? parsed.turnId
          : null,
    }
  } catch {
    return {
      deliveryContextOrdinal: 0,
      turnId: null,
    }
  }
}

export type AssistantProviderResumeStateAction =
  | 'clear'
  | 'persist-from-provider-turn'
  | 'preserve-existing'

export async function clearAssistantSessionCodexResumeState(input: {
  session: AssistantSession
  vault: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.vault)
  const updatedAt = new Date().toISOString()
  return await state.sessions.save({
    ...input.session,
    codexResume: null,
    resumeState: null,
    updatedAt,
  })
}

export function resolveAssistantResumeStateFromProviderTurn(input: {
  assistantContractFingerprint?: string | null
  codexRolloutRelativePath?: string | null
  codexThreadId: string | null
  routeFingerprint: string
  threadCompatibilityFingerprint?: string | null
  transcriptSeenThrough?: TranscriptSeenThrough
}): AssistantSession['resumeState'] {
  return buildCodexResumeState({
    assistantContractFingerprint: input.assistantContractFingerprint,
    rolloutRelativePath: input.codexRolloutRelativePath,
    routeFingerprint: input.routeFingerprint,
    threadCompatibilityFingerprint: input.threadCompatibilityFingerprint,
    threadId: input.codexThreadId,
    transcriptSeenThrough: input.transcriptSeenThrough,
  })
}

export function resolveAssistantProviderResumeStateAction(input: {
  providerThreadUnchanged?: true
  codexThreadId: string | null
  threadScope: AssistantCodexThreadScope
}): AssistantProviderResumeStateAction {
  if (input.providerThreadUnchanged || input.threadScope === 'isolated-thread') {
    return 'preserve-existing'
  }

  return normalizeNullableString(input.codexThreadId)
    ? 'persist-from-provider-turn'
    : 'clear'
}

// A provider turn that did not complete leaves the saved thread alone: Codex
// may not have accepted the turn's history, and a thread the turn opened has no
// bookmark to resume from. The one exception is a saved thread Codex could not
// resume; it is dropped so the retry starts a new one.
export async function dropAssistantSessionStaleCodexThread(input: {
  error: unknown
  session: AssistantSession
  vault: string
}): Promise<AssistantSession> {
  const code = (input.error as { code?: unknown } | null)?.code
  return code === 'ASSISTANT_CODEX_RESUME_STALE'
    ? await clearAssistantSessionCodexResumeState({
        session: input.session,
        vault: input.vault,
      })
    : input.session
}

export async function persistAssistantTurnAndSession(input: {
  onPersistenceTiming?: HostedAssistantPersistenceTimingSink
  assistantTranscriptStandaloneContext?: true
  assistantTranscriptText?: string | null
  input: AssistantMessageInput
  // Transcript entries the caller wrote for this turn before finalizing.
  ownTranscriptEntries?: readonly AssistantTranscriptEntry[]
  plan: AssistantTurnSharedPlan
  persistUserPromptToTranscript?: boolean
  // Final answers completed before a steered message in the same turn; each
  // is persisted as its own assistant transcript entry ahead of the final.
  precedingAssistantTranscriptTexts?: readonly string[]
  providerResult: ExecutedAssistantProviderTurnResult
  providerResumeStateAction: AssistantProviderResumeStateAction
  session: AssistantSession
  turnCreatedAt: string
  turnId: string
  userContentReceivedAt?: string | null
}): Promise<AssistantSession> {
  const timing: HostedAssistantPersistenceTiming = {}
  const state = createAssistantRuntimeStateService(input.input.vault)
  const persistUserPromptToTranscript = input.persistUserPromptToTranscript ?? true
  const assistantTranscriptText =
    input.assistantTranscriptText === undefined
      ? input.providerResult.response
      : input.assistantTranscriptText
  const ownEntries: AssistantTranscriptEntry[] = [...(input.ownTranscriptEntries ?? [])]

  if (!input.plan.persistUserPromptOnFailure && persistUserPromptToTranscript) {
    const startedAt = performance.now()
    ownEntries.push(...await state.transcripts.append(
      input.session.sessionId,
      [
        {
          ...(input.userContentReceivedAt
            ? { contentReceivedAt: input.userContentReceivedAt }
            : {}),
          kind: 'user',
          text: input.input.prompt,
          createdAt: input.turnCreatedAt,
        },
      ],
    ))
    await state.turns.appendEvent({
      turnId: input.turnId,
      kind: 'user.persisted',
      detail: 'user prompt persisted after provider completion',
      at: input.turnCreatedAt,
    })
    timing.turnTimingUserPersistenceMs = performance.now() - startedAt
  }

  const auditEntries = buildAssistantProviderTranscriptAuditEntries({
    rawToolEvents: input.providerResult.rawEvents,
    routeLabel: input.providerResult.route.label,
  })
  if (auditEntries.length > 0) {
    const startedAt = performance.now()
    ownEntries.push(...await state.transcripts.append(input.session.sessionId, auditEntries))
    timing.turnTimingAuditTranscriptMs = performance.now() - startedAt
  }

  const assistantTranscriptEntries = [
    ...(input.precedingAssistantTranscriptTexts ?? []).map((text) => ({
      kind: 'assistant' as const,
      ...(input.assistantTranscriptStandaloneContext === true
        ? { standaloneAssistantContext: true as const }
        : {}),
      text,
    })),
    ...(assistantTranscriptText !== null
      ? [{
          kind: 'assistant' as const,
          ...(input.assistantTranscriptStandaloneContext === true
            ? { standaloneAssistantContext: true as const }
            : {}),
          text: assistantTranscriptText,
        }]
      : []),
  ]
  const generatedImageMarkersStartedAt = performance.now()
  const generatedImageDeliveryEntries =
    await resolveAssistantGeneratedImageDeliveryTranscriptEntries({
      input: input.input,
      providerResult: input.providerResult,
      sessionId: input.session.sessionId,
      state,
      turnCreatedAt: input.turnCreatedAt,
      turnId: input.turnId,
    })
  timing.turnTimingGeneratedImageMarkersMs = performance.now() - generatedImageMarkersStartedAt
  const turnTranscriptEntries = [
    ...assistantTranscriptEntries,
    ...generatedImageDeliveryEntries,
  ]
  if (turnTranscriptEntries.length > 0) {
    const startedAt = performance.now()
    ownEntries.push(...await state.transcripts.append(
      input.session.sessionId,
      turnTranscriptEntries,
    ))
    timing.turnTimingAssistantTranscriptMs = performance.now() - startedAt
  }
  const acceptedNoReplyDeliveryContextOrdinals =
    normalizeAssistantNoReplyDeliveryContextOrdinals(
      input.providerResult.acceptedNoReplyDeliveryContextOrdinals,
    )
  const noReplyMarkerDeliveryContextOrdinals =
    acceptedNoReplyDeliveryContextOrdinals.length > 0
      ? acceptedNoReplyDeliveryContextOrdinals
      : (
          assistantTranscriptText === null &&
          input.providerResult.finalAction?.kind === 'none'
            ? [0]
            : []
        )
  const noReplyMarkersStartedAt = performance.now()
  ownEntries.push(...await persistAssistantNoReplyTranscriptMarkers({
    deliveryContextOrdinals: noReplyMarkerDeliveryContextOrdinals,
    sessionId: input.session.sessionId,
    turnCreatedAt: input.turnCreatedAt,
    turnId: input.turnId,
    vault: input.input.vault,
  }))
  timing.turnTimingNoReplyMarkersMs = performance.now() - noReplyMarkersStartedAt
  const walkedBookmark = await walkCompletedTurnBookmark({
    action: input.providerResumeStateAction,
    boundary: input.providerResult.transcriptBoundary,
    listEntries: () => state.transcripts.list(input.session.sessionId),
    ownEntries,
  })

  const updatedAt = new Date().toISOString()
  const hasTurnScopedTargetOverride =
    compactAutomationAssistantTargetOverride(
      input.input.assistantTargetOverride,
    ) !== null
  const shouldApplyProviderConfigToSession =
    input.providerResumeStateAction !== 'preserve-existing' &&
    !hasTurnScopedTargetOverride
  const nextTarget = shouldApplyProviderConfigToSession
    ? createAssistantModelTarget({
        ...assistantBackendTargetToProviderConfigInput(input.session.target),
        ...(compactAssistantProviderConfigInput(input.input) ?? {}),
      }) ?? input.session.target
    : input.session.target
  const nextProviderOptions = shouldApplyProviderConfigToSession
    ? serializeAssistantProviderSessionOptions(
        assistantBackendTargetToProviderConfigInput(nextTarget),
      )
    : input.session.providerOptions
  const nextResumeState = resolveAssistantSessionResumeState({
    action: input.providerResumeStateAction,
    assistantContractFingerprint: input.providerResult.assistantContractFingerprint,
    codexRolloutRelativePath: input.providerResult.codexRolloutRelativePath,
    codexThreadId: input.providerResult.codexThreadId,
    overrideDurableTarget: hasTurnScopedTargetOverride ? nextTarget : null,
    routeFingerprint: readCodexThreadRouteFingerprint(input.providerResult.route),
    threadCompatibilityFingerprint:
      readCodexThreadCompatibilityFingerprint(input.providerResult.route),
    sessionResumeState: readAssistantCodexResume(input.session),
    walkedBookmark,
  })

  const sessionPersistenceStartedAt = performance.now()
  const savedSession = await state.sessions.save({
    ...input.session,
    codexResume: nextResumeState,
    codexTarget: nextTarget,
    provider: nextTarget.adapter,
    providerOptions: nextProviderOptions,
    target: nextTarget,
    resumeState: nextResumeState,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
  })

  timing.turnTimingSessionPersistenceMs = performance.now() - sessionPersistenceStartedAt
  reportHostedAssistantPersistenceTiming(input.onPersistenceTiming, timing)
  return savedSession
}

async function resolveAssistantGeneratedImageDeliveryTranscriptEntries(input: {
  input: AssistantMessageInput
  providerResult: ExecutedAssistantProviderTurnResult
  sessionId: string
  state: ReturnType<typeof createAssistantRuntimeStateService>
  turnCreatedAt: string
  turnId: string
}): Promise<Array<{
  createdAt: string
  kind: 'status'
  text: string
}>> {
  const exactMedia =
    input.input.hostedImageCompletionEffectRestriction?.exactMedia?.[0] ?? null
  if (exactMedia === null || !exactMedia.ref.startsWith('raw/captures/')) {
    return []
  }
  const deliveryContextOrdinals = new Set<number>()
  for (const segment of input.providerResult.precedingResponseSegments ?? []) {
    if (matchesExactAssistantVaultImageResponseMedia({
      actual: segment.media,
      expected: exactMedia,
    })) {
      deliveryContextOrdinals.add(segment.deliveryContextOrdinal)
    }
  }
  if (matchesExactAssistantVaultImageResponseMedia({
    actual: input.providerResult.responseMedia,
    expected: exactMedia,
  })) {
    deliveryContextOrdinals.add(
      input.providerResult.responseDeliveryContextOrdinal,
    )
  }
  if (deliveryContextOrdinals.size === 0) {
    // This marker records trusted generated provenance, not delivery. A ready
    // completion may retain provider continuity while finishing without an
    // attachment; the outbox join independently proves later visibility.
    deliveryContextOrdinals.add(
      input.providerResult.responseDeliveryContextOrdinal,
    )
  }
  const markers = [...deliveryContextOrdinals].sort((left, right) =>
    left - right
  ).map((deliveryContextOrdinal) => ({
    contentType: exactMedia.contentType,
    deliveryContextOrdinal,
    ref: exactMedia.ref,
    sha256: exactMedia.sha256,
    sizeBytes: exactMedia.sizeBytes,
    turnId: input.turnId,
  } satisfies AssistantGeneratedImageDeliveryTranscriptMarker))
  const existing = await input.state.transcripts.list(input.sessionId)
  const existingKeys = new Set(existing.flatMap((entry) => {
    if (entry.kind !== 'status') {
      return []
    }
    const marker = readAssistantGeneratedImageDeliveryTranscriptMarker(
      entry.text,
    )
    return marker
      ? [`${marker.turnId}:${marker.deliveryContextOrdinal}:${marker.ref}:${marker.sha256}`]
      : []
  }))
  return markers
    .filter((marker) => !existingKeys.has(
      `${marker.turnId}:${marker.deliveryContextOrdinal}:${marker.ref}:${marker.sha256}`,
    ))
    .map((marker) => ({
      createdAt: input.turnCreatedAt,
      kind: 'status' as const,
      text: buildAssistantGeneratedImageDeliveryTranscriptMarkerText(marker),
    }))
}

// Only a completed provider turn carries a planning boundary. Failed outcomes
// do not, so their bookmark is never advanced.
async function walkCompletedTurnBookmark(input: {
  action: AssistantProviderResumeStateAction
  boundary: TranscriptSeenThrough | undefined
  listEntries: () => Promise<readonly AssistantTranscriptEntry[]>
  ownEntries: readonly AssistantTranscriptEntry[]
}): Promise<TranscriptSeenThrough | undefined> {
  if (input.boundary === undefined || input.action !== 'persist-from-provider-turn') {
    return undefined
  }
  return advanceBookmarkOverOwnEntries({
    boundary: input.boundary,
    ownEntries: input.ownEntries,
    entries: await input.listEntries(),
  })
}

// The one rule for every saved thread binding.
// - A completed provider turn adopts its thread with the bookmark walked over
//   what that turn saw and wrote.
// - A completed turn with no planning boundary keeps the same thread's existing
//   bookmark; a different thread gets none, so the next turn rebuilds from the
//   transcript. Unseen entries are replayed, never skipped.
// - A turn that did not complete never saves a binding
//   (dropAssistantSessionStaleCodexThread).
// - A turn-scoped target override replaces the durable binding only when its
//   thread matches the durable route; otherwise the durable binding is kept.
function resolveAssistantSessionResumeState(input: {
  action: AssistantProviderResumeStateAction
  assistantContractFingerprint?: string | null
  codexRolloutRelativePath?: string | null
  codexThreadId: string | null
  overrideDurableTarget: AssistantSession['target'] | null
  routeFingerprint: string
  threadCompatibilityFingerprint?: string | null
  sessionResumeState: AssistantSession['resumeState']
  walkedBookmark: TranscriptSeenThrough | undefined
}): AssistantSession['resumeState'] {
  const existing = input.sessionResumeState
  if (input.action === 'preserve-existing') {
    return existing
  }
  if (input.action === 'clear') {
    return input.overrideDurableTarget ? existing : null
  }

  const candidate = resolveAssistantResumeStateFromProviderTurn({
    assistantContractFingerprint: input.assistantContractFingerprint,
    codexRolloutRelativePath: input.codexRolloutRelativePath,
    codexThreadId: input.codexThreadId,
    routeFingerprint: input.routeFingerprint,
    threadCompatibilityFingerprint: input.threadCompatibilityFingerprint,
    transcriptSeenThrough: input.walkedBookmark
      ?? (existing?.threadId === input.codexThreadId
        ? existing?.transcriptSeenThrough
        : undefined),
  })
  if (!candidate) {
    return existing
  }
  if (input.overrideDurableTarget) {
    const durableRoute = resolveAssistantExecutionPlan({
      defaults: null,
      sessionTarget: input.overrideDurableTarget,
    }).codexRoute
    if (!doesAssistantResumeBindingMatchRoute({ resumeState: candidate, route: durableRoute })) {
      return existing
    }
  }
  return candidate
}
