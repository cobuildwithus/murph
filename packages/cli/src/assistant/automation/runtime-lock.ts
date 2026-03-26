import path from 'node:path'
import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  isProcessRunning,
} from '@healthybob/runtime-state'
import { VaultCliError } from '../../vault-cli-errors.js'
import type { AssistantStatePaths } from '../store/paths.js'

interface AssistantAutomationRunLockMetadata {
  command: string
  mode: 'continuous' | 'once'
  pid: number
  startedAt: string
}

const activeAutomationRoots = new Set<string>()

export async function acquireAssistantAutomationRunLock(input: {
  once?: boolean
  paths: AssistantStatePaths
}): Promise<{
  release(): Promise<void>
}> {
  const ownerKey = `assistant-automation:${input.paths.assistantStateRoot}`
  const lockPath = path.join(input.paths.assistantStateRoot, '.automation-run.lock')
  const metadataPath = path.join(
    input.paths.assistantStateRoot,
    '.automation-run-lock.json',
  )

  if (activeAutomationRoots.has(input.paths.assistantStateRoot)) {
    throw createAssistantAlreadyRunningError({
      metadata: {
        command: buildProcessCommand(),
        mode: input.once ? 'once' : 'continuous',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      sameProcess: true,
    })
  }

  activeAutomationRoots.add(input.paths.assistantStateRoot)
  let handle: { release(): Promise<void> } | null = null

  try {
    handle = await acquireDirectoryLock({
      ownerKey,
      lockPath,
      metadataPath,
      metadata: {
        command: buildProcessCommand(),
        mode: input.once ? 'once' : 'continuous',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      } satisfies AssistantAutomationRunLockMetadata,
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

function createAssistantAlreadyRunningError(input: {
  metadata: AssistantAutomationRunLockMetadata | null
  sameProcess: boolean
}): VaultCliError {
  const metadata = input.metadata
  const modeLabel =
    metadata?.mode === 'once' ? 'one-shot scan' : 'continuous automation loop'
  const details = metadata
    ? `pid=${metadata.pid}, startedAt=${metadata.startedAt}, command=${metadata.command}, mode=${modeLabel}`
    : null

  return new VaultCliError(
    'ASSISTANT_ALREADY_RUNNING',
    [
      'Assistant automation is already running for this vault.',
      input.sameProcess
        ? 'This process already owns the assistant automation loop.'
        : 'Another process already owns the assistant automation loop.',
      details ? `Existing owner: ${details}.` : null,
      'If a prior foreground run was suspended with Ctrl+Z, resume it with `fg` and stop it with Ctrl+C before starting another assistant run.',
    ]
      .filter((value): value is string => value !== null)
      .join(' '),
    metadata
      ? {
          command: metadata.command,
          mode: metadata.mode,
          pid: metadata.pid,
          startedAt: metadata.startedAt,
        }
      : undefined,
  )
}

function isAssistantAutomationRunLockMetadata(
  value: unknown,
): value is AssistantAutomationRunLockMetadata {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'command' in value &&
      typeof (value as { command?: unknown }).command === 'string' &&
      'mode' in value &&
      ((value as { mode?: unknown }).mode === 'continuous' ||
        (value as { mode?: unknown }).mode === 'once') &&
      'pid' in value &&
      typeof (value as { pid?: unknown }).pid === 'number' &&
      Number.isInteger((value as { pid: number }).pid) &&
      (value as { pid: number }).pid > 0 &&
      'startedAt' in value &&
      typeof (value as { startedAt?: unknown }).startedAt === 'string',
  )
}
