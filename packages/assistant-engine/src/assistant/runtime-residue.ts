import { createHash } from 'node:crypto'
import { createReadStream, type Dirent, type Stats } from 'node:fs'
import { lstat, readdir, readFile, rm, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantTurnReceiptSchema,
  type AssistantOutboxIntent,
  type AssistantTurnReceipt,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assertAssistantStatePathHasNoSymlinks,
} from '@murphai/runtime-state/node'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import {
  assistantAcceptedTurnInputJournalSchema,
  type AssistantAcceptedTurnInputJournal,
} from './active-turn-input-journal.js'
import {
  readAssistantAutoReplyReceiptMetadata,
} from './automation/auto-reply-retry.js'
import {
  maintainAssistantAutoReplyRouteStateAtPaths,
  readAssistantAutoReplyRouteMigrationStatusAtPaths,
  type AssistantAutoReplyRouteMaintenanceResult,
} from './automation/cross-session-route-state.js'
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
  readHostedMailboxAssistantInputItemInventory,
  resolveHostedMailboxAssistantInputItemsDirectory,
  type HostedMailboxAssistantInputItemInventory,
} from './hosted-mailbox-input-items.js'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
  resolveSupportedAssistantVaultFileContentType,
} from './generated-delivery-files.js'
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
// Input events are the durable group-message and reaction spine. Retain a
// deeper bounded history without expanding every other runtime residue class.
const ASSISTANT_INPUT_EVENT_RETENTION_LIMIT = 1_000
const ASSISTANT_RUNTIME_RESIDUE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

export interface AssistantGeneratedDeliveryResiduePruneResult {
  generatedDeliveryCleanupSkippedUntrustedOutbox: boolean
  generatedDeliveryBytesPruned: number
  generatedDeliveryFilesPruned: number
}

export interface AssistantRuntimeResiduePruneResult
  extends AssistantGeneratedDeliveryResiduePruneResult {
  acceptedTurnInputJournalsPruned: number
  autoReplyEvidenceFilesPruned: number
  autoReplyEvidenceGroupsPruned: number
  autoReplyIntentProvenancePruned: number
  hostedMailboxInputItemMappingsPruned: number
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
  hostedMailboxInputItems: HostedMailboxAssistantInputItemInventory
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
  hostedMailboxInputItemPaths: string[]
  provenancePaths: string[]
  receiptPaths: string[]
}

interface AssistantGeneratedDeliveryFileSnapshot {
  absolutePath: string
  ref: string
  stats: Stats
}

interface AssistantGeneratedDeliveryPrunePlan {
  files: AssistantGeneratedDeliveryFileSnapshot[]
  inventoryFiles: AssistantGeneratedDeliveryFileSnapshot[]
  root: string | null
  skippedUntrustedOutbox: boolean
}

export async function pruneAssistantRuntimeResidue(input: {
  generatedDeliveryFilesQuiescent?: boolean
  now?: Date
  pendingInputIds: readonly string[]
  protectPendingProviderCleanupEvidence?: boolean
  signal?: AbortSignal | null
  vault: string
}): Promise<AssistantRuntimeResiduePruneResult> {
  input.signal?.throwIfAborted()
  const result = await withAssistantRuntimeWriteLock(
    input.vault,
    async (paths) => {
      await ensureAssistantState(paths)
      input.signal?.throwIfAborted()
      return await pruneAssistantRuntimeResidueAtPaths({
        generatedDeliveryFilesQuiescent:
          input.generatedDeliveryFilesQuiescent ?? false,
        now: input.now ?? new Date(),
        paths,
        pendingInputIds: input.pendingInputIds,
        protectPendingProviderCleanupEvidence:
          input.protectPendingProviderCleanupEvidence ?? false,
        signal: input.signal,
        vault: input.vault,
      })
    },
    input.signal,
  )
  input.signal?.throwIfAborted()
  return result
}

