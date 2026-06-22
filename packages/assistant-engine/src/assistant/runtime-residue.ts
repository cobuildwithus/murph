import type { Dirent } from 'node:fs'
import { readdir, readFile, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantTurnReceiptSchema,
  type AssistantOutboxIntent,
  type AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assertAssistantStatePathHasNoSymlinks,
} from '@murphai/runtime-state/node'
import {
  assistantAcceptedTurnInputJournalSchema,
  type AssistantAcceptedTurnInputJournal,
} from './active-turn-input-journal.js'
import {
  readAssistantAutoReplyReceiptMetadata,
} from './automation/auto-reply-retry.js'
import {
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
  type AssistantAutoReplyTerminalEvidence,
} from './automation/evidence.js'
import {
  readAssistantAutoReplyIntentProvenance,
  type AssistantAutoReplyIntentProvenance,
} from './automation/intent-provenance.js'
import { assistantInputIdFromInboxCaptureId } from './input-source.js'
import {
  readAssistantInputEvent,
  resolveAssistantInputEventsDirectory,
  type AssistantInputEventRecord,
} from './input-store.js'
import { readAssistantOutboxIntentInventoryEntry } from './outbox/store.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError } from './shared.js'
import { ensureAssistantState } from './store/persistence.js'
import type { AssistantStatePaths } from './store/paths.js'

const ASSISTANT_RUNTIME_RESIDUE_RETENTION_LIMIT = 100
const ASSISTANT_RUNTIME_RESIDUE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

export interface AssistantRuntimeResiduePruneResult {
  acceptedTurnInputJournalsPruned: number
  autoReplyEvidenceFilesPruned: number
  autoReplyEvidenceGroupsPruned: number
  autoReplyIntentProvenancePruned: number
  inputEventsPruned: number
  receiptsPruned: number
}

interface PersistedRecord<T> {
  filePath: string
  record: T
}

interface Inventory<T> {
  records: T[]
  trusted: boolean
}

interface EvidenceFile extends PersistedRecord<AssistantAutoReplyTerminalEvidence> {
  evidenceId: string
}

interface EvidenceGroup {
  complete: boolean
  filePaths: string[]
  groupId: string
  inputIds: Set<string>
  recordedAtMs: number
  records: AssistantAutoReplyTerminalEvidence[]
}

interface AssistantRuntimeResidueInventory {
  evidence: Inventory<EvidenceFile>
  inputEvents: Inventory<PersistedRecord<AssistantInputEventRecord>>
  journals: Inventory<PersistedRecord<AssistantAcceptedTurnInputJournal>>
  outbox: Inventory<PersistedRecord<AssistantOutboxIntent>>
  provenance: Inventory<PersistedRecord<AssistantAutoReplyIntentProvenance>>
  receipts: Inventory<PersistedRecord<AssistantTurnReceipt>>
}

interface AssistantRuntimeResiduePrunePlan {
  evidenceGroups: EvidenceGroup[]
  inputEventPaths: string[]
  journalPaths: string[]
  provenancePaths: string[]
  receiptPaths: string[]
}

export async function pruneAssistantRuntimeResidue(input: {
  now?: Date
  pendingInputIds: readonly string[]
  vault: string
}): Promise<AssistantRuntimeResiduePruneResult> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    return await pruneAssistantRuntimeResidueAtPaths({
      now: input.now ?? new Date(),
      paths,
      pendingInputIds: input.pendingInputIds,
      vault: input.vault,
    })
  })
}

