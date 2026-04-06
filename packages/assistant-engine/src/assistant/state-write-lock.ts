import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  inspectDirectoryLock,
  isProcessRunning,
} from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface AssistantStateWriteLockMetadata {
  command: string
  pid: number
  startedAt: string
}

interface AssistantStateWriteLockPaths {
  assistantStateRoot: string
}

interface AssistantStateWriteLockOptions {
  ownerKeyPrefix: string
  lockDirectory: string
  lockMetadataPath: string
  invalidMetadataReason: string
  heldLockErrorCode: string
  formatHeldLockMessage(metadata: AssistantStateWriteLockMetadata | null): string
}

export function createAssistantStateWriteLock<
  TPaths extends AssistantStateWriteLockPaths,
>(options: AssistantStateWriteLockOptions) {
  const processWriteChains = new Map<string, Promise<void>>()
  const reentrantRootStorage = new AsyncLocalStorage<Set<string>>()

  async function withWriteLock<TResult>(
    paths: TPaths,
    run: () => Promise<TResult>,
  ): Promise<TResult> {
    const reentrantRoots = reentrantRootStorage.getStore()
    if (reentrantRoots?.has(paths.assistantStateRoot)) {
      const handle = await acquireWriteLock(paths)

      try {
        return await run()
      } finally {
        await handle.release()
      }
    }

    const prior =
      processWriteChains.get(paths.assistantStateRoot) ?? Promise.resolve()
    let releaseQueue!: () => void
    const queued = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    const tail = prior.then(
      () => queued,
      () => queued,
    )
    processWriteChains.set(paths.assistantStateRoot, tail)

    await prior.catch(() => undefined)

    try {
      const nextReentrantRoots = new Set(reentrantRoots ?? [])
      nextReentrantRoots.add(paths.assistantStateRoot)

      return await reentrantRootStorage.run(nextReentrantRoots, async () => {
        const handle = await acquireWriteLock(paths)

        try {
          return await run()
        } finally {
          await handle.release()
        }
      })
    } finally {
      releaseQueue()
      if (processWriteChains.get(paths.assistantStateRoot) === tail) {
        processWriteChains.delete(paths.assistantStateRoot)
      }
    }
  }

  async function acquireWriteLock(paths: TPaths): Promise<{
    release(): Promise<void>
  }> {
    try {
      const handle = await acquireDirectoryLock({
        ownerKey: `${options.ownerKeyPrefix}:${paths.assistantStateRoot}`,
        lockPath: path.join(paths.assistantStateRoot, options.lockDirectory),
        metadataPath: path.join(paths.assistantStateRoot, options.lockMetadataPath),
        metadata: {
          command: buildProcessCommand(),
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        parseMetadata(value) {
          return isAssistantStateWriteLockMetadata(value) ? value : null
        },
        invalidMetadataReason: options.invalidMetadataReason,
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
        throw new VaultCliError(
          options.heldLockErrorCode,
          options.formatHeldLockMessage(error.inspection.metadata),
        )
      }

      throw error
    }
  }

  async function inspectWriteLock(paths: TPaths) {
    return await inspectDirectoryLock({
      lockPath: path.join(paths.assistantStateRoot, options.lockDirectory),
      metadataPath: path.join(paths.assistantStateRoot, options.lockMetadataPath),
      parseMetadata(value) {
        return isAssistantStateWriteLockMetadata(value) ? value : null
      },
      invalidMetadataReason: options.invalidMetadataReason,
      inspectStale(metadata) {
        return isProcessRunning(metadata.pid)
          ? null
          : `Process ${metadata.pid} is no longer running.`
      },
    })
  }

  async function clearWriteLock(paths: TPaths): Promise<void> {
    await Promise.all([
      rm(path.join(paths.assistantStateRoot, options.lockDirectory), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 10,
      }),
      rm(path.join(paths.assistantStateRoot, options.lockMetadataPath), {
        force: true,
        maxRetries: 3,
        retryDelay: 10,
      }),
    ])
  }

  return {
    withWriteLock,
    acquireWriteLock,
    inspectWriteLock,
    clearWriteLock,
    isWriteLockMetadata: isAssistantStateWriteLockMetadata,
  }
}

function isAssistantStateWriteLockMetadata(
  value: unknown,
): value is AssistantStateWriteLockMetadata {
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