export async function pruneAssistantGeneratedDeliveryResidue(input: {
  generatedDeliveryFilesQuiescent: true
  signal?: AbortSignal | null
  vault: string
}): Promise<AssistantGeneratedDeliveryResiduePruneResult> {
  input.signal?.throwIfAborted()
  const result = await withAssistantRuntimeWriteLock(
    input.vault,
    async (paths) => {
      await ensureAssistantState(paths)
      input.signal?.throwIfAborted()
      const outbox = await readOutboxInventory(
        paths.outboxDirectory,
        input.vault,
        input.signal,
      )
      const plan = await planAssistantGeneratedDeliveryPrune({
        outbox,
        signal: input.signal,
        vault: input.vault,
      })
      input.signal?.throwIfAborted()
      const pruneResult = await applyAssistantGeneratedDeliveryPrunePlan({
        plan,
        signal: input.signal,
        vault: input.vault,
      })
      return {
        generatedDeliveryCleanupSkippedUntrustedOutbox:
          plan.skippedUntrustedOutbox,
        generatedDeliveryBytesPruned: pruneResult.bytesPruned,
        generatedDeliveryFilesPruned: pruneResult.filesPruned,
      }
    },
    input.signal,
  )
  input.signal?.throwIfAborted()
  return result
}

export async function maintainAssistantAutoReplyRouteState(
  input: {
    shouldYield?: (() => boolean) | null
    signal?: AbortSignal | null
    vault: string
  },
): Promise<AssistantAutoReplyRouteMaintenanceResult> {
  input.signal?.throwIfAborted()
  const shouldYield = () => {
    input.signal?.throwIfAborted()
    return input.shouldYield?.() === true
  }
  if (shouldYield()) {
    return { changed: false, trusted: false }
  }
  return await withAssistantRuntimeWriteLock(
    input.vault,
    async (paths) => {
      await ensureAssistantState(paths)
      input.signal?.throwIfAborted()
      const migrationStatus =
        await readAssistantAutoReplyRouteMigrationStatusAtPaths(paths)
      const outbox = await readOutboxInventory(
        paths.outboxDirectory,
        input.vault,
        input.signal,
        shouldYield,
      )
      input.signal?.throwIfAborted()
      if (!outbox.trusted || shouldYield()) {
        return { changed: false, trusted: false }
      }
      const receipts = migrationStatus === 'missing'
        ? await readJsonInventory(
            paths.turnsDirectory,
            (value) => assistantTurnReceiptSchema.parse(value),
            input.signal,
            shouldYield,
          )
        : { records: [], trusted: true }
      input.signal?.throwIfAborted()
      return await maintainAssistantAutoReplyRouteStateAtPaths({
        outboxIntents: outbox.records.map(({ record }) => record),
        outboxTrusted: outbox.trusted,
        paths,
        receipts: receipts.records.map(({ record }) => record),
        receiptsTrusted: receipts.trusted,
        shouldYield,
      })
    },
    input.signal,
  )
}