async function pruneAssistantRuntimeResidueAtPaths(input: {
  now: Date
  paths: AssistantStatePaths
  pendingInputIds: readonly string[]
  vault: string
}): Promise<AssistantRuntimeResiduePruneResult> {
  const directories = resolveAssistantRuntimeResidueDirectories(input.paths)
  const inventory = await readAssistantRuntimeResidueInventory({
    directories,
    paths: input.paths,
    vault: input.vault,
  })
  const plan = planAssistantRuntimeResiduePrune({
    inventory,
    now: input.now,
    pendingInputIds: input.pendingInputIds,
  })

  for (const filePath of plan.journalPaths) {
    await removeAssistantStateFile(filePath)
  }
  for (const filePath of plan.inputEventPaths) {
    await removeAssistantStateFile(filePath)
  }
  for (const filePath of plan.receiptPaths) {
    await removeAssistantStateFile(filePath)
  }

  let evidenceFilesPruned = 0
  for (const group of plan.evidenceGroups) {
    for (const filePath of group.filePaths) {
      await removeAssistantStateFile(filePath)
      evidenceFilesPruned += 1
    }
  }
  for (const filePath of plan.provenancePaths) {
    await removeAssistantStateFile(filePath)
  }

  await Promise.all([
    removeAssistantStateDirectoryIfEmpty(directories.acceptedTurnInputs),
    removeAssistantStateDirectoryIfEmpty(directories.evidence),
    removeAssistantStateDirectoryIfEmpty(directories.inputEvents),
    removeAssistantStateDirectoryIfEmpty(directories.provenance),
  ])

  return {
    acceptedTurnInputJournalsPruned: plan.journalPaths.length,
    autoReplyEvidenceFilesPruned: evidenceFilesPruned,
    autoReplyEvidenceGroupsPruned: plan.evidenceGroups.length,
    autoReplyIntentProvenancePruned: plan.provenancePaths.length,
    inputEventsPruned: plan.inputEventPaths.length,
    receiptsPruned: plan.receiptPaths.length,
  }
}

