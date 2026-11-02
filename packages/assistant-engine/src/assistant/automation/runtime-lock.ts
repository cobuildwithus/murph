import { rm } from 'node:fs/promises'
import path from 'node:path'
import { inspectDirectoryLock, isProcessRunning } from '@murphai/runtime-state/node'
import type { AssistantStatusRunLock } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantStatePaths } from '../store/paths.js'

interface AssistantAutomationRunLockMetadata {
  command: string
  mode: 'continuous' | 'once'
  pid: number
  startedAt: string
}

export async function inspectAssistantAutomationRunLock(
  paths: AssistantStatePaths,
): Promise<AssistantStatusRunLock> {
  const inspection = await inspectAssistantAutomationRunLockDirectory({
    lockPath: resolveAssistantAutomationRunLockPath(paths),
    metadataPath: resolveAssistantAutomationRunLockMetadataPath(paths),
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

function resolveAssistantAutomationRunLockPath(paths: AssistantStatePaths): string {
  return path.join(paths.assistantStateRoot, '.automation-run.lock')
}

function resolveAssistantAutomationRunLockMetadataPath(paths: AssistantStatePaths): string {
  return path.join(paths.assistantStateRoot, '.automation-run.lock', 'owner.json')
}

async function inspectAssistantAutomationRunLockDirectory(input: {
  lockPath: string
  metadataPath: string
}) {
  return await inspectDirectoryLock({
    lockPath: input.lockPath,
    metadataPath: input.metadataPath,
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
