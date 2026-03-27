import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  isProtectedCanonicalPath,
  listProtectedCanonicalPaths,
  listWriteOperationMetadataPaths,
  normalizeRelativeVaultPath,
  readRecoverableStoredWriteOperation,
  readStoredWriteOperation as readWriteOperationMetadata,
  resolveVaultPath,
} from '@murph/core'
import { VaultCliError } from '../vault-cli-errors.js'
import { isMissingFileError } from './shared.js'

const CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV =
  'MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR'
const WRITE_OPERATION_GUARD_RECEIPT_SCHEMA_VERSION =
  'murph.write-operation-guard-receipt.v1'

interface GuardInput<TResult> {
  enabled: boolean
  execute: () => Promise<TResult>
  vaultRoot: string
}

interface GuardSnapshot {
  backupRoot: string
  expectedStates: Map<string, ExpectedFileState>
  guardReceiptRoot: string
  operationMetadataStates: Map<string, GuardOperationSnapshot>
}

interface GuardOperationSnapshot {
  status: string | null
}

interface GuardAuditStateFailure {
  actionKind?: 'jsonl_append' | 'text_write'
  causeCode?: string
  causeMessage: string
  metadataPath: string
  operationId?: string
  reason: 'invalid_committed_payload' | 'invalid_write_operation_metadata'
  targetRelativePath?: string
}

type ExpectedFileState =
  | {
      exists: false
    }
  | {
      backupPath: string
      exists: true
      kind: 'backup'
    }
  | {
      buffer: Buffer
      exists: true
      kind: 'buffer'
    }

type StoredWriteOperation = Awaited<ReturnType<typeof readWriteOperationMetadata>>
type GuardRecoveredOperation = NonNullable<
  Awaited<ReturnType<typeof readRecoverableStoredWriteOperation>>
>

interface GuardOperationEntry {
  existedInSnapshot: boolean
  guardFailure: GuardAuditStateFailure | null
  operation: GuardRecoveredOperation | null
  operationId: string | null
  relativePath: string
  snapshotStatus: string | null
}

interface GuardCommittedPayloadReceipt {
  byteLength: number
  sha256: string
}

type GuardReceiptAction =
  | {
      kind: 'delete'
      targetRelativePath: string
    }
  | {
      kind: 'jsonl_append' | 'text_write'
      committedPayloadReceipt: GuardCommittedPayloadReceipt
      payloadRelativePath: string
      targetRelativePath: string
    }

interface GuardReceiptOperation {
  actions: GuardReceiptAction[]
  createdAt: string
  operationId: string
  receiptPath: string
  updatedAt: string
}

export async function executeWithCanonicalWriteGuard<TResult>(
  input: GuardInput<TResult>,
): Promise<TResult> {
  if (!input.enabled) {
    return input.execute()
  }

  const snapshot = await captureCanonicalWriteSnapshot(input.vaultRoot)
  let providerResult: TResult | undefined
  let providerError: unknown = null

  try {
    providerResult = await withCanonicalGuardReceiptDirectory(
      snapshot.guardReceiptRoot,
      input.execute,
    )
  } catch (error) {
    providerError = error
  }

  try {
    const { guardFailure, reverted: violations } = await restoreUnexpectedCanonicalWrites({
      snapshot,
      vaultRoot: input.vaultRoot,
    })

    if (guardFailure || violations.length > 0) {
      throw buildCanonicalWriteGuardError({
        guardFailure,
        paths: violations,
        providerError,
      })
    }

    if (providerError) {
      throw providerError
    }

    return providerResult as TResult
  } finally {
    await rm(snapshot.backupRoot, {
      force: true,
      recursive: true,
    }).catch(() => undefined)
    await rm(snapshot.guardReceiptRoot, {
      force: true,
      recursive: true,
    }).catch(() => undefined)
  }
}

