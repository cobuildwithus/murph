import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { sendAssistantMessage } from '../service.js'
import {
  assistantOutboxAnsweredCoverageSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  ensureAssistantStateDir,
  writeAssistantStateJson,
} from '@murphai/runtime-state/node/assistant-state-fs'
import {
  normalizeNullableString,
} from '../shared.js'
import {
  assistantInputIdFromInboxCaptureId,
} from '../input-source.js'
import {
  readAssistantInputEvent,
} from '../input-store.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { readAssistantTurnReceipt } from '../turns.js'
import { readAssistantAutoReplyReceiptMetadata } from './auto-reply-retry.js'

const ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA =
  'murph.assistant-auto-reply-terminal-evidence.v1'
const ASSISTANT_AUTO_REPLY_ANSWERED_COVERAGE_SCHEMA =
  'murph.assistant-auto-reply-answered-coverage.v1'

export type AssistantAutoReplyTerminalKind =
  | 'deferred'
  | 'reply_intent_committed'
  | 'replied'
  | 'retry_exhausted'
  | 'suppressed'

export interface AssistantAutoReplyTerminalEvidence {
  captureId: string
  groupCaptureIds: string[]
  groupId: string
  groupInputIds: string[]
  inputId: string
  primaryCaptureId: string
  primaryInputId: string
  providerCleanup: {
    linqMessageIds: string[]
    queuedAt: string | null
  }
  recordedAt: string
  schema: typeof ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA
  terminal:
    | {
        deliveryIntentId: string | null
        kind: 'deferred' | 'replied' | 'reply_intent_committed'
        sessionId: string
      }
      | {
          kind: 'suppressed'
          reason: string
        }
      | {
          failedAttempts: number
          kind: 'retry_exhausted'
          maxFailedAttempts: number
          reason: string
        }
}

interface AssistantAutoReplyAnsweredCoverageState {
  coverage: AssistantOutboxIntent['answeredCoverage']
  pendingLaneRanges: AssistantAutoReplyAnsweredCoverageRange[]
  pendingLaneSeqs: string[]
  schema: typeof ASSISTANT_AUTO_REPLY_ANSWERED_COVERAGE_SCHEMA
}

interface AssistantAutoReplyAnsweredCoverageRange {
  endSeq: string
  startSeq: string
}

export async function assistantAutoReplyTerminalEvidenceExists(
  vault: string,
  evidenceId: string,
): Promise<boolean> {
  return (await readAssistantAutoReplyTerminalEvidenceByEvidenceId(vault, evidenceId)) !== null
}

export async function hasCompleteAssistantAutoReplyTerminalEvidence(input: {
  captureId?: string | null
  inputId: string
  vault: string
}): Promise<boolean> {
  const evidence =
    await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
      input.vault,
      input.inputId,
    )
    ?? (
      input.captureId
        ? await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
            input.vault,
            input.captureId,
          )
        : null
    )
  if (!evidence) {
    return false
  }

  return await assistantAutoReplyTerminalEvidenceGroupComplete({
    evidence,
    vault: input.vault,
  })
}

