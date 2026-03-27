import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  listWriteOperationMetadataPaths,
  readStoredWriteOperation as readWriteOperationMetadata,
  VAULT_LAYOUT,
  resolveVaultPath,
} from '@healthybob/core'
import { VaultCliError } from '../vault-cli-errors.js'
import { isMissingFileError } from './shared.js'

interface GuardInput<TResult> {
  enabled: boolean
  execute: () => Promise<TResult>
  vaultRoot: string
}

interface GuardSnapshot {
  backupRoot: string
  expectedStates: Map<string, ExpectedFileState>
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
interface GuardRecoveredOperation {
  actions: StoredWriteOperation['actions']
  createdAt: string
  operationId: string
  status: string
  updatedAt: string
}

interface GuardOperationEntry {
  guardFailure: GuardAuditStateFailure | null
  operation: GuardRecoveredOperation | null
  relativePath: string
  snapshotStatus: string | null
}
const PROTECTED_ROOT_FILES = new Set<string>([
  VAULT_LAYOUT.metadata,
  VAULT_LAYOUT.coreDocument,
])

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
    providerResult = await input.execute()
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
  }
}

async function captureCanonicalWriteSnapshot(
  vaultRoot: string,
): Promise<GuardSnapshot> {
  const backupRoot = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-canonical-guard-'),
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
  let guardFailure: GuardAuditStateFailure | null = null
  const operations: GuardOperationEntry[] = await Promise.all(
    operationMetadataPaths.sort().map(async (relativePath) => {
      const snapshotStatus =
        input.snapshot.operationMetadataStates.get(relativePath)?.status ?? null

      try {
        return {
          guardFailure: null,
          operation: await readStoredWriteOperationIfPresent(input.vaultRoot, relativePath),
          relativePath,
          snapshotStatus,
        }
      } catch (error) {
        const failure = createGuardAuditStateFailure({
          cause: error,
          metadataPath: relativePath,
          reason: 'invalid_write_operation_metadata',
        })
        const recovered = await recoverStoredWriteOperationForGuard(input.vaultRoot, relativePath)
        return {
          guardFailure: failure,
          operation: recovered,
          relativePath,
          snapshotStatus,
        }
      }
    }),
  )

  for (const operationEntry of operations) {
    if (
      operationEntry.snapshotStatus !== 'committed' &&
      operationEntry.operation?.status === 'committed' &&
      operationEntry.guardFailure &&
      !guardFailure
    ) {
      guardFailure = operationEntry.guardFailure
    }
  }

  const committedOperations = operations
    .filter(
      (
        entry,
      ): entry is GuardOperationEntry & { operation: GuardRecoveredOperation } =>
        entry.operation !== null &&
        entry.operation.status === 'committed' &&
        entry.snapshotStatus !== 'committed',
    )
    .sort((left, right) =>
      compareOperationOrder(left.operation, right.operation, left.relativePath, right.relativePath),
    )

  for (const { operation, relativePath } of committedOperations) {
    for (const action of operation.actions) {
      if (!isProtectedCanonicalPath(action.targetRelativePath)) {
        continue
      }

      if (action.kind === 'delete') {
        input.snapshot.expectedStates.set(action.targetRelativePath, {
          exists: false,
        })
        continue
      }

      if (action.kind !== 'jsonl_append' && action.kind !== 'text_write') {
        continue
      }

      const payload = await resolveCommittedPayload({
        actionKind: action.kind,
        metadataPath: relativePath,
        operationId: operation.operationId,
        stageRelativePath: action.stageRelativePath,
        targetRelativePath: action.targetRelativePath,
        value: action.committedPayloadBase64,
        vaultRoot: input.vaultRoot,
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

function compareOperationOrder(
  left: GuardRecoveredOperation,
  right: GuardRecoveredOperation,
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

async function listProtectedCanonicalPaths(vaultRoot: string): Promise<string[]> {
  const matches = new Set<string>()

  for (const relativePath of PROTECTED_ROOT_FILES) {
    if (await protectedPathExists(vaultRoot, relativePath)) {
      matches.add(relativePath)
    }
  }

  await walkProtectedDirectory(vaultRoot, VAULT_LAYOUT.journalDirectory, () => true, matches)
  await walkProtectedDirectory(vaultRoot, 'bank', () => true, matches)
  await walkProtectedDirectory(
    vaultRoot,
    'ledger',
    (relativePath) => relativePath.endsWith('.jsonl'),
    matches,
  )
  await walkProtectedDirectory(
    vaultRoot,
    VAULT_LAYOUT.auditDirectory,
    (relativePath) => relativePath.endsWith('.jsonl'),
    matches,
  )

  return [...matches].sort()
}

async function walkProtectedDirectory(
  vaultRoot: string,
  relativeDirectory: string,
  include: (relativePath: string) => boolean,
  matches: Set<string>,
): Promise<void> {
  const absoluteDirectory = resolveVaultPath(vaultRoot, relativeDirectory).absolutePath
  let entries
  try {
    entries = await readdir(absoluteDirectory, {
      withFileTypes: true,
    })
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }

    throw error
  }

  for (const entry of entries) {
    const childRelativePath = path.posix.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      await walkProtectedDirectory(vaultRoot, childRelativePath, include, matches)
      continue
    }

    if (entry.isFile() && include(childRelativePath)) {
      matches.add(childRelativePath)
    }
  }
}

async function readStoredWriteOperationStatusForGuard(
  vaultRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return (await readStoredWriteOperationIfPresent(vaultRoot, relativePath))?.status ?? null
  } catch {
    return (await recoverStoredWriteOperationForGuard(vaultRoot, relativePath))?.status ?? null
  }
}

function isProtectedCanonicalPath(relativePath: string): boolean {
  return (
    PROTECTED_ROOT_FILES.has(relativePath) ||
    relativePath.startsWith(`${VAULT_LAYOUT.journalDirectory}/`) ||
    relativePath.startsWith('bank/') ||
    (relativePath.startsWith('ledger/') && relativePath.endsWith('.jsonl')) ||
    (
      relativePath.startsWith(`${VAULT_LAYOUT.auditDirectory}/`) &&
      relativePath.endsWith('.jsonl')
    )
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

async function recoverStoredWriteOperationForGuard(
  vaultRoot: string,
  relativePath: string,
): Promise<GuardRecoveredOperation | null> {
  try {
    const raw = JSON.parse(
      await readFile(resolveVaultPath(vaultRoot, relativePath).absolutePath, 'utf8'),
    ) as unknown
    if (!isPlainObject(raw)) {
      return null
    }

    const actions = Array.isArray(raw.actions)
      ? raw.actions.map(parseRecoverableStoredAction)
      : null
    if (
      typeof raw.operationId !== 'string' ||
      typeof raw.createdAt !== 'string' ||
      typeof raw.updatedAt !== 'string' ||
      typeof raw.status !== 'string' ||
      !actions ||
      actions.some((action) => action === null)
    ) {
      return null
    }

    return {
      actions: actions as StoredWriteOperation['actions'],
      createdAt: raw.createdAt,
      operationId: raw.operationId,
      status: raw.status,
      updatedAt: raw.updatedAt,
    }
  } catch {
    return null
  }
}

function parseRecoverableStoredAction(
  value: unknown,
): StoredWriteOperation['actions'][number] | null {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    return null
  }

  if (typeof value.targetRelativePath !== 'string' || typeof value.state !== 'string') {
    return null
  }

  if (
    value.kind === 'raw_copy' ||
    value.kind === 'text_write' ||
    value.kind === 'jsonl_append'
  ) {
    return typeof value.stageRelativePath === 'string'
      ? (value as StoredWriteOperation['actions'][number])
      : null
  }

  if (value.kind === 'delete') {
    return value as StoredWriteOperation['actions'][number]
  }

  return null
}

async function protectedPathExists(
  vaultRoot: string,
  relativePath: string,
): Promise<boolean> {
  try {
    await readFile(resolveVaultPath(vaultRoot, relativePath).absolutePath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }

    throw error
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

async function resolveCommittedPayload(input: {
  actionKind: 'jsonl_append' | 'text_write'
  metadataPath: string
  operationId: string
  stageRelativePath: string
  targetRelativePath: string
  value: string | undefined
  vaultRoot: string
}): Promise<{
  buffer: Buffer | null
  guardFailure: GuardAuditStateFailure | null
}> {
  const decoded = decodeCommittedPayloadBase64(input.value)
  if (decoded) {
    return {
      buffer: decoded,
      guardFailure: null,
    }
  }

  const guardFailure = createGuardAuditStateFailure({
    cause:
      typeof input.value === 'string'
        ? new Error('Committed write payload is not valid canonical base64.')
        : new Error('Committed write payload is missing.'),
    metadataPath: input.metadataPath,
    operationId: input.operationId,
    reason: 'invalid_committed_payload',
    targetRelativePath: input.targetRelativePath,
    actionKind: input.actionKind,
  })

  try {
    return {
      buffer: await readFile(
        resolveVaultPath(input.vaultRoot, input.stageRelativePath).absolutePath,
      ),
      guardFailure,
    }
  } catch {
    return {
      buffer: null,
      guardFailure,
    }
  }
}

function decodeCommittedPayloadBase64(value: string | undefined): Buffer | null {
  if (typeof value !== 'string') {
    return null
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    return null
  }

  return Buffer.from(decoded.toString('utf8')).equals(decoded) ? decoded : null
}

function buildCanonicalWriteGuardError(input: {
  guardFailure?: GuardAuditStateFailure | null
  paths: string[]
  providerError: unknown
}): VaultCliError {
  const details: Record<string, unknown> = {
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

function isGuardAuditStateFailure(value: unknown): value is GuardAuditStateFailure {
  return (
    !!value &&
    typeof value === 'object' &&
    'reason' in value &&
    (value as { reason?: unknown }).reason !== undefined &&
    'metadataPath' in value &&
    typeof (value as { metadataPath?: unknown }).metadataPath === 'string' &&
    'causeMessage' in value &&
    typeof (value as { causeMessage?: unknown }).causeMessage === 'string'
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