function planAssistantRuntimeResiduePrune(input: {
  inventory: AssistantRuntimeResidueInventory
  now: Date
  pendingInputIds: readonly string[]
}): AssistantRuntimeResiduePrunePlan {
  const cutoffMs = input.now.getTime() - ASSISTANT_RUNTIME_RESIDUE_RETENTION_MS
  const pendingInputIds = new Set(
    input.pendingInputIds.map((inputId) => inputId.trim()).filter(Boolean),
  )
  const activeOutbox = input.inventory.outbox.records
    .map(({ record }) => record)
    .filter(isActiveAssistantOutboxIntent)
  const activeIntentIds = new Set(activeOutbox.map((intent) => intent.intentId))
  const activeTurnIds = new Set(activeOutbox.map((intent) => intent.turnId))
  const allOutboxIntentIds = new Set(
    input.inventory.outbox.records.map(({ record }) => record.intentId),
  )
  const receiptsByTurnId = new Map(
    input.inventory.receipts.records.map((entry) => [
      entry.record.turnId,
      entry,
    ] as const),
  )
  const activeAutoReplyInputIds = new Set<string>()
  for (const turnId of activeTurnIds) {
    const receipt = receiptsByTurnId.get(turnId)?.record
    const metadata = receipt
      ? readAssistantAutoReplyReceiptMetadata(receipt)
      : null
    for (const inputId of metadata?.inputIds ?? []) {
      activeAutoReplyInputIds.add(inputId)
    }
  }

  const journalPaths: string[] = []
  const retainedJournalInputIds = new Set<string>()
  const retainedJournalTurnIds = new Set<string>()
  for (const journal of input.inventory.journals.records) {
    const receipt = receiptsByTurnId.get(journal.record.turnId)?.record ?? null
    const canPrune =
      input.inventory.journals.trusted &&
      input.inventory.outbox.trusted &&
      receipt !== null &&
      receipt.status !== 'running' &&
      !activeTurnIds.has(journal.record.turnId) &&
      journal.record.inputIds.every((inputId) => !pendingInputIds.has(inputId))

    if (canPrune) {
      journalPaths.push(journal.filePath)
      continue
    }

    retainedJournalTurnIds.add(journal.record.turnId)
    for (const inputId of journal.record.inputIds) {
      retainedJournalInputIds.add(inputId)
    }
  }

  const evidenceGroups = buildEvidenceGroups(input.inventory.evidence.records)
  const prunableEvidenceGroups = evidenceGroups
    .filter((group) =>
      input.inventory.evidence.trusted &&
      input.inventory.inputEvents.trusted &&
      input.inventory.journals.trusted &&
      input.inventory.outbox.trusted &&
      group.complete &&
      Number.isFinite(group.recordedAtMs) &&
      !setIntersects(group.inputIds, pendingInputIds) &&
      !setIntersects(group.inputIds, retainedJournalInputIds) &&
      !setIntersects(group.inputIds, activeAutoReplyInputIds) &&
      !group.records.some(hasPendingAssistantProviderCleanup) &&
      group.records.every((evidence) => {
        const intentId = readEvidenceDeliveryIntentId(evidence)
        return intentId === null || !activeIntentIds.has(intentId)
      }),
    )
    .sort(compareEvidenceGroupsNewestFirst)
    .filter((group, index) =>
      index >= ASSISTANT_RUNTIME_RESIDUE_RETENTION_LIMIT ||
      group.recordedAtMs < cutoffMs,
    )
  const prunableEvidenceGroupIds = new Set(
    prunableEvidenceGroups.map((group) => group.groupId),
  )

  const protectedEvidenceInputIds = new Set<string>()
  for (const group of evidenceGroups) {
    if (prunableEvidenceGroupIds.has(group.groupId)) {
      continue
    }
    for (const inputId of group.inputIds) {
      protectedEvidenceInputIds.add(inputId)
    }
  }

  const inputEventPaths = new Set<string>()
  const inputEventsById = new Map(
    input.inventory.inputEvents.records.map((entry) => [
      entry.record.inputId,
      entry,
    ] as const),
  )
  for (const group of prunableEvidenceGroups) {
    for (const inputId of group.inputIds) {
      const event = inputEventsById.get(inputId)
      if (event) {
        inputEventPaths.add(event.filePath)
      }
    }
  }

  if (
    input.inventory.evidence.trusted &&
    input.inventory.inputEvents.trusted &&
    input.inventory.journals.trusted &&
    input.inventory.outbox.trusted
  ) {
    const orphanEvents = input.inventory.inputEvents.records
      .filter(({ filePath, record }) =>
        !inputEventPaths.has(filePath) &&
        !pendingInputIds.has(record.inputId) &&
        !retainedJournalInputIds.has(record.inputId) &&
        !activeAutoReplyInputIds.has(record.inputId) &&
        !protectedEvidenceInputIds.has(record.inputId) &&
        Number.isFinite(resolveInputEventTimestampMs(record)),
      )
      .sort((left, right) =>
        resolveInputEventTimestampMs(right.record) -
        resolveInputEventTimestampMs(left.record),
      )

    for (const [index, event] of orphanEvents.entries()) {
      const timestampMs = resolveInputEventTimestampMs(event.record)
      if (
        index >= ASSISTANT_RUNTIME_RESIDUE_RETENTION_LIMIT ||
        timestampMs < cutoffMs
      ) {
        inputEventPaths.add(event.filePath)
      }
    }
  }

  const receiptPaths: string[] = []
  if (input.inventory.outbox.trusted && input.inventory.receipts.trusted) {
    const unprotectedReceipts = input.inventory.receipts.records
      .filter(({ record }) =>
        !activeTurnIds.has(record.turnId) &&
        !retainedJournalTurnIds.has(record.turnId) &&
        receiptHasNoPendingAutoReplyInputs({
          pendingInputIds,
          receipt: record,
        }) &&
        Number.isFinite(resolveReceiptTimestampMs(record)),
      )

    const terminalReceipts = unprotectedReceipts
      .filter(({ record }) => isPrunableTerminalAssistantTurnReceipt(record))
      .sort((left, right) =>
        resolveReceiptTimestampMs(right.record) -
        resolveReceiptTimestampMs(left.record),
      )
    for (const [index, receipt] of terminalReceipts.entries()) {
      const timestampMs = resolveReceiptTimestampMs(receipt.record)
      if (
        index >= ASSISTANT_RUNTIME_RESIDUE_RETENTION_LIMIT ||
        timestampMs < cutoffMs
      ) {
        receiptPaths.push(receipt.filePath)
      }
    }

    for (const receipt of unprotectedReceipts) {
      if (
        receipt.record.status === 'running' &&
        resolveReceiptTimestampMs(receipt.record) < cutoffMs
      ) {
        receiptPaths.push(receipt.filePath)
      }
    }
  }

  const provenancePaths =
    input.inventory.outbox.trusted && input.inventory.provenance.trusted
      ? input.inventory.provenance.records
          .filter(({ record }) => !allOutboxIntentIds.has(record.intentId))
          .map(({ filePath }) => filePath)
      : []

  return {
    evidenceGroups: prunableEvidenceGroups,
    inputEventPaths: [...inputEventPaths],
    journalPaths,
    provenancePaths,
    receiptPaths,
  }
}