export async function readAssistantAutoReplyTerminalEvidenceByEvidenceId(
  vault: string,
  evidenceId: string,
): Promise<AssistantAutoReplyTerminalEvidence | null> {
  try {
    const raw = await readFile(resolveAssistantAutoReplyEvidencePath(vault, evidenceId), 'utf8')
    return parseAssistantAutoReplyTerminalEvidence(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export async function findAssistantAutoReplyDeliveryIntentIds(input: {
  intents: readonly Pick<
    AssistantOutboxIntent,
    'answeredCoverage' | 'intentId' | 'turnId'
  >[]
  vault: string
}): Promise<Set<string>> {
  const matched = new Set<string>()
  const unresolvedByTurnId = new Map<string, string[]>()

  for (const intent of input.intents) {
    if (intent.answeredCoverage) {
      matched.add(intent.intentId)
      continue
    }
    const unresolved = unresolvedByTurnId.get(intent.turnId)
    if (unresolved) {
      unresolved.push(intent.intentId)
    } else {
      unresolvedByTurnId.set(intent.turnId, [intent.intentId])
    }
  }

  for (const [turnId, intentIds] of unresolvedByTurnId) {
    const receipt = await readAssistantTurnReceipt(input.vault, turnId)
    if (!receipt || !readAssistantAutoReplyReceiptMetadata(receipt)) {
      continue
    }
    for (const intentId of intentIds) {
      matched.add(intentId)
    }
  }

  return matched
}

export async function computeAssistantAutoReplyAnsweredCoverageFromTerminalInputs(input: {
  baseCoverage?: AssistantOutboxIntent['answeredCoverage'] | null
  terminalInputIds?: readonly string[] | null
  vault: string
}): Promise<AssistantOutboxIntent['answeredCoverage']> {
  const current = await readAssistantAutoReplyAnsweredCoverageState(input.vault)
  const laneSeqs = await readAssistantAutoReplyAnsweredCoverageLaneSeqs({
    inputIds: input.terminalInputIds ?? [],
    vault: input.vault,
  })
  return advanceAssistantAutoReplyAnsweredCoverageState({
    current: {
      ...current,
      coverage: selectHighestAssistantAutoReplyAnsweredCoverage(
        input.baseCoverage ?? null,
        current.coverage,
      ),
    },
    laneSeqs,
  }).coverage
}

async function assistantAutoReplyTerminalEvidenceGroupComplete(input: {
  evidence: AssistantAutoReplyTerminalEvidence
  vault: string
}): Promise<boolean> {
  const groupInputIds = [
    ...new Set(
      input.evidence.groupInputIds && input.evidence.groupInputIds.length > 0
        ? input.evidence.groupInputIds
        : input.evidence.groupCaptureIds.map(assistantInputIdFromInboxCaptureId),
    ),
  ]
  if (groupInputIds.length === 0) {
    return true
  }

  const groupEvidence = await Promise.all(
    groupInputIds.map((inputId) =>
      readAssistantAutoReplyTerminalEvidenceByEvidenceId(input.vault, inputId),
    ),
  )
  return groupEvidence.every((item) => item !== null)
}

export async function writeAssistantAutoReplyReplyIntentEvidence(input: {
  captureIds: readonly string[]
  inputIds?: readonly string[]
  linqMessageIds?: readonly string[]
  outcome: 'deferred' | 'result'
  recordedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<string[]> {
  const terminalKind =
    input.outcome === 'deferred' && input.result.deliveryIntentId
      ? 'reply_intent_committed'
      : null
  return await writeAssistantAutoReplyReplyTerminalEvidence({
    captureIds: input.captureIds,
    inputIds: input.inputIds,
    deliveryIntentId: input.result.deliveryIntentId,
    linqMessageIds: input.linqMessageIds,
    outcome: input.outcome,
    recordedAt: input.recordedAt,
    sessionId: input.result.session.sessionId,
    ...(terminalKind ? { terminalKind } : {}),
    vault: input.vault,
  })
}

export async function writeAssistantAutoReplyReplyTerminalEvidence(input: {
  captureIds: readonly string[]
  deliveryIntentId: string | null
  inputIds?: readonly string[]
  linqMessageIds?: readonly string[]
  outcome: 'deferred' | 'result'
  recordedAt: string
  sessionId: string
  terminalKind?: 'deferred' | 'replied' | 'reply_intent_committed'
  vault: string
}): Promise<string[]> {
  const group = normalizeEvidenceGroup({
    captureIds: input.captureIds,
    inputIds: input.inputIds,
  })
  const providerCleanup = createProviderCleanupState(input.linqMessageIds ?? [])
  const terminalKind = input.terminalKind ??
    (input.outcome === 'deferred' ? 'deferred' : 'replied')

  await Promise.all(
    group.evidenceIds.map((evidenceId) =>
      writeAssistantAutoReplyTerminalEvidence(input.vault, evidenceId, {
        captureId: evidenceId,
        groupCaptureIds: group.captureIds,
        groupId: group.groupId,
        groupInputIds: group.inputIds,
        inputId: evidenceId,
        primaryCaptureId: group.primaryCaptureId,
        primaryInputId: group.primaryInputId,
        providerCleanup,
        recordedAt: input.recordedAt,
        schema: ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA,
        terminal: {
          deliveryIntentId: input.deliveryIntentId,
          kind: terminalKind,
          sessionId: input.sessionId,
        },
      }),
    ),
  )
  await recordAssistantAutoReplyAnsweredCoverage({
    inputIds: group.inputIds,
    vault: input.vault,
  })
  return providerCleanup.linqMessageIds
}

export async function writeAssistantAutoReplySuppressionEvidence(input: {
  captureIds: readonly string[]
  inputIds?: readonly string[]
  linqMessageIds?: readonly string[]
  reason: string
  recordedAt?: string
  vault: string
}): Promise<string[]> {
  const group = normalizeEvidenceGroup({
    captureIds: input.captureIds,
    inputIds: input.inputIds,
  })
  const providerCleanup = createProviderCleanupState(input.linqMessageIds ?? [])

  await Promise.all(
    group.evidenceIds.map((evidenceId) =>
      writeAssistantAutoReplyTerminalEvidence(input.vault, evidenceId, {
        captureId: evidenceId,
        groupCaptureIds: group.captureIds,
        groupId: group.groupId,
        groupInputIds: group.inputIds,
        inputId: evidenceId,
        primaryCaptureId: group.primaryCaptureId,
        primaryInputId: group.primaryInputId,
        providerCleanup,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        schema: ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA,
        terminal: {
          kind: 'suppressed',
          reason: input.reason,
        },
      }),
    ),
  )
  await recordAssistantAutoReplyAnsweredCoverage({
    inputIds: group.inputIds,
    vault: input.vault,
  })
  return providerCleanup.linqMessageIds
}

export async function listPendingAssistantAutoReplyLinqCleanupEvidence(input: {
  limit?: number
  vault: string
}): Promise<{
  captureIds: string[]
  linqMessageIds: string[]
}> {
  const evidenceDirectory = resolveAssistantAutoReplyEvidenceDirectory(input.vault)
  let entries: string[]
  try {
    entries = await readdir(evidenceDirectory)
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        captureIds: [],
        linqMessageIds: [],
      }
    }
    throw error
  }

  const captureIds: string[] = []
  const messageIds = new Set<string>()
  const limit = input.limit ?? 100
  for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const raw = await readFile(path.join(evidenceDirectory, entry), 'utf8')
      .catch((error) => {
        if (isMissingFileError(error)) {
          return null
        }
        throw error
      })
    if (!raw) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const evidence = parseAssistantAutoReplyTerminalEvidence(parsed)
    if (!evidence || evidence.providerCleanup.queuedAt) {
      continue
    }
    if (evidence.providerCleanup.linqMessageIds.length === 0) {
      continue
    }
    captureIds.push(evidence.captureId)
    for (const messageId of evidence.providerCleanup.linqMessageIds) {
      messageIds.add(messageId)
    }
    if (captureIds.length >= limit) {
      break
    }
  }

  return {
    captureIds,
    linqMessageIds: [...messageIds],
  }
}

export async function markAssistantAutoReplyLinqCleanupQueued(input: {
  captureIds: readonly string[]
  queuedAt?: string
  vault: string
}): Promise<void> {
  const queuedAt = input.queuedAt ?? new Date().toISOString()
  await Promise.all(
    input.captureIds.map(async (captureId) => {
      const evidence = await readAssistantAutoReplyTerminalEvidenceByEvidenceId(input.vault, captureId)
      if (!evidence || evidence.providerCleanup.queuedAt) {
        return
      }
      await writeAssistantAutoReplyTerminalEvidence(input.vault, captureId, {
        ...evidence,
        providerCleanup: {
          ...evidence.providerCleanup,
          queuedAt,
        },
      })
    }),
  )
}

function normalizeEvidenceGroup(input: {
  captureIds: readonly string[]
  inputIds?: readonly string[]
}): {
  captureIds: string[]
  evidenceIds: string[]
  groupId: string
  inputIds: string[]
  primaryCaptureId: string
  primaryInputId: string
} {
  const captureIds = [
    ...new Set(input.captureIds.map((captureId) => captureId.trim()).filter(Boolean)),
  ]
  const inputIds = [
    ...new Set((input.inputIds ?? []).map((inputId) => inputId.trim()).filter(Boolean)),
  ]
  const evidenceIds = inputIds.length > 0 ? inputIds : captureIds
  const primaryInputId = evidenceIds[0]
  if (!primaryInputId) {
    throw new Error('assistant auto-reply terminal evidence requires at least one input id or capture id')
  }
  const primaryCaptureId = captureIds[0] ?? primaryInputId

  return {
    captureIds,
    evidenceIds,
    groupId: `group_${evidenceIds.join('__')}`,
    inputIds,
    primaryCaptureId,
    primaryInputId,
  }
}

function createProviderCleanupState(messageIds: readonly string[]): AssistantAutoReplyTerminalEvidence['providerCleanup'] {
  return {
    linqMessageIds: [...new Set(messageIds.map((messageId) => messageId.trim()).filter(Boolean))],
    queuedAt: null,
  }
}

async function writeAssistantAutoReplyTerminalEvidence(
  vault: string,
  evidenceId: string,
  evidence: AssistantAutoReplyTerminalEvidence,
): Promise<void> {
  const filePath = resolveAssistantAutoReplyEvidencePath(vault, evidenceId)
  await ensureAssistantStateDir(path.dirname(filePath))
  await writeAssistantStateJson(filePath, evidence)
}

function resolveAssistantAutoReplyEvidenceDirectory(vault: string): string {
  return path.join(
    resolveAssistantStatePaths(vault).assistantStateRoot,
    'auto-reply',
    'evidence',
  )
}

function resolveAssistantAutoReplyEvidencePath(vault: string, evidenceId: string): string {
  return path.join(
    resolveAssistantAutoReplyEvidenceDirectory(vault),
    `${encodeURIComponent(evidenceId)}.json`,
  )
}

async function recordAssistantAutoReplyAnsweredCoverage(input: {
  inputIds: readonly string[]
  vault: string
}): Promise<void> {
  if (input.inputIds.length === 0) {
    return
  }

  const laneSeqs = await readAssistantAutoReplyAnsweredCoverageLaneSeqs(input)
  if (laneSeqs.length === 0) {
    return
  }

  const current = await readAssistantAutoReplyAnsweredCoverageState(input.vault)
  const next = advanceAssistantAutoReplyAnsweredCoverageState({
    current,
    laneSeqs,
  })
  if (sameAssistantAutoReplyAnsweredCoverageState(next, current)) {
    return
  }

  const statePath = resolveAssistantAutoReplyAnsweredCoveragePath(input.vault)
  await ensureAssistantStateDir(path.dirname(statePath))
  await writeAssistantStateJson(statePath, next)
}

async function readAssistantAutoReplyAnsweredCoverageLaneSeqs(input: {
  inputIds: readonly string[]
  vault: string
}): Promise<string[]> {
  const laneSeqs = new Set<string>()
  for (const inputId of input.inputIds) {
    const normalizedInputId = normalizeNullableString(inputId)
    if (!normalizedInputId) {
      continue
    }
    const event = await readAssistantInputEventForAnsweredCoverage({
      inputId: normalizedInputId,
      vault: input.vault,
    })
    if (
      event?.sourceRef.kind === 'hosted-mailbox' &&
      event.sourceRef.lane === 'conversation'
    ) {
      laneSeqs.add(event.sourceRef.laneSeq)
    }
  }
  return [...laneSeqs]
}

async function readAssistantInputEventForAnsweredCoverage(input: {
  inputId: string
  vault: string
}): ReturnType<typeof readAssistantInputEvent> {
  try {
    return await readAssistantInputEvent(input)
  } catch (error) {
    if (isAssistantInputEventInvalidIdError(error)) {
      return null
    }
    throw error
  }
}

function isAssistantInputEventInvalidIdError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ASSISTANT_INPUT_EVENT_INVALID_ID',
  )
}