async function captureCanonicalWriteSnapshot(
  vaultRoot: string,
): Promise<GuardSnapshot> {
  const backupRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-canonical-guard-'),
  )
  const guardReceiptRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-canonical-guard-receipts-'),
  )
  const protectedPaths = await listProtectedCanonicalPaths(vaultRoot)
  const expectedStates = new Map<string, ExpectedFileState>()

  for (const relativePath of protectedPaths) {
    const absolutePath = resolveVaultPath(vaultRoot, relativePath).absolutePath
    const backupPath = path.join(backupRoot, relativePath)
    await mkdir(path.dirname(backupPath), {
      recursive: true,
    })
    await copyFile(absolutePath, backupPath)
    expectedStates.set(relativePath, {
      exists: true,
      kind: 'backup',
      backupPath,
    })
  }

  return {
    backupRoot,
    expectedStates,
    guardReceiptRoot,
    operationMetadataStates: await captureOperationMetadataSnapshot(vaultRoot),
  }
}

async function captureOperationMetadataSnapshot(
  vaultRoot: string,
): Promise<Map<string, GuardOperationSnapshot>> {
  const relativePaths = await listWriteOperationMetadataPaths(vaultRoot)
  const snapshots = await Promise.all(
    relativePaths.map(async (relativePath) => [
      relativePath,
      {
        status: await readStoredWriteOperationStatusForGuard(vaultRoot, relativePath),
      },
    ] as const),
  )

  return new Map(snapshots)
}

async function restoreUnexpectedCanonicalWrites(input: {
  snapshot: GuardSnapshot
  vaultRoot: string
}): Promise<{
  guardFailure: GuardAuditStateFailure | null
  reverted: string[]
}> {
  const guardFailure = await applyCommittedOperationEffects(input)

  const currentPaths = new Set(await listProtectedCanonicalPaths(input.vaultRoot))
  const candidatePaths = new Set<string>([
    ...input.snapshot.expectedStates.keys(),
    ...currentPaths,
  ])
  const reverted: string[] = []

  for (const relativePath of [...candidatePaths].sort()) {
    const expected: ExpectedFileState =
      input.snapshot.expectedStates.get(relativePath) ?? { exists: false }
    const currentExists = currentPaths.has(relativePath)

    if (!expected.exists && !currentExists) {
      continue
    }

    if (!expected.exists && currentExists) {
      await unlinkProtectedFile(input.vaultRoot, relativePath)
      reverted.push(relativePath)
      continue
    }

    if (expected.exists && !currentExists) {
      await restoreProtectedFile(input.vaultRoot, relativePath, expected)
      reverted.push(relativePath)
      continue
    }

    const currentBuffer = await readFile(
      resolveVaultPath(input.vaultRoot, relativePath).absolutePath,
    )
    const existingExpected = expected as Extract<ExpectedFileState, { exists: true }>
    const expectedBuffer = await readExpectedBuffer(existingExpected)
    if (!currentBuffer.equals(expectedBuffer)) {
      await restoreProtectedFile(input.vaultRoot, relativePath, existingExpected)
      reverted.push(relativePath)
    }
  }

  return {
    guardFailure,
    reverted,
  }
}

