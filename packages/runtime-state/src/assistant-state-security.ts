import { appendFile, chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  ASSISTANT_RUNTIME_DIRECTORY_NAME,
} from './shared.ts'

export const ASSISTANT_STATE_DIRECTORY_MODE = 0o700
export const ASSISTANT_STATE_FILE_MODE = 0o600

export interface AssistantStatePermissionIssue {
  actualMode: number | null
  entryKind: 'directory' | 'file' | 'other'
  expectedMode: number | null
  path: string
  repaired: boolean
}

export interface AssistantStatePermissionAudit {
  incorrectEntries: number
  issues: AssistantStatePermissionIssue[]
  repairedEntries: number
  scannedDirectories: number
  scannedFiles: number
  scannedOtherEntries: number
}

export function isAssistantStatePath(targetPath: string): boolean {
  const absolutePath = path.resolve(targetPath)
  const segments = absolutePath.split(path.sep).filter((segment) => segment.length > 0)
  return hasAssistantRuntimeRootSegments(segments)
}

export async function ensureAssistantStateDirectory(directoryPath: string): Promise<void> {
  if (!isAssistantStatePath(directoryPath)) {
    await mkdir(directoryPath, { recursive: true })
    return
  }

  await ensureAssistantStateDirectoryPrivate(directoryPath)
}

export async function ensureAssistantStateParentDirectory(filePath: string): Promise<void> {
  await ensureAssistantStateDirectory(path.dirname(filePath))
}

export function resolveAssistantStateFileMode(
  filePath: string,
  explicitMode?: number,
): number | undefined {
  if (typeof explicitMode === 'number') {
    return explicitMode
  }

  return isAssistantStatePath(filePath) ? ASSISTANT_STATE_FILE_MODE : undefined
}

export function resolveAssistantStateRestoreMode(input: {
  kind: 'directory' | 'file'
  relativePath: string
  root: string
}): number | undefined {
  if (input.root !== 'vault') {
    return undefined
  }

  const normalizedRelativePath = input.relativePath
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .join('/')
  const assistantRuntimeRoot = `.runtime/operations/${ASSISTANT_RUNTIME_DIRECTORY_NAME}`

  if (
    normalizedRelativePath !== assistantRuntimeRoot &&
    !normalizedRelativePath.startsWith(`${assistantRuntimeRoot}/`)
  ) {
    return undefined
  }

  return input.kind === 'directory'
    ? ASSISTANT_STATE_DIRECTORY_MODE
    : ASSISTANT_STATE_FILE_MODE
}

export async function appendTextFileWithMode(
  filePath: string,
  value: string,
  options: {
    mode?: number
  } = {},
): Promise<void> {
  const fileMode = resolveAssistantStateFileMode(filePath, options.mode)

  await ensureAssistantStateParentDirectory(filePath)
  if (isAssistantStatePath(filePath)) {
    await assertAssistantStatePathHasNoSymlinks(filePath)
  }
  if (typeof fileMode === 'number') {
    await chmodExistingPath(filePath, fileMode)
  }
  await appendFile(filePath, value, {
    encoding: 'utf8',
    mode: fileMode,
  })

  if (typeof fileMode === 'number') {
    await chmod(filePath, fileMode)
  }
}

export async function auditAssistantStatePermissions(input: {
  repair?: boolean
  rootPath: string
}): Promise<AssistantStatePermissionAudit> {
  const rootPath = path.resolve(input.rootPath)
  const issues: AssistantStatePermissionIssue[] = []
  let incorrectEntries = 0
  let repairedEntries = 0
  let scannedDirectories = 0
  let scannedFiles = 0
  let scannedOtherEntries = 0

  async function visit(currentPath: string): Promise<void> {
    let stats
    try {
      stats = await lstat(currentPath)
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'ENOENT'
      ) {
        return
      }
      throw error
    }

    if (stats.isDirectory()) {
      scannedDirectories += 1
      const actualMode = stats.mode & 0o777
      const expectedMode = ASSISTANT_STATE_DIRECTORY_MODE
      let repaired = false
      if (actualMode !== expectedMode) {
        incorrectEntries += 1
        if (input.repair) {
          await chmod(currentPath, expectedMode)
          repaired = true
          repairedEntries += 1
        }
        issues.push({
          actualMode,
          entryKind: 'directory',
          expectedMode,
          path: currentPath,
          repaired,
        })
      }

      const entries = await readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        await visit(path.join(currentPath, entry.name))
      }
      return
    }

    if (stats.isFile()) {
      scannedFiles += 1
      const actualMode = stats.mode & 0o777
      const expectedMode = ASSISTANT_STATE_FILE_MODE
      let repaired = false
      if (actualMode !== expectedMode) {
        incorrectEntries += 1
        if (input.repair) {
          await chmod(currentPath, expectedMode)
          repaired = true
          repairedEntries += 1
        }
        issues.push({
          actualMode,
          entryKind: 'file',
          expectedMode,
          path: currentPath,
          repaired,
        })
      }
      return
    }

    scannedOtherEntries += 1
    incorrectEntries += 1
    issues.push({
      actualMode: null,
      entryKind: 'other',
      expectedMode: null,
      path: currentPath,
      repaired: false,
    })
  }

  await visit(rootPath)

  return {
    incorrectEntries,
    issues,
    repairedEntries,
    scannedDirectories,
    scannedFiles,
    scannedOtherEntries,
  }
}