async function readAssistantAutoReplyAnsweredCoverageState(
  vault: string,
): Promise<AssistantAutoReplyAnsweredCoverageState> {
  try {
    const raw = await readFile(
      resolveAssistantAutoReplyAnsweredCoveragePath(vault),
      'utf8',
    )
    return parseAssistantAutoReplyAnsweredCoverageState(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) {
      return createEmptyAssistantAutoReplyAnsweredCoverageState()
    }
    throw error
  }
}

function resolveAssistantAutoReplyAnsweredCoveragePath(vault: string): string {
  return path.join(
    resolveAssistantStatePaths(vault).assistantStateRoot,
    'auto-reply',
    'answered-coverage.json',
  )
}

function createEmptyAssistantAutoReplyAnsweredCoverageState(): AssistantAutoReplyAnsweredCoverageState {
  return {
    coverage: null,
    pendingLaneRanges: [],
    pendingLaneSeqs: [],
    schema: ASSISTANT_AUTO_REPLY_ANSWERED_COVERAGE_SCHEMA,
  }
}

function parseAssistantAutoReplyAnsweredCoverageState(
  value: unknown,
): AssistantAutoReplyAnsweredCoverageState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyAssistantAutoReplyAnsweredCoverageState()
  }
  const record = value as {
    coverage?: unknown
    pendingLaneRanges?: unknown
    pendingLaneSeqs?: unknown
    schema?: unknown
  }
  if (record.schema !== ASSISTANT_AUTO_REPLY_ANSWERED_COVERAGE_SCHEMA) {
    return createEmptyAssistantAutoReplyAnsweredCoverageState()
  }
  const coverage = assistantOutboxAnsweredCoverageSchema
    .nullable()
    .safeParse(record.coverage ?? null)
  const legacySeqRanges = Array.isArray(record.pendingLaneSeqs)
    ? record.pendingLaneSeqs
        .map((item) => normalizeUnknownNullableString(item))
        .filter((item): item is string => item !== null)
        .map((item) => parseNumericLaneSeq(item))
        .filter((item): item is bigint => item !== null)
        .map((seq) => ({ end: seq, start: seq }))
    : []
  return {
    coverage: coverage.success ? coverage.data : null,
    pendingLaneRanges: serializeAssistantAutoReplyAnsweredCoverageRanges(
      mergeAssistantAutoReplyAnsweredCoverageRanges([
        ...legacySeqRanges,
        ...parseAssistantAutoReplyAnsweredCoverageRanges(record.pendingLaneRanges),
      ]),
    ),
    pendingLaneSeqs: [],
    schema: ASSISTANT_AUTO_REPLY_ANSWERED_COVERAGE_SCHEMA,
  }
}

