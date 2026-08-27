import {
  MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
  MockChildProcess,
  asRecord,
  codexMocks,
  createDeferred,
  createTempDir,
  executeCodexAppServerTurn,
  initializeWarmTurn,
  jsonLine,
  mockHostedCodexIdentityServer,
  mockProcessGroupSignalsForChildren,
  readTurnStartInputItems,
  readWrittenRpcMessages,
  requireMockChildProcess,
  respondToBackgroundTerminals,
  waitForMockCall,
  waitForProcessKillWithFakeTimers,
  waitForRpcMethod,
  waitForRpcMethodCount,
  writeCompletedTurn,
  writeContextCompactionStarted,
  writeStartedTurn,
  writeSubAgentActivity,
  writeWarmTurnStarted,
} from "./assistant-codex-runtime.harness.ts";

import { tmpdir } from 'node:os'
import {
  MURPH_MEMBER_READ_PERMISSION_PROFILE,
  MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
} from '@murphai/hosted-execution/assistant-permissions'
import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCodexAppServerSteerRequest,
  buildCodexAppServerArgs,
  compactWarmCodexThread,
  executeCodexAppServerTurn as executeCodexAppServerTurnUnchecked,
  executeCodexManagedAccountOperation,
  preinitializeCodexAppServer,
  readCodexAppServerTurnFailureContext,
  resolveCodexDisplayOptions,
  stopWarmCodexAppServer,
  waitForWarmCodexBackgroundWork,
} from '../src/assistant-codex.ts'
import {
  executeCodexAssistantTurnAttempt,
  executeCodexAssistantTurnAttemptFromInput,
} from '../src/assistant/codex-runtime.ts'

