import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  isProcessRunning,
} from '@healthybob/runtime-state'
import { VaultCliError } from '../../vault-cli-errors.js'
import type { AssistantStatePaths } from '../store.js'

const ASSISTANT_CRON_LOCK_DIRECTORY = '.locks/assistant-cron-write'
const ASSISTANT_CRON_LOCK_METADATA_PATH = `${ASSISTANT_CRON_LOCK_DIRECTORY}/owner.json`

interface AssistantCronWriteLockMetadata {
  command: string
  pid: number
  startedAt: string
}

const processAssistantCronWriteChains = new Map<string, Promise<void>>()
const assistantCronWriteOwnerStorage = new AsyncLocalStorage<Set<string>>()

export async function withAssistantCronWriteLock<TResult>(
  paths: AssistantStatePaths,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const ownedRoots = assistantCronWriteOwnerStorage.getStore()
  if (ownedRoots?.has(paths.assistantStateRoot)) {
    const handle = await acquireAssistantCronWriteLock(paths)

    try {
      return await run()
    } finally {
      await handle.release()
    }
  }

  const prior =
    processAssistantCronWriteChains.get(paths.assistantStateRoot) ?? Promise.resolve()
  let releaseQueue!: () => void
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  const tail = prior.then(
    () => queued,
    () => queued,
  )
  processAssistantCronWriteChains.set(paths.assistantStateRoot, tail)

  await prior.catch(() => undefined)

  try {
    const nextOwnedRoots = new Set(ownedRoots ?? [])
    nextOwnedRoots.add(paths.assistantStateRoot)

    return await assistantCronWriteOwnerStorage.run(nextOwnedRoots, async () => {
      const handle = await acquireAssistantCronWriteLock(paths)

      try {
        return await run()
      } finally {
        await handle.release()
      }
    })
  } finally {
    releaseQueue()
    if (processAssistantCronWriteChains.get(paths.assistantStateRoot) === tail) {
      processAssistantCronWriteChains.delete(paths.assistantStateRoot)
    }
  }
}

async function acquireAssistantCronWriteLock(paths: AssistantStatePaths): Promise<{
  release(): Promise<void>
}> {
  try {
    const handle = await acquireDirectoryLock({
      ownerKey: `assistant-cron:${paths.assistantStateRoot}`,
      lockPath: path.join(paths.assistantStateRoot, ASSISTANT_CRON_LOCK_DIRECTORY),
      metadataPath: path.join(
        paths.assistantStateRoot,
        ASSISTANT_CRON_LOCK_METADATA_PATH,
      ),
      metadata: {
        command: buildProcessCommand(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      parseMetadata(value) {
        return isAssistantCronWriteLockMetadata(value) ? value : null
      },
      invalidMetadataReason: 'Assistant cron write lock metadata is malformed.',
      cleanupRetries: 3,
      cleanupRetryDelayMs: 10,
      inspectStale(metadata) {
        return isProcessRunning(metadata.pid)
          ? null
          : `Process ${metadata.pid} is no longer running.`
      },
    })

    return {
      release: handle.release,
    }
  } catch (error) {
    if (error instanceof DirectoryLockHeldError) {
      const owner = error.inspection.metadata
      throw new VaultCliError(
        'ASSISTANT_CRON_LOCKED',
        owner
          ? `Assistant cron writes are already in progress (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
          : 'Assistant cron writes are already in progress.',
      )
    }

    throw error
  }
}

function isAssistantCronWriteLockMetadata(
  value: unknown,
): value is AssistantCronWriteLockMetadata {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'command' in value &&
      typeof (value as { command?: unknown }).command === 'string' &&
      'pid' in value &&
      typeof (value as { pid?: unknown }).pid === 'number' &&
      Number.isInteger((value as { pid: number }).pid) &&
      'startedAt' in value &&
      typeof (value as { startedAt?: unknown }).startedAt === 'string',
  )
}
