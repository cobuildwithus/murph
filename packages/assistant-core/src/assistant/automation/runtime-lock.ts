import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  inspectDirectoryLock,
  isProcessRunning,
} from '@murph/runtime-state'
import type { AssistantStatusRunLock } from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import type { AssistantStatePaths } from '../store/paths.js'

interface AssistantAutomationRunLockMetadata {
  command: string
  mode: 'continuous' | 'once'
  pid: number
  startedAt: string
}

const activeAutomationRoots = new Map<string, AssistantAutomationRunLockMetadata>()

export async function acquireAssistantAutomationRunLock(input: {
  once?: boolean
  paths: AssistantStatePaths
}): Promise<{
  release(): Promise<void>
}> {
  const ownerKey = `assistant-automation:${input.paths.assistantStateRoot}`
  const lockPath = resolveAssistantAutomationRunLockPath(input.paths)
  const metadataPath = resolveAssistantAutomationRunLockMetadataPath(input.paths)
  const metadata = {
    command: buildProcessCommand(),
    mode: input.once ? 'once' : 'continuous',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  } satisfies AssistantAutomationRunLockMetadata

  if (activeAutomationRoots.has(input.paths.assistantStateRoot)) {
    throw createAssistantAlreadyRunningError({
      metadata: activeAutomationRoots.get(input.paths.assistantStateRoot) ?? metadata,
      sameProcess: true,
    })
  }

  activeAutomationRoots.set(input.paths.assistantStateRoot, metadata)
  let handle: { release(): Promise<void> } | null = null

  try {
    handle = await acquireDirectoryLock({
      ownerKey,
      lockPath,
      metadataPath,
      metadata,
      parseMetadata(value) {
        return isAssistantAutomationRunLockMetadata(value) ? value : null
      },
      invalidMetadataReason: 'Assistant automation run lock metadata is malformed.',
      cleanupRetries: 3,
      cleanupRetryDelayMs: 10,
      inspectStale(metadata) {
        return isProcessRunning(metadata.pid)
          ? null
          : `Process ${metadata.pid} is no longer running.`
      },
    })
  } catch (error) {
    activeAutomationRoots.delete(input.paths.assistantStateRoot)

    if (error instanceof DirectoryLockHeldError) {
      throw createAssistantAlreadyRunningError({
        metadata: error.inspection.metadata,
        sameProcess: false,
      })
    }

    throw error
  }

  return {
    async release() {
      activeAutomationRoots.delete(input.paths.assistantStateRoot)
      await handle?.release()
    },
  }
}

export async function inspectAssistantAutomationRunLock(
  paths: AssistantStatePaths,
): Promise<AssistantStatusRunLock> {
  const activeMetadata = activeAutomationRoots.get(paths.assistantStateRoot)
  if (activeMetadata) {
    return {
      state: 'active',
      pid: activeMetadata.pid,
      startedAt: activeMetadata.startedAt,
      mode: activeMetadata.mode,
      command: activeMetadata.command,
      reason: 'assistant automation already active in this process',
    }
  }

  const inspection = await inspectDirectoryLock({
    lockPath: resolveAssistantAutomationRunLockPath(paths),
    metadataPath: resolveAssistantAutomationRunLockMetadataPath(paths),
    parseMetadata(value) {
      return isAssistantAutomationRunLockMetadata(value) ? value : null
    },
    invalidMetadataReason: 'Assistant automation run lock metadata is malformed.',
    inspectStale(metadata) {
      return isProcessRunning(metadata.pid)
        ? null
        : `Process ${metadata.pid} is no longer running.`
    },
  })

  if (inspection.state === 'unlocked') {
    return {
      state: 'unlocked',
      pid: null,
      startedAt: null,
      mode: null,
      command: null,
      reason: null,
    }
  }

  return {
    state: inspection.state,
    pid: inspection.metadata?.pid ?? null,
    startedAt: inspection.metadata?.startedAt ?? null,
    mode: inspection.metadata?.mode ?? null,
    command: inspection.metadata?.command ?? null,
    reason: inspection.state === 'stale' ? inspection.reason : null,
  }
}

export async function clearAssistantAutomationRunLock(
  paths: AssistantStatePaths,
): Promise<void> {
  await Promise.all([
    rm(resolveAssistantAutomationRunLockPath(paths), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 10,
    }),
    rm(resolveAssistantAutomationRunLockMetadataPath(paths), {
      force: true,
      maxRetries: 3,
      retryDelay: 10,
    }),
  ])
}

function createAssistantAlreadyRunningError(input: {
  metadata: AssistantAutomationRunLockMetadata | null
  sameProcess: boolean
}): VaultCliError {
  const detail = input.metadata
    ? `${input.metadata.command} (pid ${input.metadata.pid}) started ${input.metadata.startedAt}`
    : 'another assistant automation process'
  return new VaultCliError(
    'ASSISTANT_AUTOMATION_ALREADY_RUNNING',
    input.sameProcess
      ? 'Assistant automation is already running for this vault in the current process.'
      : `Assistant automation is already running for this vault: ${detail}. Use \`murph stop --vault <path>\` to recover or \`murph status --vault <path>\` to inspect it.`,
    {
      sameProcess: input.sameProcess,
      ...input.metadata,
    },
  )
}

function resolveAssistantAutomationRunLockPath(paths: AssistantStatePaths): string {
  return path.join(paths.assistantStateRoot, '.automation-run.lock')
}

function resolveAssistantAutomationRunLockMetadataPath(paths: AssistantStatePaths): string {
  return path.join(paths.assistantStateRoot, '.automation-run-lock.json')
}

function isAssistantAutomationRunLockMetadata(
  value: unknown,
): value is AssistantAutomationRunLockMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.command === 'string' &&
    (record.mode === 'continuous' || record.mode === 'once') &&
    typeof record.pid === 'number' &&
    Number.isFinite(record.pid) &&
    typeof record.startedAt === 'string'
  )
}