function receiptHasNoPendingAutoReplyInputs(input: {
  pendingInputIds: ReadonlySet<string>
  receipt: AssistantTurnReceipt
}): boolean {
  const metadata = readAssistantAutoReplyReceiptMetadata(input.receipt)
  if (!metadata) {
    return true
  }
  return metadata.inputIds.every((inputId) => !input.pendingInputIds.has(inputId))
}

function isPrunableTerminalAssistantTurnReceipt(
  receipt: AssistantTurnReceipt,
): boolean {
  return (
    receipt.status === 'completed' ||
    receipt.status === 'deferred' ||
    receipt.status === 'blocked' ||
    receipt.status === 'failed'
  )
}

function isActiveAssistantOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return (
    intent.deliveryConfirmationPending ||
    intent.status === 'pending' ||
    intent.status === 'sending' ||
    intent.status === 'retryable'
  )
}

function hasPendingAssistantProviderCleanup(
  evidence: AssistantAutoReplyTerminalEvidence,
): boolean {
  return (
    evidence.providerCleanup.linqMessageIds.length > 0 &&
    evidence.providerCleanup.queuedAt === null
  )
}

function readEvidenceDeliveryIntentId(
  evidence: AssistantAutoReplyTerminalEvidence,
): string | null {
  return (
    evidence.terminal.kind === 'deferred' ||
    evidence.terminal.kind === 'replied' ||
    evidence.terminal.kind === 'reply_intent_committed'
  )
    ? evidence.terminal.deliveryIntentId
    : null
}

function buildEvidenceGroups(files: readonly EvidenceFile[]): EvidenceGroup[] {
  const groups = new Map<
    string,
    {
      actualEvidenceIds: Set<string>
      expectedEvidenceIds: Set<string>
      filePaths: string[]
      fingerprint: string
      inputIds: Set<string>
      records: AssistantAutoReplyTerminalEvidence[]
      consistent: boolean
    }
  >()

  for (const file of files) {
    const expectedEvidenceIds = new Set<string>(
      file.record.groupInputIds.length > 0
        ? file.record.groupInputIds
        : file.record.groupCaptureIds,
    )
    const inputIds = new Set<string>(
      file.record.groupInputIds.length > 0
        ? file.record.groupInputIds
        : file.record.groupCaptureIds.map(assistantInputIdFromInboxCaptureId),
    )
    const fingerprint = createEvidenceGroupFingerprint({
      evidence: file.record,
      expectedEvidenceIds,
      inputIds,
    })
    const existing = groups.get(file.record.groupId)
    if (!existing) {
      groups.set(file.record.groupId, {
        actualEvidenceIds: new Set<string>([file.evidenceId]),
        consistent: true,
        expectedEvidenceIds,
        filePaths: [file.filePath],
        fingerprint,
        inputIds,
        records: [file.record],
      })
      continue
    }

    existing.actualEvidenceIds.add(file.evidenceId)
    existing.filePaths.push(file.filePath)
    existing.records.push(file.record)
    for (const inputId of inputIds) {
      existing.inputIds.add(inputId)
    }
    if (existing.fingerprint !== fingerprint) {
      existing.consistent = false
    }
  }

  return [...groups.entries()].map(([groupId, group]) => ({
    complete:
      group.consistent &&
      setsEqual(group.actualEvidenceIds, group.expectedEvidenceIds),
    filePaths: group.filePaths,
    groupId,
    inputIds: group.inputIds,
    recordedAtMs: Date.parse(group.records[0]?.recordedAt ?? ''),
    records: group.records,
  }))
}