function advanceAssistantAutoReplyAnsweredCoverageState(input: {
  current: AssistantAutoReplyAnsweredCoverageState
  laneSeqs: readonly string[]
}): AssistantAutoReplyAnsweredCoverageState {
  const initialCoveredSeq = input.current.coverage
    ? parseNumericLaneSeq(input.current.coverage.laneSeq)
    : 0n
  if (initialCoveredSeq === null) {
    return input.current
  }
  let coveredSeq = initialCoveredSeq

  const pending = new Set<bigint>()
  for (const laneSeq of input.laneSeqs) {
    const numeric = parseNumericLaneSeq(laneSeq)
    if (numeric !== null && numeric > coveredSeq) {
      pending.add(numeric)
    }
  }

  let pendingRanges = mergeAssistantAutoReplyAnsweredCoverageRanges([
    ...parseAssistantAutoReplyAnsweredCoverageRanges(input.current.pendingLaneRanges),
    ...input.current.pendingLaneSeqs
      .map((laneSeq) => parseNumericLaneSeq(laneSeq))
      .filter((seq): seq is bigint => seq !== null)
      .map((seq) => ({ end: seq, start: seq })),
    ...[...pending].map((seq) => ({ end: seq, start: seq })),
  ]).filter((range) => range.end > coveredSeq)

  for (;;) {
    const nextSeq = coveredSeq + 1n
    const nextRange = pendingRanges[0]
    if (!nextRange || nextRange.start > nextSeq) {
      break
    }
    coveredSeq = nextRange.end > coveredSeq ? nextRange.end : coveredSeq
    pendingRanges = pendingRanges.slice(1)
  }

  const pendingLaneRanges = serializeAssistantAutoReplyAnsweredCoverageRanges(
    pendingRanges.filter((range) => range.end > coveredSeq),
  )

  return {
    coverage: coveredSeq > 0n
      ? {
          lane: 'conversation',
          laneSeq: coveredSeq.toString(),
        }
      : null,
    pendingLaneRanges,
    pendingLaneSeqs: [],
    schema: ASSISTANT_AUTO_REPLY_ANSWERED_COVERAGE_SCHEMA,
  }
}

