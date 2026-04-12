import assert from 'node:assert/strict'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('@murphai/vault-usecases/assistant-vault-paths')
  vi.doUnmock('../src/assistant/shared.js')
  vi.doUnmock('@murphai/runtime-state/node')
})

describe('assistant automation tail branch coverage', () => {
  it('rejects grouped outcome writes when the primary artifact path is missing', async () => {
    const resolveAssistantInboxArtifactPath = vi
      .fn()
      .mockResolvedValueOnce(undefined)
    const writeJsonFileAtomic = vi.fn()

    vi.doMock('@murphai/vault-usecases/assistant-vault-paths', () => ({
      resolveAssistantInboxArtifactPath,
    }))
    vi.doMock('../src/assistant/shared.js', () => ({
      writeJsonFileAtomic,
    }))

    const artifacts = await import('../src/assistant/automation/artifacts.ts')

    await expect(
      artifacts.writeAssistantAutoReplyGroupOutcomeArtifact({
        captureIds: ['capture-a'],
        outcome: 'result',
        recordedAt: '2026-04-08T00:00:00.000Z',
        result: {
          delivery: null,
          deliveryError: null,
          deliveryIntentId: null,
          response: 'Done.',
          session: {
            sessionId: 'session-a',
          },
        } as never,
        vault: '/tmp/test-vault',
      }),
    ).rejects.toThrow(/primary capture artifact path/u)

    expect(writeJsonFileAtomic).not.toHaveBeenCalled()
  })

  it('covers runtime-lock held and propagation branches through mocked directory locks', async () => {
    class MockDirectoryLockHeldError<TMetadata> extends Error {
      inspection: {
        lockPath: string
        metadata: TMetadata | null
        metadataPath: string
        state: 'active' | 'stale'
      }

      constructor(inspection: {
        lockPath: string
        metadata: TMetadata | null
        metadataPath: string
        state: 'active' | 'stale'
      }) {
        super('Directory lock is already held.')
        this.inspection = inspection
      }
    }

    const acquireDirectoryLock = vi
      .fn()
      .mockImplementationOnce(async (options) => {
        assert.equal(options.parseMetadata([]), null)
        assert.equal(
          options.inspectStale({
            command: 'stale-runner',
            mode: 'once',
            pid: 999_999,
            startedAt: '2026-04-08T00:00:00.000Z',
          }),
          'Process 999999 is no longer running.',
        )
        throw new MockDirectoryLockHeldError({
          lockPath: `${options.lockPath}`,
          metadata: null,
          metadataPath: `${options.metadataPath}`,
          state: 'stale',
        })
      })
      .mockRejectedValueOnce(new Error('lock boom'))
      .mockResolvedValueOnce({
        release: async () => undefined,
      })
    let inspectCallCount = 0
    const inspectDirectoryLock = vi.fn(async (options) => {
      inspectCallCount += 1
      assert.equal(options.parseMetadata([]), null)

      if (inspectCallCount === 4) {
        return {
          lockPath: `${options.lockPath}`,
          metadata: null,
          metadataPath: `${options.metadataPath}`,
          reason: 'Assistant automation run lock metadata is malformed.',
          state: 'stale' as const,
        }
      }

      return {
        lockPath: `${options.lockPath}`,
        metadataPath: `${options.metadataPath}`,
        state: 'unlocked' as const,
      }
    })
    const buildProcessCommand = vi.fn(() => 'murph automation run')
    const isProcessRunning = vi.fn((pid: number) => pid === process.pid)

    vi.doMock('@murphai/runtime-state/node', () => ({
      DirectoryLockHeldError: MockDirectoryLockHeldError,
      acquireDirectoryLock,
      buildProcessCommand,
      inspectDirectoryLock,
      isProcessRunning,
    }))

    const runtimeLock = await import('../src/assistant/automation/runtime-lock.ts')
    const paths = {
      assistantStateRoot: '/tmp/assistant-state',
    } as never

    await expect(
      runtimeLock.acquireAssistantAutomationRunLock({
        once: true,
        paths,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_AUTOMATION_ALREADY_RUNNING',
      context: {
        sameProcess: false,
      },
      message: expect.stringContaining('another assistant automation process'),
    })

    await expect(
      runtimeLock.acquireAssistantAutomationRunLock({
        paths,
      }),
    ).rejects.toThrow('lock boom')

    const lock = await runtimeLock.acquireAssistantAutomationRunLock({
      paths,
    })
    await lock.release()

    await expect(
      runtimeLock.inspectAssistantAutomationRunLock(paths),
    ).resolves.toEqual({
      command: null,
      mode: null,
      pid: null,
      reason: null,
      startedAt: null,
      state: 'unlocked',
    })
  })

  it('preserves same-process runtime-lock messaging with current metadata', async () => {
    class MockDirectoryLockHeldError extends Error {}

    const acquireDirectoryLock = vi.fn(async () => ({
      release: async () => undefined,
    }))

    vi.doMock('@murphai/runtime-state/node', () => ({
      DirectoryLockHeldError: MockDirectoryLockHeldError,
      acquireDirectoryLock,
      buildProcessCommand: () => 'murph automation run',
      inspectDirectoryLock: vi.fn(async () => ({
        lockPath: '/tmp/assistant-state-2/.automation-run.lock',
        metadataPath: '/tmp/assistant-state-2/.automation-run.lock/owner.json',
        state: 'unlocked' as const,
      })),
      isProcessRunning: vi.fn(),
    }))

    const runtimeLock = await import('../src/assistant/automation/runtime-lock.ts')
    const paths = {
      assistantStateRoot: '/tmp/assistant-state-2',
    } as never

    const first = await runtimeLock.acquireAssistantAutomationRunLock({
      once: true,
      paths,
    })

    await expect(
      runtimeLock.acquireAssistantAutomationRunLock({
        paths,
      }),
    ).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({
        code: 'ASSISTANT_AUTOMATION_ALREADY_RUNNING',
      })
      expect((error as { message: string }).message).toContain('current process')
      expect((error as { context?: unknown }).context).toMatchObject({
        sameProcess: true,
      })
      return true
    })

    await first.release()
  })
})
