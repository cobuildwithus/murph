import {
  cliTimingLaunchArgs,
  MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
  MockChildProcess,
  asRecord,
  codexMocks,
  codexSandboxPolicyForMode,
  createDeferred,
  createErrnoException,
  createTempDir,
  emitProcessErrorAndExit,
  executeCodexAppServerTurn,
  jsonLine,
  mockProcessGroupSignalsForChildren,
  readLocalImagePath,
  readTurnStartInputItems,
  readWrittenRpcMessages,
  requireMockChildProcess,
  waitForMockCall,
  waitForProcessKillWithFakeTimers,
  waitForRpcMessages,
  waitForRpcMethod,
  waitForRpcMethodCount,
  waitForRpcResponse,
  waitForStableMicrotask,
  writeCodexV2AssistantEventTurn,
  writeCompletedTurn,
  writeWarmTurnStarted,
} from "./assistant-codex-runtime.harness.ts";

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  MURPH_MEMBER_READ_PERMISSION_PROFILE,
  MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
} from '@murphai/hosted-execution/assistant-permissions'
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
import type {
  CodexAppServerLiveTurn,
  CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import {
  GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'

describe('assistant codex runtime', () => {it('handles current Codex v2 turn-tagged assistant events across warm turns', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-v2-events-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-v2-events-work-')
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 21_500
      child = spawnedChild

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-v2-events-one',
            turnId: 'turn-v2-events-one',
          })
          writeCodexV2AssistantEventTurn({
            child: spawnedChild,
            finalMessage: 'First warm answer.',
            threadId: 'thread-v2-events-one',
            turnId: 'turn-v2-events-one',
          })
          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
            threadId: 'thread-v2-events-two',
            turnId: 'turn-v2-events-two',
          })
          writeCodexV2AssistantEventTurn({
            child: spawnedChild,
            finalMessage: 'Second warm answer.',
            threadId: 'thread-v2-events-two',
            turnId: 'turn-v2-events-two',
          })
        })()
      })

      return spawnedChild
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'first v2 event turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'First warm answer.',
      turnId: 'turn-v2-events-one',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'second v2 event turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Second warm answer.',
      turnId: 'turn-v2-events-two',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(readWrittenRpcMessages(requireMockChildProcess(child))
      .filter((message) => message.method === 'turn/start'))
      .toHaveLength(2)
  })

  it('denies known unsupported warm server requests without turn ids', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-unsupported-request-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-unsupported-request-work-')
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 22_500
      child = spawnedChild

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-unsupported-request',
            turnId: 'turn-unsupported-request',
          })
          spawnedChild.stdout.write(jsonLine({
            id: 99,
            method: 'approval/request',
            params: {
              reason: 'unsupported request shape',
            },
          }))

          const messages = await waitForRpcMessages(spawnedChild, 5)
          expect(messages[4]).toEqual({
            id: 99,
            error: {
              code: -32000,
              message:
                'Murph does not support interactive Codex app-server request approval/request in noninteractive assistant turns.',
            },
          })

          writeCompletedTurn(
            spawnedChild,
            'thread-unsupported-request',
            'turn-unsupported-request',
          )
        })()
      })

      return spawnedChild
    })

    await expect(
      executeCodexAppServerTurn({
        env: {
          CODEX_HOME: hostedCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          NODE_ENV: 'test',
          PATH: '/usr/bin',
        },
        prompt: 'unsupported request without turn id',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      turnId: 'turn-unsupported-request',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(requireMockChildProcess(child).killed).toBe(false)
  })

  it('keeps warm Codex when idle notifications arrive outside an active turn', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-off-turn-output-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-off-turn-output-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 23_500 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-off-turn-one',
            turnId: 'turn-off-turn-one',
          })
          writeCompletedTurn(
            spawnedChild,
            'thread-off-turn-one',
            'turn-off-turn-one',
          )
          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
            threadId: 'thread-off-turn-two',
            turnId: 'turn-off-turn-two',
          })
          writeCompletedTurn(
            spawnedChild,
            'thread-off-turn-two',
            'turn-off-turn-two',
          )
        })()
      })

      return spawnedChild
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'first off-turn output turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      turnId: 'turn-off-turn-one',
    })

    spawnedChildren[0]!.stdout.write(jsonLine({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread-off-turn-one',
      },
    }))
    spawnedChildren[0]!.stdout.write(jsonLine({
      id: 99,
      method: 'approval/request',
      params: {
        reason: 'idle request outside a parent turn',
      },
    }))
    await expect(
      waitForRpcResponse(spawnedChildren[0]!, 99),
    ).resolves.toMatchObject({
      error: {
        code: -32000,
        message: 'Server requests outside an active Codex turn are not supported.',
      },
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'second off-turn output turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      turnId: 'turn-off-turn-two',
    })
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(process.kill).not.toHaveBeenCalledWith(-spawnedChildren[0]!.pid, 'SIGTERM')
  })

  it('keeps the warm Codex app-server process when explicit per-thread model settings change', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-thread-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-thread-work-')
    const spawnedChildren: MockChildProcess[] = []

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 30_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const firstThread = await waitForRpcMethodCount(spawnedChild, 'thread/start', 1)
          spawnedChild.stdout.write(jsonLine({
            id: firstThread.id,
            result: {
              thread: {
                id: 'thread-warm-config-1',
              },
            },
          }))

          const firstTurn = await waitForRpcMethodCount(spawnedChild, 'turn/start', 1)
          spawnedChild.stdout.write(jsonLine({
            id: firstTurn.id,
            result: {
              turn: {
                id: 'turn-warm-config-1',
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-warm-config-1',
                status: 'completed',
              },
            },
          }))
          const secondThread = await waitForRpcMethodCount(spawnedChild, 'thread/start', 2)
          spawnedChild.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-warm-config-2',
              },
            },
          }))

          const secondTurn = await waitForRpcMethodCount(spawnedChild, 'turn/start', 2)
          spawnedChild.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-warm-config-2',
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-warm-config-2',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        model: 'gpt-thread-first',
        modelProvider: 'openai',
        prompt: 'first thread launch',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-config-1',
      turnId: 'turn-warm-config-1',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        model: 'gpt-thread-second',
        modelProvider: 'venice',
        prompt: 'second thread launch',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-config-2',
      turnId: 'turn-warm-config-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const messages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[0] ?? null),
    )
    const threadStarts = messages.filter((message) => message.method === 'thread/start')
    expect(messages.filter((message) => message.method === 'initialize'))
      .toHaveLength(1)
    expect(threadStarts).toHaveLength(2)
    expect(asRecord(threadStarts[0]?.params)).toMatchObject({
      model: 'gpt-thread-first',
      modelProvider: 'openai',
    })
    expect(asRecord(threadStarts[1]?.params)).toMatchObject({
      model: 'gpt-thread-second',
      modelProvider: 'venice',
    })
  })

  it('resumes personalization on the reused warm Codex app-server process', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-personalization-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-personalization-work-')
    const spawnedChildren: MockChildProcess[] = []
    const personalizationDynamicTools = resolveMurphDynamicTools({
      personalizationAvailable: true,
    })
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const firstThread = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: firstThread.id,
            result: { thread: { id: 'thread-warm-personalization' } },
          }))
          const firstTurn = await waitForRpcMethodCount(child, 'turn/start', 1)
          child.stdout.write(jsonLine({
            id: firstTurn.id,
            result: { turn: { id: 'turn-warm-personalization-1' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-warm-personalization-1',
                status: 'completed',
              },
            },
          }))
          const resumedThread = await waitForRpcMethod(child, 'thread/resume')
          const resumedThreadParams = asRecord(resumedThread.params)
          child.stdout.write(jsonLine({
            id: resumedThread.id,
            result: {
              approvalPolicy: resumedThreadParams.approvalPolicy,
              cwd: resumedThreadParams.cwd,
              thread: { id: 'thread-warm-personalization' },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: { turn: { id: 'turn-warm-personalization-2' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-warm-personalization-2',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(executeCodexAppServerTurn({
      dynamicTools: personalizationDynamicTools,
      env: hostedEnv,
      prompt: 'start warm personalization',
      workingDirectory,
    })).resolves.toMatchObject({
      sessionId: 'thread-warm-personalization',
      turnId: 'turn-warm-personalization-1',
    })

    await expect(executeCodexAppServerTurn({
      dynamicTools: personalizationDynamicTools,
      env: hostedEnv,
      prompt: 'resume warm personalization',
      resumeSessionId: 'thread-warm-personalization',
      workingDirectory,
    })).resolves.toMatchObject({
      sessionId: 'thread-warm-personalization',
      turnId: 'turn-warm-personalization-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const messages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[0] ?? null),
    )
    expect(messages.filter((message) => message.method === 'thread/resume'))
      .toHaveLength(1)
    expect(messages.some(
      (message) => message.method === 'thread/backgroundTerminals/clean',
    )).toBe(false)
    expect(asRecord(messages.find((message) => message.method === 'thread/start')?.params))
      .toMatchObject({
        dynamicTools: expect.arrayContaining([
          expect.objectContaining({
            name: 'personalization',
            namespace: 'murph',
          }),
        ]),
      })
  })

  it('uses native Codex resume for personalization on a cold app-server', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-cold-personalization-home-')
    const workingDirectory = await createTempDir('assistant-codex-cold-personalization-work-')
    const spawnedChildren: MockChildProcess[] = []
    const personalizationDynamicTools = resolveMurphDynamicTools({
      personalizationAvailable: true,
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const resumedThread = await waitForRpcMethod(child, 'thread/resume')
          const resumedParams = asRecord(resumedThread.params)
          child.stdout.write(jsonLine({
            id: resumedThread.id,
            result: {
              approvalPolicy: resumedParams.approvalPolicy,
              cwd: resumedParams.cwd,
              thread: { id: 'thread-cold-personalization-old' },
            },
          }))
          const turn = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turn.id,
            result: { turn: { id: 'turn-cold-personalization' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-cold-personalization',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      dynamicTools: personalizationDynamicTools,
      env: {
        CODEX_HOME: hostedCodexHome,
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        NODE_ENV: 'test',
        PATH: '/usr/bin',
      },
      prompt: 'Update my tone.',
      resumeSessionId: 'thread-cold-personalization-old',
      workingDirectory,
    })).resolves.toMatchObject({
      sessionId: 'thread-cold-personalization-old',
      turnId: 'turn-cold-personalization',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const messages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[0] ?? null),
    )
    expect(messages.filter((message) => message.method === 'thread/resume'))
      .toHaveLength(1)
    expect(messages.filter((message) => message.method === 'thread/start'))
      .toHaveLength(0)
    expect(asRecord(messages.find((message) => message.method === 'turn/start')?.params))
      .toMatchObject({
        input: [{
          text: 'Update my tone.',
          type: 'text',
        }],
      })
  })

  it('starts a fresh warm Codex app-server when process config overrides change', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-config-overrides-home-')
    const workingDirectory = await createTempDir('assistant-codex-config-overrides-work-')
    const firstConfigOverrides = [
      'model_providers.internal.name="Internal"',
      'model_providers.internal.base_url="https://one.example.test/v1"',
      'model_providers.internal.env_key="INTERNAL_API_KEY"',
      'model_providers.internal.wire_api="responses"',
      'model_providers.internal.requires_openai_auth=false',
    ]
    const secondConfigOverrides = [
      'model_providers.internal.name="Internal"',
      'model_providers.internal.base_url="https://two.example.test/v1"',
      'model_providers.internal.env_key="INTERNAL_API_KEY"',
      'model_providers.internal.wire_api="responses"',
      'model_providers.internal.requires_openai_auth=false',
    ]

    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      let turnCount = 0
      child.pid = 30_600 + spawnedChildren.length
      spawnedChildren.push(child)

      child.stdin.onWrite = (write) => {
        for (const line of write.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) {
            continue
          }

          const message = asRecord(JSON.parse(trimmed))
          queueMicrotask(() => {
            switch (message.method) {
              case 'initialize':
                child.stdout.write(jsonLine({ id: message.id, result: {} }))
                break
              case 'thread/start':
              case 'thread/resume': {
                const params = asRecord(message.params)
                const responseThreadId = message.method === 'thread/resume'
                  ? String(params.threadId)
                  : `thread-provider-table-${processNumber}`
                child.stdout.write(jsonLine({
                  id: message.id,
                  result: {
                    approvalPolicy: params.approvalPolicy,
                    cwd: params.cwd,
                    model: params.model,
                    modelProvider: params.modelProvider,
                    thread: {
                      id: responseThreadId,
                    },
                  },
                }))
                break
              }
              case 'turn/start':
                turnCount += 1
                child.stdout.write(jsonLine({
                  id: message.id,
                  result: {
                    turn: {
                      id: `turn-provider-table-${processNumber}-${turnCount}`,
                    },
                  },
                }))
                child.stdout.write(jsonLine({
                  method: 'turn/completed',
                  params: {
                    turn: {
                      id: `turn-provider-table-${processNumber}-${turnCount}`,
                      status: 'completed',
                    },
                  },
                }))
                break
            }
          })
        }
      }

      return child
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      INTERNAL_API_KEY: 'test-key',
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        configOverrides: firstConfigOverrides,
        model: 'gpt-provider-table',
        modelProvider: 'internal',
        prompt: 'first config override launch',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-provider-table-1',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        configOverrides: secondConfigOverrides,
        model: 'gpt-provider-table',
        modelProvider: 'internal',
        prompt: 'second config override launch',
        resumeSessionId: 'thread-provider-table-1',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-provider-table-1',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
  })

  it('does not clear or replace a stale warm Codex process when stop cannot prove exit', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-stop-fail-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-stop-fail-work-')
    const spawnedChildren: MockChildProcess[] = []
    const offSpy = vi.spyOn(process, 'off')

    vi.mocked(process.kill).mockImplementation(() => true)
    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 31_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const thread = await waitForRpcMethod(spawnedChild, 'thread/start')
          const processNumber = spawnedChildren.length
          spawnedChild.stdout.write(jsonLine({
            id: thread.id,
            result: {
              thread: {
                id: `thread-warm-stop-fail-${processNumber}`,
              },
            },
          }))

          const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(jsonLine({
            id: turn.id,
            result: {
              turn: {
                id: `turn-warm-stop-fail-${processNumber}`,
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-warm-stop-fail-${processNumber}`,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'first stop failure launch',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-stop-fail-1',
      turnId: 'turn-warm-stop-fail-1',
    })

    vi.useFakeTimers()
    try {
      const externalStop = stopWarmCodexAppServer('operator-stop')
      const externalStopError = externalStop.then(
        () => null,
        (error: unknown) => error,
      )
      await waitForProcessKillWithFakeTimers(-31_000, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(await externalStopError).toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
      vi.mocked(process.kill).mockClear()

      const replacementAttempt = executeCodexAppServerTurn({
        env: {
          ...hostedEnv,
          PATH: '/usr/local/bin',
        },
        prompt: 'second stop failure launch',
        workingDirectory,
      })
      const replacementError = replacementAttempt.then(
        () => null,
        (error: unknown) => error,
      )
      await waitForProcessKillWithFakeTimers(-31_000, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(await replacementError).toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
    } finally {
      vi.useRealTimers()
    }

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(process.kill).toHaveBeenCalledWith(-31_000, 'SIGTERM')
    expect(process.kill).toHaveBeenCalledWith(-31_000, 'SIGKILL')
    expect(
      offSpy.mock.calls.some(
        ([eventName]) =>
          eventName === 'exit' ||
          eventName === 'SIGINT' ||
          eventName === 'SIGTERM',
      ),
    ).toBe(false)
  })

  it('poisons warm Codex when an aborted turn later completes', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-abort-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-abort-work-')
    const controller = new AbortController()
    const spawnedChildren: MockChildProcess[] = []

    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      const child = spawnedChildren.find((candidate) => pid === -candidate.pid)
      if (child && signal === 'SIGTERM') {
        queueMicrotask(() => {
          child.emit('exit', null, signal)
          child.emit('close', null, signal)
        })
      }
      return true
    })

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 20_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const thread = await waitForRpcMethod(spawnedChild, 'thread/start')
          const threadId = spawnedChildren.length === 1
            ? 'thread-warm-abort-one'
            : 'thread-warm-abort-two'
          const turnId = spawnedChildren.length === 1
            ? 'turn-warm-abort-one'
            : 'turn-warm-abort-two'
          spawnedChild.stdout.write(jsonLine({
            id: thread.id,
            result: {
              thread: {
                id: threadId,
              },
            },
          }))

          const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(jsonLine({
            id: turn.id,
            result: {
              turn: {
                id: turnId,
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: turnId,
              },
            },
          }))

          if (spawnedChildren.length === 1) {
            controller.abort()
            const interrupt = await waitForRpcMethod(spawnedChild, 'turn/interrupt')
            spawnedChild.stdout.write(jsonLine({
              id: interrupt.id,
              result: {},
            }))
          }

          spawnedChild.stdout.write(jsonLine({
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

      return spawnedChild
    })

    const hostedEnv = {
      CODEX_HOME: hostedCodexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        abortSignal: controller.signal,
        env: hostedEnv,
        prompt: 'aborted but completed',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-abort-one',
      turnId: 'turn-warm-abort-one',
    })

    const replacementTrace = vi.fn()

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        onTraceEvent: replacementTrace,
        prompt: 'next turn after abort',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-abort-two',
      turnId: 'turn-warm-abort-two',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-turn-abort',
          codexTimingStage: 'initialized',
        }),
      }),
    )
    expect(process.kill).toHaveBeenCalledWith(-20_000, 'SIGINT')
    expect(process.kill).toHaveBeenCalledWith(-20_000, 'SIGTERM')
  })

  it.each([
    {
      expectedColdStartReason: 'previous-turn-abort',
      liveInterruptRequested: false,
      pidBase: 21_000,
      slug: 'warm-abort-timeout',
      trigger: 'an aborted turn',
    },
    {
      expectedColdStartReason: 'previous-turn-failure',
      liveInterruptRequested: true,
      pidBase: 22_000,
      slug: 'warm-live-interrupt-timeout',
      trigger: 'a live interrupt',
    },
  ])(
    'rejects and frees the warm slot when $trigger never completes',
    async ({ expectedColdStartReason, liveInterruptRequested, pidBase, slug }) => {
      const hostedCodexHome = await createTempDir(`assistant-codex-${slug}-home-`)
      const workingDirectory = await createTempDir(`assistant-codex-${slug}-work-`)
      const controller = new AbortController()
      const interruptSeen = createDeferred<void>()
      const liveTurnReady = createDeferred<CodexAppServerLiveTurn>()
      const spawnedChildren: MockChildProcess[] = []

      vi.mocked(process.kill).mockImplementation((pid, signal) => {
        const child = spawnedChildren.find((candidate) => pid === -candidate.pid)
        if (child && signal === 'SIGTERM') {
          queueMicrotask(() => {
            child.emit('exit', null, signal)
            child.emit('close', null, signal)
          })
        }
        return true
      })

      codexMocks.spawn.mockImplementation(() => {
        const spawnedChild = new MockChildProcess()
        spawnedChild.pid = pidBase + spawnedChildren.length
        spawnedChildren.push(spawnedChild)
        const processNumber = spawnedChildren.length

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
            spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

            const thread = await waitForRpcMethod(spawnedChild, 'thread/start')
            spawnedChild.stdout.write(jsonLine({
              id: thread.id,
              result: {
                thread: {
                  id: `thread-${slug}-${processNumber}`,
                },
              },
            }))

            const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
            spawnedChild.stdout.write(jsonLine({
              id: turn.id,
              result: {
                turn: {
                  id: `turn-${slug}-${processNumber}`,
                },
              },
            }))
            spawnedChild.stdout.write(jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: `turn-${slug}-${processNumber}`,
                },
              },
            }))

            if (processNumber === 1) {
              const interrupt = await waitForRpcMethod(spawnedChild, 'turn/interrupt')
              interruptSeen.resolve()
              spawnedChild.stdout.write(jsonLine({
                id: interrupt.id,
                result: {},
              }))
              return
            }

            spawnedChild.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: `turn-${slug}-${processNumber}`,
                  status: 'completed',
                },
              },
            }))
          })()
        })

        return spawnedChild
      })

      const hostedEnv = {
        CODEX_HOME: hostedCodexHome,
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        NODE_ENV: 'test',
        PATH: '/usr/bin',
      }

      const timedOutTurn = executeCodexAppServerTurn({
        abortSignal: liveInterruptRequested ? undefined : controller.signal,
        env: hostedEnv,
        onLiveTurn: (turn) => {
          liveTurnReady.resolve(turn)
        },
        prompt: 'interrupt without completion',
        workingDirectory,
      })
      void timedOutTurn.catch(() => undefined)

      const liveTurn = await liveTurnReady.promise

      try {
        vi.useFakeTimers()
        const interruptPromise = liveInterruptRequested ? liveTurn.interrupt() : null
        if (!liveInterruptRequested) {
          controller.abort()
        }
        await vi.advanceTimersByTimeAsync(1)
        await interruptSeen.promise
        if (interruptPromise) {
          await interruptPromise
          expect(process.kill).not.toHaveBeenCalledWith(-pidBase, 'SIGINT')
        } else {
          expect(process.kill).toHaveBeenCalledWith(-pidBase, 'SIGINT')
        }

        await vi.advanceTimersByTimeAsync(15_000)
        await expect(timedOutTurn).rejects.toMatchObject({
          code: 'ASSISTANT_CODEX_APP_SERVER_INTERRUPT_TIMEOUT',
          context: {
            interruptCleanupTimeoutMs: 15_000,
            liveInterruptRequested,
            retryable: true,
          },
        })
      } finally {
        vi.useRealTimers()
      }

      const replacementTrace = vi.fn()
      await expect(
        executeCodexAppServerTurn({
          env: hostedEnv,
          onTraceEvent: replacementTrace,
          prompt: 'next turn after interrupt timeout',
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: `thread-${slug}-2`,
        turnId: `turn-${slug}-2`,
      })

      expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
      expect(replacementTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          rawEvent: expect.objectContaining({
            codexTimingColdStartReason: expectedColdStartReason,
            codexTimingStage: 'initialized',
          }),
        }),
      )
      expect(process.kill).toHaveBeenCalledWith(-pidBase, 'SIGTERM')
    },
  )

  it('passes readable image paths through to Codex app-server without rematerializing them', async () => {
    const workingDirectory = await createTempDir('assistant-codex-path-image-')
    const imagePath = path.join(workingDirectory, 'evidence.png')

    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          expect(asRecord(threadStart.params)).toMatchObject({
            approvalPolicy: 'never',
          })
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-path',
                },
              },
            }),
          )
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          const inputItems = readTurnStartInputItems(turnStart)
          expect(readLocalImagePath(inputItems[1])).toBe(imagePath)
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-path',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-path',
                  status: 'completed',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        images: [
          {
            path: imagePath,
            mimeType: 'image/png',
          },
        ],
        prompt: 'use the existing image path',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: '',
      sessionId: 'thread-path',
      threadId: 'thread-path',
      turnId: 'turn-path',
    })
  })

  it('captures rollout paths on thread/resume only when they match the resumed thread id', async () => {
    const workingDirectory = await createTempDir('assistant-codex-resume-rollout-')
    const codexHome = await createTempDir('assistant-codex-resume-home-')
    const threadId = '00000000-0000-4000-8000-000000000025'
    const otherThreadId = '00000000-0000-4000-8000-000000000026'
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`
    const mismatchedRolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${otherThreadId}.jsonl`

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const threadPaths = [
        path.join(codexHome, rolloutRelativePath),
        path.join(codexHome, mismatchedRolloutRelativePath),
      ]

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          for (const [index, threadPath] of threadPaths.entries()) {
            const requestCount = index + 1
            const threadResume = await waitForRpcMethodCount(
              child,
              'thread/resume',
              requestCount,
            )
            child.stdout.write(
              jsonLine({
                id: threadResume.id,
                result: {
                  approvalPolicy: 'never',
                  cwd: path.resolve(workingDirectory),
                  thread: {
                    id: threadId,
                    path: threadPath,
                  },
                },
              }),
            )
            const turnStart = await waitForRpcMethodCount(
              child,
              'turn/start',
              requestCount,
            )
            const turnId = `turn-resume-rollout-${requestCount}`
            child.stdout.write(
              jsonLine({
                id: turnStart.id,
                result: {
                  turn: {
                    id: turnId,
                  },
                },
              }),
            )
            child.stdout.write(
              jsonLine({
                method: 'turn/completed',
                params: {
                  turn: {
                    id: turnId,
                    status: 'completed',
                  },
                },
              }),
            )
          }
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        codexHome,
        prompt: 'resume with matching rollout',
        resumeSessionId: threadId,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      rolloutRelativePath,
      sessionId: threadId,
    })

    await expect(
      executeCodexAppServerTurn({
        codexHome,
        prompt: 'resume with mismatched rollout',
        resumeSessionId: threadId,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      rolloutRelativePath: null,
      sessionId: threadId,
    })
  })

  it('captures turn ids from turn/started when turn/start returns no turn id', async () => {
    const workingDirectory = await createTempDir('assistant-codex-turn-started-id-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-started-fallback',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({ id: 3, result: {} }))
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turnId: 'turn-started-fallback',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-started-fallback',
                  status: 'completed',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'capture fallback turn id',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-started-fallback',
      threadId: 'thread-started-fallback',
      turnId: 'turn-started-fallback',
    })
  })

  it('rejects unreadable image paths before spawning Codex', async () => {
    const workingDirectory = await createTempDir('assistant-codex-unreadable-image-')
    const imagePath = path.join(workingDirectory, 'private.png')

    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await chmod(imagePath, 0o000)

    await expect(
      executeCodexAppServerTurn({
        images: [
          {
            path: imagePath,
            mimeType: 'image/png',
          },
        ],
        prompt: 'fail on unreadable path',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_IMAGE_INVALID',
      message: 'Codex app-server image input path is not readable.',
    })

    expect(codexMocks.spawn).not.toHaveBeenCalled()
  })

  it('fails closed on unsupported interactive approval policies before spawning Codex', async () => {
    const workingDirectory = await createTempDir('assistant-codex-approval-policy-')
    const staleTurnInput: Record<string, unknown> = {
      approvalPolicy: 'on-request',
      prompt: 'require approval',
      workingDirectory,
    }

    await expect(
      Reflect.apply(executeCodexAppServerTurn, undefined, [staleTurnInput]),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED',
      context: {
        approvalPolicy: 'on-request',
        retryable: false,
      },
      message: expect.stringContaining('approvalPolicy=never'),
    })

    expect(codexMocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects invalid Codex homes before spawning the CLI', async () => {
    const workingDirectory = await createTempDir('assistant-codex-invalid-home-')
    const invalidRoot = await createTempDir('assistant-codex-invalid-home-root-')
    const filePath = path.join(invalidRoot, 'not-a-directory')

    await writeFile(filePath, 'content', 'utf8')

    await expect(
      executeCodexAppServerTurn({
        codexHome: filePath,
        prompt: 'invalid home',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_HOME_INVALID',
      message: 'Configured Codex home is not accessible. Check --codexHome permissions.',
    })

    expect(codexMocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects missing and executable-file Codex homes with precise validation errors', async () => {
    const workingDirectory = await createTempDir('assistant-codex-home-validation-')
    const validationRoot = await createTempDir('assistant-codex-home-validation-root-')
    const missingPath = path.join(validationRoot, 'missing-home')
    const executableFilePath = path.join(validationRoot, 'codex-home-file')

    await writeFile(executableFilePath, '#!/bin/sh\n', 'utf8')
    await chmod(executableFilePath, 0o755)

    await expect(
      executeCodexAppServerTurn({
        codexHome: missingPath,
        prompt: 'missing home',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_HOME_INVALID',
      message: 'Configured Codex home does not exist. Check --codexHome or CODEX_HOME.',
    })

    await expect(
      executeCodexAppServerTurn({
        codexHome: executableFilePath,
        prompt: 'file home',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_HOME_INVALID',
      message: 'Configured Codex home is not a directory. Check --codexHome.',
    })
  })

  it('maps missing Codex binaries to a not-found CLI error', async () => {
    const workingDirectory = await createTempDir('assistant-codex-not-found-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          emitProcessErrorAndExit(child, error)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'missing binary',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        'Codex app-server executable "codex" was not found. Install @openai/codex or pass --codexCommand.',
    })
  })

  it('reports missing working directories before spawning Codex', async () => {
    const tempRoot = await createTempDir('assistant-codex-missing-workdir-')
    const workingDirectory = path.join(tempRoot, 'missing')

    await expect(
      executeCodexAppServerTurn({
        prompt: 'missing cwd',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_WORKING_DIRECTORY_MISSING',
      message: 'Codex app-server working directory does not exist.',
    })

    expect(codexMocks.spawn).not.toHaveBeenCalled()
  })

  it('hands managed disconnect cleanup attribution to the next assistant turn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-managed-disconnect-work-')
    const codexHome = await createTempDir('assistant-codex-managed-disconnect-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      child.pid = 41_000 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          if (processNumber === 1) {
            const logout = await waitForRpcMethod(child, 'account/logout')
            child.stdout.write(jsonLine({ id: logout.id, result: {} }))
            return
          }

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-after-managed-disconnect',
            turnId: 'turn-after-managed-disconnect',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-after-managed-disconnect',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(
      executeCodexManagedAccountOperation({
        action: 'disconnect',
        codexHome,
        workingDirectory,
      }),
    ).resolves.toEqual({ kind: 'disconnected' })

    const replacementTrace = vi.fn()
    await expect(
      executeCodexAppServerTurn({
        codexHome,
        onTraceEvent: replacementTrace,
        prompt: 'assistant turn after managed disconnect',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-after-managed-disconnect',
      turnId: 'turn-after-managed-disconnect',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-explicit-stop',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it('waits for the Codex account update before verifying managed ChatGPT connect', async () => {
    const workingDirectory = await createTempDir('assistant-codex-managed-auth-work-')
    const codexHome = await createTempDir('assistant-codex-managed-auth-home-')
    const child = new MockChildProcess()
    const loginStarted = createDeferred<void>()
    const onDeviceCode = vi.fn()

    codexMocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          child.stdout.write(jsonLine({
            method: 'account/updated',
            params: {
              authMode: 'chatgpt',
              planType: 'pro',
            },
          }))

          const initialRead = await waitForRpcMethodCount(child, 'account/read', 1)
          child.stdout.write(jsonLine({
            id: initialRead.id,
            result: {
              account: null,
              requiresOpenaiAuth: true,
            },
          }))

          const loginStart = await waitForRpcMethod(child, 'account/login/start')
          expect(loginStart.params).toEqual({
            type: 'chatgptDeviceCode',
          })
          child.stdout.write(jsonLine({
            id: loginStart.id,
            result: {
              type: 'chatgptDeviceCode',
              loginId: 'login-managed-chatgpt',
              verificationUrl: 'https://auth.openai.com/codex/device',
              userCode: 'ABCD-1234',
            },
          }))
          loginStarted.resolve()
        })()
      })

      return child
    })

    const operation = executeCodexManagedAccountOperation({
      action: 'connect',
      codexHome,
      onDeviceCode,
      timeoutMs: 1_000,
      workingDirectory,
    })

    await loginStarted.promise
    await waitForMockCall(onDeviceCode, 1)
    expect(onDeviceCode).toHaveBeenCalledWith({
      userCode: 'ABCD-1234',
      verificationUrl: 'https://auth.openai.com/codex/device',
    })

    child.stdout.write(jsonLine({
      method: 'account/login/completed',
      params: {
        loginId: 'login-managed-chatgpt',
        success: true,
      },
    }))
    await waitForStableMicrotask()
    expect(readWrittenRpcMessages(child).filter(
      (message) => message.method === 'account/read',
    )).toHaveLength(1)

    child.stdout.write(jsonLine({
      method: 'account/updated',
      params: {
        authMode: 'chatgpt',
        planType: 'pro',
      },
    }))

    const verifiedRead = await waitForRpcMethodCount(child, 'account/read', 2)
    child.stdout.write(jsonLine({
      id: verifiedRead.id,
      result: {
        account: {
          type: 'chatgpt',
          email: 'user@example.com',
          planType: 'pro',
        },
        requiresOpenaiAuth: true,
      },
    }))

    await expect(operation).resolves.toEqual({
      kind: 'connected',
    })
    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      [
        '--config',
        'model_provider="openai"',
        '--config',
        'cli_auth_credentials_store="file"',
        ...cliTimingLaunchArgs,
        'app-server',
      ],
      expect.any(Object),
    )
  })

  it('preserves Codex managed ChatGPT login completion errors', async () => {
    const workingDirectory = await createTempDir('assistant-codex-managed-auth-error-work-')
    const codexHome = await createTempDir('assistant-codex-managed-auth-error-home-')
    const child = new MockChildProcess()
    const loginStarted = createDeferred<void>()
    const onDeviceCode = vi.fn()

    codexMocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const initialRead = await waitForRpcMethodCount(child, 'account/read', 1)
          child.stdout.write(jsonLine({
            id: initialRead.id,
            result: {
              account: null,
              requiresOpenaiAuth: true,
            },
          }))

          const loginStart = await waitForRpcMethod(child, 'account/login/start')
          child.stdout.write(jsonLine({
            id: loginStart.id,
            result: {
              type: 'chatgptDeviceCode',
              loginId: 'login-managed-chatgpt-error',
              verificationUrl: 'https://auth.openai.com/codex/device',
              userCode: 'WXYZ-9876',
            },
          }))
          loginStarted.resolve()
        })()
      })

      return child
    })

    const operation = executeCodexManagedAccountOperation({
      action: 'connect',
      codexHome,
      onDeviceCode,
      timeoutMs: 1_000,
      workingDirectory,
    })

    await loginStarted.promise
    await waitForMockCall(onDeviceCode, 1)

    child.stdout.write(jsonLine({
      method: 'account/login/completed',
      params: {
        error: 'device auth failed with status 500',
        loginId: 'login-managed-chatgpt-error',
        success: false,
      },
    }))

    await expect(operation).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_AUTH_FAILED',
      context: {
        codexLoginError: 'device auth failed with status 500',
        retryable: false,
      },
      message: 'ChatGPT account authentication did not complete successfully.',
    })
  })

  it('preserves missing Codex startup errors emitted before turn binding', async () => {
    const workingDirectory = await createTempDir('assistant-codex-prebind-not-found-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 0

      process.nextTick(() => {
        const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        emitProcessErrorAndExit(child, error)
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'missing binary before bind',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        'Codex app-server executable "codex" was not found. Install @openai/codex or pass --codexCommand.',
    })
  })

  it('normalizes missing Codex startup errors while waiting for spawn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-spawn-wait-not-found-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 0

      setImmediate(() => {
        const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        emitProcessErrorAndExit(child, error)
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'missing binary during spawn wait',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        'Codex app-server executable "codex" was not found. Install @openai/codex or pass --codexCommand.',
    })
  })

  it('preserves missing Codex startup errors when an already-aborted turn binds', async () => {
    const workingDirectory = await createTempDir('assistant-codex-aborted-not-found-')
    const controller = new AbortController()
    controller.abort()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      setImmediate(() => {
        const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        emitProcessErrorAndExit(child, error)
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        abortSignal: controller.signal,
        prompt: 'missing binary after abort',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        'Codex app-server executable "codex" was not found. Install @openai/codex or pass --codexCommand.',
    })
  })

  it('still interrupts a healthy child when an already-aborted turn binds', async () => {
    const workingDirectory = await createTempDir('assistant-codex-already-aborted-')
    const controller = new AbortController()
    controller.abort()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 35_000
      setImmediate(() => {
        child.emit('exit', null, 'SIGINT')
        child.emit('close', null, 'SIGINT')
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        abortSignal: controller.signal,
        prompt: 'already aborted turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
    })
    expect(process.kill).toHaveBeenCalledWith(-35_000, 'SIGINT')
  })

  it('preserves startup stderr when Codex exits before turn binding', async () => {
    const workingDirectory = await createTempDir('assistant-codex-prebind-stderr-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 0

      process.nextTick(() => {
        child.stderr.write('native runtime missing during startup\n')
        child.emit('exit', 1, null)
        child.emit('close', 1, null)
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'bad install before bind',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexExitCode: 1,
        codexFailureDetailPresent: true,
        codexFailureStage: 'process_exit',
        codexLifecycleStage: 'startup',
        codexStderrPresent: true,
        retryable: false,
      },
      message: expect.stringContaining('native runtime missing during startup'),
    })
  })

  it('preserves startup stdin error details emitted before spawn completes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-prebind-stdin-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 0

      process.nextTick(() => {
        child.stdin.emit('error', createErrnoException('EPIPE', 'write EPIPE before bind'))
        child.emit('exit', 1, null)
        child.emit('close', 1, null)
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'stdin failure before bind',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexFailureDetailPresent: true,
        retryable: false,
      },
      message: expect.stringContaining('write EPIPE before bind'),
    })
  })

  it('marks connection-loss failures as retryable and preserves the Codex thread id', async () => {
    const workingDirectory = await createTempDir('assistant-codex-connection-loss-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-77',
                },
              },
            }),
          )
          await waitForRpcMessages(child, 4)
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-77',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-77',
                },
              },
            }),
          )
          child.stderr.write('connection closed before response.completed\n')
          child.emit('exit', 1, null)
          child.emit('close', 1, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'retry me',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
      context: {
        connectionLost: true,
        codexThreadIdPresent: true,
        recoverableConnectionLoss: true,
        retryable: true,
      },
      message: expect.stringContaining(
        'Codex thread id was captured for diagnostics only.',
      ),
    })
  })

  it('classifies usage-limit turn failures from structured error notifications end to end', async () => {
    // Proves the lastEventErrorInfo threading: the structured codexErrorInfo
    // arrives on an `error` notification, then the turn fails via a separate
    // turn/completed event that carries no structured info of its own. The
    // message text deliberately matches none of the historical usage-limit
    // phrases (June 2026 quota incident regression guard).
    const workingDirectory = await createTempDir('assistant-codex-structured-usage-limit-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-structured-usage',
                },
              },
            }),
          )
          await waitForRpcMessages(child, 4)
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-structured-usage',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-structured-usage',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'error',
              params: {
                error: {
                  codexErrorInfo: 'usageLimitExceeded',
                  message: 'You have reached your monthly cap.',
                },
                threadId: 'thread-structured-usage',
                turnId: 'turn-structured-usage',
                willRetry: false,
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-structured-usage',
                  status: 'failed',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'structured usage limit',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_USAGE_LIMIT',
      context: {
        codexErrorInfo: 'usageLimitExceeded',
        codexErrorInfoPresent: true,
        codexFailureStage: 'turn_failed',
        codexThreadIdPresent: true,
        codexTurnStatus: 'failed',
        providerUsageLimit: true,
        retryable: false,
      },
      message: expect.stringContaining('You have reached your monthly cap.'),
    })
  })

  it('does not classify process exits as connection loss when structured info names another failure', async () => {
    // Same connection-sounding stderr as the retryable connection-loss test
    // above, but a structured non-connection error arrived first: the
    // structured classification must win over text sniffing end to end.
    const workingDirectory = await createTempDir('assistant-codex-structured-non-connection-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-structured-exit',
                },
              },
            }),
          )
          await waitForRpcMessages(child, 4)
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-structured-exit',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-structured-exit',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'error',
              params: {
                error: {
                  codexErrorInfo: 'internalServerError',
                  message: 'provider rejected the request',
                },
                threadId: 'thread-structured-exit',
                turnId: 'turn-structured-exit',
                willRetry: false,
              },
            }),
          )
          child.stderr.write('connection closed before response.completed\n')
          child.emit('exit', 1, null)
          child.emit('close', 1, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'structured non-connection exit',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexErrorInfo: 'internalServerError',
        codexErrorInfoPresent: true,
        codexFailureStage: 'process_exit',
        connectionLost: false,
        retryable: false,
      },
    })
  })

  it('classifies stale resume failures from thread/resume RPC errors', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stale-resume-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(
            jsonLine({
              id: 2,
              error: {
                code: -32000,
                message: 'thread/resume failed: no rollout found for thread id stale-thread',
              },
            }),
          )
        })()
      })

      return child
    })

    const error: unknown = await executeCodexAppServerTurn({
      prompt: 'resume please',
      resumeSessionId: 'stale-thread',
      workingDirectory,
    }).then(
      () => {
        throw new Error('expected stale resume to fail')
      },
      (turnError: unknown) => turnError,
    )

    expect(error).toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        retryable: true,
        staleResume: true,
      },
      message: expect.stringContaining('no rollout found for thread id stale-thread'),
    })
    expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
      codexThreadId: null,
      providerTurnId: null,
    })
  })

  it('keeps model/profile lookup failures as generic thread/resume RPC errors', async () => {
    const workingDirectory = await createTempDir('assistant-codex-non-stale-resume-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    for (const rpcErrorMessage of [
      'thread/resume failed: model not found',
      'thread/resume failed: profile not found',
    ]) {
      codexMocks.spawn.mockImplementationOnce(() => {
        const child = new MockChildProcess()
        child.pid = 35_000 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: 1, result: {} }))
            await waitForRpcMethod(child, 'thread/resume')
            child.stdout.write(
              jsonLine({
                id: 2,
                error: {
                  code: -32000,
                  message: rpcErrorMessage,
                },
              }),
            )
          })()
        })

        return child
      })

      await expect(
        executeCodexAppServerTurn({
          prompt: 'resume please',
          resumeSessionId: 'resume-thread',
          workingDirectory,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED',
        context: {
          method: 'thread/resume',
          retryable: false,
          staleResume: false,
        },
        message: rpcErrorMessage,
      })
    }
  })

  it('attests the member-workspace profile on resident thread resume', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-member-workspace-resume-',
    )
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 35_050
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(jsonLine({
            id: threadResume.id,
            result: {
              activePermissionProfile: {
                id: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
              },
              approvalPolicy: 'never',
              cwd: path.resolve(workingDirectory),
              runtimeWorkspaceRoots: [path.resolve(workingDirectory)],
              thread: {
                id: 'thread-member-workspace-resume',
              },
            },
          }))

          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-member-workspace-resume',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-member-workspace-resume',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      approvalPolicy: 'never',
      permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
      prompt: 'resume the ordinary hosted member turn',
      resumeSessionId: 'thread-member-workspace-resume',
      runtimeWorkspaceRoots: [workingDirectory],
      workingDirectory,
    })).resolves.toMatchObject({
      sessionId: 'thread-member-workspace-resume',
      turnId: 'turn-member-workspace-resume',
    })

    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    expect(asRecord((await waitForRpcMethod(child, 'thread/resume')).params)).toEqual({
      approvalPolicy: 'never',
      cwd: workingDirectory,
      excludeTurns: true,
      permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
      runtimeWorkspaceRoots: [workingDirectory],
      threadId: 'thread-member-workspace-resume',
    })
  })

  it('fails closed when a resumed member-workspace profile drifts', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-member-workspace-drift-',
    )
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 35_075
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(jsonLine({
            id: threadResume.id,
            result: {
              activePermissionProfile: {
                id: MURPH_MEMBER_READ_PERMISSION_PROFILE,
              },
              approvalPolicy: 'never',
              cwd: path.resolve(workingDirectory),
              runtimeWorkspaceRoots: [path.resolve(workingDirectory)],
              thread: {
                id: 'thread-member-workspace-drift',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      approvalPolicy: 'never',
      permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
      prompt: 'must not start under a different profile',
      resumeSessionId: 'thread-member-workspace-drift',
      runtimeWorkspaceRoots: [workingDirectory],
      workingDirectory,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        mismatchedFields: ['activePermissionProfile'],
        resumeContextMismatch: true,
        retryable: true,
        staleResume: true,
      },
    })

    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    expect(readWrittenRpcMessages(child).some(
      (message) => message.method === 'turn/start',
    )).toBe(false)
  })

  it('fails closed when thread/resume reports stale execution context', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stale-resume-context-')
    const staleWorkingDirectory = await createTempDir('assistant-codex-old-resume-context-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 35_100 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(
            jsonLine({
              id: threadResume.id,
              result: {
                approvalPolicy: 'never',
                cwd: staleWorkingDirectory,
                model: 'gpt-5',
                modelProvider: 'vercel-ai-gateway',
                sandbox: codexSandboxPolicyForMode('read-only'),
                thread: {
                  id: 'resume-thread',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        model: 'gpt-5.1',
        modelProvider: 'openai',
        prompt: 'resume with current context',
        resumeSessionId: 'resume-thread',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        mismatchedFields: ['cwd', 'modelProvider', 'sandbox'],
        resumeContextMismatch: true,
        retryable: true,
        staleResume: true,
      },
    })

    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    expect(
      readWrittenRpcMessages(child).some((message) => message.method === 'turn/start'),
    ).toBe(false)
    expect(process.kill).toHaveBeenCalledWith(-35_100, 'SIGTERM')
  })

  it('fails closed when thread/resume returns a different thread id', async () => {
    const workingDirectory = await createTempDir('assistant-codex-resume-thread-mismatch-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 35_200 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(
            jsonLine({
              id: threadResume.id,
              result: {
                approvalPolicy: 'never',
                cwd: path.resolve(workingDirectory),
                model: 'gpt-5.1',
                modelProvider: 'openai',
                thread: {
                  id: 'wrong-thread',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    const error: unknown = await executeCodexAppServerTurn({
      approvalPolicy: 'never',
      model: 'gpt-5.1',
      modelProvider: 'openai',
      prompt: 'resume with wrong returned id',
      resumeSessionId: 'requested-thread',
      workingDirectory,
    }).then(
      () => {
        throw new Error('expected mismatched resume identity to fail')
      },
      (turnError: unknown) => turnError,
    )

    expect(error).toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        mismatchedFields: ['threadId'],
        resumeContextMismatch: true,
        retryable: true,
        staleResume: true,
      },
    })
    expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
      codexThreadId: null,
      providerTurnId: null,
    })

    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    expect(
      readWrittenRpcMessages(child).some((message) => message.method === 'turn/start'),
    ).toBe(false)
    expect(process.kill).toHaveBeenCalledWith(-35_200, 'SIGTERM')
  })

  it('fails closed on missing echoed fields and skips unrequested ones', async () => {
    const workingDirectory = await createTempDir('assistant-codex-resume-missing-echo-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 35_300 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(
            jsonLine({
              id: threadResume.id,
              result: {
                cwd: '',
                model: 'unrequested-model',
                modelProvider: 'unrequested-provider',
                sandbox: codexSandboxPolicyForMode('read-only'),
                thread: {},
              },
            }),
          )
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        prompt: 'resume with missing echoed context',
        resumeSessionId: 'requested-thread',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        mismatchedFields: ['approvalPolicy', 'cwd'],
        resumeContextMismatch: true,
        retryable: true,
        staleResume: true,
      },
    })

    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    expect(
      readWrittenRpcMessages(child).some((message) => message.method === 'turn/start'),
    ).toBe(false)
    expect(process.kill).toHaveBeenCalledWith(-35_300, 'SIGTERM')
  })

  it.each([
    ['read-only', 'read-only'],
    ['workspace-write', 'workspace-write'],
    ['danger-full-access', 'danger-full-access'],
  ] as const)(
    'uses Codex app-server SandboxMode %s on thread/start and thread/resume context',
    async (sandbox, expectedSandbox) => {
      const workingDirectory = await createTempDir('assistant-codex-thread-context-')
      const freshSandbox = sandbox === 'read-only' ? 'danger-full-access' : 'read-only'
      const expectedFreshThreadContext = {
        approvalPolicy: 'never',
        cwd: path.resolve(workingDirectory),
        developerInstructions: 'Stable Murph instructions.',
        model: 'gpt-5',
        modelProvider: 'vercel-ai-gateway',
        sandbox: freshSandbox,
      }
      const expectedResumeThreadContext = {
        approvalPolicy: 'never',
        cwd: path.resolve(workingDirectory),
        excludeTurns: true,
        model: 'gpt-5.1',
        modelProvider: 'openai',
        sandbox: expectedSandbox,
        threadId: 'thread-resume-request',
      }
      const threadRequests: Record<string, unknown>[] = []
      const turnRequests: Record<string, unknown>[] = []

      const writeSuccessfulTurn = async (input: {
        child: MockChildProcess
        expectedPrompt: string
        responseThreadId: string
        threadRequestCount: number
        threadMethod: 'thread/start' | 'thread/resume'
        turnRequestCount: number
      }) => {
        const threadRequest = await waitForRpcMethodCount(
          input.child,
          input.threadMethod,
          input.threadRequestCount,
        )
        threadRequests.push(threadRequest)
        input.child.stdout.write(
          jsonLine({
            id: threadRequest.id,
            result: {
              ...(input.threadMethod === 'thread/resume'
                ? {
                    approvalPolicy: expectedResumeThreadContext.approvalPolicy,
                    cwd: expectedResumeThreadContext.cwd,
                    model: expectedResumeThreadContext.model,
                    modelProvider: expectedResumeThreadContext.modelProvider,
                    sandbox: codexSandboxPolicyForMode(expectedResumeThreadContext.sandbox),
                  }
                : {}),
              thread: {
                id: input.responseThreadId,
              },
            },
          }),
        )

        const turnRequest = await waitForRpcMethodCount(
          input.child,
          'turn/start',
          input.turnRequestCount,
        )
        turnRequests.push(turnRequest)
        input.child.stdout.write(
          jsonLine({
            id: turnRequest.id,
            result: {
              turn: {
                id: `turn-${input.responseThreadId}`,
              },
            },
          }),
        )
        input.child.stdout.write(
          jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-${input.responseThreadId}`,
                status: 'completed',
              },
            },
          }),
        )

        const turnInputItems = readTurnStartInputItems(turnRequest)
        expect(turnInputItems).toEqual([
          {
            type: 'text',
            text: input.expectedPrompt,
          },
        ])
      }

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeSuccessfulTurn({
              child,
              expectedPrompt: 'fresh prompt',
              responseThreadId: 'thread-fresh',
              threadRequestCount: 1,
              threadMethod: 'thread/start',
              turnRequestCount: 1,
            })
            await writeSuccessfulTurn({
              child,
              expectedPrompt: 'resume prompt',
              responseThreadId: 'thread-resume-request',
              threadRequestCount: 1,
              threadMethod: 'thread/resume',
              turnRequestCount: 2,
            })
          })()
        })

        return child
      })

      await expect(
        executeCodexAppServerTurn({
          approvalPolicy: 'never',
          model: 'gpt-5',
          modelProvider: 'vercel-ai-gateway',
          developerInstructions: 'Stable Murph instructions.',
          prompt: 'fresh prompt',
          reasoningEffort: 'high',
          sandbox: freshSandbox,
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-fresh',
      })

      await expect(
        executeCodexAppServerTurn({
          approvalPolicy: 'never',
          model: 'gpt-5.1',
          modelProvider: 'openai',
          developerInstructions: 'Stable Murph instructions.',
          prompt: 'resume prompt',
          reasoningEffort: 'high',
          resumeSessionId: 'thread-resume-request',
          sandbox,
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-resume-request',
      })

      expect(asRecord(threadRequests[0]?.params)).toEqual({
        ...expectedFreshThreadContext,
        dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
        serviceName: 'murph',
      })
      expect(asRecord(threadRequests[1]?.params)).toEqual(expectedResumeThreadContext)

      for (const [index, expectedThreadId] of ['thread-fresh', 'thread-resume-request'].entries()) {
        const turnParams = asRecord(turnRequests[index]?.params)
        expect(turnParams).toMatchObject({
          effort: 'high',
          model: index === 0 ? 'gpt-5' : 'gpt-5.1',
          threadId: expectedThreadId,
        })
        expect(turnParams.approvalPolicy).toBeUndefined()
        expect(turnParams.cwd).toBeUndefined()
        expect(turnParams.modelProvider).toBeUndefined()
        expect(turnParams.sandbox).toBeUndefined()
      }
    },
  )

  })