function parseAssistantAutoReplyAnsweredCoverageRanges(
  value: unknown,
): Array<{ end: bigint; start: bigint }> {
  if (!Array.isArray(value)) {
    return []
  }
  const ranges: Array<{ end: bigint; start: bigint }> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as {
      endSeq?: unknown
      startSeq?: unknown
    }
    const startSeq = normalizeUnknownNullableString(record.startSeq)
    const endSeq = normalizeUnknownNullableString(record.endSeq)
    if (!startSeq || !endSeq) {
      continue
    }
    const start = parseNumericLaneSeq(startSeq)
    const end = parseNumericLaneSeq(endSeq)
    if (start === null || end === null || end < start) {
      continue
    }
    ranges.push({ end, start })
  }
  return ranges
}

function mergeAssistantAutoReplyAnsweredCoverageRanges(
  ranges: readonly { end: bigint; start: bigint }[],
): Array<{ end: bigint; start: bigint }> {
  const sorted = ranges
    .filter((range) => range.end >= range.start)
    .sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : 0)
  const merged: Array<{ end: bigint; start: bigint }> = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end + 1n) {
      merged.push({ ...range })
      continue
    }
    if (range.end > previous.end) {
      previous.end = range.end
    }
  }
  return merged
}

function serializeAssistantAutoReplyAnsweredCoverageRanges(
  ranges: readonly { end: bigint; start: bigint }[],
): AssistantAutoReplyAnsweredCoverageRange[] {
  return ranges.map((range) => ({
    endSeq: range.end.toString(),
    startSeq: range.start.toString(),
  }))
}