async function applyCommittedOperationEffects(input: {
  snapshot: GuardSnapshot
  vaultRoot: string
}): Promise<GuardAuditStateFailure | null> {
  const operationMetadataPaths = await listWriteOperationMetadataPaths(input.vaultRoot)
  const receipts = await readGuardReceiptOperations(input.snapshot.guardReceiptRoot)
  const receiptByOperationId = new Map(
    receipts.map((receipt) => [receipt.operationId, receipt] as const),
  )
  let guardFailure: GuardAuditStateFailure | null = null
  const operations: GuardOperationEntry[] = await Promise.all(
    operationMetadataPaths.sort().map(async (relativePath) => {
      const snapshotStatus =
        input.snapshot.operationMetadataStates.get(relativePath)?.status ?? null
      const existedInSnapshot =
        input.snapshot.operationMetadataStates.has(relativePath)

      try {
        const operation = await readStoredWriteOperationIfPresent(input.vaultRoot, relativePath)
        return {
          existedInSnapshot,
          guardFailure: null,
          operation,
          operationId: operation?.operationId ?? null,
          relativePath,
          snapshotStatus,
        }
      } catch (error) {
        const failure = createGuardAuditStateFailure({
          cause: error,
          metadataPath: relativePath,
          reason: 'invalid_write_operation_metadata',
        })
        const recovered = await readRecoverableStoredWriteOperation(
          input.vaultRoot,
          relativePath,
        )
        return {
          existedInSnapshot,
          guardFailure: failure,
          operation: recovered,
          operationId: recovered?.operationId ?? null,
          relativePath,
          snapshotStatus,
        }
      }
    }),
  )
  const operationById = new Map(
    operations
      .filter((operation): operation is GuardOperationEntry & { operationId: string } =>
        typeof operation.operationId === 'string',
      )
      .map((operation) => [operation.operationId, operation] as const),
  )

  for (const operationEntry of operations) {
    if (!operationEntry.existedInSnapshot && operationEntry.guardFailure && !guardFailure) {
      guardFailure = operationEntry.guardFailure
    }

    if (
      operationEntry.snapshotStatus !== 'committed' &&
      operationEntry.operation?.status === 'committed' &&
      operationEntry.guardFailure &&
      !guardFailure
    ) {
      guardFailure = operationEntry.guardFailure
    }

    if (
      operationEntry.snapshotStatus !== 'committed' &&
      operationEntry.operation?.status === 'committed' &&
      operationTouchesProtectedCanonicalPath(operationEntry.operation) &&
      operationEntry.operationId &&
      !receiptByOperationId.has(operationEntry.operationId) &&
      !guardFailure
    ) {
      guardFailure = createGuardAuditStateFailure({
        cause: new Error(
          'Committed write operation did not produce a trusted canonical-write guard receipt.',
        ),
        metadataPath: operationEntry.relativePath,
        operationId: operationEntry.operationId,
        reason: 'invalid_write_operation_metadata',
      })
    }
  }

  const committedOperations = receipts
    .sort((left, right) =>
      compareOperationOrder(left, right, left.receiptPath, right.receiptPath),
    )

  for (const receipt of committedOperations) {
    const operationEntry = operationById.get(receipt.operationId) ?? null
    const transitionedToCommitted =
      operationEntry?.snapshotStatus !== 'committed' ||
      operationEntry === null
    if (!transitionedToCommitted) {
      continue
    }

    if (operationEntry?.guardFailure && !guardFailure) {
      guardFailure = operationEntry.guardFailure
    }
    if (!operationEntry && !guardFailure) {
      guardFailure = createGuardAuditStateFailure({
        cause: new Error(
          'Committed write guard receipt has no matching vault metadata file.',
        ),
        metadataPath: receipt.receiptPath,
        operationId: receipt.operationId,
        reason: 'invalid_write_operation_metadata',
      })
    }
    if (!operationEntry || operationEntry.guardFailure) {
      continue
    }

    for (const action of receipt.actions) {
      if (!isProtectedCanonicalPath(action.targetRelativePath)) {
        continue
      }

      if (action.kind === 'delete') {
        input.snapshot.expectedStates.set(action.targetRelativePath, {
          exists: false,
        })
        continue
      }

      const payload = await readGuardReceiptPayload({
        action,
        metadataPath: operationEntry?.relativePath ?? receipt.receiptPath,
        operationId: receipt.operationId,
        receiptPath: receipt.receiptPath,
        receiptRoot: input.snapshot.guardReceiptRoot,
        targetRelativePath: action.targetRelativePath,
      })
      if (payload.guardFailure && !guardFailure) {
        guardFailure = payload.guardFailure
      }
      if (!payload.buffer) {
        continue
      }

      if (action.kind === 'jsonl_append') {
        const previous = input.snapshot.expectedStates.get(action.targetRelativePath)
        const previousBuffer =
          previous && previous.exists
            ? await readExpectedBuffer(previous)
            : Buffer.alloc(0)
        input.snapshot.expectedStates.set(action.targetRelativePath, {
          exists: true,
          kind: 'buffer',
          buffer: Buffer.concat([previousBuffer, payload.buffer]),
        })
        continue
      }

      input.snapshot.expectedStates.set(action.targetRelativePath, {
        exists: true,
        kind: 'buffer',
        buffer: payload.buffer,
      })
    }
  }

  return guardFailure
}

