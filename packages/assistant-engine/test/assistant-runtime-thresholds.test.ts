import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('../src/assistant/automation/runtime-lock.js')
  vi.doUnmock('../src/assistant/diagnostics.js')
  vi.doUnmock('../src/assistant/runtime-cache.js')
  vi.doUnmock('../src/assistant/runtime-events.js')
  vi.doUnmock('../src/assistant/runtime-write-lock.js')
  vi.doUnmock('../src/assistant/state-write-lock.ts')
  vi.doUnmock('../src/assistant/store/paths.ts')
  vi.doUnmock('../src/assistant/store/persistence.js')
  vi.doUnmock('../src/assistant/shared.js')
  vi.doUnmock('../src/outbound-channel.ts')
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant runtime thresholds', () => {
  it('covers the turn-lock held-message formatter for owned and unknown lock owners', async () => {
    let capturedConfig:
      | {
          formatHeldLockMessage(owner: {
            command: string
            pid: number
            startedAt: string
          } | null): string
        }
      | undefined

    vi.doMock('../src/assistant/state-write-lock.ts', () => ({
      createAssistantStateWriteLock: vi.fn((config) => {
        capturedConfig = config
        return {
          acquireWriteLock: vi.fn(async () => ({
            release: async () => undefined,
          })),
        }
      }),
    }))
    vi.doMock('../src/assistant/store/paths.ts', () => ({
      resolveAssistantStatePaths: vi.fn(() => ({
        assistantStateRoot: 'assistant-state-root',
      })),
    }))

    const turnLock = await import('../src/assistant/turn-lock.ts')

    expect(
      capturedConfig?.formatHeldLockMessage({
        command: 'assistant run',
        pid: 42,
        startedAt: '2026-04-08T00:00:00.000Z',
      }),
    ).toBe(
      'Assistant turn is already in progress for this vault (pid=42, startedAt=2026-04-08T00:00:00.000Z, command=assistant run).',
    )
    expect(capturedConfig?.formatHeldLockMessage(null)).toBe(
      'Assistant turn is already in progress for this vault.',
    )
    await expect(
      turnLock.withAssistantTurnLock({
        run: async () => 'ok',
        vault: 'ignored',
      }),
    ).resolves.toBe('ok')
  })

  it('treats missing budget snapshots and missing quarantine directories as an empty maintenance pass', async () => {
    const paths = await createAssistantPaths(
      'assistant-runtime-thresholds-runtime-budgets-missing-',
    )
    await rm(paths.quarantineDirectory, {
      force: true,
      recursive: true,
    })
    await rm(paths.outboxQuarantineDirectory, {
      force: true,
      recursive: true,
    })

    const appendAssistantRuntimeEventAtPaths = vi.fn(async () => {
      throw new Error('best-effort runtime event failure')
    })

    vi.doMock('../src/assistant/runtime-write-lock.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/runtime-write-lock.ts')
      >('../src/assistant/runtime-write-lock.ts')
      return {
        ...actual,
        clearAssistantRuntimeWriteLock: vi.fn(async () => undefined),
        inspectAssistantRuntimeWriteLock: vi.fn(async () => ({
          state: 'active' as const,
        })),
        withAssistantRuntimeWriteLock: vi.fn(
          async (_vault: string, run: (lockedPaths: typeof paths) => Promise<unknown>) =>
            await run(paths),
        ),
      }
    })
    vi.doMock('../src/assistant/automation/runtime-lock.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/automation/runtime-lock.ts')
      >('../src/assistant/automation/runtime-lock.ts')
      return {
        ...actual,
        clearAssistantAutomationRunLock: vi.fn(async () => undefined),
        inspectAssistantAutomationRunLock: vi.fn(async () => ({
          state: 'active' as const,
        })),
      }
    })
    vi.doMock('../src/assistant/runtime-cache.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../src/assistant/runtime-cache.js')>()
      return {
        ...actual,
        listAssistantRuntimeCacheSnapshots: vi.fn(() => []),
        pruneAssistantRuntimeCaches: vi.fn(() => 0),
      }
    })
    vi.doMock('../src/assistant/runtime-events.js', () => ({
      appendAssistantRuntimeEventAtPaths,
    }))

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.readAssistantRuntimeBudgetStatus('ignored-by-mock'),
    ).resolves.toMatchObject({
      maintenance: {
        lastRunAt: null,
        notes: [],
        staleLocksCleared: 0,
        staleQuarantinePruned: 0,
      },
      schema: 'murph.assistant-runtime-budget.v1',
    })

    await expect(
      runtimeBudgets.runAssistantRuntimeMaintenance({
        now: new Date('2026-03-01T00:00:00.000Z'),
        vault: 'ignored-by-mock',
      }),
    ).resolves.toMatchObject({
      maintenance: {
        lastRunAt: '2026-03-01T00:00:00.000Z',
        notes: [],
        staleLocksCleared: 0,
        staleQuarantinePruned: 0,
      },
    })
    expect(appendAssistantRuntimeEventAtPaths).toHaveBeenCalledOnce()
  })

  it('returns the current budget snapshot without rerunning maintenance when the last run is recent', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-thresholds-recent-maintenance-',
    )
    await writeFile(
      paths.resourceBudgetPath,
      JSON.stringify({
        schema: 'murph.assistant-runtime-budget.v1',
        updatedAt: '2026-03-01T00:00:00.000Z',
        caches: [],
        maintenance: {
          lastRunAt: '2026-03-01T00:03:00.000Z',
          notes: ['already fresh'],
          staleLocksCleared: 0,
          staleQuarantinePruned: 0,
        },
      }),
      'utf8',
    )

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.maybeRunAssistantRuntimeMaintenance({
        now: new Date('2026-03-01T00:06:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      maintenance: {
        lastRunAt: '2026-03-01T00:03:00.000Z',
        notes: ['already fresh'],
      },
    })
  })

  it('reruns overdue maintenance with the current clock and records the singular cache-prune note', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T01:00:00.000Z'))

    const paths = createMockAssistantPaths('assistant-runtime-thresholds-overdue-maintenance')

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readFile: vi.fn(async (targetPath: string, encoding: BufferEncoding) => {
          if (targetPath === paths.resourceBudgetPath && encoding === 'utf8') {
            return JSON.stringify({
              schema: 'murph.assistant-runtime-budget.v1',
              updatedAt: '2026-03-01T00:00:00.000Z',
              caches: [],
              maintenance: {
                lastRunAt: '2026-03-01T00:00:00.000Z',
                notes: [],
                staleLocksCleared: 0,
                staleQuarantinePruned: 0,
              },
            })
          }

          return await actual.readFile(targetPath, encoding)
        }),
        readdir: vi.fn(async () => []),
        rmdir: vi.fn(async () => undefined),
        stat: vi.fn(async () => ({
          mtimeMs: 0,
        })),
      }
    })
    vi.doMock('../src/assistant/runtime-write-lock.js', () => ({
      clearAssistantRuntimeWriteLock: vi.fn(async () => undefined),
      inspectAssistantRuntimeWriteLock: vi.fn(async () => ({
        state: 'active' as const,
      })),
      withAssistantRuntimeWriteLock: vi.fn(
        async (_vault: string, run: (lockedPaths: typeof paths) => Promise<unknown>) =>
          await run(paths),
      ),
    }))
    vi.doMock('../src/assistant/automation/runtime-lock.js', () => ({
      clearAssistantAutomationRunLock: vi.fn(async () => undefined),
      inspectAssistantAutomationRunLock: vi.fn(async () => ({
        state: 'active' as const,
      })),
    }))
    vi.doMock('../src/assistant/runtime-cache.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../src/assistant/runtime-cache.js')>()
      return {
        ...actual,
        listAssistantRuntimeCacheSnapshots: vi.fn(() => []),
        pruneAssistantRuntimeCaches: vi.fn(() => 1),
      }
    })
    vi.doMock('../src/assistant/runtime-events.js', () => ({
      appendAssistantRuntimeEventAtPaths: vi.fn(async () => undefined),
    }))
    vi.doMock('../src/assistant/store/persistence.js', () => ({
      ensureAssistantState: vi.fn(async () => undefined),
    }))
    vi.doMock('../src/assistant/shared.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/shared.ts')>(
        '../src/assistant/shared.ts',
      )
      return {
        ...actual,
        writeJsonFileAtomic: vi.fn(async () => undefined),
      }
    })

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.maybeRunAssistantRuntimeMaintenance({
        vault: 'ignored-by-mock',
      }),
    ).resolves.toMatchObject({
      maintenance: {
        lastRunAt: '2026-03-01T01:00:00.000Z',
        notes: ['1 expired runtime cache entry was pruned.'],
        staleLocksCleared: 0,
        staleQuarantinePruned: 0,
      },
      updatedAt: '2026-03-01T01:00:00.000Z',
    })
  })

  it('rethrows unexpected budget snapshot read failures before attempting recovery', async () => {
    const paths = createMockAssistantPaths('assistant-runtime-thresholds-budget-read-error')
    const readError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    })

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readFile: vi.fn(async (targetPath: string, encoding: BufferEncoding) => {
          if (targetPath === paths.resourceBudgetPath && encoding === 'utf8') {
            throw readError
          }

          return await actual.readFile(targetPath, encoding)
        }),
      }
    })
    mockRuntimeBudgetDependencies(paths)

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.readAssistantRuntimeBudgetStatus('ignored-by-mock'),
    ).rejects.toBe(readError)
  })

  it('recovers a corrupted budget snapshot even when recovery event logging fails', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-thresholds-corrupt-budget-',
    )
    await writeFile(paths.resourceBudgetPath, '{"schema":"broken"', 'utf8')

    vi.doMock('../src/assistant/runtime-events.js', () => ({
      appendAssistantRuntimeEventAtPaths: vi.fn(async () => {
        throw new Error('ignore recovery event write failure')
      }),
    }))

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.readAssistantRuntimeBudgetStatus(vaultRoot),
    ).resolves.toMatchObject({
      maintenance: {
        lastRunAt: null,
        notes: [],
      },
      schema: 'murph.assistant-runtime-budget.v1',
    })
  })

  it('ignores ENOTEMPTY when a nested quarantine directory refills during cleanup', async () => {
    const paths = createMockAssistantPaths('assistant-runtime-thresholds-enotempty')
    const readdir = vi.fn(async (directory: string, options?: { withFileTypes?: boolean }) => {
      if (options?.withFileTypes) {
        if (directory === paths.quarantineDirectory) {
          return [createDirectoryEntry('nested')]
        }
        if (directory === path.join(paths.quarantineDirectory, 'nested')) {
          return []
        }
        return []
      }

      if (directory === path.join(paths.quarantineDirectory, 'nested')) {
        return []
      }

      return ['still-here']
    })
    const rmdir = vi.fn(async () => {
      throw Object.assign(new Error('directory refilled'), {
        code: 'ENOTEMPTY',
      })
    })

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readdir,
        rmdir,
        stat: vi.fn(),
      }
    })
    mockRuntimeBudgetDependencies(paths)

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.runAssistantRuntimeMaintenance({
        now: new Date('2026-03-02T00:00:00.000Z'),
        vault: 'ignored-by-mock',
      }),
    ).resolves.toMatchObject({
      maintenance: {
        notes: [],
        staleQuarantinePruned: 0,
      },
    })
    expect(rmdir).toHaveBeenCalledOnce()
  })

  it('rethrows unexpected metadata stat failures while pruning orphan quarantine payloads', async () => {
    const paths = createMockAssistantPaths('assistant-runtime-thresholds-stat-failure')
    const statError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    })

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readdir: vi.fn(async (directory: string, options?: { withFileTypes?: boolean }) => {
          if (!options?.withFileTypes) {
            return []
          }
          if (directory === paths.quarantineDirectory) {
            return []
          }
          if (directory === paths.outboxQuarantineDirectory) {
            return [createFileEntry('reply.invalid.json')]
          }
          return []
        }),
        rmdir: vi.fn(),
        stat: vi.fn(async (targetPath: string) => {
          if (targetPath.endsWith('.meta.json')) {
            throw statError
          }
          return {
            mtimeMs: 0,
          }
        }),
      }
    })
    mockRuntimeBudgetDependencies(paths)

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.runAssistantRuntimeMaintenance({
        now: new Date('2026-03-03T00:00:00.000Z'),
        vault: 'ignored-by-mock',
      }),
    ).rejects.toBe(statError)
  })

  it('ignores non-file entries and fresh quarantine payloads during pruning', async () => {
    const paths = createMockAssistantPaths('assistant-runtime-thresholds-prune-guards')

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readdir: vi.fn(async (directory: string, options?: { withFileTypes?: boolean }) => {
          if (!options?.withFileTypes) {
            return ['still-here']
          }
          if (directory === paths.quarantineDirectory) {
            return [
              createDirectoryEntry('nested'),
              createFileEntry('note.txt'),
            ]
          }
          if (directory === path.join(paths.quarantineDirectory, 'nested')) {
            return []
          }
          if (directory === paths.outboxQuarantineDirectory) {
            return [createFileEntry('fresh.invalid.json')]
          }
          return []
        }),
        rmdir: vi.fn(async () => undefined),
        stat: vi.fn(async (targetPath: string) => ({
          mtimeMs: targetPath.endsWith('fresh.invalid.json')
            ? Date.parse('2026-03-10T23:59:59.000Z')
            : 0,
        })),
      }
    })
    mockRuntimeBudgetDependencies(paths)

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.runAssistantRuntimeMaintenance({
        now: new Date('2026-03-11T00:00:00.000Z'),
        vault: 'ignored-by-mock',
      }),
    ).resolves.toMatchObject({
      maintenance: {
        staleQuarantinePruned: 0,
      },
    })
  })

  it('records maintenance notes when caches, quarantine artifacts, and stale locks are all pruned', async () => {
    const paths = createMockAssistantPaths('assistant-runtime-thresholds-maintenance-notes')

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readdir: vi.fn(async (directory: string, options?: { withFileTypes?: boolean }) => {
          if (!options?.withFileTypes) {
            return []
          }
          if (directory === paths.quarantineDirectory) {
            return [createFileEntry('stale.invalid.json')]
          }
          return []
        }),
        rm: vi.fn(async () => undefined),
        rmdir: vi.fn(async () => undefined),
        stat: vi.fn(async (targetPath: string) => {
          if (targetPath.endsWith('.meta.json')) {
            throw Object.assign(new Error('missing metadata'), {
              code: 'ENOENT',
            })
          }
          return {
            mtimeMs: 0,
          }
        }),
      }
    })
    vi.doMock('../src/assistant/runtime-write-lock.js', () => ({
      clearAssistantRuntimeWriteLock: vi.fn(async () => undefined),
      inspectAssistantRuntimeWriteLock: vi.fn(async () => ({
        state: 'stale' as const,
      })),
      withAssistantRuntimeWriteLock: vi.fn(
        async (_vault: string, run: (lockedPaths: typeof paths) => Promise<unknown>) =>
          await run(paths),
      ),
    }))
    vi.doMock('../src/assistant/automation/runtime-lock.js', () => ({
      clearAssistantAutomationRunLock: vi.fn(async () => undefined),
      inspectAssistantAutomationRunLock: vi.fn(async () => ({
        state: 'stale' as const,
      })),
    }))
    vi.doMock('../src/assistant/runtime-cache.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../src/assistant/runtime-cache.js')>()
      return {
        ...actual,
        listAssistantRuntimeCacheSnapshots: vi.fn(() => []),
        pruneAssistantRuntimeCaches: vi.fn(() => 1),
      }
    })
    vi.doMock('../src/assistant/runtime-events.js', () => ({
      appendAssistantRuntimeEventAtPaths: vi.fn(async () => undefined),
    }))
    vi.doMock('../src/assistant/store/persistence.js', () => ({
      ensureAssistantState: vi.fn(async () => undefined),
    }))
    vi.doMock('../src/assistant/shared.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/shared.ts')>(
        '../src/assistant/shared.ts',
      )
      return {
        ...actual,
        writeJsonFileAtomic: vi.fn(async () => undefined),
      }
    })

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.runAssistantRuntimeMaintenance({
        now: new Date('2026-03-12T00:00:00.000Z'),
        vault: 'ignored-by-mock',
      }),
    ).resolves.toMatchObject({
      maintenance: {
        notes: [
          '1 expired runtime cache entry was pruned.',
          '1 expired quarantine artifact(s) were removed.',
          '2 stale runtime lock(s) were cleared.',
        ],
        staleLocksCleared: 2,
        staleQuarantinePruned: 1,
      },
    })
  })

  it('skips quarantine errors when a malformed outbox inventory file disappears mid-race', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-thresholds-outbox-race-',
    )
    await writeFile(
      path.join(paths.outboxDirectory, 'broken.json'),
      '{"schema":"murph.assistant-outbox-intent.v1"',
      'utf8',
    )

    const rename = vi.fn(async () => {
      throw Object.assign(new Error('already gone'), {
        code: 'ENOENT',
      })
    })
    const recordAssistantDiagnosticEvent = vi.fn(async () => undefined)

    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      )
      return {
        ...actual,
        rename,
      }
    })
    vi.doMock('../src/assistant/diagnostics.js', () => ({
      recordAssistantDiagnosticEvent,
    }))

    const outbox = await import('../src/assistant/outbox.ts')

    await expect(outbox.listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
    expect(rename).toHaveBeenCalledOnce()
    expect(recordAssistantDiagnosticEvent).not.toHaveBeenCalled()
  })

  it('marks prepared dispatch failures without a clear hook as confirmation-pending retries', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-thresholds-outbox-ambiguous-',
    )
    const deliverAssistantMessageOverBinding = vi.fn(async () => {
      throw Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
      })
    })

    vi.doMock('../src/outbound-channel.ts', () => ({
      deliverAssistantMessageOverBinding,
    }))

    const outbox = await import('../src/assistant/outbox.ts')
    const seeded = await outbox.createAssistantOutboxIntent({
      channel: 'telegram',
      createdAt: '2026-04-08T09:00:00.000Z',
      identityId: 'participant-1',
      message: 'retry me if cleanup is ambiguous',
      sessionId: 'session-thresholds',
      threadId: 'thread-thresholds',
      threadIsDirect: true,
      turnId: 'turn-thresholds',
      vault: vaultRoot,
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, seeded)
    await expect(
      outbox.readAssistantOutboxIntent(vaultRoot, seeded.intentId),
    ).resolves.toMatchObject({
      intentId: seeded.intentId,
    })

    const result = await outbox.dispatchAssistantOutboxIntent({
      dispatchHooks: {
        prepareDispatchIntent: vi.fn(async () => undefined),
      },
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T09:05:00.000Z'),
      vault: vaultRoot,
    })

    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
    expect(result.intent.status).toBe('retryable')
    expect(result.intent.deliveryConfirmationPending).toBe(true)
    expect(result.deliveryError?.code).toBe(
      'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    )
  })
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  const paths = resolveAssistantStatePaths(context.vaultRoot)
  await ensureAssistantState(paths)
  return paths
}