function sameAssistantAutoReplyAnsweredCoverageState(
  left: AssistantAutoReplyAnsweredCoverageState,
  right: AssistantAutoReplyAnsweredCoverageState,
): boolean {
  const leftRanges = left.pendingLaneRanges
    .map((range) => `${range.startSeq}-${range.endSeq}`)
    .join('\u0000')
  const rightRanges = right.pendingLaneRanges
    .map((range) => `${range.startSeq}-${range.endSeq}`)
    .join('\u0000')
  return left.coverage?.laneSeq === right.coverage?.laneSeq &&
    left.pendingLaneSeqs.join('\u0000') === right.pendingLaneSeqs.join('\u0000') &&
    leftRanges === rightRanges
}

function selectHighestAssistantAutoReplyAnsweredCoverage(
  left: AssistantOutboxIntent['answeredCoverage'],
  right: AssistantOutboxIntent['answeredCoverage'],
): AssistantOutboxIntent['answeredCoverage'] {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  const leftSeq = parseNumericLaneSeq(left.laneSeq)
  const rightSeq = parseNumericLaneSeq(right.laneSeq)
  if (leftSeq === null || rightSeq === null) {
    return left.laneSeq.localeCompare(right.laneSeq) >= 0 ? left : right
  }
  return leftSeq >= rightSeq ? left : right
}

function parseNumericLaneSeq(laneSeq: string): bigint | null {
  try {
    return /^\d+$/u.test(laneSeq) ? BigInt(laneSeq) : null
  } catch {
    return null
  }
}