function operationTouchesProtectedCanonicalPath(
  operation: GuardRecoveredOperation,
): boolean {
  return operation.actions.some((action) =>
    isProtectedCanonicalPath(action.targetRelativePath),
  )
}

function compareOperationOrder(
  left: Pick<GuardRecoveredOperation, 'createdAt' | 'updatedAt' | 'operationId'>,
  right: Pick<GuardRecoveredOperation, 'createdAt' | 'updatedAt' | 'operationId'>,
  leftPath: string,
  rightPath: string,
): number {
  return (
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.operationId.localeCompare(right.operationId) ||
    leftPath.localeCompare(rightPath)
  )
}

async function readStoredWriteOperationStatusForGuard(
  vaultRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return (await readStoredWriteOperationIfPresent(vaultRoot, relativePath))?.status ?? null
  } catch {
    return (await readRecoverableStoredWriteOperation(vaultRoot, relativePath))?.status ?? null
  }
}

export function isAssistantCanonicalWriteBlockedError(
  error: unknown,
): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED'
  )
}

async function readStoredWriteOperationIfPresent(
  vaultRoot: string,
  relativePath: string,
): Promise<StoredWriteOperation | null> {
  try {
    return await readWriteOperationMetadata(vaultRoot, relativePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

async function withCanonicalGuardReceiptDirectory<TResult>(
  receiptRoot: string,
  execute: () => Promise<TResult>,
): Promise<TResult> {
  const previous = process.env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV]
  process.env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV] = receiptRoot

  try {
    return await execute()
  } finally {
    if (typeof previous === 'string') {
      process.env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV] = previous
    } else {
      delete process.env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV]
    }
  }
}

async function readGuardReceiptOperations(
  receiptRoot: string,
): Promise<GuardReceiptOperation[]> {
  try {
    const entries = await readdir(receiptRoot, { withFileTypes: true })
    const receiptFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(receiptRoot, entry.name))
      .sort((left, right) => left.localeCompare(right))
    const receipts = await Promise.all(
      receiptFiles.map((receiptPath) => readGuardReceiptOperation(receiptRoot, receiptPath)),
    )
    return receipts.filter((receipt): receipt is GuardReceiptOperation => receipt !== null)
  } catch {
    return []
  }
}

async function readGuardReceiptOperation(
  receiptRoot: string,
  receiptPath: string,
): Promise<GuardReceiptOperation | null> {
  try {
    const raw = JSON.parse(await readFile(receiptPath, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null
    }

    const record = raw as Record<string, unknown>
    if (
      record.schemaVersion !== WRITE_OPERATION_GUARD_RECEIPT_SCHEMA_VERSION ||
      typeof record.operationId !== 'string' ||
      typeof record.createdAt !== 'string' ||
      typeof record.updatedAt !== 'string' ||
      !Array.isArray(record.actions)
    ) {
      return null
    }

    const actions = record.actions.map((action) => parseGuardReceiptAction(receiptRoot, action))
    if (actions.some((action) => action === null)) {
      return null
    }

    return {
      actions: actions as GuardReceiptAction[],
      createdAt: record.createdAt,
      operationId: record.operationId,
      receiptPath: path.relative(receiptRoot, receiptPath) || path.basename(receiptPath),
      updatedAt: record.updatedAt,
    }
  } catch {
    return null
  }
}

function parseGuardReceiptAction(
  receiptRoot: string,
  value: unknown,
): GuardReceiptAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const action = value as Record<string, unknown>
  const targetRelativePath = normalizeGuardRelativePath(action.targetRelativePath)
  if (!targetRelativePath) {
    return null
  }

  if (action.kind === 'delete') {
    return {
      kind: 'delete',
      targetRelativePath,
    }
  }

  if (action.kind !== 'jsonl_append' && action.kind !== 'text_write') {
    return null
  }

  const payloadRelativePath = normalizeGuardRelativePath(action.payloadRelativePath)
  const committedPayloadReceipt = parseGuardCommittedPayloadReceipt(
    action.committedPayloadReceipt,
  )
  if (!payloadRelativePath || !committedPayloadReceipt) {
    return null
  }

  const absolutePayloadPath = path.resolve(receiptRoot, payloadRelativePath)
  const relativeToRoot = path.relative(receiptRoot, absolutePayloadPath)
  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null
  }

  return {
    kind: action.kind,
    committedPayloadReceipt,
    payloadRelativePath,
    targetRelativePath,
  }
}

