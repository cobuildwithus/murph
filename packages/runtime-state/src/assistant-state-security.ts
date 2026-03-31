import { appendFile, chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

import { ASSISTANT_STATE_DIRECTORY_NAME } from './shared.ts'

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
  return segments.includes(ASSISTANT_STATE_DIRECTORY_NAME)
}

export async function ensureAssistantStateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true })

  if (!isAssistantStatePath(directoryPath)) {
    return
  }

  await applyAssistantStateDirectoryModes(directoryPath)
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

export async function appendTextFileWithMode(
  filePath: string,
  value: string,
  options: {
    mode?: number
  } = {},
): Promise<void> {
  const fileMode = resolveAssistantStateFileMode(filePath, options.mode)

  await ensureAssistantStateParentDirectory(filePath)
  await appendFile(filePath, value, 'utf8')

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

async function applyAssistantStateDirectoryModes(directoryPath: string): Promise<void> {
  const absolutePath = path.resolve(directoryPath)
  const { root } = path.parse(absolutePath)
  const relativeSegments = path
    .relative(root, absolutePath)
    .split(path.sep)
    .filter((segment) => segment.length > 0)

  let currentPath = root
  let insideAssistantState = false

  for (const segment of relativeSegments) {
    currentPath = currentPath ? path.join(currentPath, segment) : segment
    if (segment === ASSISTANT_STATE_DIRECTORY_NAME) {
      insideAssistantState = true
    }
    if (!insideAssistantState) {
      continue
    }
    await chmod(currentPath, ASSISTANT_STATE_DIRECTORY_MODE)
  }
}