function createEvidenceGroupFingerprint(input: {
  evidence: AssistantAutoReplyTerminalEvidence
  expectedEvidenceIds: ReadonlySet<string>
  inputIds: ReadonlySet<string>
}): string {
  return JSON.stringify({
    expectedEvidenceIds: [...input.expectedEvidenceIds].sort(),
    groupCaptureIds: [...input.evidence.groupCaptureIds].sort(),
    inputIds: [...input.inputIds].sort(),
    providerCleanup: input.evidence.providerCleanup,
    recordedAt: input.evidence.recordedAt,
    terminal: input.evidence.terminal,
  })
}

function compareEvidenceGroupsNewestFirst(
  left: EvidenceGroup,
  right: EvidenceGroup,
): number {
  const timestampDelta = right.recordedAtMs - left.recordedAtMs
  return Number.isFinite(timestampDelta) && timestampDelta !== 0
    ? timestampDelta
    : right.groupId.localeCompare(left.groupId)
}

async function readAssistantRuntimeResidueInventory(input: {
  directories: ReturnType<typeof resolveAssistantRuntimeResidueDirectories>
  paths: AssistantStatePaths
  vault: string
}): Promise<AssistantRuntimeResidueInventory> {
  const [evidence, inputEvents, journals, outbox, provenance, receipts] =
    await Promise.all([
      readEvidenceInventory(input.directories.evidence, input.vault),
      readInputEventInventory(input.directories.inputEvents, input.paths),
      readJsonInventory(
        input.directories.acceptedTurnInputs,
        (value) => assistantAcceptedTurnInputJournalSchema.parse(value),
      ),
      readOutboxInventory(input.paths.outboxDirectory, input.vault),
      readProvenanceInventory(input.directories.provenance, input.vault),
      readJsonInventory(
        input.paths.turnsDirectory,
        (value) => assistantTurnReceiptSchema.parse(value),
      ),
    ])

  return {
    evidence,
    inputEvents,
    journals,
    outbox,
    provenance,
    receipts,
  }
}

async function readEvidenceInventory(
  directory: string,
  vault: string,
): Promise<Inventory<EvidenceFile>> {
  const records: EvidenceFile[] = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory)) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    let evidenceId: string
    try {
      evidenceId = decodeURIComponent(entry.name.slice(0, -'.json'.length))
    } catch {
      trusted = false
      continue
    }

    try {
      const record = await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
        vault,
        evidenceId,
      )
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        evidenceId,
        filePath: path.join(directory, entry.name),
        record,
      })
    } catch {
      trusted = false
    }
  }

  return { records, trusted }
}

async function readInputEventInventory(
  directory: string,
  paths: AssistantStatePaths,
): Promise<Inventory<PersistedRecord<AssistantInputEventRecord>>> {
  const records: Array<PersistedRecord<AssistantInputEventRecord>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory)) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    const inputId = entry.name.slice(0, -'.json'.length)
    try {
      const record = await readAssistantInputEvent({ inputId, paths })
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        filePath: path.join(directory, entry.name),
        record,
      })
    } catch {
      trusted = false
    }
  }

  return { records, trusted }
}

