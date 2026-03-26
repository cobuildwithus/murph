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
  operationMetadataPaths: Set<string>
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
    const violations = await restoreUnexpectedCanonicalWrites({
      snapshot,
      vaultRoot: input.vaultRoot,
    })

    if (violations.length > 0) {
      throw buildCanonicalWriteGuardError({
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
    operationMetadataPaths: new Set(await listWriteOperationMetadataPaths(vaultRoot)),
  }
}

async function restoreUnexpectedCanonicalWrites(input: {
  snapshot: GuardSnapshot
  vaultRoot: string
}): Promise<string[]> {
  await applyCommittedOperationEffects(input)

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

  return reverted
}

async function applyCommittedOperationEffects(input: {
  snapshot: GuardSnapshot
  vaultRoot: string
}): Promise<void> {
  const operationMetadataPaths = await listWriteOperationMetadataPaths(input.vaultRoot)
  const newOperationPaths = operationMetadataPaths
    .filter((relativePath) => !input.snapshot.operationMetadataPaths.has(relativePath))
    .sort()
  const operations = await Promise.all(
    newOperationPaths.map(async (relativePath) => ({
      operation: await tryReadStoredWriteOperation(input.vaultRoot, relativePath),
      relativePath,
    })),
  )
  const committedOperations = operations
    .filter(
      (entry): entry is { operation: StoredWriteOperation; relativePath: string } =>
        entry.operation !== null,
    )
    .sort((left, right) =>
      compareOperationOrder(left.operation, right.operation, left.relativePath, right.relativePath),
    )

  for (const { operation } of committedOperations) {
    if (operation.status !== 'committed') {
      continue
    }

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

      const payloadBuffer = decodeCommittedPayload(action.committedPayloadBase64)
      if (!payloadBuffer) {
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
          buffer: Buffer.concat([previousBuffer, payloadBuffer]),
        })
        continue
      }

      input.snapshot.expectedStates.set(action.targetRelativePath, {
        exists: true,
        kind: 'buffer',
        buffer: payloadBuffer,
      })
    }
  }
}

function compareOperationOrder(
  left: StoredWriteOperation,
  right: StoredWriteOperation,
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

async function tryReadStoredWriteOperation(
  vaultRoot: string,
  relativePath: string,
): Promise<StoredWriteOperation | null> {
  try {
    return await readWriteOperationMetadata(vaultRoot, relativePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
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

function decodeCommittedPayload(value: string | undefined): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  try {
    return Buffer.from(value, 'base64')
  } catch {
    return null
  }
}

function buildCanonicalWriteGuardError(input: {
  paths: string[]
  providerError: unknown
}): VaultCliError {
  const preview = formatProtectedPathPreview(input.paths)
  const details: Record<string, unknown> = {
    pathCount: input.paths.length,
    paths: input.paths,
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
    `Rolled back unauthorized direct canonical vault edits: ${preview}. Use vault-cli or audited core mutations for canonical files.`,
    details,
  )
}

function formatProtectedPathPreview(paths: string[]): string {
  const visible = paths.slice(0, 4)
  const remainder = paths.length - visible.length
  return remainder > 0
    ? `${visible.join(', ')}, +${remainder} more`
    : visible.join(', ')
}