export async function assertAssistantStatePathHasNoSymlinks(targetPath: string): Promise<void> {
  const absolutePath = path.resolve(targetPath)
  const { root } = path.parse(absolutePath)
  const relativeSegments = path
    .relative(root, absolutePath)
    .split(path.sep)
    .filter((segment) => segment.length > 0)
  const assistantRuntimeRootIndex = findAssistantRuntimeRootIndex(relativeSegments)
  if (assistantRuntimeRootIndex < 0) {
    return
  }

  let currentPath = root
  for (let index = 0; index < relativeSegments.length; index += 1) {
    const segment = relativeSegments[index]!
    currentPath = currentPath ? path.join(currentPath, segment) : segment
    if (index < assistantRuntimeRootIndex) {
      continue
    }

    try {
      const entry = await lstat(currentPath)
      if (entry.isSymbolicLink()) {
        throw new Error(`Assistant state path must not contain symlinks: ${targetPath}`)
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return
      }
      throw error
    }
  }
}

async function ensureAssistantStateDirectoryPrivate(directoryPath: string): Promise<void> {
  const absolutePath = path.resolve(directoryPath)
  const { root } = path.parse(absolutePath)
  const relativeSegments = path
    .relative(root, absolutePath)
    .split(path.sep)
    .filter((segment) => segment.length > 0)

  let currentPath = root
  const assistantRuntimeRootIndex = findAssistantRuntimeRootIndex(relativeSegments)
  if (assistantRuntimeRootIndex < 0) {
    return
  }

  const parentSegments = relativeSegments.slice(0, assistantRuntimeRootIndex)
  if (parentSegments.length > 0) {
    await mkdir(path.join(root, ...parentSegments), { recursive: true })
  }

  for (let index = 0; index < relativeSegments.length; index += 1) {
    const segment = relativeSegments[index]!
    currentPath = currentPath ? path.join(currentPath, segment) : segment
    if (index < assistantRuntimeRootIndex) {
      continue
    }

    try {
      const entry = await lstat(currentPath)
      if (entry.isSymbolicLink()) {
        throw new Error(`Assistant state directory must not contain symlinks: ${directoryPath}`)
      }
      if (!entry.isDirectory()) {
        throw new Error(`Assistant state path is not a directory: ${currentPath}`)
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error
      }
      try {
        await mkdir(currentPath, { mode: ASSISTANT_STATE_DIRECTORY_MODE })
      } catch (mkdirError) {
        if (!isPathExistsError(mkdirError)) {
          throw mkdirError
        }
      }

      const entry = await lstat(currentPath)
      if (entry.isSymbolicLink()) {
        throw new Error(`Assistant state directory must not contain symlinks: ${directoryPath}`)
      }
      if (!entry.isDirectory()) {
        throw new Error(`Assistant state path is not a directory: ${currentPath}`)
      }
    }

    await chmod(currentPath, ASSISTANT_STATE_DIRECTORY_MODE)
  }
}

async function chmodExistingPath(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode)
  } catch (error) {
    if (isMissingPathError(error)) {
      return
    }
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

function isPathExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EEXIST'
  )
}

function hasAssistantRuntimeRootSegments(segments: readonly string[]): boolean {
  return findAssistantRuntimeRootIndex(segments) >= 0
}

function findAssistantRuntimeRootIndex(segments: readonly string[]): number {
  for (let index = 0; index <= segments.length - 3; index += 1) {
    if (
      segments[index] === '.runtime' &&
      segments[index + 1] === 'operations' &&
      segments[index + 2] === ASSISTANT_RUNTIME_DIRECTORY_NAME
    ) {
      return index
    }
  }

  return -1
}
