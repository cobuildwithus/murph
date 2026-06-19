import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { sendAssistantMessage } from '../service.js'
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
import { resolveAssistantStatePaths } from '../store/paths.js'

const ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA =
  'murph.assistant-auto-reply-terminal-evidence.v1'
const ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_SCHEMA =
  'murph.assistant-auto-reply-suppression-commit.v1'
const ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_INDEX_SCHEMA =
  'murph.assistant-auto-reply-suppression-commit-index.v1'

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

export interface AssistantAutoReplySuppressionCommit {
  groupCaptureIds: string[]
  groupId: string
  groupInputIds: string[]
  primaryCaptureId: string
  primaryInputId: string
  providerCleanup: AssistantAutoReplyTerminalEvidence['providerCleanup']
  recordedAt: string
  schema: typeof ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_SCHEMA
  terminal: {
    kind: 'suppressed'
    reason: string
  }
}

interface AssistantAutoReplySuppressionCommitIndex {
  groupId: string
  indexedEvidenceId: string
  schema: typeof ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_INDEX_SCHEMA
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
}): Promise<void> {
  const terminalKind =
    input.outcome === 'deferred' && input.result.deliveryIntentId
      ? 'reply_intent_committed'
      : null
  await writeAssistantAutoReplyReplyTerminalEvidence({
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
}): Promise<void> {
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
}

export async function writeAssistantAutoReplySuppressionEvidence(input: {
  captureIds: readonly string[]
  inputIds?: readonly string[]
  linqMessageIds?: readonly string[]
  reason: string
  recordedAt?: string
  vault: string
}): Promise<void> {
  const group = normalizeEvidenceGroup({
    captureIds: input.captureIds,
    inputIds: input.inputIds,
  })
  const providerCleanup = createProviderCleanupState(input.linqMessageIds ?? [])
  const recordedAt = input.recordedAt ?? new Date().toISOString()
  const commit: AssistantAutoReplySuppressionCommit = {
    groupCaptureIds: group.captureIds,
    groupId: group.groupId,
    groupInputIds: group.inputIds,
    primaryCaptureId: group.primaryCaptureId,
    primaryInputId: group.primaryInputId,
    providerCleanup,
    recordedAt,
    schema: ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_SCHEMA,
    terminal: {
      kind: 'suppressed',
      reason: input.reason,
    },
  }

  await writeAssistantAutoReplySuppressionCommitIndexes(input.vault, commit)
  await writeAssistantAutoReplySuppressionCommit(input.vault, commit)
  await writeAssistantAutoReplySuppressionEvidenceProjections(input.vault, commit)
}

export async function readAssistantAutoReplySuppressionCommit(input: {
  captureIds: readonly string[]
  inputIds?: readonly string[]
  vault: string
}): Promise<AssistantAutoReplySuppressionCommit | null> {
  const group = normalizeEvidenceGroup({
    captureIds: input.captureIds,
    inputIds: input.inputIds,
  })
  const exactCommit = await readAssistantAutoReplySuppressionCommitByGroupId(
    input.vault,
    group.groupId,
  )
  if (exactCommit) {
    return exactCommit
  }

  return readAssistantAutoReplySuppressionCommitByIndexedEvidenceIds(
    input.vault,
    group,
  )
}

export async function repairAssistantAutoReplySuppressionEvidenceFromCommit(input: {
  captureIds: readonly string[]
  inputIds?: readonly string[]
  vault: string
}): Promise<{ committed: boolean; repaired: boolean }> {
  const commit = await readAssistantAutoReplySuppressionCommit(input)
  if (!commit) {
    return {
      committed: false,
      repaired: false,
    }
  }

  await writeAssistantAutoReplySuppressionEvidenceProjections(input.vault, commit)
  return {
    committed: true,
    repaired: true,
  }
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

async function writeAssistantAutoReplySuppressionCommit(
  vault: string,
  commit: AssistantAutoReplySuppressionCommit,
): Promise<void> {
  const filePath = resolveAssistantAutoReplySuppressionCommitPath(
    vault,
    commit.groupId,
  )
  await ensureAssistantStateDir(path.dirname(filePath))
  await writeAssistantStateJson(filePath, commit)
}

async function writeAssistantAutoReplySuppressionCommitIndexes(
  vault: string,
  commit: AssistantAutoReplySuppressionCommit,
): Promise<void> {
  const indexDirectory = resolveAssistantAutoReplySuppressionCommitIndexDirectory(vault)
  await ensureAssistantStateDir(indexDirectory)
  await Promise.all(
    collectSuppressionCommitLookupIds(commit).map((indexedEvidenceId) =>
      writeAssistantStateJson(
        resolveAssistantAutoReplySuppressionCommitIndexPath(
          vault,
          indexedEvidenceId,
        ),
        {
          groupId: commit.groupId,
          indexedEvidenceId,
          schema: ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_INDEX_SCHEMA,
        } satisfies AssistantAutoReplySuppressionCommitIndex,
      ),
    ),
  )
}

async function writeAssistantAutoReplySuppressionEvidenceProjections(
  vault: string,
  commit: AssistantAutoReplySuppressionCommit,
): Promise<void> {
  const group = normalizeEvidenceGroup({
    captureIds: commit.groupCaptureIds,
    inputIds: commit.groupInputIds,
  })
  await Promise.all(
    group.evidenceIds.map((evidenceId) =>
      writeAssistantAutoReplyTerminalEvidence(vault, evidenceId, {
        captureId: evidenceId,
        groupCaptureIds: commit.groupCaptureIds,
        groupId: commit.groupId,
        groupInputIds: commit.groupInputIds,
        inputId: evidenceId,
        primaryCaptureId: commit.primaryCaptureId,
        primaryInputId: commit.primaryInputId,
        providerCleanup: commit.providerCleanup,
        recordedAt: commit.recordedAt,
        schema: ASSISTANT_AUTO_REPLY_EVIDENCE_SCHEMA,
        terminal: commit.terminal,
      }),
    ),
  )
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

function resolveAssistantAutoReplySuppressionCommitDirectory(vault: string): string {
  return path.join(
    resolveAssistantStatePaths(vault).assistantStateRoot,
    'auto-reply',
    'suppression-commits',
  )
}

function resolveAssistantAutoReplySuppressionCommitPath(
  vault: string,
  groupId: string,
): string {
  return path.join(
    resolveAssistantAutoReplySuppressionCommitDirectory(vault),
    `${encodeURIComponent(groupId)}.json`,
  )
}

function resolveAssistantAutoReplySuppressionCommitIndexDirectory(vault: string): string {
  return path.join(
    resolveAssistantStatePaths(vault).assistantStateRoot,
    'auto-reply',
    'suppression-commit-index',
  )
}

function resolveAssistantAutoReplySuppressionCommitIndexPath(
  vault: string,
  evidenceId: string,
): string {
  return path.join(
    resolveAssistantAutoReplySuppressionCommitIndexDirectory(vault),
    `${encodeURIComponent(evidenceId)}.json`,
  )
}

async function readAssistantAutoReplySuppressionCommitByGroupId(
  vault: string,
  groupId: string,
): Promise<AssistantAutoReplySuppressionCommit | null> {
  try {
    const raw = await readFile(
      resolveAssistantAutoReplySuppressionCommitPath(vault, groupId),
      'utf8',
    )
    return parseAssistantAutoReplySuppressionCommit(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

async function readAssistantAutoReplySuppressionCommitByIndexedEvidenceIds(
  vault: string,
  group: ReturnType<typeof normalizeEvidenceGroup>,
): Promise<AssistantAutoReplySuppressionCommit | null> {
  for (const evidenceId of collectEvidenceGroupLookupIds(group)) {
    const index = await readAssistantAutoReplySuppressionCommitIndex(
      vault,
      evidenceId,
    )
    if (!index) {
      continue
    }
    const commit = await readAssistantAutoReplySuppressionCommitByGroupId(
      vault,
      index.groupId,
    )
    if (commit && suppressionCommitCoversEvidenceGroup(commit, group)) {
      return commit
    }
  }

  return null
}

async function readAssistantAutoReplySuppressionCommitIndex(
  vault: string,
  evidenceId: string,
): Promise<AssistantAutoReplySuppressionCommitIndex | null> {
  try {
    const raw = await readFile(
      resolveAssistantAutoReplySuppressionCommitIndexPath(vault, evidenceId),
      'utf8',
    )
    return parseAssistantAutoReplySuppressionCommitIndex(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

function suppressionCommitCoversEvidenceGroup(
  commit: AssistantAutoReplySuppressionCommit,
  group: ReturnType<typeof normalizeEvidenceGroup>,
): boolean {
  const commitEvidenceIds = new Set(collectSuppressionCommitLookupIds(commit))
  return group.evidenceIds.every((evidenceId) => commitEvidenceIds.has(evidenceId))
}

function collectSuppressionCommitLookupIds(
  commit: AssistantAutoReplySuppressionCommit,
): string[] {
  return [
    ...new Set(
      [
        ...commit.groupInputIds,
        ...commit.groupCaptureIds,
      ].map((evidenceId) => evidenceId.trim()).filter(Boolean),
    ),
  ]
}

function collectEvidenceGroupLookupIds(
  group: ReturnType<typeof normalizeEvidenceGroup>,
): string[] {
  return [
    ...new Set(
      [
        ...group.evidenceIds,
        ...group.captureIds,
      ].map((evidenceId) => evidenceId.trim()).filter(Boolean),
    ),
  ]
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

function parseAssistantAutoReplySuppressionCommit(value: unknown): AssistantAutoReplySuppressionCommit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    groupCaptureIds?: unknown
    groupId?: unknown
    groupInputIds?: unknown
    primaryCaptureId?: unknown
    primaryInputId?: unknown
    providerCleanup?: unknown
    recordedAt?: unknown
    schema?: unknown
    terminal?: unknown
  }
  if (record.schema !== ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_SCHEMA) {
    return null
  }
  const groupId = normalizeUnknownNullableString(record.groupId)
  const primaryCaptureId = normalizeUnknownNullableString(record.primaryCaptureId)
  const primaryInputId = normalizeUnknownNullableString(record.primaryInputId)
  const recordedAt = normalizeUnknownNullableString(record.recordedAt)
  const terminal = parseTerminalEvidence(record.terminal)
  if (
    !groupId ||
    !primaryCaptureId ||
    !primaryInputId ||
    !recordedAt ||
    !terminal ||
    terminal.kind !== 'suppressed'
  ) {
    return null
  }
  const groupCaptureIds = Array.isArray(record.groupCaptureIds)
    ? record.groupCaptureIds
        .map((item) => normalizeUnknownNullableString(item))
        .filter((item): item is string => item !== null)
    : []
  const groupInputIds = Array.isArray(record.groupInputIds)
    ? record.groupInputIds
        .map((item) => normalizeUnknownNullableString(item))
        .filter((item): item is string => item !== null)
    : []
  if (groupCaptureIds.length === 0 && groupInputIds.length === 0) {
    return null
  }

  return {
    groupCaptureIds,
    groupId,
    groupInputIds,
    primaryCaptureId,
    primaryInputId,
    providerCleanup: parseProviderCleanup(record.providerCleanup),
    recordedAt,
    schema: ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_SCHEMA,
    terminal,
  }
}

function parseAssistantAutoReplySuppressionCommitIndex(value: unknown): AssistantAutoReplySuppressionCommitIndex | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    groupId?: unknown
    indexedEvidenceId?: unknown
    schema?: unknown
  }
  if (record.schema !== ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_INDEX_SCHEMA) {
    return null
  }
  const groupId = normalizeUnknownNullableString(record.groupId)
  const indexedEvidenceId = normalizeUnknownNullableString(record.indexedEvidenceId)
  if (!groupId || !indexedEvidenceId) {
    return null
  }

  return {
    groupId,
    indexedEvidenceId,
    schema: ASSISTANT_AUTO_REPLY_SUPPRESSION_COMMIT_INDEX_SCHEMA,
  }
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