async function readOutboxInventory(
  directory: string,
  vault: string,
): Promise<Inventory<PersistedRecord<AssistantOutboxIntent>>> {
  const records: Array<PersistedRecord<AssistantOutboxIntent>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory)) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    const filePath = path.join(directory, entry.name)
    try {
      const record = await readAssistantOutboxIntentInventoryEntry(vault, filePath)
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        filePath,
        record,
      })
    } catch {
      trusted = false
    }
  }

  return { records, trusted }
}

async function readProvenanceInventory(
  directory: string,
  vault: string,
): Promise<Inventory<PersistedRecord<AssistantAutoReplyIntentProvenance>>> {
  const records: Array<PersistedRecord<AssistantAutoReplyIntentProvenance>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory)) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    let intentId: string
    try {
      intentId = decodeURIComponent(entry.name.slice(0, -'.json'.length))
    } catch {
      trusted = false
      continue
    }

    try {
      const record = await readAssistantAutoReplyIntentProvenance({
        intentId,
        vault,
      })
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        filePath: path.join(directory, entry.name),
        record,
      })
    } catch {
      trusted = false
    }
  }

  return { records, trusted }
}

async function readJsonInventory<T>(
  directory: string,
  parse: (value: unknown) => T,
): Promise<Inventory<PersistedRecord<T>>> {
  const records: Array<PersistedRecord<T>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory)) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    const filePath = path.join(directory, entry.name)
    try {
      records.push({
        filePath,
        record: parse(JSON.parse(await readFile(filePath, 'utf8'))),
      })
    } catch {
      trusted = false
    }
  }

  return { records, trusted }
}

function resolveAssistantRuntimeResidueDirectories(paths: AssistantStatePaths) {
  return {
    acceptedTurnInputs: path.join(paths.stateDirectory, 'accepted-turn-inputs'),
    evidence: path.join(paths.assistantStateRoot, 'auto-reply', 'evidence'),
    inputEvents: resolveAssistantInputEventsDirectory(paths),
    provenance: path.join(
      paths.assistantStateRoot,
      'auto-reply',
      'intent-provenance',
    ),
  }
}

async function readDirectoryEntries(directory: string): Promise<Dirent[]> {
  try {
    await assertAssistantStatePathHasNoSymlinks(directory)
    return await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}

async function removeAssistantStateFile(filePath: string): Promise<void> {
  await assertAssistantStatePathHasNoSymlinks(filePath)
  await rm(filePath, { force: true })
}

async function removeAssistantStateDirectoryIfEmpty(directory: string): Promise<void> {
  try {
    await assertAssistantStatePathHasNoSymlinks(directory)
    if ((await readdir(directory)).length === 0) {
      await rmdir(directory)
    }
  } catch (error) {
    if (isMissingFileError(error) || readNodeErrorCode(error) === 'ENOTEMPTY') {
      return
    }
    throw error
  }
}

function resolveInputEventTimestampMs(event: AssistantInputEventRecord): number {
  const timestampMs = Date.parse(event.updatedAt ?? event.storedAt)
  return Number.isFinite(timestampMs) ? timestampMs : Number.NaN
}

function resolveReceiptTimestampMs(receipt: AssistantTurnReceipt): number {
  const timestampMs = Date.parse(
    receipt.completedAt ?? receipt.updatedAt ?? receipt.startedAt,
  )
  return Number.isFinite(timestampMs) ? timestampMs : Number.NaN
}

function setIntersects<T>(
  left: ReadonlySet<T>,
  right: ReadonlySet<T>,
): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true
    }
  }
  return false
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}

function readNodeErrorCode(error: unknown): string | null {
  return (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  )
    ? (error as { code: string }).code
    : null
}
