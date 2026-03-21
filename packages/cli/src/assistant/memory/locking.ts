import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  isProcessRunning,
} from '@healthybob/runtime-state'
import { VaultCliError } from '../../vault-cli-errors.js'
import type { AssistantMemoryPaths } from './paths.js'

const ASSISTANT_MEMORY_LOCK_DIRECTORY = '.locks/assistant-memory-write'
const ASSISTANT_MEMORY_LOCK_METADATA_PATH = `${ASSISTANT_MEMORY_LOCK_DIRECTORY}/owner.json`

interface AssistantMemoryWriteLockMetadata {
  command: string
  pid: number
  startedAt: string
}

const processAssistantMemoryWriteChains = new Map<string, Promise<void>>()
const assistantMemoryWriteOwnerStorage = new AsyncLocalStorage<Set<string>>()

export async function withAssistantMemoryWriteLock<TResult>(
  paths: AssistantMemoryPaths,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const ownedRoots = assistantMemoryWriteOwnerStorage.getStore()
  if (ownedRoots?.has(paths.assistantStateRoot)) {
    const handle = await acquireAssistantMemoryWriteLock(paths)

    try {
      return await run()
    } finally {
      await handle.release()
    }
  }

  const prior =
    processAssistantMemoryWriteChains.get(paths.assistantStateRoot) ?? Promise.resolve()
  let releaseQueue!: () => void
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  const tail = prior.then(
    () => queued,
    () => queued,
  )
  processAssistantMemoryWriteChains.set(paths.assistantStateRoot, tail)

  await prior.catch(() => undefined)

  try {
    const nextOwnedRoots = new Set(ownedRoots ?? [])
    nextOwnedRoots.add(paths.assistantStateRoot)

    return await assistantMemoryWriteOwnerStorage.run(nextOwnedRoots, async () => {
      const handle = await acquireAssistantMemoryWriteLock(paths)

      try {
        return await run()
      } finally {
        await handle.release()
      }
    })
  } finally {
    releaseQueue()
    if (processAssistantMemoryWriteChains.get(paths.assistantStateRoot) === tail) {
      processAssistantMemoryWriteChains.delete(paths.assistantStateRoot)
    }
  }
}

async function acquireAssistantMemoryWriteLock(paths: AssistantMemoryPaths): Promise<{
  release(): Promise<void>
}> {
  try {
    const handle = await acquireDirectoryLock({
      ownerKey: `assistant-memory:${paths.assistantStateRoot}`,
      lockPath: path.join(paths.assistantStateRoot, ASSISTANT_MEMORY_LOCK_DIRECTORY),
      metadataPath: path.join(
        paths.assistantStateRoot,
        ASSISTANT_MEMORY_LOCK_METADATA_PATH,
      ),
      metadata: {
        command: buildProcessCommand(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      parseMetadata(value) {
        return isAssistantMemoryWriteLockMetadata(value) ? value : null
      },
      invalidMetadataReason: 'Assistant memory write lock metadata is malformed.',
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
        'ASSISTANT_MEMORY_WRITE_LOCKED',
        owner
          ? `Assistant memory writes are already in progress (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
          : 'Assistant memory writes are already in progress.',
      )
    }

    throw error
  }
}

function isAssistantMemoryWriteLockMetadata(
  value: unknown,
): value is AssistantMemoryWriteLockMetadata {
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