async function createAssistantVault(prefix: string): Promise<{
  paths: ReturnType<typeof resolveAssistantStatePaths>
  vaultRoot: string
}> {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  const paths = resolveAssistantStatePaths(context.vaultRoot)
  await ensureAssistantState(paths)
  return {
    paths,
    vaultRoot: context.vaultRoot,
  }
}

function createMockAssistantPaths(seed: string) {
  const root = path.join('/tmp', seed)
  return {
    assistantStateRoot: root,
    outboxQuarantineDirectory: path.join(root, 'outbox-quarantine'),
    quarantineDirectory: path.join(root, 'quarantine'),
    resourceBudgetPath: path.join(root, 'resource-budget.json'),
  }
}

function createDirectoryEntry(name: string) {
  return {
    isDirectory: () => true,
    isFile: () => false,
    name,
  }
}

function createFileEntry(name: string) {
  return {
    isDirectory: () => false,
    isFile: () => true,
    name,
  }
}

function mockRuntimeBudgetDependencies(
  paths: ReturnType<typeof createMockAssistantPaths>,
): void {
  vi.doMock('../src/assistant/runtime-write-lock.js', () => ({
    clearAssistantRuntimeWriteLock: vi.fn(async () => undefined),
    inspectAssistantRuntimeWriteLock: vi.fn(async () => ({
      state: 'active' as const,
    })),
    withAssistantRuntimeWriteLock: vi.fn(
      async (_vault: string, run: (lockedPaths: typeof paths) => Promise<unknown>) =>
        await run(paths),
    ),
  }))
  vi.doMock('../src/assistant/automation/runtime-lock.js', () => ({
    clearAssistantAutomationRunLock: vi.fn(async () => undefined),
    inspectAssistantAutomationRunLock: vi.fn(async () => ({
      state: 'active' as const,
    })),
  }))
  vi.doMock('../src/assistant/runtime-cache.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/runtime-cache.ts')
    >('../src/assistant/runtime-cache.ts')
    return {
      ...actual,
      listAssistantRuntimeCacheSnapshots: vi.fn(() => []),
      pruneAssistantRuntimeCaches: vi.fn(() => 0),
    }
  })
  vi.doMock('../src/assistant/runtime-events.js', () => ({
    appendAssistantRuntimeEventAtPaths: vi.fn(async () => undefined),
  }))
  vi.doMock('../src/assistant/store/persistence.js', () => ({
    ensureAssistantState: vi.fn(async () => undefined),
  }))
  vi.doMock('../src/assistant/shared.js', async () => {
    const actual = await vi.importActual<typeof import('../src/assistant/shared.ts')>(
      '../src/assistant/shared.ts',
    )
    return {
      ...actual,
      writeJsonFileAtomic: vi.fn(async () => undefined),
    }
  })
}