function parseGuardCommittedPayloadReceipt(
  value: unknown,
): GuardCommittedPayloadReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const receipt = value as Record<string, unknown>
  if (
    typeof receipt.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
    typeof receipt.byteLength !== 'number' ||
    !Number.isInteger(receipt.byteLength) ||
    receipt.byteLength < 0
  ) {
    return null
  }

  return {
    byteLength: receipt.byteLength,
    sha256: receipt.sha256,
  }
}

function normalizeGuardRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const normalized = normalizeRelativeVaultPath(value)
    return normalized === value ? normalized : null
  } catch {
    return null
  }
}

async function readExpectedBuffer(
  state: Extract<ExpectedFileState, { exists: true }>,
): Promise<Buffer> {
  if (state.kind === 'buffer') {
    return state.buffer
  }

  return readFile(state.backupPath)
}

async function restoreProtectedFile(
  vaultRoot: string,
  relativePath: string,
  state: Extract<ExpectedFileState, { exists: true }>,
): Promise<void> {
  const absolutePath = resolveVaultPath(vaultRoot, relativePath).absolutePath
  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  })

  if (state.kind === 'backup') {
    await copyFile(state.backupPath, absolutePath)
    return
  }

  await writeFile(absolutePath, state.buffer)
}

async function unlinkProtectedFile(
  vaultRoot: string,
  relativePath: string,
): Promise<void> {
  try {
    await unlink(resolveVaultPath(vaultRoot, relativePath).absolutePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }

    throw error
  }
}

async function readGuardReceiptPayload(input: {
  action: Extract<GuardReceiptAction, { kind: 'jsonl_append' | 'text_write' }>
  metadataPath: string
  operationId: string
  receiptPath: string
  receiptRoot: string
  targetRelativePath: string
}): Promise<{
  buffer: Buffer | null
  guardFailure: GuardAuditStateFailure | null
}> {
  const absolutePayloadPath = path.resolve(
    input.receiptRoot,
    input.action.payloadRelativePath,
  )

  try {
    const buffer = await readFile(absolutePayloadPath)
    if (
      buffer.byteLength !== input.action.committedPayloadReceipt.byteLength ||
      createHash('sha256').update(buffer).digest('hex') !==
        input.action.committedPayloadReceipt.sha256
    ) {
      return {
        buffer: null,
        guardFailure: createGuardAuditStateFailure({
          cause: new Error(
            'Committed write payload receipt does not match the trusted payload copy.',
          ),
          metadataPath: input.metadataPath,
          operationId: input.operationId,
          reason: 'invalid_committed_payload',
          targetRelativePath: input.targetRelativePath,
          actionKind: input.action.kind,
        }),
      }
    }

    return {
      buffer,
      guardFailure: null,
    }
  } catch {
    return {
      buffer: null,
      guardFailure: createGuardAuditStateFailure({
        cause: new Error(
          `Committed write payload copy is missing from trusted receipt path "${input.receiptPath}".`,
        ),
        metadataPath: input.metadataPath,
        operationId: input.operationId,
        reason: 'invalid_committed_payload',
        targetRelativePath: input.targetRelativePath,
        actionKind: input.action.kind,
      }),
    }
  }
}