function parseAssistantAutoReplyTerminalEvidence(value: unknown): AssistantAutoReplyTerminalEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    captureId?: unknown
    groupCaptureIds?: unknown
    groupId?: unknown
    groupInputIds?: unknown
    inputId?: unknown
    primaryCaptureId?: unknown
    primaryInputId?: unknown
    providerCleanup?: unknown
    recordedAt?: unknown
    schema?: unknown
    terminal?: unknown
  }
  if (record.schema !== ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA) {
    return null
  }
  const captureId = normalizeUnknownNullableString(record.captureId)
  const groupId = normalizeUnknownNullableString(record.groupId)
  const primaryCaptureId = normalizeUnknownNullableString(record.primaryCaptureId)
  const inputId = normalizeUnknownNullableString(record.inputId) ?? captureId
  const primaryInputId =
    normalizeUnknownNullableString(record.primaryInputId) ?? inputId
  const recordedAt = normalizeUnknownNullableString(record.recordedAt)
  if (!captureId || !groupId || !primaryCaptureId || !inputId || !primaryInputId || !recordedAt) {
    return null
  }
  const terminal = parseTerminalEvidence(record.terminal)
  if (!terminal) {
    return null
  }
  return {
    captureId,
    groupCaptureIds: Array.isArray(record.groupCaptureIds)
      ? record.groupCaptureIds
          .map((item) => normalizeUnknownNullableString(item))
          .filter((item): item is string => item !== null)
      : [captureId],
    groupInputIds: Array.isArray(record.groupInputIds)
      ? record.groupInputIds
          .map((item) => normalizeUnknownNullableString(item))
          .filter((item): item is string => item !== null)
      : [inputId],
    groupId,
    inputId,
    primaryCaptureId,
    primaryInputId,
    providerCleanup: parseProviderCleanup(record.providerCleanup),
    recordedAt,
    schema: ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA,
    terminal,
  }
}

function parseProviderCleanup(value: unknown): AssistantAutoReplyTerminalEvidence['providerCleanup'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createProviderCleanupState([])
  }
  const record = value as {
    linqMessageIds?: unknown
    queuedAt?: unknown
  }
  return {
    linqMessageIds: Array.isArray(record.linqMessageIds)
      ? record.linqMessageIds
          .map((item) => normalizeUnknownNullableString(item))
          .filter((item): item is string => item !== null)
      : [],
    queuedAt: normalizeUnknownNullableString(record.queuedAt),
  }
}

function parseTerminalEvidence(value: unknown): AssistantAutoReplyTerminalEvidence['terminal'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    deliveryIntentId?: unknown
    failedAttempts?: unknown
    kind?: unknown
    maxFailedAttempts?: unknown
    outcome?: unknown
    reason?: unknown
    sessionId?: unknown
  }
  if (record.kind === 'suppressed') {
    const reason = normalizeUnknownNullableString(record.reason)
    return reason ? { kind: 'suppressed', reason } : null
  }
  if (record.kind === 'retry_exhausted') {
    const reason = normalizeUnknownNullableString(record.reason)
    const failedAttempts = normalizeUnknownNonNegativeInteger(record.failedAttempts)
    const maxFailedAttempts = normalizeUnknownNonNegativeInteger(
      record.maxFailedAttempts,
    )
    return reason && failedAttempts !== null && maxFailedAttempts !== null
      ? {
          failedAttempts,
          kind: 'retry_exhausted',
          maxFailedAttempts,
          reason,
        }
      : null
  }
  if (
    record.kind === 'reply_intent_committed' &&
    (record.outcome === 'result' || record.outcome === 'deferred')
  ) {
    const sessionId = normalizeUnknownNullableString(record.sessionId)
    if (!sessionId) {
      return null
    }
    return {
      deliveryIntentId: normalizeUnknownNullableString(record.deliveryIntentId),
      kind: 'reply_intent_committed',
      sessionId,
    }
  }
  if (
    record.kind === 'deferred' ||
    record.kind === 'replied' ||
    record.kind === 'reply_intent_committed'
  ) {
    const sessionId = normalizeUnknownNullableString(record.sessionId)
    if (!sessionId) {
      return null
    }
    return {
      deliveryIntentId: normalizeUnknownNullableString(record.deliveryIntentId),
      kind: record.kind,
      sessionId,
    }
  }
  return null
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT',
  )
}

function normalizeUnknownNullableString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

function normalizeUnknownNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null
}