describe('assistant codex runtime', () => {it('coalesces process-only preinitialization and keeps the first foreground turn cold-scoped', async () => {
    const workingDirectory = await createTempDir('assistant-codex-preinitialize-work-')
    const codexHome = await createTempDir('assistant-codex-preinitialize-home-')
    const children: MockChildProcess[] = []
    const initializeObserved = createDeferred<void>()
    const releaseInitialize = createDeferred<void>()
    const onTraceEvent = vi.fn()
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_000
      children.push(child)
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          initializeObserved.resolve(undefined)
          await releaseInitialize.promise
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-preinitialized-first',
            turnId: 'turn-preinitialized-first',
          })
          // First-turn events remain valid without a turn id. Prior-turn warm
          // reuse intentionally requires scoped events.
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-preinitialized-first',
                text: 'Prepared answer',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-preinitialized-first',
                status: 'completed',
              },
            },
          }))
        })()
      })
      return child
    })

    const launchInput = {
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    }
    await Promise.all([
      preinitializeCodexAppServer(launchInput),
      preinitializeCodexAppServer(launchInput),
    ])
    await initializeObserved.promise

    const child = requireMockChildProcess(children[0] ?? null)
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(readWrittenRpcMessages(child).map((message) => message.method))
      .toEqual(['initialize'])

    const turn = executeCodexAppServerTurn({
      ...launchInput,
      onTraceEvent,
      prompt: 'Use the process that is already initializing.',
    })
    let claimed = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const outcome = await compactWarmCodexThread({
        minThreadTokens: 1,
        timeoutMs: 1_000,
      })
      if (outcome.kind === 'skipped' && outcome.reason === 'turn_in_flight') {
        claimed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(claimed).toBe(true)
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(readWrittenRpcMessages(child).map((message) => message.method))
      .toEqual(['initialize'])
    releaseInitialize.resolve(undefined)

    await expect(turn).resolves.toMatchObject({
      finalMessage: 'Prepared answer',
      sessionId: 'thread-preinitialized-first',
      turnId: 'turn-preinitialized-first',
    })
    expect(onTraceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: expect.any(String),
          codexTimingStage: 'preinitialized',
        }),
      }),
    )
  })

  it('keeps a ready resident when mismatched preparation is requested', async () => {
    const workingDirectory = await createTempDir('assistant-codex-preinitialize-ready-work-')
    const codexHome = await createTempDir('assistant-codex-preinitialize-ready-home-')
    const children: MockChildProcess[] = []
    const controller = new AbortController()
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_050
      children.push(child)
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
        })()
      })
      return child
    })

    const preparation = await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin' },
      signal: controller.signal,
      workingDirectory,
    })
    const child = requireMockChildProcess(children[0] ?? null)
    await waitForRpcMethod(child, 'initialized')
    controller.abort()
    await Promise.resolve()
    expect(preparation).not.toBeNull()
    await expect(preparation?.cancelPending()).resolves.toBeUndefined()

    expect(await compactWarmCodexThread({
      minThreadTokens: 1,
      timeoutMs: 1_000,
    })).toMatchObject({
      kind: 'skipped',
      reason: 'no_thread_vitals',
    })
    expect(readWrittenRpcMessages(child).map((message) => message.method))
      .toEqual(['initialize', 'initialized'])
    expect(process.kill).not.toHaveBeenCalled()

    await expect(preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/different/bin' },
      workingDirectory,
    })).resolves.toBeNull()
    expect(children).toHaveLength(1)
    expect(process.kill).not.toHaveBeenCalled()
  })

  it('keeps an initializing resident when mismatched preparation is requested', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-preinitialize-in-progress-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-preinitialize-in-progress-home-',
    )
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_060
      children.push(child)
      return child
    })

    const firstPreparation = await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-one' },
      workingDirectory,
    })
    await waitForRpcMethod(
      requireMockChildProcess(children[0] ?? null),
      'initialize',
    )

    await expect(preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-two' },
      workingDirectory,
    })).resolves.toBeNull()
    expect(children).toHaveLength(1)
    expect(process.kill).not.toHaveBeenCalled()

    await expect(firstPreparation?.cancelPending()).resolves.toBeUndefined()
    expect(children[0]?.signalCode).toBe('SIGTERM')
  })

  it('binds cancellation to the exact preparation after foreground replacement', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-preinitialize-exact-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-preinitialize-exact-home-',
    )
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_075 + children.length
      children.push(child)
      return child
    })

    const firstPreparation = await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-one' },
      workingDirectory,
    })
    const firstChild = requireMockChildProcess(children[0] ?? null)
    await waitForRpcMethod(firstChild, 'initialize')

    const foregroundTurn = executeCodexAppServerTurn({
      codexHome,
      env: { PATH: '/custom/bin-two' },
      prompt: 'Replace the incompatible pending preparation authoritatively.',
      workingDirectory,
    })
    await waitForMockCall(codexMocks.spawn, 2)
    const secondChild = requireMockChildProcess(children[1] ?? null)
    if (!firstPreparation) {
      throw new Error('Expected the first process preparation to be admitted.')
    }

    await firstPreparation.cancelPending()
    expect(secondChild.signalCode).toBeNull()

    await initializeWarmTurn(
      secondChild,
      'thread-foreground-exact-preparation',
      'turn-foreground-exact-preparation',
    )
    secondChild.stdout.write(jsonLine({
      method: 'item/completed',
      params: {
        item: {
          id: 'assistant-foreground-exact-preparation',
          text: 'Foreground replacement answer',
          type: 'agentMessage',
        },
      },
    }))
    writeCompletedTurn(
      secondChild,
      'thread-foreground-exact-preparation',
      'turn-foreground-exact-preparation',
    )

    await expect(foregroundTurn).resolves.toMatchObject({
      finalMessage: 'Foreground replacement answer',
      sessionId: 'thread-foreground-exact-preparation',
    })
    expect(children).toHaveLength(2)
  })

  it('stops pending unclaimed preinitialization at the workspace boundary', async () => {
    const workingDirectory = await createTempDir('assistant-codex-preinitialize-boundary-work-')
    const codexHome = await createTempDir('assistant-codex-preinitialize-boundary-home-')
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = children.length + 1
      child.pid = 25_100 + children.length
      children.push(child)
      if (processNumber === 2) {
        queueMicrotask(() => {
          void (async () => {
            await initializeWarmTurn(
              child,
              'thread-after-preinitialize-boundary',
              'turn-after-preinitialize-boundary',
            )
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-after-preinitialize-boundary',
                  text: 'Fresh process answer',
                  type: 'agentMessage',
                },
              },
            }))
            writeCompletedTurn(
              child,
              'thread-after-preinitialize-boundary',
              'turn-after-preinitialize-boundary',
            )
          })()
        })
      }
      return child
    })

    const launchInput = {
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    }
    const preparation = await preinitializeCodexAppServer(launchInput)
    const pendingChild = requireMockChildProcess(children[0] ?? null)
    await waitForRpcMethod(pendingChild, 'initialize')
    if (!preparation) {
      throw new Error('Expected process preinitialization to be admitted.')
    }

    await expect(Promise.all([
      preparation.cancelPending(),
      waitForWarmCodexBackgroundWork(),
    ])).resolves.toEqual([undefined, undefined])
    expect(pendingChild.signalCode).toBe('SIGTERM')

    await expect(executeCodexAppServerTurn({
      ...launchInput,
      prompt: 'Start normally after the pending preparation was canceled.',
    })).resolves.toMatchObject({
      finalMessage: 'Fresh process answer',
      sessionId: 'thread-after-preinitialize-boundary',
    })
    expect(children).toHaveLength(2)
  })

  it('preserves invocation success after exact preinitialization exit is proven', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-preinitialize-proven-exit-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-preinitialize-proven-exit-home-',
    )
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_150
      children.push(child)
      return child
    })

    const preparation = await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    })
    const child = requireMockChildProcess(children[0] ?? null)
    await waitForRpcMethod(child, 'initialize')
    child.stdin.onEnd = () => {
      child.stdin.emit(
        'error',
        Object.assign(new Error('synthetic stdin close failure'), {
          code: 'EIO',
        }),
      )
    }

    expect(preparation).not.toBeNull()
    await expect(preparation?.cancelPending()).resolves.toBeUndefined()
    expect(child.signalCode).toBe('SIGTERM')
  })

  it('fails invocation release closed when preinitialization exit is unproven', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-preinitialize-unproven-exit-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-preinitialize-unproven-exit-home-',
    )
    const child = new MockChildProcess()
    child.pid = 25_175
    codexMocks.spawn.mockReturnValue(child)

    const preparation = await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    })
    await waitForRpcMethod(child, 'initialize')
    if (!preparation) {
      throw new Error('Expected process preinitialization to be admitted.')
    }

    vi.useFakeTimers()
    try {
      const cancellation = preparation.cancelPending()
      const cancellationError = cancellation.then(
        () => null,
        (error: unknown) => error,
      )
      await waitForProcessKillWithFakeTimers(-25_175, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(await cancellationError).toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(
        vi.mocked(process.kill).mock.calls
          .filter(
            ([pid, signal]) =>
              pid === -25_175 &&
              (signal === 'SIGTERM' || signal === 'SIGKILL'),
          )
          .map(([, signal]) => signal),
      ).toEqual(['SIGTERM', 'SIGKILL', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
  })

  it('blocks speculative publication while a workspace boundary tears down the prior process', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-boundary-first-preinitialize-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-boundary-first-preinitialize-home-',
    )
    const children: MockChildProcess[] = []
    const stopObserved = createDeferred<void>()
    const releaseStop = createDeferred<void>()

    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      const child = children.find(
        (candidate) => pid === -candidate.pid || pid === candidate.pid,
      )
      if (
        child &&
        signal === 'SIGTERM' &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        stopObserved.resolve(undefined)
        void releaseStop.promise.then(() => {
          child.emit('exit', null, signal)
          child.emit('close', null, signal)
        })
      }
      return true
    })
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_177 + children.length
      children.push(child)
      return child
    })

    await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-one' },
      workingDirectory,
    })

    const boundary = waitForWarmCodexBackgroundWork()
    await stopObserved.promise
    const replacement = preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-two' },
      workingDirectory,
    })

    expect(children).toHaveLength(1)
    releaseStop.resolve(undefined)

    const [replacementResult] = await Promise.all([replacement, boundary])
    expect(replacementResult).toBeNull()
    expect(children).toHaveLength(1)
  })

  it('blocks foreground publication while a workspace boundary tears down the prior process', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-boundary-first-foreground-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-boundary-first-foreground-home-',
    )
    const children: MockChildProcess[] = []
    const stopObserved = createDeferred<void>()
    const releaseStop = createDeferred<void>()

    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      const child = children.find(
        (candidate) => pid === -candidate.pid || pid === candidate.pid,
      )
      if (
        child &&
        signal === 'SIGTERM' &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        stopObserved.resolve(undefined)
        void releaseStop.promise.then(() => {
          child.emit('exit', null, signal)
          child.emit('close', null, signal)
        })
      }
      return true
    })
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = children.length + 1
      child.pid = 25_178 + children.length
      children.push(child)
      if (processNumber === 2) {
        queueMicrotask(() => {
          void (async () => {
            await initializeWarmTurn(
              child,
              'thread-boundary-first-foreground',
              'turn-boundary-first-foreground',
            )
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-boundary-first-foreground',
                  text: 'Unexpected replacement answer',
                  type: 'agentMessage',
                },
              },
            }))
            writeCompletedTurn(
              child,
              'thread-boundary-first-foreground',
              'turn-boundary-first-foreground',
            )
          })()
        })
      }
      return child
    })

    await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-one' },
      workingDirectory,
    })

    const boundary = waitForWarmCodexBackgroundWork()
    await stopObserved.promise
    const turn = executeCodexAppServerTurn({
      codexHome,
      env: { PATH: '/custom/bin-two' },
      prompt: 'Do not publish behind the active workspace boundary.',
      workingDirectory,
    })

    expect(children).toHaveLength(1)
    releaseStop.resolve(undefined)

    const results = await Promise.allSettled([turn, boundary])
    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
      },
    })
    expect(results[1]).toMatchObject({
      status: 'fulfilled',
    })
    expect(children).toHaveLength(1)
  })

  it('keeps a foreground replacement ahead of its queued workspace boundary', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-foreground-boundary-replacement-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-foreground-boundary-replacement-home-',
    )
    const children: MockChildProcess[] = []
    const firstStopObserved = createDeferred<void>()
    const releaseFirstStop = createDeferred<void>()

    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      const child = children.find(
        (candidate) => pid === -candidate.pid || pid === candidate.pid,
      )
      if (
        !child ||
        signal !== 'SIGTERM' ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        return true
      }
      if (child === children[0]) {
        firstStopObserved.resolve(undefined)
        void releaseFirstStop.promise.then(() => {
          child.emit('exit', null, signal)
          child.emit('close', null, signal)
        })
      } else {
        queueMicrotask(() => {
          child.emit('exit', null, signal)
          child.emit('close', null, signal)
        })
      }
      return true
    })
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = children.length + 1
      child.pid = 25_180 + children.length
      children.push(child)
      queueMicrotask(() => {
        void (async () => {
          if (processNumber === 1) {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            return
          }
          await initializeWarmTurn(
            child,
            'thread-foreground-boundary-replacement',
            'turn-foreground-boundary-replacement',
          )
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-foreground-boundary-replacement',
                text: 'Replacement answer',
                type: 'agentMessage',
              },
            },
          }))
          writeCompletedTurn(
            child,
            'thread-foreground-boundary-replacement',
            'turn-foreground-boundary-replacement',
          )
        })()
      })
      return child
    })

    await preinitializeCodexAppServer({
      codexHome,
      env: { PATH: '/custom/bin-one' },
      workingDirectory,
    })
    await waitForRpcMethod(
      requireMockChildProcess(children[0] ?? null),
      'initialized',
    )

    const replacementTurn = executeCodexAppServerTurn({
      codexHome,
      env: { PATH: '/custom/bin-two' },
      prompt: 'Replace the incompatible prepared process.',
      workingDirectory,
    })
    await firstStopObserved.promise
    const boundary = waitForWarmCodexBackgroundWork()
    void boundary.catch(() => undefined)
    releaseFirstStop.resolve(undefined)

    await expect(boundary).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
    })
    await expect(replacementTurn).resolves.toMatchObject({
      finalMessage: 'Replacement answer',
      sessionId: 'thread-foreground-boundary-replacement',
    })
    expect(children).toHaveLength(2)
  })

  it('falls back once when claimed speculative initialization fails', async () => {
    const workingDirectory = await createTempDir('assistant-codex-preinitialize-fallback-work-')
    const codexHome = await createTempDir('assistant-codex-preinitialize-fallback-home-')
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = children.length + 1
      child.pid = 25_200 + children.length
      children.push(child)
      if (processNumber === 2) {
        queueMicrotask(() => {
          void (async () => {
            await initializeWarmTurn(
              child,
              'thread-preinitialize-fallback',
              'turn-preinitialize-fallback',
            )
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-preinitialize-fallback',
                  text: 'Fallback answer',
                  type: 'agentMessage',
                },
              },
            }))
            writeCompletedTurn(
              child,
              'thread-preinitialize-fallback',
              'turn-preinitialize-fallback',
            )
          })()
        })
      }
      return child
    })

    const launchInput = {
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    }
    await preinitializeCodexAppServer(launchInput)
    const speculativeChild = requireMockChildProcess(children[0] ?? null)
    const initialize = await waitForRpcMethod(speculativeChild, 'initialize')
    const turn = executeCodexAppServerTurn({
      ...launchInput,
      prompt: 'Recover from the speculative startup failure.',
    })

    let claimed = false
    for (let attempt = 0; attempt < 200 && !claimed; attempt += 1) {
      const outcome = await compactWarmCodexThread({
        minThreadTokens: 1,
        timeoutMs: 1_000,
      })
      claimed = outcome.kind === 'skipped' && outcome.reason === 'turn_in_flight'
      if (!claimed) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    expect(claimed).toBe(true)
    speculativeChild.stdout.write(jsonLine({
      error: {
        code: -32_000,
        message: 'speculative initialize failed',
      },
      id: initialize.id,
    }))

    await expect(turn).resolves.toMatchObject({
      finalMessage: 'Fallback answer',
      sessionId: 'thread-preinitialize-fallback',
    })
    expect(children).toHaveLength(2)
    expect(children[0]?.signalCode).toBe('SIGTERM')
    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
  })

  it('rejects a ready-process claim while checking the workspace boundary', async () => {
    const workingDirectory = await createTempDir('assistant-codex-boundary-claim-work-')
    const codexHome = await createTempDir('assistant-codex-boundary-claim-home-')
    const children: MockChildProcess[] = []
    const boundaryRequestObserved = createDeferred<void>()
    const releaseBoundaryResponse = createDeferred<void>()
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_300
      children.push(child)
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-boundary-claim-one',
            turnId: 'turn-boundary-claim-one',
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-boundary-claim-one',
                text: 'First boundary answer',
                type: 'agentMessage',
              },
            },
          }))
          writeCompletedTurn(
            child,
            'thread-boundary-claim-one',
            'turn-boundary-claim-one',
          )

          const boundaryRequest = await waitForRpcMethod(
            child,
            'thread/backgroundTerminals/list',
          )
          boundaryRequestObserved.resolve(undefined)
          await releaseBoundaryResponse.promise
          child.stdout.write(jsonLine({
            id: boundaryRequest.id,
            result: {
              data: [],
              nextCursor: null,
            },
          }))

          await writeWarmTurnStarted({
            child,
            requestCount: 2,
            threadId: 'thread-boundary-claim-two',
            turnId: 'turn-boundary-claim-two',
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-boundary-claim-two',
                text: 'Second boundary answer',
                type: 'agentMessage',
              },
              turnId: 'turn-boundary-claim-two',
            },
          }))
          writeCompletedTurn(
            child,
            'thread-boundary-claim-two',
            'turn-boundary-claim-two',
          )
        })()
      })
      return child
    })

    const launchInput = {
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    }
    await preinitializeCodexAppServer(launchInput)
    await expect(executeCodexAppServerTurn({
      ...launchInput,
      prompt: 'Establish one completed turn before the boundary.',
    })).resolves.toMatchObject({
      finalMessage: 'First boundary answer',
    })

    const boundary = waitForWarmCodexBackgroundWork()
    await boundaryRequestObserved.promise
    await expect(waitForWarmCodexBackgroundWork()).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
    })
    await expect(executeCodexManagedAccountOperation({
      action: 'disconnect',
      codexHome,
      workingDirectory,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
    })
    await expect(executeCodexAppServerTurn({
      ...launchInput,
      prompt: 'Do not cross the active workspace boundary.',
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
    })

    releaseBoundaryResponse.resolve(undefined)
    await expect(boundary).resolves.toBeUndefined()
    await expect(executeCodexAppServerTurn({
      ...launchInput,
      prompt: 'Run after the workspace boundary releases.',
    })).resolves.toMatchObject({
      finalMessage: 'Second boundary answer',
    })
    expect(children).toHaveLength(1)
  })

  it('reuses the warm Codex app-server across stable local turns', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-warm-work-')
    const codexHome = await createTempDir('assistant-codex-local-warm-home-')
    const spawnedChildren: MockChildProcess[] = []

    codexMocks.spawn.mockImplementation((_command, args, options) => {
      const child = new MockChildProcess()
      spawnedChildren.push(child)

      expect(args).toEqual(['app-server'])
      expect(options).toMatchObject({
        cwd: tmpdir(),
        env: {
          CODEX_HOME: codexHome,
          PATH: '/custom/bin',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          expect(initialize.id).toBe(1)
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const firstThread = await waitForRpcMethodCount(child, 'thread/start', 1)
          expect(firstThread.id).toBe(2)
          child.stdout.write(jsonLine({
            id: firstThread.id,
            result: {
              thread: {
                id: 'thread-local-warm-1',
              },
            },
          }))

          const firstTurn = await waitForRpcMethodCount(child, 'turn/start', 1)
          expect(firstTurn.id).toBe(3)
          child.stdout.write(jsonLine({
            id: firstTurn.id,
            result: {
              turn: {
                id: 'turn-local-warm-1',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-warm-1', delta: 'First answer' },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-local-warm-1',
                type: 'agentMessage',
                text: 'First answer',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-warm-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          expect(secondThread.id).toBe(4)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-warm-2',
              },
            },
          }))

          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          expect(secondTurn.id).toBe(5)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-warm-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-warm-2', delta: 'Second answer', turnId: 'turn-local-warm-2' },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-local-warm-2',
                type: 'agentMessage',
                text: 'Second answer',
              },
              turnId: 'turn-local-warm-2',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-warm-2',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const stableInput = {
      approvalPolicy: 'never',
      codexHome,
      env: {
        PATH: '/custom/bin',
      },
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'First local warm turn',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'First answer',
      sessionId: 'thread-local-warm-1',
      turnId: 'turn-local-warm-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'Second local warm turn',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Second answer',
      sessionId: 'thread-local-warm-2',
      turnId: 'turn-local-warm-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(
      readWrittenRpcMessages(requireMockChildProcess(spawnedChildren[0] ?? null))
      .filter((message) => message.method === 'initialize'),
    ).toHaveLength(1)
  })

  it('reuses the warm Codex app-server when resolved local child env is unchanged', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-warm-stable-env-work-')
    const codexHome = await createTempDir('assistant-codex-local-warm-stable-env-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const baseInput = {
      approvalPolicy: 'never',
      codexHome,
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...baseInput,
        env: {
          PATH: '/custom/bin',
          CUSTOM_TOOL_SECRET: 'custom-tool-secret-stable',
          NODE_V8_COVERAGE: '/coverage-one',
        },
        prompt: 'first stable resolved child env turn',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-identity-1-1',
      turnId: 'turn-warm-identity-1-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...baseInput,
        env: {
          CUSTOM_TOOL_SECRET: 'custom-tool-secret-stable',
          NODE_V8_COVERAGE: '/coverage-two',
          PATH: '/custom/bin',
        },
        prompt: 'second stable resolved child env turn',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-identity-1-2',
      turnId: 'turn-warm-identity-1-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const messages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[0] ?? null),
    )
    expect(messages.filter((message) => message.method === 'initialize'))
      .toHaveLength(1)
    expect(messages.filter((message) => message.method === 'turn/start'))
      .toHaveLength(2)
  })

  it('keeps an output-only continuation on the resident Codex app-server', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-local-warm-thread-config-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-local-warm-thread-config-home-',
    )
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const baseInput = {
      approvalPolicy: 'never',
      codexHome,
      env: {
        PATH: '/custom/bin',
      },
      sandbox: 'read-only' as const,
      workingDirectory,
    }

    await expect(executeCodexAppServerTurn({
      ...baseInput,
      prompt: 'ordinary resident turn',
    })).resolves.toMatchObject({
      sessionId: 'thread-warm-identity-1-1',
    })

    const restrictedThreadConfig = {
      'features.apps': false,
      'features.browser_use': false,
      'features.enable_mcp_apps': false,
      'features.multi_agent': false,
      'features.multi_agent_v2': false,
      'features.plugins': false,
      'features.shell_tool': false,
      'features.standalone_web_search': false,
      'features.tool_suggest': false,
      'features.web_search_request': false,
      'memories.generate_memories': false,
      'memories.use_memories': false,
      web_search: 'disabled',
    } as const

    await expect(executeCodexAppServerTurn({
      ...baseInput,
      dynamicTools: [],
      ephemeral: true,
      prompt: 'assistant ask private continuation',
      threadConfig: restrictedThreadConfig,
    })).resolves.toMatchObject({
      sessionId: 'thread-warm-identity-1-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const launchArgs = codexMocks.spawn.mock.calls[0]?.[1] ?? []
    expect(launchArgs).not.toEqual(expect.arrayContaining([
      'features.shell_tool=false',
      'web_search="disabled"',
    ]))
    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    const threadStarts = readWrittenRpcMessages(child).filter(
      (message) => message.method === 'thread/start',
    )
    expect(threadStarts).toHaveLength(2)
    const restrictedThreadStart = asRecord(threadStarts[1]?.params)
    expect(restrictedThreadStart).toMatchObject({
      dynamicTools: [],
      ephemeral: true,
    })
    expect(restrictedThreadStart?.config).toEqual(restrictedThreadConfig)
    expect(process.kill).not.toHaveBeenCalled()
  })

  it('starts a fresh warm Codex app-server when local child env changes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-warm-noisy-work-')
    const codexHome = await createTempDir('assistant-codex-local-warm-noisy-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const baseInput = {
      approvalPolicy: 'never',
      codexHome,
      env: {
        ASSISTANT_MEMORY_BOUND_TURN_ID: 'ambient-turn-one',
        MURPH_LOCAL_TURN_SCOPED_TEST_ENV: 'turn-one',
        PATH: '/custom/bin',
      },
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...baseInput,
        prompt: 'first noisy local warm turn',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-identity-1-1',
      turnId: 'turn-warm-identity-1-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...baseInput,
        env: {
          ...baseInput.env,
          ASSISTANT_MEMORY_BOUND_TURN_ID: 'ambient-turn-two',
          MURPH_LOCAL_TURN_SCOPED_TEST_ENV: 'turn-two',
        },
        prompt: 'second noisy local warm turn',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-identity-2-1',
      turnId: 'turn-warm-identity-2-1',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(process.kill).toHaveBeenCalledWith(-40_000, 'SIGTERM')
    const firstMessages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[0] ?? null),
    )
    const secondMessages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[1] ?? null),
    )
    expect(firstMessages.filter((message) => message.method === 'turn/start'))
      .toHaveLength(1)
    expect(secondMessages.filter((message) => message.method === 'turn/start'))
      .toHaveLength(1)
  })

  it.each([
    {
      firstEnv: {
        PATH: '/custom/bin-one',
      },
      name: 'PATH',
      secondEnv: {
        PATH: '/custom/bin-two',
      },
    },
    {
      firstEnv: {
        PATH: '/custom/bin',
        VERCEL_AI_API_KEY: 'fixture-provider-key-one',
      },
      name: 'registered provider credential',
      secondEnv: {
        VERCEL_AI_API_KEY: 'fixture-provider-key-two',
      },
    },
    {
      firstEnv: {
        CODEX_API_KEY: 'fixture-codex-key-one',
        PATH: '/custom/bin',
      },
      name: 'Codex auth alias',
      secondEnv: {
        CODEX_API_KEY: 'fixture-codex-key-two',
      },
    },
    {
      firstEnv: {
        CODEX_ACCESS_TOKEN: 'fixture-codex-token-one',
        PATH: '/custom/bin',
      },
      name: 'Codex access-token alias',
      secondEnv: {
        CODEX_ACCESS_TOKEN: 'fixture-codex-token-two',
      },
    },
    {
      firstEnv: {
        CUSTOM_TOOL_SECRET: 'custom-tool-secret-one',
        PATH: '/custom/bin',
      },
      name: 'custom tool secret',
      secondEnv: {
        CUSTOM_TOOL_SECRET: 'custom-tool-secret-two',
      },
    },
  ] as const)(
    'starts a fresh warm Codex app-server when local child env changes: $name',
    async (scenario) => {
      const workingDirectory = await createTempDir('assistant-codex-local-warm-env-work-')
      const codexHome = await createTempDir('assistant-codex-local-warm-env-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockHostedCodexIdentityServer(spawnedChildren)

      const baseInput = {
        approvalPolicy: 'never',
        codexHome,
        env: scenario.firstEnv,
        sandbox: 'workspace-write' as const,
        workingDirectory,
      }

      await expect(
        executeCodexAppServerTurn({
          ...baseInput,
          prompt: 'first local child env turn',
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-warm-identity-1-1',
        turnId: 'turn-warm-identity-1-1',
      })

      await expect(
        executeCodexAppServerTurn({
          ...baseInput,
          env: {
            ...baseInput.env,
            ...scenario.secondEnv,
          },
          prompt: 'second local child env turn',
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-warm-identity-2-1',
        turnId: 'turn-warm-identity-2-1',
      })

      expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
      expect(process.kill).toHaveBeenCalledWith(-40_000, 'SIGTERM')
      const firstMessages = readWrittenRpcMessages(
        requireMockChildProcess(spawnedChildren[0] ?? null),
      )
      const secondMessages = readWrittenRpcMessages(
        requireMockChildProcess(spawnedChildren[1] ?? null),
      )
      expect(firstMessages.filter((message) => message.method === 'turn/start'))
        .toHaveLength(1)
      expect(secondMessages.filter((message) => message.method === 'turn/start'))
        .toHaveLength(1)
    },
  )

  it('rejects overlapping local turns without replacing the warm Codex app-server', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-busy-work-')
    const codexHome = await createTempDir('assistant-codex-local-busy-home-')
    const firstTurnStarted = createDeferred<void>()
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 26_250
      child = spawnedChild

      queueMicrotask(() => {
        void (async () => {
          try {
            const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
            spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

            await writeWarmTurnStarted({
              child: spawnedChild,
              requestCount: 1,
              threadId: 'thread-local-busy-1',
              turnId: 'turn-local-busy-1',
            })
            firstTurnStarted.resolve(undefined)
          } catch (error) {
            firstTurnStarted.reject(error)
          }
        })()
      })

      return spawnedChild
    })

    const stableInput = {
      approvalPolicy: 'never',
      codexHome,
      env: {
        PATH: '/custom/bin',
      },
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    const firstTurn = executeCodexAppServerTurn({
      ...stableInput,
      prompt: 'first local busy turn',
    })
    for (let attempt = 0; attempt < 200 && !child; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const spawnedChild = requireMockChildProcess(child)
    await waitForRpcMethod(spawnedChild, 'turn/start')
    await firstTurnStarted.promise

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second overlapping local busy turn',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
      context: {
        retryable: true,
      },
    })

    spawnedChild.stdout.write(jsonLine({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-local-busy-1',
          status: 'completed',
        },
      },
    }))

    await expect(firstTurn).resolves.toMatchObject({
      sessionId: 'thread-local-busy-1',
      turnId: 'turn-local-busy-1',
    })
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(readWrittenRpcMessages(spawnedChild).filter(
      (message) => message.method === 'turn/start',
    )).toHaveLength(1)
  })

  it('keeps restricted named permissions on fresh one-shot threads', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-restricted-permission-shape-',
    )

    await expect(executeCodexAppServerTurn({
      approvalPolicy: 'never',
      permissions: MURPH_MEMBER_READ_PERMISSION_PROFILE,
      prompt: 'must not resume with a restricted permission profile',
      resumeSessionId: 'thread-restricted-resume',
      runtimeWorkspaceRoots: [workingDirectory],
      workingDirectory,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      context: {
        invalidFields: ['resumeSessionId', 'ephemeral', 'processLifetime'],
        retryable: false,
      },
    })
    expect(codexMocks.spawn).not.toHaveBeenCalled()
  })

  it('runs one-shot permission turns beside the occupied warm process and proves exact child exit', async () => {
    const workingDirectory = await createTempDir('assistant-codex-one-shot-work-')
    const workspaceRoot = await createTempDir('assistant-codex-one-shot-root-')
    const codexHome = await createTempDir('assistant-codex-one-shot-home-')
    const children: MockChildProcess[] = []
    const completeWarmTurn = createDeferred<void>()
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 27_000 + children.length
      children.push(child)
      const childNumber = children.length

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          const params = asRecord(threadStart.params)
          const threadId = `thread-process-${childNumber}`
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              ...(params.permissions === 'murph-group-read'
                ? {
                    activePermissionProfile: {
                      id: 'murph-group-read',
                    },
                    approvalPolicy: 'never',
                    cwd: workingDirectory,
                    instructionSources: [],
                    runtimeWorkspaceRoots: [workspaceRoot],
                  }
                : {}),
              thread: {
                id: threadId,
              },
            },
          }))
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          const turnId = `turn-process-${childNumber}`
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: turnId,
              },
            },
          }))

          if (childNumber === 1) {
            await completeWarmTurn.promise
          }
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const warmTurn = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexHome,
      env: { PATH: '/custom/bin' },
      prompt: 'foreground group reply',
      sandbox: 'workspace-write',
      workingDirectory,
    })
    for (let attempt = 0; attempt < 200 && children.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const warmChild = requireMockChildProcess(children[0] ?? null)
    await waitForRpcMethod(warmChild, 'turn/start')

    const outputSchema = {
      properties: {
        answer: { type: 'string' },
      },
      type: 'object',
    }
    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        dynamicTools: [],
        env: { PATH: '/custom/bin' },
        ephemeral: true,
        outputSchema,
        permissions: 'murph-group-read',
        processLifetime: 'one-shot',
        prompt: 'private consultation',
        runtimeWorkspaceRoots: [workspaceRoot],
        threadConfig: {
          project_doc_max_bytes: 0,
        },
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-process-2',
      turnId: 'turn-process-2',
    })

    const oneShotChild = requireMockChildProcess(children[1] ?? null)
    expect(children).toHaveLength(2)
    expect(warmChild.exitCode).toBeNull()
    expect(oneShotChild.signalCode).toBe('SIGTERM')
    expect(process.kill).toHaveBeenCalledWith(-27_001, 'SIGTERM')
    expect(asRecord(
      (await waitForRpcMethod(oneShotChild, 'thread/start')).params,
    )).toMatchObject({
      approvalPolicy: 'never',
      cwd: workingDirectory,
      dynamicTools: [],
      ephemeral: true,
      permissions: 'murph-group-read',
      runtimeWorkspaceRoots: [workspaceRoot],
      config: {
        project_doc_max_bytes: 0,
      },
    })
    expect(asRecord(
      (await waitForRpcMethod(oneShotChild, 'turn/start')).params,
    )).toMatchObject({
      outputSchema,
    })

    completeWarmTurn.resolve()
    await expect(warmTurn).resolves.toMatchObject({
      sessionId: 'thread-process-1',
      turnId: 'turn-process-1',
    })
  })

  it('runs member-read check-ins through the real provider validator as fresh one-shot threads', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-member-read-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-member-read-home-',
    )
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 27_250
      children.push(child)
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              activePermissionProfile: {
                id: MURPH_MEMBER_READ_PERMISSION_PROFILE,
              },
              approvalPolicy: 'never',
              cwd: workingDirectory,
              instructionSources: [],
              runtimeWorkspaceRoots: [workingDirectory],
              thread: {
                id: 'thread-member-read-checkin',
              },
            },
          }))
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-member-read-checkin',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-member-read-checkin',
                text:
                  '{"kind":"skip","privateSummary":"No useful check-in now."}',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-member-read-checkin',
                status: 'completed',
              },
            },
          }))
        })()
      })
      return child
    })

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: {
        approvalPolicy: 'never',
        codexHome,
        provider: 'codex-cli',
        sandbox: 'read-only',
      },
      turn: {
        conversationHistoryMessages: [
          {
            content: 'I want to make weekday lunches easier.',
            role: 'user',
          },
          {
            content: 'We can keep that practical and low pressure.',
            role: 'assistant',
          },
        ],
        developerInstructions: 'Immutable member-read check-in policy.',
        dynamicTools: [],
        permissions: MURPH_MEMBER_READ_PERMISSION_PROFILE,
        processLifetime: 'one-shot',
        prompt: 'Offer one truthful, low-pressure choice point.',
        providerThreadEphemeral: true,
        resume: null,
        runtimeWorkspaceRoots: [workingDirectory],
        workingDirectory,
      },
    })

    expect(attempt.ok).toBe(true)
    expect(children).toHaveLength(1)
    const child = requireMockChildProcess(children[0] ?? null)
    const written = readWrittenRpcMessages(child)
    expect(written.some((message) => message.method === 'thread/resume')).toBe(
      false,
    )
    expect(written.filter((message) => message.method === 'thread/start')).toHaveLength(
      1,
    )
    expect(asRecord(
      (await waitForRpcMethod(child, 'thread/start')).params,
    )).toMatchObject({
      approvalPolicy: 'never',
      cwd: workingDirectory,
      dynamicTools: [],
      ephemeral: true,
      permissions: MURPH_MEMBER_READ_PERMISSION_PROFILE,
      runtimeWorkspaceRoots: [workingDirectory],
    })
    expect(asRecord(
      (await waitForRpcMethod(child, 'turn/start')).params,
    )).toMatchObject({
      input: expect.any(Array),
    })
    expect(child.signalCode).toBe('SIGTERM')
    expect(process.kill).toHaveBeenCalledWith(-27_250, 'SIGTERM')
  })

  it('starts fresh named-permission turns without response metadata', async () => {
    const workingDirectory = await createTempDir('assistant-codex-permission-work-')
    const workspaceRoot = await createTempDir('assistant-codex-permission-root-')
    const children: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(children)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 27_500
      children.push(child)
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              thread: {
                id: 'thread-permission-metadata-free',
              },
            },
          }))
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-permission-metadata-free',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-permission-metadata-free',
                text: 'Completed without response metadata.',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-permission-metadata-free',
                status: 'completed',
              },
            },
          }))
        })()
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        dynamicTools: [],
        ephemeral: true,
        permissions: 'murph-group-read',
        processLifetime: 'one-shot',
        prompt: 'continue without response metadata',
        runtimeWorkspaceRoots: [workspaceRoot],
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Completed without response metadata.',
      sessionId: 'thread-permission-metadata-free',
      turnId: 'turn-permission-metadata-free',
    })

    const child = requireMockChildProcess(children[0] ?? null)
    expect(asRecord(
      (await waitForRpcMethod(child, 'thread/start')).params,
    )).toMatchObject({
      approvalPolicy: 'never',
      cwd: workingDirectory,
      permissions: 'murph-group-read',
      runtimeWorkspaceRoots: [workspaceRoot],
    })
    expect(readWrittenRpcMessages(child).some(
      (message) => message.method === 'turn/start',
    )).toBe(true)
    expect(child.signalCode).toBe('SIGTERM')
  })

  it('rejects external warm stops while a local turn is running', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-stop-busy-work-')
    const codexHome = await createTempDir('assistant-codex-local-stop-busy-home-')
    const completeTurn = createDeferred<void>()
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 25_750
      child = spawnedChild

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-local-stop-busy',
            turnId: 'turn-local-stop-busy',
          })

          await completeTurn.promise
          spawnedChild.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-stop-busy', delta: 'Still completed' },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-stop-busy',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    const turn = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexHome,
      env: {
        PATH: '/custom/bin',
      },
      prompt: 'local turn active during external stop',
      sandbox: 'workspace-write',
      workingDirectory,
    })

    for (let attempt = 0; attempt < 200 && !child; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const spawnedChild = requireMockChildProcess(child)
    await waitForRpcMethod(spawnedChild, 'turn/start')

    await expect(stopWarmCodexAppServer('external-stop-during-turn'))
      .rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_BUSY',
        context: {
          retryable: true,
          state: 'running',
        },
      })
    expect(vi.mocked(process.kill)).not.toHaveBeenCalled()
    expect(spawnedChild.kill).not.toHaveBeenCalled()

    completeTurn.resolve()
    await expect(turn).resolves.toMatchObject({
      finalMessage: 'Still completed',
      sessionId: 'thread-local-stop-busy',
      turnId: 'turn-local-stop-busy',
    })
  })

  it('reuses the warm Codex app-server through provider turns with different local prompts', async () => {
    const workingDirectory = await createTempDir('assistant-codex-provider-local-warm-work-')
    const codexHome = await createTempDir('assistant-codex-provider-local-warm-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const providerConfig = normalizeAssistantProviderConfig({
      approvalPolicy: 'never',
      codexHome,
      provider: 'codex-cli',
      sandbox: 'workspace-write',
    })
    const baseInput = {
      developerInstructions: 'Stable Murph instructions.',
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
      env: {
        PATH: '/custom/bin',
      },
      providerConfig,
      systemPrompt: 'Stable Murph instructions.',
      turnContextPrompt: 'Current runtime context.',
      workingDirectory,
    }

    await expect(
      executeCodexAssistantTurnAttempt({
        ...baseInput,
        userPrompt: 'First ordinary local prompt',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    await expect(
      executeCodexAssistantTurnAttempt({
        ...baseInput,
        userPrompt: 'Second ordinary local prompt',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const messages = readWrittenRpcMessages(requireMockChildProcess(spawnedChildren[0] ?? null))
    const turnStarts = messages.filter((message) => message.method === 'turn/start')
    expect(turnStarts).toHaveLength(2)
    expect(readTurnStartInputItems(turnStarts[0] ?? {})[0]?.text)
      .toContain('First ordinary local prompt')
    expect(readTurnStartInputItems(turnStarts[1] ?? {})[0]?.text)
      .toContain('Second ordinary local prompt')
  })

  it('runs output-only provider work one-shot without evicting resident background work', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-provider-one-shot-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-provider-one-shot-home-',
    )
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const providerConfig = normalizeAssistantProviderConfig({
      approvalPolicy: 'never',
      codexHome,
      provider: 'codex-cli',
      sandbox: 'workspace-write',
    })
    const baseInput = {
      developerInstructions: 'Stable Murph instructions.',
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
      env: { PATH: '/custom/bin' },
      providerConfig,
      systemPrompt: 'Stable Murph instructions.',
      workingDirectory,
    }

    await expect(
      executeCodexAssistantTurnAttempt({
        ...baseInput,
        userPrompt: 'Start background enrichment and reply.',
      }),
    ).resolves.toMatchObject({ ok: true })

    const residentChild = requireMockChildProcess(spawnedChildren[0] ?? null)
    writeSubAgentActivity(
      residentChild,
      'thread-warm-identity-1-1',
      'thread-provider-background-child',
      'started',
      {
        agentPath: '/root/provider-background-child',
        id: 'spawn-provider-background-child',
        turnId: 'turn-warm-identity-1-1',
      },
    )
    writeStartedTurn(
      residentChild,
      'thread-provider-background-child',
      'turn-provider-background-child',
    )

    await expect(
      executeCodexAssistantTurnAttempt({
        ...baseInput,
        codexConfigOverrides: [
          'features.shell_tool=false',
          'features.apps=false',
        ],
        dynamicTools: [],
        processLifetime: 'one-shot',
        userPrompt: 'Format one detached system notification.',
      }),
    ).resolves.toMatchObject({ ok: true })

    const oneShotChild = requireMockChildProcess(spawnedChildren[1] ?? null)
    expect(spawnedChildren).toHaveLength(2)
    expect(residentChild.signalCode).toBeNull()
    expect(oneShotChild.signalCode).toBe('SIGTERM')
    expect(process.kill).not.toHaveBeenCalledWith(-40_000, 'SIGTERM')
    expect(process.kill).toHaveBeenCalledWith(-40_001, 'SIGTERM')
    const oneShotArgs = codexMocks.spawn.mock.calls[1]?.[1]
    expect(oneShotArgs).toEqual(
      expect.arrayContaining([
        'features.shell_tool=false',
        'features.apps=false',
      ]),
    )

    await expect(
      executeCodexAssistantTurnAttempt({
        ...baseInput,
        userPrompt: 'Run the next ordinary turn on the resident process.',
      }),
    ).resolves.toMatchObject({ ok: true })

    let boundaryResolved = false
    const boundary = waitForWarmCodexBackgroundWork().then(() => {
      boundaryResolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(boundaryResolved).toBe(false)

    writeCompletedTurn(
      residentChild,
      'thread-provider-background-child',
      'turn-provider-background-child',
    )
    await expect(boundary).resolves.toBeUndefined()
    expect(boundaryResolved).toBe(true)
    expect(residentChild.signalCode).toBeNull()
    expect(
      readWrittenRpcMessages(residentChild).filter(
        (message) => message.method === 'turn/start',
      ),
    ).toHaveLength(2)
    expect(spawnedChildren).toHaveLength(2)
  })

  it('keeps personal threads on the personal threshold when a group minimum is configured', async () => {
    const workingDirectory = await createTempDir('assistant-codex-personal-compact-threshold-work-')
    const codexHome = await createTempDir('assistant-codex-personal-compact-threshold-home-')
    const threadId = 'thread-personal-compact-threshold'
    const turnId = 'turn-personal-compact-threshold'
    const spawnedChildren: MockChildProcess[] = []

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          await initializeWarmTurn(child, threadId, turnId)
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 25_000,
                  inputTokens: 75_000,
                  outputTokens: 12,
                  totalTokens: 75_012,
                },
                total: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 25_000,
                  inputTokens: 75_000,
                  outputTokens: 12,
                  totalTokens: 75_012,
                },
                modelContextWindow: 128_000,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-personal-compact-threshold',
                text: 'Seeded personal thread below its threshold',
                type: 'agentMessage',
              },
            },
          }))
          writeCompletedTurn(child, threadId, turnId)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        groupConversation: false,
        prompt: 'seed personal compact threshold',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded personal thread below its threshold',
      sessionId: threadId,
      turnId,
    })

    await expect(
      compactWarmCodexThread({
        groupMinThreadTokens: 60_000,
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({
      kind: 'skipped',
      reason: 'below_threshold',
      threadContextTokensBefore: 75_000,
    })
    expect(
      readWrittenRpcMessages(
        requireMockChildProcess(spawnedChildren[0] ?? null),
      ).some((message) => message.method === 'thread/compact/start'),
    ).toBe(false)
  })

  it.each([
    ['active', false],
    ['completed but not yet checkpoint-scanned', true],
  ] as const)(
    'skips group compaction while a detached child is %s',
    async (_childState, completeChildBeforeRoot) => {
      const workingDirectory = await createTempDir(
        'assistant-codex-group-compact-detached-work-',
      )
      const codexHome = await createTempDir(
        'assistant-codex-group-compact-detached-home-',
      )
      const parentThreadId = 'thread-group-compact-detached-parent'
      const parentTurnId = 'turn-group-compact-detached-parent'
      const childThreadId = 'thread-group-compact-detached-child'
      const childTurnId = 'turn-group-compact-detached-child'
      const spawnedChildren: MockChildProcess[] = []

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            await initializeWarmTurn(child, parentThreadId, parentTurnId)
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: parentThreadId,
                turnId: parentTurnId,
                tokenUsage: {
                  last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                    cachedInputTokens: 25_000,
                    inputTokens: 75_000,
                    outputTokens: 12,
                    totalTokens: 75_012,
                  },
                  total: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                    cachedInputTokens: 25_000,
                    inputTokens: 75_000,
                    outputTokens: 12,
                    totalTokens: 75_012,
                  },
                  modelContextWindow: 128_000,
                },
              },
            }))
            writeSubAgentActivity(
              child,
              parentThreadId,
              childThreadId,
              'started',
              {
                agentPath: '/root/group-owned-background-work',
                id: 'spawn-group-compact-detached-child',
                turnId: parentTurnId,
              },
            )
            writeStartedTurn(child, childThreadId, childTurnId)
            if (completeChildBeforeRoot) {
              writeCompletedTurn(child, childThreadId, childTurnId)
            }
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-group-compact-detached',
                  text: 'The group reply completed before its detached work.',
                  type: 'agentMessage',
                },
                threadId: parentThreadId,
                turnId: parentTurnId,
              },
            }))
            writeCompletedTurn(child, parentThreadId, parentTurnId)
          })()
        })

        return child
      })

      await expect(
        executeCodexAppServerTurn({
          approvalPolicy: 'never',
          codexHome,
          env: { PATH: '/custom/bin' },
          groupConversation: true,
          prompt: 'reply while detached group work continues',
          sandbox: 'workspace-write',
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        finalMessage: 'The group reply completed before its detached work.',
        sessionId: parentThreadId,
        turnId: parentTurnId,
      })

      const residentChild = requireMockChildProcess(spawnedChildren[0] ?? null)
      await expect(
        compactWarmCodexThread({
          groupMinThreadTokens: 60_000,
          minThreadTokens: 100_000,
          timeoutMs: 5_000,
        }),
      ).resolves.toEqual({
        kind: 'skipped',
        reason: 'background_work_pending',
        threadContextTokensBefore: 75_000,
      })

      expect(
        readWrittenRpcMessages(residentChild).some(
          (message) =>
            message.method === 'config/read' ||
            message.method === 'thread/compact/start',
        ),
      ).toBe(false)
      expect(residentChild.signalCode).toBeNull()

      if (!completeChildBeforeRoot) {
        writeCompletedTurn(residentChild, childThreadId, childTurnId)
      }
      const boundary = waitForWarmCodexBackgroundWork()
      const scannedThreadIds: string[] = []
      for (let requestCount = 1; requestCount <= 2; requestCount += 1) {
        const request = await respondToBackgroundTerminals(
          residentChild,
          requestCount,
        )
        scannedThreadIds.push(String(asRecord(request.params).threadId))
      }
      await expect(boundary).resolves.toBeUndefined()
      expect(scannedThreadIds).toEqual([parentThreadId, childThreadId])
      expect(residentChild.signalCode).toBeNull()
      expect(spawnedChildren).toHaveLength(1)

      const childFreeCompaction = compactWarmCodexThread({
        groupMinThreadTokens: 60_000,
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      })
      const barrier = await waitForRpcMethod(residentChild, 'config/read')
      residentChild.stdout.write(jsonLine({ id: barrier.id, result: {} }))
      const compact = await waitForRpcMethod(
        residentChild,
        'thread/compact/start',
      )
      expect(asRecord(compact.params)).toEqual({
        threadId: parentThreadId,
      })
      residentChild.stdout.write(jsonLine({ id: compact.id, result: {} }))
      writeContextCompactionStarted({
        child: residentChild,
        itemId: 'context-group-compact-after-detached-boundary',
        threadId: parentThreadId,
      })
      residentChild.stdout.write(jsonLine({
        method: 'item/completed',
        params: {
          item: {
            id: 'context-group-compact-after-detached-boundary',
            type: 'contextCompaction',
          },
          threadId: parentThreadId,
        },
      }))

      await expect(childFreeCompaction).resolves.toMatchObject({
        kind: 'compacted',
        threadContextTokensBefore: 75_000,
        threadId: parentThreadId,
      })
      expect(residentChild.signalCode).toBeNull()
    },
  )

  it('compacts current-shape group usage and preserves pre-compaction attribution', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-provider-usage-work-')
    const codexHome = await createTempDir('assistant-codex-compact-provider-usage-home-')
    const threadId = 'thread-compact-provider-usage'
    const turnId = 'turn-compact-provider-usage'
    const spawnedChildren: MockChildProcess[] = []

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { reasoningOutputTokens: 0,
                  cachedInputTokens: 25_000,
                  inputTokens: 50_000,
                  outputTokens: 12,
                  totalTokens: 50_012,
                },
                total: { reasoningOutputTokens: 0,
                  cachedInputTokens: 25_000,
                  inputTokens: 50_000,
                  outputTokens: 12,
                  totalTokens: 50_012,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-provider-usage',
                type: 'agentMessage',
                text: 'Seeded before compact',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          writeContextCompactionStarted({
            child,
            itemId: 'context-compact-provider-usage',
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 24_000,
                  inputTokens: 125_000,
                  outputTokens: 700,
                  totalTokens: 125_700,
                },
                total: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 49_000,
                  inputTokens: 250_000,
                  outputTokens: 712,
                  totalTokens: 250_712,
                },
                modelContextWindow: 128_000,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 43_000,
                },
                total: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 49_000,
                  inputTokens: 250_000,
                  outputTokens: 712,
                  totalTokens: 250_712,
                },
                modelContextWindow: 128_000,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-provider-usage',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        groupConversation: true,
        prompt: 'seed compact provider usage',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before compact',
      sessionId: threadId,
      turnId,
    })

    await expect(
      compactWarmCodexThread({
        groupMinThreadTokens: 50_000,
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 50_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 50_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 50_000,
      },
    })
    expect(
      readWrittenRpcMessages(
        requireMockChildProcess(spawnedChildren[0] ?? null),
      ).filter((message) => message.method === 'thread/compact/start'),
    ).toHaveLength(1)
  })

  it('uses the pre-compaction estimate when the exact completion has no billing payload', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-explicit-usage-work-')
    const codexHome = await createTempDir('assistant-codex-compact-explicit-usage-home-')
    const threadId = 'thread-compact-explicit-usage'
    const turnId = 'turn-compact-explicit-usage'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 25_000,
                  inputTokens: 125_000,
                  outputTokens: 12,
                  totalTokens: 125_012,
                },
                total: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 25_000,
                  inputTokens: 125_000,
                  outputTokens: 12,
                  totalTokens: 125_012,
                },
                modelContextWindow: 128_000,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-explicit-usage',
                type: 'agentMessage',
                text: 'Seeded before explicit compact',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          writeContextCompactionStarted({
            child,
            itemId: 'context-compact-explicit-usage',
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-explicit-usage',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed compact explicit usage',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before explicit compact',
      sessionId: threadId,
      turnId,
    })

    await expect(
      compactWarmCodexThread({
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 125_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('keeps child-thread usage out of idle compaction thread selection', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-parent-vitals-work-')
    const codexHome = await createTempDir('assistant-codex-compact-parent-vitals-home-')
    const threadId = 'thread-compact-parent-vitals'
    const childThreadId = 'thread-compact-child-vitals'
    const turnId = 'turn-compact-parent-vitals'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId: childThreadId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 0,
                  inputTokens: 126_000,
                  outputTokens: 200,
                  totalTokens: 126_200,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-parent-vitals',
                type: 'agentMessage',
                text: 'Seeded parent before compact',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          writeContextCompactionStarted({
            child,
            itemId: 'context-compact-parent-vitals',
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 43_000,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-parent-vitals',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed parent compact vitals',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded parent before compact',
      sessionId: threadId,
      turnId,
    })

    await expect(
      compactWarmCodexThread({
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        inputTokens: 125_000,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('ignores stale compaction completions before compact rpc success', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-stale-completion-work-')
    const codexHome = await createTempDir('assistant-codex-compact-stale-completion-home-')
    const staleCompletionSent = createDeferred<void>()
    const releaseRealCompletion = createDeferred<void>()
    const threadId = 'thread-compact-stale-completion'
    const turnId = 'turn-compact-stale-completion'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-stale-completion',
                type: 'agentMessage',
                text: 'Seeded before stale completion',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 4_000,
                  inputTokens: 111_000,
                  outputTokens: 222,
                  totalTokens: 111_222,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-stale-completion',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
          staleCompletionSent.resolve()
          await releaseRealCompletion.promise
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          writeContextCompactionStarted({
            child,
            itemId: 'context-compact-real-completion',
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 43_000,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-real-completion',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed compact stale completion',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before stale completion',
      sessionId: threadId,
      turnId,
    })

    const outcome = compactWarmCodexThread({
      minThreadTokens: 100_000,
      timeoutMs: 5_000,
    })
    await staleCompletionSent.promise
    await expect(
      Promise.race([
        outcome.then(() => 'settled' as const),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
      ]),
    ).resolves.toBe('pending')

    releaseRealCompletion.resolve()
    await expect(outcome).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 125_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('accepts legacy thread compacted completion after compact rpc success', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-legacy-completion-work-')
    const codexHome = await createTempDir('assistant-codex-compact-legacy-completion-home-')
    const threadId = 'thread-compact-legacy-completion'
    const turnId = 'turn-compact-legacy-completion'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-legacy-completion',
                type: 'agentMessage',
                text: 'Seeded before legacy completion',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          child.stdout.write(jsonLine({
            method: 'thread/compacted',
            params: {
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed compact legacy completion',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before legacy completion',
      sessionId: threadId,
      turnId,
    })

    await expect(
      compactWarmCodexThread({
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 125_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('accepts context compaction start before compact rpc success', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-start-before-rpc-work-')
    const codexHome = await createTempDir('assistant-codex-compact-start-before-rpc-home-')
    const contextItemId = 'context-compact-start-before-rpc'
    const seedMessage = 'Seeded before start-before-rpc completion'
    const threadId = 'thread-compact-start-before-rpc'
    const turnId = 'turn-compact-start-before-rpc'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: `${contextItemId}-assistant`,
                type: 'agentMessage',
                text: seedMessage,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          writeContextCompactionStarted({
            child,
            itemId: contextItemId,
            threadId,
          })
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: contextItemId,
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: `seed compact ${contextItemId}`,
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: seedMessage,
      sessionId: threadId,
      turnId,
    })

    await expect(
      compactWarmCodexThread({
        minThreadTokens: 100_000,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 125_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('accepts matching context compaction completion after start before compact rpc success', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-complete-before-rpc-work-')
    const codexHome = await createTempDir('assistant-codex-compact-complete-before-rpc-home-')
    const completionSent = createDeferred<void>()
    const releaseRpcSuccess = createDeferred<void>()
    const contextItemId = 'context-compact-complete-before-rpc'
    const seedMessage = 'Seeded before complete-before-rpc completion'
    const threadId = 'thread-compact-complete-before-rpc'
    const turnId = 'turn-compact-complete-before-rpc'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: `${contextItemId}-assistant`,
                type: 'agentMessage',
                text: seedMessage,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          writeContextCompactionStarted({
            child,
            itemId: contextItemId,
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: contextItemId,
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
          completionSent.resolve()
          await releaseRpcSuccess.promise
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: `seed compact ${contextItemId}`,
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: seedMessage,
      sessionId: threadId,
      turnId,
    })

    const outcome = compactWarmCodexThread({
      minThreadTokens: 100_000,
      timeoutMs: 5_000,
    })
    await completionSent.promise
    await expect(
      Promise.race([
        outcome.then(() => 'settled' as const),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
      ]),
    ).resolves.toBe('pending')

    releaseRpcSuccess.resolve()
    await expect(outcome).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 125_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('ignores stale compaction completions after compact rpc success before current start', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-stale-after-rpc-work-')
    const codexHome = await createTempDir('assistant-codex-compact-stale-after-rpc-home-')
    const staleCompletionSent = createDeferred<void>()
    const releaseRealCompletion = createDeferred<void>()
    const threadId = 'thread-compact-stale-after-rpc'
    const turnId = 'turn-compact-stale-after-rpc'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-stale-after-rpc',
                type: 'agentMessage',
                text: 'Seeded before stale after rpc',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          const barrier = await waitForRpcMethod(child, 'config/read')
          child.stdout.write(jsonLine({ id: barrier.id, result: {} }))
          const compact = await waitForRpcMethod(child, 'thread/compact/start')
          expect(asRecord(compact.params)).toEqual({ threadId })
          child.stdout.write(jsonLine({ id: compact.id, result: {} }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-stale-after-rpc',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
          staleCompletionSent.resolve()
          await releaseRealCompletion.promise
          writeContextCompactionStarted({
            child,
            itemId: 'context-compact-real-after-rpc',
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'context-compact-real-after-rpc',
                type: 'contextCompaction',
              },
              threadId,
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed compact stale after rpc',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before stale after rpc',
      sessionId: threadId,
      turnId,
    })

    const outcome = compactWarmCodexThread({
      minThreadTokens: 100_000,
      timeoutMs: 5_000,
    })
    await staleCompletionSent.promise
    await expect(
      Promise.race([
        outcome.then(() => 'settled' as const),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
      ]),
    ).resolves.toBe('pending')

    releaseRealCompletion.resolve()
    await expect(outcome).resolves.toMatchObject({
      kind: 'compacted',
      threadContextTokensBefore: 125_000,
      threadId,
      usage: {
        cachedInputTokens: null,
        inputTokens: 125_000,
        outputTokens: null,
        source: 'estimated',
        totalTokens: 125_000,
      },
    })
  })

  it('does not submit idle compaction after abort while the config barrier is pending', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-abort-barrier-work-')
    const codexHome = await createTempDir('assistant-codex-compact-abort-barrier-home-')
    const barrierReady = createDeferred<Record<string, unknown>>()
    const releaseProcessClose = createDeferred<void>()
    const threadId = 'thread-compact-abort-barrier'
    const turnId = 'turn-compact-abort-barrier'
    const spawnedChildren: MockChildProcess[] = []
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      const child = spawnedChildren.find(
        (candidate) => pid === -candidate.pid || pid === candidate.pid,
      )
      if (
        child &&
        (signal === 'SIGTERM' || signal === 'SIGKILL') &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        void releaseProcessClose.promise.then(() => {
          child.emit('exit', null, signal)
          child.emit('close', null, signal)
        })
      }
      return true
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_650 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId,
            turnId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: { cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
                  cachedInputTokens: 10_000,
                  inputTokens: 125_000,
                  outputTokens: 100,
                  totalTokens: 125_100,
                },
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-abort-barrier',
                type: 'agentMessage',
                text: 'Seeded before abort barrier',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: turnId,
                status: 'completed',
              },
            },
          }))

          if (spawnedChildren[0] === child) {
            barrierReady.resolve(await waitForRpcMethod(child, 'config/read'))
          }
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed compact abort barrier',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before abort barrier',
      sessionId: threadId,
      turnId,
    })

    const abortController = new AbortController()
    const outcome = compactWarmCodexThread({
      minThreadTokens: 100_000,
      signal: abortController.signal,
      timeoutMs: 5_000,
    })
    const barrier = await barrierReady.promise
    abortController.abort()
    spawnedChildren[0]!.stdout.write(jsonLine({ id: barrier.id, result: {} }))

    await expect(
      Promise.race([
        outcome.then(() => 'settled' as const),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
      ]),
    ).resolves.toBe('pending')
    expect(process.kill).toHaveBeenCalledWith(-25_650, 'SIGTERM')
    releaseProcessClose.resolve()

    await expect(outcome).resolves.toMatchObject({
      kind: 'failed',
      reason: 'aborted',
      threadContextTokensBefore: 125_000,
      threadId,
    })

    expect(
      readWrittenRpcMessages(spawnedChildren[0]!).some(
        (message) => message.method === 'thread/compact/start',
      ),
    ).toBe(false)

    const replacementTrace = vi.fn()
    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        onTraceEvent: replacementTrace,
        prompt: 'turn after failed idle compaction',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: threadId,
      turnId,
    })
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-idle-compaction-failure',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  })