function buildCanonicalWriteGuardError(input: {
  guardFailure?: GuardAuditStateFailure | null
  paths: string[]
  providerError: unknown
}): VaultCliError {
  const details: Record<string, unknown> = {
    ...readAssistantProviderErrorContext(input.providerError),
    pathCount: input.paths.length,
    paths: input.paths,
  }

  if (input.guardFailure) {
    details.guardFailureReason = input.guardFailure.reason
    details.guardFailurePath = input.guardFailure.metadataPath
    details.guardFailureMessage = input.guardFailure.causeMessage

    if (input.guardFailure.causeCode) {
      details.guardFailureCode = input.guardFailure.causeCode
    }

    if (input.guardFailure.operationId) {
      details.guardFailureOperationId = input.guardFailure.operationId
    }

    if (input.guardFailure.targetRelativePath) {
      details.guardFailureTargetPath = input.guardFailure.targetRelativePath
    }

    if (input.guardFailure.actionKind) {
      details.guardFailureActionKind = input.guardFailure.actionKind
    }
  }

  if (input.providerError instanceof Error) {
    details.providerErrorMessage = input.providerError.message
  }

  if (
    input.providerError &&
    typeof input.providerError === 'object' &&
    'code' in input.providerError &&
    typeof (input.providerError as { code?: unknown }).code === 'string'
  ) {
    details.providerErrorCode = (input.providerError as { code: string }).code
  }

  return new VaultCliError(
    'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED',
    formatCanonicalWriteGuardMessage(input),
    details,
  )
}

function readAssistantProviderErrorContext(
  error: unknown,
): Record<string, unknown> {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return {}
  }

  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {}
  }

  return { ...(context as Record<string, unknown>) }
}

function formatCanonicalWriteGuardMessage(input: {
  guardFailure?: GuardAuditStateFailure | null
  paths: string[]
}): string {
  if (input.guardFailure) {
    return `Blocked canonical write guard because audited write state is corrupted (${formatGuardFailureSummary(input.guardFailure)}). Use vault-cli or audited core mutations for canonical files.`
  }

  return `Rolled back unauthorized direct canonical vault edits: ${formatProtectedPathPreview(input.paths)}. Use vault-cli or audited core mutations for canonical files.`
}

function formatProtectedPathPreview(paths: string[]): string {
  const visible = paths.slice(0, 4)
  const remainder = paths.length - visible.length
  return remainder > 0
    ? `${visible.join(', ')}, +${remainder} more`
    : visible.join(', ')
}

function formatGuardFailureSummary(failure: GuardAuditStateFailure): string {
  const suffix = failure.targetRelativePath
    ? ` for ${failure.targetRelativePath}`
    : ''
  return `${failure.reason} at ${failure.metadataPath}${suffix}`
}

function createGuardAuditStateFailure(input: {
  actionKind?: 'jsonl_append' | 'text_write'
  cause: unknown
  metadataPath: string
  operationId?: string
  reason: GuardAuditStateFailure['reason']
  targetRelativePath?: string
}): GuardAuditStateFailure {
  return {
    actionKind: input.actionKind,
    causeCode:
      input.cause &&
      typeof input.cause === 'object' &&
      'code' in input.cause &&
      typeof (input.cause as { code?: unknown }).code === 'string'
        ? (input.cause as { code: string }).code
        : undefined,
    causeMessage:
      input.cause instanceof Error ? input.cause.message : String(input.cause),
    metadataPath: input.metadataPath,
    operationId: input.operationId,
    reason: input.reason,
    targetRelativePath: input.targetRelativePath,
  }
}