async function pruneAssistantRuntimeResidueAtPaths(input: {
  generatedDeliveryFilesQuiescent: boolean
  now: Date
  paths: AssistantStatePaths
  pendingInputIds: readonly string[]
  protectPendingProviderCleanupEvidence: boolean
  signal?: AbortSignal | null
  vault: string
}): Promise<AssistantRuntimeResiduePruneResult> {
  input.signal?.throwIfAborted()
  const directories = resolveAssistantRuntimeResidueDirectories(input.paths)
  const inventory = await readAssistantRuntimeResidueInventory({
    directories,
    paths: input.paths,
    signal: input.signal,
    vault: input.vault,
  })
  input.signal?.throwIfAborted()
  const autoReplyRouteState = await maintainAssistantAutoReplyRouteStateAtPaths({
    outboxIntents: inventory.outbox.records.map(({ record }) => record),
    outboxTrusted: inventory.outbox.trusted,
    paths: input.paths,
    receipts: inventory.receipts.records.map(({ record }) => record),
    receiptsTrusted: inventory.receipts.trusted,
  })
  input.signal?.throwIfAborted()
  const plan = planAssistantRuntimeResiduePrune({
    autoReplyRouteState,
    inventory,
    now: input.now,
    pendingInputIds: input.pendingInputIds,
    protectPendingProviderCleanupEvidence:
      input.protectPendingProviderCleanupEvidence,
  })
  const generatedDeliveryPlan = input.generatedDeliveryFilesQuiescent
    ? await planAssistantGeneratedDeliveryPrune({
        outbox: inventory.outbox,
        signal: input.signal,
        vault: input.vault,
      })
    : {
        files: [],
        inventoryFiles: [],
        root: null,
        skippedUntrustedOutbox: false,
      }
  input.signal?.throwIfAborted()

  for (const filePath of plan.journalPaths) {
    await removeAssistantStateFile(filePath, input.signal)
  }
  for (const filePath of plan.inputEventPaths) {
    await removeAssistantStateFile(filePath, input.signal)
  }
  for (const filePath of plan.hostedMailboxInputItemPaths) {
    await removeAssistantStateFile(filePath, input.signal)
  }
  for (const filePath of plan.receiptPaths) {
    await removeAssistantStateFile(filePath, input.signal)
  }

  let evidenceFilesPruned = 0
  for (const group of plan.evidenceGroups) {
    input.signal?.throwIfAborted()
    for (const filePath of group.filePaths) {
      await removeAssistantStateFile(filePath, input.signal)
      evidenceFilesPruned += 1
    }
  }
  for (const filePath of plan.provenancePaths) {
    await removeAssistantStateFile(filePath, input.signal)
  }

  const generatedDeliveryPruneResult =
    await applyAssistantGeneratedDeliveryPrunePlan({
      plan: generatedDeliveryPlan,
      signal: input.signal,
      vault: input.vault,
    })

  for (const directory of [
    directories.acceptedTurnInputs,
    directories.evidence,
    directories.hostedMailboxInputItems,
    directories.inputEvents,
    directories.provenance,
  ]) {
    await removeAssistantStateDirectoryIfEmpty(directory, input.signal)
  }

  return {
    acceptedTurnInputJournalsPruned: plan.journalPaths.length,
    autoReplyEvidenceFilesPruned: evidenceFilesPruned,
    autoReplyEvidenceGroupsPruned: plan.evidenceGroups.length,
    autoReplyIntentProvenancePruned: plan.provenancePaths.length,
    generatedDeliveryCleanupSkippedUntrustedOutbox:
      generatedDeliveryPlan.skippedUntrustedOutbox,
    generatedDeliveryBytesPruned:
      generatedDeliveryPruneResult.bytesPruned,
    generatedDeliveryFilesPruned:
      generatedDeliveryPruneResult.filesPruned,
    hostedMailboxInputItemMappingsPruned:
      plan.hostedMailboxInputItemPaths.length,
    inputEventsPruned: plan.inputEventPaths.length,
    receiptsPruned: plan.receiptPaths.length,
  }
}

async function planAssistantGeneratedDeliveryPrune(input: {
  outbox: Inventory<PersistedRecord<AssistantOutboxIntent>>
  signal?: AbortSignal | null
  vault: string
}): Promise<AssistantGeneratedDeliveryPrunePlan> {
  if (!input.outbox.trusted) {
    return {
      files: [],
      inventoryFiles: [],
      root: null,
      skippedUntrustedOutbox: true,
    }
  }

  const activeMediaByRef = new Map<
    string,
    AssistantVaultFileResponseMedia[]
  >()
  for (const { record } of input.outbox.records) {
    if (!isActiveAssistantOutboxIntent(record)) {
      continue
    }
    for (const media of record.media) {
      if (
        media.kind !== 'vault_file' ||
        !isAssistantGeneratedDeliveryRef(media.ref)
      ) {
        continue
      }
      const existing = activeMediaByRef.get(media.ref)
      if (existing) {
        existing.push(media)
      } else {
        activeMediaByRef.set(media.ref, [media])
      }
    }
  }
  // Every active descriptor sharing one ref must agree on the exact byte
  // fingerprint. Conflicting active claims mean the outbox no longer proves
  // which bytes the ref must retain, so cleanup fails closed and keeps the
  // whole inventory instead of guessing.
  for (const mediaList of activeMediaByRef.values()) {
    const [first, ...rest] = mediaList
    if (
      first !== undefined
      && rest.some((media) =>
        media.contentType !== first.contentType
        || media.sizeBytes !== first.sizeBytes
        || media.sha256 !== first.sha256)
    ) {
      return {
        files: [],
        inventoryFiles: [],
        root: null,
        skippedUntrustedOutbox: true,
      }
    }
  }
  const root = await resolveAssistantVaultPath(
    input.vault,
    ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  )
  input.signal?.throwIfAborted()

  let rootStats: Stats
  try {
    rootStats = await lstat(root)
  } catch (error) {
    input.signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      if (activeMediaByRef.size > 0) {
        throw new Error(
          'An active assistant generated delivery is missing from runtime staging.',
        )
      }
      return {
        files: [],
        inventoryFiles: [],
        root: null,
        skippedUntrustedOutbox: false,
      }
    }
    throw error
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(
      'Assistant generated-delivery root must be a regular directory.',
    )
  }

  const files: AssistantGeneratedDeliveryFileSnapshot[] = []
  const inventoryFiles: AssistantGeneratedDeliveryFileSnapshot[] = []
  const entries = await readdir(root, { withFileTypes: true })
  input.signal?.throwIfAborted()

  for (const entry of entries) {
    input.signal?.throwIfAborted()
    const absolutePath = path.join(root, entry.name)
    const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/${entry.name}`
    const stats = await lstat(absolutePath)
    input.signal?.throwIfAborted()
    if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
      throw new Error(
        'Assistant generated-delivery paths must not contain symlinks.',
      )
    }
    if (entry.isDirectory() && stats.isDirectory()) {
      throw new Error(
        'Assistant generated-delivery staging must remain flat.',
      )
    }
    if (!entry.isFile() || !stats.isFile()) {
      throw new Error(
        'Assistant generated-delivery staging may contain only regular files.',
      )
    }
    if (!isAssistantGeneratedDeliveryRef(ref)) {
      throw new Error(
        'Assistant generated-delivery staging contains an unsafe filename.',
      )
    }
    if (stats.nlink !== 1 && activeMediaByRef.has(ref)) {
      throw new Error(
        'An active assistant generated delivery must have exactly one hard link.',
      )
    }
    const file = {
      absolutePath,
      ref,
      stats,
    }
    inventoryFiles.push(file)
    const activeMedia = activeMediaByRef.get(ref) ?? []
    if (!(await assistantGeneratedDeliveryFileMatchesActiveMedia({
      activeMedia,
      filePath: absolutePath,
      ref,
      signal: input.signal,
      stats,
    }))) {
      files.push(file)
    }
  }

  const observedRefs = new Set(inventoryFiles.map((file) => file.ref))
  for (const activeRef of activeMediaByRef.keys()) {
    if (!observedRefs.has(activeRef)) {
      throw new Error(
        'An active assistant generated delivery is missing from runtime staging.',
      )
    }
  }

  for (const file of inventoryFiles) {
    input.signal?.throwIfAborted()
    await assertAssistantGeneratedDeliveryFileUnchanged({
      file,
      signal: input.signal,
      vault: input.vault,
    })
  }

  return {
    files,
    inventoryFiles,
    root,
    skippedUntrustedOutbox: false,
  }
}

async function assistantGeneratedDeliveryFileMatchesActiveMedia(input: {
  activeMedia: readonly AssistantVaultFileResponseMedia[]
  filePath: string
  ref: string
  signal?: AbortSignal | null
  stats: Stats
}): Promise<boolean> {
  if (input.activeMedia.length === 0) {
    return false
  }
  // The staged basename is runtime-owned while the descriptor's filename is
  // the user-facing display name, so matching binds on the physical ref's
  // content type plus exact size and SHA-256 rather than filename equality.
  const contentType = resolveSupportedAssistantVaultFileContentType(
    path.posix.basename(input.ref),
  )
  if (!contentType) {
    return false
  }
  const possibleMatches = input.activeMedia.filter(
    (media) =>
      media.contentType === contentType &&
      media.sizeBytes === input.stats.size,
  )
  if (possibleMatches.length === 0) {
    return false
  }
  const sha256 = await sha256AssistantGeneratedDeliveryFile(
    input.filePath,
    input.signal,
  )
  return possibleMatches.every((media) => media.sha256 === sha256)
}

async function sha256AssistantGeneratedDeliveryFile(
  filePath: string,
  signal?: AbortSignal | null,
): Promise<string> {
  signal?.throwIfAborted()
  const hash = createHash('sha256')
  try {
    const stream = createReadStream(filePath, {
      ...(signal ? { signal } : {}),
    })
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      hash.update(chunk)
    }
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
  signal?.throwIfAborted()
  return hash.digest('hex')
}

async function applyAssistantGeneratedDeliveryPrunePlan(input: {
  plan: AssistantGeneratedDeliveryPrunePlan
  signal?: AbortSignal | null
  vault: string
}): Promise<{
  bytesPruned: number
  filesPruned: number
}> {
  let bytesPruned = 0
  let filesPruned = 0
  for (const file of input.plan.inventoryFiles) {
    input.signal?.throwIfAborted()
    await assertAssistantGeneratedDeliveryFileUnchanged({
      file,
      signal: input.signal,
      vault: input.vault,
    })
  }

  for (const file of input.plan.files) {
    input.signal?.throwIfAborted()
    await assertAssistantGeneratedDeliveryFileUnchanged({
      file,
      signal: input.signal,
      vault: input.vault,
    })
    await unlink(file.absolutePath)
    input.signal?.throwIfAborted()
    bytesPruned += file.stats.size
    filesPruned += 1
  }

  if (input.plan.root) {
    input.signal?.throwIfAborted()
    try {
      const resolvedDirectory = await resolveAssistantVaultPath(
        input.vault,
        ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
      )
      input.signal?.throwIfAborted()
      if (resolvedDirectory !== input.plan.root) {
        throw new Error(
          'Assistant generated-delivery directory changed during cleanup.',
        )
      }
      const stats = await lstat(input.plan.root)
      input.signal?.throwIfAborted()
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(
          'Assistant generated-delivery directory changed during cleanup.',
        )
      }
      await rmdir(input.plan.root)
      input.signal?.throwIfAborted()
    } catch (error) {
      input.signal?.throwIfAborted()
      if (
        isMissingFileError(error) ||
        readNodeErrorCode(error) === 'ENOTEMPTY'
      ) {
        return { bytesPruned, filesPruned }
      }
      throw error
    }
  }

  return {
    bytesPruned,
    filesPruned,
  }
}

async function assertAssistantGeneratedDeliveryFileUnchanged(input: {
  file: AssistantGeneratedDeliveryFileSnapshot
  signal?: AbortSignal | null
  vault: string
}): Promise<void> {
  const resolvedPath = await resolveAssistantVaultPath(
    input.vault,
    input.file.ref,
    'file path',
  )
  input.signal?.throwIfAborted()
  if (resolvedPath !== input.file.absolutePath) {
    throw new Error(
      'Assistant generated-delivery file changed during cleanup.',
    )
  }
  const current = await lstat(resolvedPath)
  input.signal?.throwIfAborted()
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    !assistantFileStatsMatch(input.file.stats, current)
  ) {
    throw new Error(
      'Assistant generated-delivery file changed during cleanup.',
    )
  }
}

function assistantFileStatsMatch(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function planAssistantRuntimeResiduePrune(input: {
  autoReplyRouteState: AssistantAutoReplyRouteMaintenanceResult
  inventory: AssistantRuntimeResidueInventory
  now: Date
  pendingInputIds: readonly string[]
  protectPendingProviderCleanupEvidence?: boolean
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
      (!input.protectPendingProviderCleanupEvidence ||
        !group.records.some(hasPendingAssistantProviderCleanup)) &&
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
        index >= ASSISTANT_INPUT_EVENT_RETENTION_LIMIT ||
        timestampMs < cutoffMs
      ) {
        inputEventPaths.add(event.filePath)
      }
    }
  }

  const survivingInputIds = new Set(
    input.inventory.inputEvents.records
      .filter(({ filePath }) => !inputEventPaths.has(filePath))
      .map(({ record }) => record.inputId),
  )
  const hostedMailboxInputItemPaths =
    input.inventory.inputEvents.trusted &&
    input.inventory.hostedMailboxInputItems.trusted
      ? input.inventory.hostedMailboxInputItems.records
          .filter(({ inputId }) => !survivingInputIds.has(inputId))
          .map(({ filePath }) => filePath)
      : []

  const receiptPaths: string[] = []
  if (
    input.autoReplyRouteState.trusted &&
    input.inventory.outbox.trusted &&
    input.inventory.receipts.trusted
  ) {
    const eligibleReceipts = input.inventory.receipts.records
      .filter(({ record }) =>
        !activeTurnIds.has(record.turnId) &&
        !retainedJournalTurnIds.has(record.turnId) &&
        receiptHasNoPendingAutoReplyInputs({
          pendingInputIds,
          receipt: record,
        }) &&
        Number.isFinite(resolveReceiptTimestampMs(record)),
      )

    const terminalReceipts = eligibleReceipts
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

    for (const receipt of eligibleReceipts) {
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
    hostedMailboxInputItemPaths,
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
    intent.status === 'awaiting_approval' ||
    intent.status === 'pending' ||
    intent.status === 'sending' ||
    intent.status === 'retryable'
  )
}

// Migration-window guard only: hosted callers set
// protectPendingProviderCleanupEvidence until the provider-cleanup recovery
// marker is durable, so pre-upgrade evidence carrying undeleted Linq message
// ids survives until the one-shot migration queues it into
// hosted-provider-cleanup.json. Delete together with that migration.
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
  signal?: AbortSignal | null
  vault: string
}): Promise<AssistantRuntimeResidueInventory> {
  input.signal?.throwIfAborted()
  const [
    evidence,
    hostedMailboxInputItems,
    inputEvents,
    journals,
    outbox,
    provenance,
    receipts,
  ] =
    await Promise.all([
      readEvidenceInventory(
        input.directories.evidence,
        input.vault,
        input.signal,
      ),
      readHostedMailboxAssistantInputItemInventory(input.paths, input.signal),
      readInputEventInventory(
        input.directories.inputEvents,
        input.paths,
        input.signal,
      ),
      readJsonInventory(
        input.directories.acceptedTurnInputs,
        (value) => assistantAcceptedTurnInputJournalSchema.parse(value),
        input.signal,
      ),
      readOutboxInventory(
        input.paths.outboxDirectory,
        input.vault,
        input.signal,
      ),
      readProvenanceInventory(
        input.directories.provenance,
        input.vault,
        input.signal,
      ),
      readJsonInventory(
        input.paths.turnsDirectory,
        (value) => assistantTurnReceiptSchema.parse(value),
        input.signal,
      ),
    ])
  input.signal?.throwIfAborted()

  return {
    evidence,
    hostedMailboxInputItems,
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
  signal?: AbortSignal | null,
): Promise<Inventory<EvidenceFile>> {
  const records: EvidenceFile[] = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory, signal)) {
    signal?.throwIfAborted()
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
      signal?.throwIfAborted()
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
      signal?.throwIfAborted()
      trusted = false
    }
  }

  return { records, trusted }
}

async function readInputEventInventory(
  directory: string,
  paths: AssistantStatePaths,
  signal?: AbortSignal | null,
): Promise<Inventory<PersistedRecord<AssistantInputEventRecord>>> {
  const records: Array<PersistedRecord<AssistantInputEventRecord>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory, signal)) {
    signal?.throwIfAborted()
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
      signal?.throwIfAborted()
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        filePath: path.join(directory, entry.name),
        record,
      })
    } catch {
      signal?.throwIfAborted()
      trusted = false
    }
  }

  return { records, trusted }
}

async function readOutboxInventory(
  directory: string,
  vault: string,
  signal?: AbortSignal | null,
  shouldYield?: (() => boolean) | null,
): Promise<Inventory<PersistedRecord<AssistantOutboxIntent>>> {
  const records: Array<PersistedRecord<AssistantOutboxIntent>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory, signal)) {
    signal?.throwIfAborted()
    if (shouldYield?.() === true) {
      return { records, trusted: false }
    }
    if (!entry.name.endsWith('.json')) {
      if (entry.name === '.quarantine') {
        const quarantineStats = await lstat(path.join(directory, entry.name))
        signal?.throwIfAborted()
        if (
          entry.isDirectory()
          && quarantineStats.isDirectory()
          && !quarantineStats.isSymbolicLink()
        ) {
          continue
        }
      }
      trusted = false
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    const filePath = path.join(directory, entry.name)
    try {
      const record = await readAssistantOutboxIntentInventoryEntry(vault, filePath)
      signal?.throwIfAborted()
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        filePath,
        record,
      })
    } catch {
      signal?.throwIfAborted()
      trusted = false
    }
  }

  return { records, trusted }
}

async function readProvenanceInventory(
  directory: string,
  vault: string,
  signal?: AbortSignal | null,
): Promise<Inventory<PersistedRecord<AssistantAutoReplyIntentProvenance>>> {
  const records: Array<PersistedRecord<AssistantAutoReplyIntentProvenance>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory, signal)) {
    signal?.throwIfAborted()
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
      signal?.throwIfAborted()
      if (!record) {
        trusted = false
        continue
      }
      records.push({
        filePath: path.join(directory, entry.name),
        record,
      })
    } catch {
      signal?.throwIfAborted()
      trusted = false
    }
  }

  return { records, trusted }
}

async function readJsonInventory<T>(
  directory: string,
  parse: (value: unknown) => T,
  signal?: AbortSignal | null,
  shouldYield?: (() => boolean) | null,
): Promise<Inventory<PersistedRecord<T>>> {
  const records: Array<PersistedRecord<T>> = []
  let trusted = true

  for (const entry of await readDirectoryEntries(directory, signal)) {
    signal?.throwIfAborted()
    if (shouldYield?.() === true) {
      return { records, trusted: false }
    }
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    const filePath = path.join(directory, entry.name)
    try {
      const raw = await readFile(filePath, 'utf8')
      signal?.throwIfAborted()
      records.push({
        filePath,
        record: parse(JSON.parse(raw)),
      })
    } catch {
      signal?.throwIfAborted()
      trusted = false
    }
  }

  return { records, trusted }
}

function resolveAssistantRuntimeResidueDirectories(paths: AssistantStatePaths) {
  return {
    acceptedTurnInputs: path.join(paths.stateDirectory, 'accepted-turn-inputs'),
    evidence: path.join(paths.assistantStateRoot, 'auto-reply', 'evidence'),
    hostedMailboxInputItems:
      resolveHostedMailboxAssistantInputItemsDirectory(paths),
    inputEvents: resolveAssistantInputEventsDirectory(paths),
    provenance: path.join(
      paths.assistantStateRoot,
      'auto-reply',
      'intent-provenance',
    ),
  }
}

async function readDirectoryEntries(
  directory: string,
  signal?: AbortSignal | null,
): Promise<Dirent[]> {
  signal?.throwIfAborted()
  try {
    await assertAssistantStatePathHasNoSymlinks(directory)
    signal?.throwIfAborted()
    const entries = await readdir(directory, { withFileTypes: true })
    signal?.throwIfAborted()
    return entries
  } catch (error) {
    signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}

async function removeAssistantStateFile(
  filePath: string,
  signal?: AbortSignal | null,
): Promise<void> {
  signal?.throwIfAborted()
  await assertAssistantStatePathHasNoSymlinks(filePath)
  signal?.throwIfAborted()
  await rm(filePath, { force: true })
  signal?.throwIfAborted()
}

async function removeAssistantStateDirectoryIfEmpty(
  directory: string,
  signal?: AbortSignal | null,
): Promise<void> {
  signal?.throwIfAborted()
  try {
    await assertAssistantStatePathHasNoSymlinks(directory)
    signal?.throwIfAborted()
    const entries = await readdir(directory)
    signal?.throwIfAborted()
    if (entries.length === 0) {
      await rmdir(directory)
      signal?.throwIfAborted()
    }
  } catch (error) {
    signal?.throwIfAborted()
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
