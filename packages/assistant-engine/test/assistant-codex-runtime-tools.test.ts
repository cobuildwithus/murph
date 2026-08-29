import {
  MURPH_DYNAMIC_TOOLS,
  MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
  MURPH_DYNAMIC_TOOLS_WITH_STYLE,
  MockChildProcess,
  asRecord,
  codexMocks,
  createDeferred,
  createErrnoException,
  createHostedToolContext,
  createProgressDeliveryMock,
  createTempDir,
  emitMockStdinError,
  executeCodexAppServerTurn,
  jsonLine,
  readWrittenRpcMessages,
  requireMockChildProcess,
  sentProgressResult,
  waitForRpcMessages,
  waitForRpcMethod,
  waitForRpcMethodCount,
  waitForRpcResponse,
  writeContextCompactionStarted,
  writeSubAgentActivity,
  writeSuccessfulContextCompactionTurn,
} from "./assistant-codex-runtime.harness.ts";

import path from 'node:path'
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
  attachCodexAppServerProcessExitCleanup,
  stopCodexAppServerChild,
  withCodexRpcTimeout,
} from '../src/assistant-codex/app-server-rpc.ts'
import {
  GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import {
  CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS,
  extractAssistantMessageFallback,
  extractCodexErrorInfo,
  extractCodexErrorMessage,
  extractCodexProgressEventFromNormalized,
  extractCodexSessionId,
  extractCodexStatusEventFromStderrLine,
  extractCodexTraceUpdates,
  extractCodexTraceUpdatesFromNormalized,
  isCodexConnectionLossText,
  normalizeCodexEvent,
  normalizeStatusText,
  type CodexNormalizedEvent,
} from '../src/assistant-codex-events.ts'

describe('assistant codex runtime', () => {it('fails closed on unexpected app-server requests under approvalPolicy=never', async () => {
    const workingDirectory = await createTempDir('assistant-codex-server-request-')

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
                  id: 'thread-server-request',
                },
              },
            }),
          )

          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-server-request',
                },
              },
            }),
          )

          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'approval/request',
              params: {
                reason: 'open the browser',
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            error: {
              code: -32000,
              message:
                'Murph does not support interactive Codex app-server request approval/request in noninteractive assistant turns.',
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-server-request',
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
        approvalPolicy: 'never',
        prompt: 'stay noninteractive',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-server-request',
    })
  })

  it('handles the Murph progress dynamic tool after live steering without changing the final response', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-tool-')
    const progressDelivery = createProgressDeliveryMock()
    const progressText =
      'Got it. I\'ll pull out the lab values and check what is usable. I\'m also going to preserve this full progress update text instead of clipping it, because users should see the exact update the assistant sent when a longer note is still only a couple of sentences.'
    expect(progressText.length).toBeGreaterThan(240)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          expect(asRecord(threadStart.params)).toMatchObject({
            dynamicTools: MURPH_DYNAMIC_TOOLS,
          })
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-progress-tool',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-tool',
                },
              },
            }),
          )
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-progress-initial',
                content: [{ type: 'text', text: 'Process this blood test.' }],
                type: 'userMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-progress-steered',
                content: [{ type: 'text', text: 'Include the late result too.' }],
                type: 'userMessage',
              },
            },
          }))
          await new Promise((resolve) => setTimeout(resolve, 0))
          child.stderr.write('Provider-side status text\n')
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                threadId: 'thread-progress-tool',
                turnId: 'turn-progress-tool',
                callId: 'call-progress',
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: progressText,
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: true,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update sent',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-final',
                  type: 'agentMessage',
                  text: 'Final answer after the progress update.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-tool',
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
        prompt: 'process this blood test',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Final answer after the progress update.',
      sessionId: 'thread-progress-tool',
      turnId: 'turn-progress-tool',
    })

    expect(progressDelivery.send).toHaveBeenCalledWith(
      progressText,
      { deliveryContextOrdinal: 1, source: 'model' },
    )
    expect(progressDelivery.send).not.toHaveBeenCalledWith('Provider-side status text')
  })

  it('reports skipped progress tool results back to Codex', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-skipped-')
    const progressDelivery = {
      send: vi.fn(async (_text: string) => {
        void _text
        return {
          kind: 'skipped' as const,
          reason: 'limit' as const,
          source: 'model' as const,
        }
      }),
    }

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
                  id: 'thread-progress-skipped',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-skipped',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: 'Checking the file now.',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update skipped: progress update limit reached',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-skipped',
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
        prompt: 'try skipped progress',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-skipped',
    })
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Checking the file now.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
  })

  it('reports failed progress tool results back to Codex', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-failed-')
    const progressDelivery = {
      send: vi.fn(async (_text: string) => {
        void _text
        return {
          kind: 'failed' as const,
          source: 'model' as const,
        }
      }),
    }

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
                  id: 'thread-progress-failed',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-failed',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: 'Checking the file now.',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update failed during best-effort delivery',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-failed',
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
        prompt: 'try failed progress',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-failed',
    })
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Checking the file now.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
  })

  it('keeps commentary internal and reserves outbound progress for the explicit tool', async () => {
    const workingDirectory = await createTempDir('assistant-codex-commentary-progress-')
    const onProgress = vi.fn()
    const progressDelivery = createProgressDeliveryMock()

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
                  id: 'thread-commentary-progress',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-commentary-progress',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-commentary-progress',
                  type: 'agentMessage',
                  phase: 'commentary',
                  text: 'Reading the report now.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: 'Checking the saved context now.',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: true,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update sent',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-commentary-final',
                  type: 'agentMessage',
                  phase: 'final_answer',
                  text: 'Final answer after commentary.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-commentary-progress',
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
        onProgress,
        prompt: 'answer with commentary progress',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Final answer after commentary.',
      sessionId: 'thread-commentary-progress',
    })
    expect(progressDelivery.send).toHaveBeenCalledTimes(1)
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Checking the saved context now.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
    expect(progressDelivery.send).not.toHaveBeenCalledWith(
      'Reading the report now.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'message',
      state: 'completed',
      text: 'Reading the report now.',
    }))
  })

  it('waits for in-flight current-channel progress before returning the final turn result', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-drain-')
    const progressSent = createDeferred<ReturnType<typeof sentProgressResult>>()
    const progressDelivery = {
      send: vi.fn(async (_text: string) => {
        void _text
        return await progressSent.promise
      }),
    }

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
                  id: 'thread-progress-drain',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-drain',
                },
              },
            }),
          )
          writeContextCompactionStarted({
            child,
            itemId: 'context-progress-drain',
            threadId: 'thread-progress-drain',
          })
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-drain-final',
                  type: 'agentMessage',
                  phase: 'final_answer',
                  text: 'Final answer after progress.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-drain',
                  status: 'completed',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    let settled = false
    const turnPromise = executeCodexAppServerTurn({
      prompt: 'answer with delayed progress',
      progressDelivery,
      workingDirectory,
    }).finally(() => {
      settled = true
    })

    for (
      let attempt = 0;
      attempt < 200 && progressDelivery.send.mock.calls.length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(progressDelivery.send).toHaveBeenCalledWith(
      expect.any(String),
      { deliveryContextOrdinal: 0, required: true, source: 'system' },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    progressSent.resolve(sentProgressResult('system'))
    await expect(turnPromise).resolves.toMatchObject({
      finalMessage: 'Final answer after progress.',
      sessionId: 'thread-progress-drain',
      turnId: 'turn-progress-drain',
    })
  })

  it('waits for in-flight current-channel progress before returning turn failures', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-drain-failure-')
    const progressSent = createDeferred<ReturnType<typeof sentProgressResult>>()
    let progressResolvedBeforeFailure = false
    const progressDelivery = {
      send: vi.fn(async (_text: string) => {
        void _text
        const result = await progressSent.promise
        progressResolvedBeforeFailure = true
        return result
      }),
    }

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
                  id: 'thread-progress-drain-failure',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-drain-failure',
                },
              },
            }),
          )
          writeContextCompactionStarted({
            child,
            itemId: 'context-progress-drain-failure',
            threadId: 'thread-progress-drain-failure',
          })
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-drain-failure',
                  status: 'failed',
                },
              },
            }),
          )
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    let settled = false
    const turnPromise = executeCodexAppServerTurn({
      prompt: 'fail with delayed progress',
      progressDelivery,
      workingDirectory,
    }).finally(() => {
      settled = true
    })

    for (
      let attempt = 0;
      attempt < 200 && progressDelivery.send.mock.calls.length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(progressDelivery.send).toHaveBeenCalledWith(
      expect.any(String),
      { deliveryContextOrdinal: 0, required: true, source: 'system' },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    progressSent.resolve(sentProgressResult('system'))
    const error: unknown = await turnPromise.then(
      () => {
        throw new Error('expected the Codex turn to fail')
      },
      (turnError: unknown) => turnError,
    )

    expect(progressResolvedBeforeFailure).toBe(true)
    expect(error).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
    })
    expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
      codexThreadId: 'thread-progress-drain-failure',
      providerTurnId: 'turn-progress-drain-failure',
    })
  })

  it('keeps the final turn pending while current-channel progress remains unsettled', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-drain-timeout-')
    const stalledProgress = createDeferred<ReturnType<typeof sentProgressResult>>()
    const progressDelivery = {
      send: vi.fn(async (_text: string) => {
        void _text
        return await stalledProgress.promise
      }),
    }

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
                  id: 'thread-progress-drain-timeout',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-drain-timeout',
                },
              },
            }),
          )
          writeContextCompactionStarted({
            child,
            itemId: 'context-progress-drain-timeout',
            threadId: 'thread-progress-drain-timeout',
          })
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-drain-timeout-final',
                  type: 'agentMessage',
                  phase: 'final_answer',
                  text: 'Final answer after stalled progress.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-drain-timeout',
                  status: 'completed',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    let settled = false
    const turnPromise = executeCodexAppServerTurn({
      prompt: 'answer with stalled progress',
      progressDelivery,
      workingDirectory,
    }).finally(() => {
      settled = true
    })

    for (
      let attempt = 0;
      attempt < 200 && progressDelivery.send.mock.calls.length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(progressDelivery.send).toHaveBeenCalledWith(
      expect.any(String),
      { deliveryContextOrdinal: 0, required: true, source: 'system' },
    )

    await new Promise((resolve) => setTimeout(resolve, 2_100))
    expect(settled).toBe(false)

    stalledProgress.resolve(sentProgressResult('system'))
    await expect(turnPromise).resolves.toMatchObject({
      finalMessage: 'Final answer after stalled progress.',
      sessionId: 'thread-progress-drain-timeout',
      turnId: 'turn-progress-drain-timeout',
    })
  })

  it('rejects unoffered progress and assistant-style calls at the canonical turn boundary', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-disabled-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          expect(asRecord(threadStart.params)).toMatchObject({
            dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
          })
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-progress-disabled',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-disabled',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: 'Checking the file now.',
                },
              },
            }),
          )
          await expect(waitForRpcResponse(child, 99)).resolves.toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'tool was not offered for this turn',
                },
              ],
            },
          })
          child.stdout.write(
            jsonLine({
              id: 100,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'assistant_style',
                arguments: {
                  action: 'show',
                },
              },
            }),
          )
          await expect(waitForRpcResponse(child, 100)).resolves.toEqual({
            id: 100,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'tool was not offered for this turn',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-disabled',
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
        prompt: 'try disabled tools',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-disabled',
    })
  })

  it('sends one current-channel progress update at the live-steered context when Codex compacts context', async () => {
    const workingDirectory = await createTempDir('assistant-codex-context-compact-')
    const onProgress = vi.fn()
    const onTraceEvent = vi.fn()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const selectedProgressText =
      CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS[Math.floor(
        0.5 * CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS.length,
      )] ?? CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS[0]

    expect(CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS.length).toBeGreaterThanOrEqual(100)
    expect(new Set(CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS).size).toBe(
      CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS.length,
    )
    for (const progressText of CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS) {
      expect(progressText).toMatch(/^[\x20-\x7E]+$/u)
      expect(progressText.length).toBeGreaterThanOrEqual(18)
      expect(progressText.length).toBeLessThanOrEqual(95)
      expect(progressText).not.toMatch(/https?:\/\/|www\.|bit\.ly|tinyurl/iu)
      expect(progressText).not.toMatch(
        /\b(compaction|context|token|prompt|model|provider|infrastructure|signup)\b/iu,
      )
    }
    const progressDelivery = createProgressDeliveryMock()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void writeSuccessfulContextCompactionTurn({
          child,
          finalMessage: 'Final answer after compaction.',
          itemId: 'context-compact-1',
          threadId: 'thread-context-compact',
          turnId: 'turn-context-compact',
          userMessages: [
            {
              id: 'user-context-compact-initial',
              message: 'Answer after compacting context.',
            },
            {
              id: 'user-context-compact-steered',
              message: 'Include the late follow up.',
            },
          ],
        })
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        onProgress,
        onTraceEvent,
        prompt: 'answer after compacting context',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Final answer after compaction.',
      sessionId: 'thread-context-compact',
      turnId: 'turn-context-compact',
    })

    expect(progressDelivery.send).toHaveBeenCalledTimes(1)
    expect(progressDelivery.send).toHaveBeenCalledWith(
      selectedProgressText,
      { deliveryContextOrdinal: 1, required: true, source: 'system' },
    )
    expect(
      onProgress.mock.calls.some(([event]) => event?.id === 'context-compact-1'),
    ).toBe(false)
    expect(
      onTraceEvent.mock.calls.some(([event]) =>
        event?.updates?.some(
          (update: { streamKey?: string }) =>
            update.streamKey === 'status:context-compact-1',
        ),
      ),
    ).toBe(false)
    expect(onTraceEvent.mock.calls.map(([event]) => event?.rawEvent)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            item: expect.objectContaining({
              id: 'context-compact-1',
            }),
          }),
        }),
      ]),
    )
  })

  it('suppresses synthetic compaction progress in groups while returning the final reply', async () => {
    const workingDirectory = await createTempDir('assistant-codex-group-context-compact-')
    const progressDelivery = createProgressDeliveryMock()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void writeSuccessfulContextCompactionTurn({
          child,
          finalMessage: 'Group answer after compaction.',
          itemId: 'group-context-compact-1',
          progressText: 'Checking the group thread now.',
          threadId: 'thread-group-context-compact',
          turnId: 'turn-group-context-compact',
        })
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        groupConversation: true,
        prompt: 'answer the group after compacting context',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Group answer after compaction.',
      sessionId: 'thread-group-context-compact',
      turnId: 'turn-group-context-compact',
    })
    expect(progressDelivery.send).toHaveBeenCalledTimes(1)
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Checking the group thread now.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
    expect(progressDelivery.send).not.toHaveBeenCalledWith(
      expect.any(String),
      { deliveryContextOrdinal: 0, required: true, source: 'system' },
    )
  })

  it('rejects unsupported dynamic tools while keeping the Codex turn alive', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-unsupported-')
    const progressDelivery = createProgressDeliveryMock()

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
                  id: 'thread-progress-unsupported',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-unsupported',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_message',
                arguments: {
                  text: 'do not route this',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            error: {
              code: -32000,
              message: 'Unsupported dynamic tool murph.send_message',
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-unsupported',
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
        prompt: 'try unsupported tool',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-unsupported',
    })
    expect(progressDelivery.send).not.toHaveBeenCalled()
  })

  it('requires exact active-turn identity for invocation-scoped root tools', async () => {
    const workingDirectory = await createTempDir('assistant-codex-root-tool-scope-')
    const replyMessageRef = `ain_${'a'.repeat(32)}`
    const reactionMessageRef = `ain_${'b'.repeat(32)}`
    const authorizeAcceptedMessageTarget = vi.fn(async (input: {
      messageRef: string
    }) => ({
      targetInputId: input.messageRef,
    }))
    const deviceTool: NonNullable<AssistantHostedToolContext['deviceTool']> = {
      request: vi.fn(async () => ({
        accounts: [],
        action: 'list_accounts' as const,
        provider: null,
        sourceProvider: null,
      })),
    }
    const automationTool: NonNullable<AssistantHostedToolContext['automationTool']> = {
      request: vi.fn(async () => ({
        action: 'patch' as const,
        automationId: 'automation-hidden',
        created: false,
        effectiveTimeZone: 'America/New_York',
        lookupId: 'hidden',
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        routeBinding: 'preserved' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '09:00',
        },
        status: 'paused' as const,
        updatedAt: '2026-08-10T00:00:00.000Z',
      })),
    }
    const invalidGapAutomationArguments = {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Gap reminder',
    }

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: { thread: { id: 'thread-root-tool-scope' } },
          }))
          await waitForRpcMethod(child, 'turn/start')

          child.stdout.write(jsonLine({
            id: 98,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'list_accounts' },
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'device',
              turnId: 'turn-root-tool-scope',
            },
          }))
          await expect(waitForRpcResponse(child, 98)).resolves.toEqual({
            error: {
              code: -32000,
              message: 'Codex parent-thread request arrived before the active turn id was known.',
            },
            id: 98,
          })

          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-root-tool-scope' } },
          }))

          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: {
              __testPreserveMissingIdentity: true,
              namespace: 'murph',
              tool: 'device',
              arguments: { action: 'list_accounts' },
            },
          }))
          await expect(waitForRpcResponse(child, 99)).resolves.toEqual({
            error: {
              code: -32000,
              message: 'Murph does not support interactive Codex app-server request item/tool/call in noninteractive assistant turns.',
            },
            id: 99,
          })

          child.stdout.write(jsonLine({
            id: 1000,
            method: 'item/tool/call',
            params: {
              arguments: invalidGapAutomationArguments,
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'automation',
              turnId: 'turn-stale-root-tool-scope',
            },
          }))
          await expect(waitForRpcResponse(child, 1000)).resolves.toEqual({
            error: {
              code: -32000,
              message: 'Codex message turn id does not match the active turn.',
            },
            id: 1000,
          })

          child.stdout.write(jsonLine({
            id: 100,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'list_accounts' },
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'device',
              turnId: 'turn-stale-root-tool-scope',
            },
          }))
          await expect(waitForRpcResponse(child, 100)).resolves.toEqual({
            error: {
              code: -32000,
              message: 'Codex message turn id does not match the active turn.',
            },
            id: 100,
          })

          child.stdout.write(jsonLine({
            id: 101,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'list_accounts' },
              namespace: 'murph',
              threadId: 'thread-foreign-root-tool-scope',
              tool: 'device',
              turnId: 'turn-root-tool-scope',
            },
          }))
          await expect(waitForRpcResponse(child, 101)).resolves.toEqual({
            error: {
              code: -32000,
              message: 'Server requests from codex subagent threads are not supported.',
            },
            id: 101,
          })

          child.stdout.write(jsonLine({
            id: 102,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'list_accounts' },
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'device',
              turnId: 'turn-root-tool-scope',
            },
          }))
          await expect(waitForRpcResponse(child, 102)).resolves.toEqual({
            id: 102,
            result: {
              success: true,
              contentItems: [{
                type: 'inputText',
                text: '{"accounts":[],"action":"list_accounts","provider":null,"sourceProvider":null}',
              }],
            },
          })

          child.stdout.write(jsonLine({
            id: 103,
            method: 'item/tool/call',
            params: {
              arguments: invalidGapAutomationArguments,
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'automation',
              turnId: 'turn-root-tool-scope',
            },
          }))
          await expect(waitForRpcResponse(child, 103)).resolves.toEqual({
            id: 103,
            result: {
              success: false,
              contentItems: [{
                type: 'inputText',
                text: 'tool was not offered for this turn',
              }],
            },
          })

          writeSubAgentActivity(
            child,
            'thread-root-tool-scope',
            'thread-root-tool-scope-descendant',
            'started',
            { turnId: 'turn-root-tool-scope' },
          )
          const messageTargetToolVariants = [
            {
              arguments: { message_ref: replyMessageRef },
              tool: 'select_reply_target',
            },
            {
              arguments: { message_ref: 'invalid' },
              tool: 'select_reply_target',
            },
            {
              arguments: {
                message_ref: reactionMessageRef,
                reaction: 'heart',
              },
              tool: 'react_to_message',
            },
            {
              arguments: {
                message_ref: reactionMessageRef,
                reaction: 'invalid',
              },
              tool: 'react_to_message',
            },
          ] as const

          let messageTargetRequestId = 104
          for (const variant of messageTargetToolVariants) {
            child.stdout.write(jsonLine({
              id: messageTargetRequestId,
              method: 'item/tool/call',
              params: {
                arguments: variant.arguments,
                namespace: 'murph',
                threadId: 'thread-root-tool-scope-descendant',
                tool: variant.tool,
                turnId: 'turn-root-tool-scope-descendant',
              },
            }))
            await expect(
              waitForRpcResponse(child, messageTargetRequestId),
            ).resolves.toEqual({
              error: {
                code: -32000,
                message: 'Server requests from codex subagent threads are not supported.',
              },
              id: messageTargetRequestId,
            })
            messageTargetRequestId += 1
          }

          for (const variant of messageTargetToolVariants) {
            child.stdout.write(jsonLine({
              id: messageTargetRequestId,
              method: 'item/tool/call',
              params: {
                arguments: variant.arguments,
                namespace: 'murph',
                threadId: 'thread-root-tool-scope',
                tool: variant.tool,
                turnId: 'turn-stale-root-tool-scope',
              },
            }))
            await expect(
              waitForRpcResponse(child, messageTargetRequestId),
            ).resolves.toEqual({
              error: {
                code: -32000,
                message: 'Codex message turn id does not match the active turn.',
              },
              id: messageTargetRequestId,
            })
            messageTargetRequestId += 1
          }

          child.stdout.write(jsonLine({
            id: messageTargetRequestId,
            method: 'item/tool/call',
            params: {
              arguments: { message_ref: replyMessageRef },
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'select_reply_target',
              turnId: 'turn-root-tool-scope',
            },
          }))
          await expect(
            waitForRpcResponse(child, messageTargetRequestId),
          ).resolves.toEqual({
            id: messageTargetRequestId,
            result: {
              success: true,
              contentItems: [{
                type: 'inputText',
                text: 'selection recorded',
              }],
            },
          })
          messageTargetRequestId += 1

          child.stdout.write(jsonLine({
            id: messageTargetRequestId,
            method: 'item/tool/call',
            params: {
              arguments: {
                message_ref: reactionMessageRef,
                reaction: 'heart',
              },
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'react_to_message',
              turnId: 'turn-root-tool-scope',
            },
          }))
          await expect(
            waitForRpcResponse(child, messageTargetRequestId),
          ).resolves.toEqual({
            id: messageTargetRequestId,
            result: {
              success: true,
              contentItems: [{
                type: 'inputText',
                text: 'reaction queued',
              }],
            },
          })

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-root-tool-scope-final',
                type: 'agentMessage',
                phase: 'final_answer',
                text: 'Root tool scope verified.',
              },
            },
          }))

          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-root-tool-scope',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      automationRelativeDateReferenceWindow: {
        earliestAt: '2026-03-08T04:59:00.000Z',
        latestAt: '2026-03-08T04:59:00.000Z',
      },
      authorizeAcceptedMessageTarget,
      hostedToolContext: {
        ...createHostedToolContext(),
        automationTool,
        deviceTool,
      },
      dynamicTools: resolveMurphDynamicTools({
        deviceAvailable: true,
        messageTargetingAvailable: true,
        pendingVaultFilesAvailable: true,
      }),
      prompt: 'inspect connected devices',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: 'Root tool scope verified.',
      sessionId: 'thread-root-tool-scope',
      turnId: 'turn-root-tool-scope',
    })
    expect(deviceTool.request).toHaveBeenCalledTimes(1)
    expect(automationTool.request).not.toHaveBeenCalled()
    expect(authorizeAcceptedMessageTarget).toHaveBeenNthCalledWith(1, {
      action: 'native-reply',
      deliveryContextOrdinal: 0,
      messageRef: replyMessageRef,
    })
    expect(authorizeAcceptedMessageTarget).toHaveBeenNthCalledWith(2, {
      action: 'reaction',
      deliveryContextOrdinal: 0,
      messageRef: reactionMessageRef,
    })
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledTimes(2)
  })

  it('returns a tool failure for invalid progress arguments without sending progress', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-invalid-')
    const progressDelivery = createProgressDeliveryMock()

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
                  id: 'thread-progress-invalid',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-invalid',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: '',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: '{"error":"invalid_progress_update_arguments","validationIssues":[{"origin":"string","code":"too_small","minimum":1,"inclusive":true,"path":["text"],"message":"Too small: expected string to have >=1 characters"}]}',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-invalid',
                  status: 'completed',
                },
              },
            }),
          )
        })()
      })

      return child
    })

    const result = await executeCodexAppServerTurn({
      prompt: 'try invalid progress tool',
      progressDelivery,
      workingDirectory,
    })
    expect(result).toMatchObject({
      sessionId: 'thread-progress-invalid',
    })
    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.runtimeIssueInputs).toEqual([
      expect.objectContaining({
        component: 'assistant.tool-validation',
        operation: 'murph.send_progress_update',
        phase: 'tool_call',
        issueKind: 'schema_rejection',
        severity: 'warning',
        errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
        summary: 'Tool input failed schema validation.',
        details: expect.objectContaining({
          detailsSchema: 'murph.tool-call-validation-digest.v1',
          toolName: 'murph.send_progress_update',
          schemaName: 'murph.send_progress_update.input',
          rootType: 'object',
          rootKeysPresent: ['text'],
          invalidPaths: ['text'],
          issueCodes: ['too_small'],
          inputShape: [
            'root.object.count_1_10',
            'text.string.len_0',
          ],
        }),
      }),
    ])
    expect(JSON.stringify(result.runtimeIssueInputs)).not.toContain('arguments')
  })

  it('persists value-free pause-tool schema rejection details', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-computer-pause-invalid-',
    )
    const invalidHandoffPurpose = 'private-invalid-purpose'
    const privateRunId = 'run_private_runtime_123'
    const privateSuggestedReply = 'private suggested reply text'
    const privateMessage = 'private message text'
    const privateUrl = 'https://private.example.test/handoff'
    const unknownKey = 'privateArbitraryField'
    const unknownValue = 'private arbitrary secret'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: {
              thread: { id: 'thread-computer-pause-invalid' },
            },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: {
              turn: { id: 'turn-computer-pause-invalid' },
            },
          }))
          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: {
              arguments: {
                handoffPurpose: invalidHandoffPurpose,
                reason: {
                  message: privateMessage,
                  url: privateUrl,
                },
                runId: privateRunId,
                suggestedReply: privateSuggestedReply,
                [unknownKey]: unknownValue,
              },
              namespace: 'murph',
              tool: 'computer_pause_for_user',
            },
          }))

          await expect(waitForRpcResponse(child, 99)).resolves.toMatchObject({
            id: 99,
            result: { success: false },
          })

          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-computer-pause-invalid',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const result = await executeCodexAppServerTurn({
      hostedToolContext: createHostedToolContext(),
      prompt: 'try invalid computer pause tool',
      workingDirectory,
    })
    expect(result.runtimeIssueInputs).toEqual([
      expect.objectContaining({
        component: 'assistant.tool-validation',
        operation: 'murph.computer_pause_for_user',
        phase: 'tool_call',
        issueKind: 'schema_rejection',
        severity: 'warning',
        errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
        summary: 'Tool input failed schema validation.',
        details: expect.objectContaining({
          detailsSchema: 'murph.tool-call-validation-digest.v1',
          inputShape: [
            'root.object.count_1_10',
            'handoffPurpose.string.len_1_32',
            'reason.object.count_1_10',
            'runId.string.len_1_32',
            'suggestedReply.string.len_1_32',
          ],
          invalidPaths: ['handoffPurpose', 'reason', 'root'],
          issueCodes: ['custom'],
          pathIssues: [
            {
              code: 'custom',
              path: 'handoffPurpose',
              received: 'string.len_1_32',
            },
            {
              code: 'custom',
              path: 'reason',
              received: 'object.count_1_10',
            },
            {
              code: 'custom',
              path: 'root',
              received: 'object.count_1_10',
            },
          ],
          rootKeyCount: 5,
          rootKeysPresent: [
            'handoffPurpose',
            'reason',
            'runId',
            'suggestedReply',
          ],
          rootType: 'object',
          schemaName: 'murph.computer_pause_for_user.input',
          toolName: 'murph.computer_pause_for_user',
          unsafeRootKeyCount: 1,
        }),
      }),
    ])
    const serializedIssues = JSON.stringify(result.runtimeIssueInputs)
    expect(serializedIssues).not.toContain(invalidHandoffPurpose)
    expect(serializedIssues).not.toContain(privateRunId)
    expect(serializedIssues).not.toContain(privateSuggestedReply)
    expect(serializedIssues).not.toContain(privateMessage)
    expect(serializedIssues).not.toContain(privateUrl)
    expect(serializedIssues).not.toContain(unknownKey)
    expect(serializedIssues).not.toContain(unknownValue)
  })

  it('records pending-file schema rejection through the standard safe diagnostic', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-pending-file-invalid-',
    )

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: {
              thread: { id: 'thread-pending-file-invalid' },
            },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: {
              turn: { id: 'turn-pending-file-invalid' },
            },
          }))
          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'cancel',
                intentIds: ['private invalid intent'],
              },
              namespace: 'murph',
              tool: 'pending_vault_files',
              turnId: 'turn-pending-file-invalid',
            },
          }))

          await expect(waitForRpcResponse(child, 99)).resolves.toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [{
                type: 'inputText',
                text: '{"error":"invalid_pending_vault_files_arguments","validationIssues":[{"origin":"string","code":"invalid_format","format":"regex","pattern":"/^outbox_[0-9a-f]{32}$/u","path":["intentIds",0],"message":"Invalid string: must match pattern /^outbox_[0-9a-f]{32}$/u"}]}',
              }],
            },
          })

          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-pending-file-invalid',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const result = await executeCodexAppServerTurn({
      dynamicTools: resolveMurphDynamicTools({
        pendingVaultFilesAvailable: true,
      }),
      prompt: 'try invalid pending file tool',
      workingDirectory,
    })
    expect(result.runtimeIssueInputs).toEqual([
      expect.objectContaining({
        component: 'assistant.tool-validation',
        operation: 'murph.pending_vault_files',
        phase: 'tool_call',
        issueKind: 'schema_rejection',
        severity: 'warning',
        summary: 'Tool input failed schema validation.',
        errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
        details: expect.objectContaining({
          detailsSchema: 'murph.tool-call-validation-digest.v1',
          invalidPaths: ['intentIds[]'],
          pathIssues: [{
            code: 'invalid_format',
            expected: 'string',
            path: 'intentIds[]',
            received: 'string.len_1_32',
          }],
          schemaName: 'murph.pending_vault_files.input',
          toolName: 'murph.pending_vault_files',
        }),
      }),
    ])
    expect(JSON.stringify(result.runtimeIssueInputs))
      .not.toContain('private invalid intent')
  })

  it('uses native cold resume when the turn requires the private style tool', async () => {
    const workingDirectory = await createTempDir('assistant-codex-style-cold-resume-')
    const spawnedChildren: MockChildProcess[] = []

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      spawnedChildren.push(child)
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          const resumeParams = asRecord(threadResume.params)
          child.stdout.write(jsonLine({
            id: threadResume.id,
            result: {
              approvalPolicy: resumeParams.approvalPolicy,
              cwd: resumeParams.cwd,
              thread: { id: 'thread-style-cold' },
            },
          }))
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: { turn: { id: 'turn-style-cold' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: { turn: { id: 'turn-style-cold', status: 'completed' } },
          }))
        })()
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_STYLE,
        prompt: 'resume with private style controls',
        resumeSessionId: 'thread-style-cold',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-style-cold',
      turnId: 'turn-style-cold',
    })

    const messages = readWrittenRpcMessages(
      requireMockChildProcess(spawnedChildren[0] ?? null),
    )
    expect(messages.filter((message) => message.method === 'thread/resume'))
      .toHaveLength(1)
    expect(messages.filter((message) => message.method === 'thread/start'))
      .toHaveLength(0)
  })

  it('keeps native resume for a style-capable thread owned by the warm process', async () => {
    const workingDirectory = await createTempDir('assistant-codex-style-warm-resume-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: { thread: { id: 'thread-style-warm' } },
          }))
          const firstTurn = await waitForRpcMethodCount(child, 'turn/start', 1)
          child.stdout.write(jsonLine({
            id: firstTurn.id,
            result: { turn: { id: 'turn-style-warm-1' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: { turn: { id: 'turn-style-warm-1', status: 'completed' } },
          }))

          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          child.stdout.write(jsonLine({
            id: threadResume.id,
            result: {
              approvalPolicy: 'never',
              cwd: path.resolve(workingDirectory),
              model: asRecord(threadResume.params)?.model,
              modelProvider: asRecord(threadResume.params)?.modelProvider,
              thread: { id: 'thread-style-warm' },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: { turn: { id: 'turn-style-warm-2' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: { turn: { id: 'turn-style-warm-2', status: 'completed' } },
          }))
        })()
      })
      return child
    })

    await expect(executeCodexAppServerTurn({
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_STYLE,
      prompt: 'start with private style controls',
      workingDirectory,
    })).resolves.toMatchObject({ sessionId: 'thread-style-warm' })
    await expect(executeCodexAppServerTurn({
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_STYLE,
      prompt: 'resume with private style controls',
      resumeSessionId: 'thread-style-warm',
      workingDirectory,
    })).resolves.toMatchObject({ sessionId: 'thread-style-warm' })
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('handles progress dynamic tool calls on cold resumed threads', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-resume-')
    const progressDelivery = createProgressDeliveryMock()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          const threadResumeParams = asRecord(threadResume.params)
          expect(threadResumeParams).toMatchObject({
            approvalPolicy: 'never',
            cwd: path.resolve(workingDirectory),
            excludeTurns: true,
            threadId: 'existing-thread-without-progress-tool',
          })
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                approvalPolicy: 'never',
                cwd: path.resolve(workingDirectory),
                model: threadResumeParams.model,
                modelProvider: threadResumeParams.modelProvider,
                thread: {
                  id: 'existing-thread-without-progress-tool',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-progress-resume',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: 'Checking the file now.',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: true,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update sent',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-progress-resume',
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
        prompt: 'resume and try progress',
        resumeSessionId: 'existing-thread-without-progress-tool',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'existing-thread-without-progress-tool',
    })
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Checking the file now.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
  })

  it('counts canonical provider actions and skips pure image views', async () => {
    const workingDirectory = await createTempDir('assistant-codex-provider-actions-')

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
                  id: 'thread-actions',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-actions',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  action: null,
                  id: 'search-canonical',
                  query: 'murph app server',
                  results: null,
                  type: 'webSearch',
                },
                threadId: 'thread-actions',
                turnId: 'turn-actions',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  appContext: null,
                  arguments: {},
                  durationMs: null,
                  error: null,
                  id: 'tool-slash',
                  pluginId: null,
                  readOnlyHint: null,
                  result: null,
                  server: 'web',
                  status: 'completed',
                  tool: 'search_query',
                  type: 'mcpToolCall',
                },
                threadId: 'thread-actions',
                turnId: 'turn-actions',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'image-canonical',
                  path: '/tmp/look.png',
                  type: 'imageView',
                },
                threadId: 'thread-actions',
                turnId: 'turn-actions',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-actions',
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
        prompt: 'count only non-replayable work',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      providerActionCount: 2,
      sessionId: 'thread-actions',
    })
  })

  it('maps initialize-time stdin write races into typed Murph failures', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stdin-race-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      vi.mocked(process.kill).mockImplementation((pid, signal) => {
        if (
          pid === -child.pid &&
          (signal === 'SIGTERM' || signal === 'SIGKILL') &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          queueMicrotask(() => {
            child.emit('exit', null, signal)
            child.emit('close', null, signal)
          })
        }
        return true
      })
      child.stdin.onWrite = (write) => {
        const message = asRecord(JSON.parse(write))
        if (message.method !== 'initialize') {
          return
        }

        child.stdin.onWrite = null
        queueMicrotask(() => {
          emitMockStdinError(child, createErrnoException('EPIPE', 'write EPIPE'))
        })
      }
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'race initialize',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        providerActionCount: 0,
        retryable: false,
      },
      message: expect.stringContaining('write EPIPE'),
    })
  })

  it('preserves connection-loss classification when stdin reports EPIPE after the provider stream drops', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stdin-connection-loss-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      vi.mocked(process.kill).mockImplementation((pid, signal) => {
        if (
          pid === -child.pid &&
          (signal === 'SIGTERM' || signal === 'SIGKILL') &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          queueMicrotask(() => {
            child.emit('exit', null, signal)
            child.emit('close', null, signal)
          })
        }
        return true
      })

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
                  id: 'thread-stdin-loss',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-stdin-loss',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-stdin-loss',
                },
              },
            }),
          )
          child.stderr.write('connection closed before response.completed\n')
          emitMockStdinError(child, createErrnoException('EPIPE', 'write EPIPE'))
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'retry me after stdin loss',
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
      message: expect.stringContaining('connection closed before response.completed'),
    })
  })

  it('attaches metadata-only process diagnostics when the app-server exits with SIGKILL mid-turn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-sigkill-')

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
                  id: 'thread-sigkill-runtime',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-sigkill-runtime',
                },
              },
            }),
          )
          await new Promise((resolve) => setTimeout(resolve, 0))
          child.emit('close', null, 'SIGKILL')
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'die during turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexAbortRequested: false,
        codexDiagnosticsPresent: true,
        codexExitSignal: 'SIGKILL',
        codexFailureStage: 'process_exit',
        codexJsonEventCount: 3,
        codexLifecycleStage: 'turn_running',
        codexPendingRpcCount: 0,
        codexProcessLifetimeMs: expect.any(Number),
        codexProviderRequestStarted: true,
        codexShutdownRequested: false,
        codexSignalPresent: true,
        codexStderrBytes: 0,
        codexThreadIdPresent: true,
        providerActionCount: 0,
        retryable: false,
      },
      message: 'Codex app-server failed. signal SIGKILL.',
    })
  })

  it('captures pending RPC diagnostics when the app-server exits during turn start', async () => {
    const workingDirectory = await createTempDir('assistant-codex-pending-rpc-')

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
                  id: 'thread-pending-rpc',
                },
              },
            }),
          )
          await waitForRpcMethod(child, 'turn/start')
          child.stderr.write('killed while waiting for turn/start response\n')
          child.emit('close', null, 'SIGKILL')
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'die while turn start is pending',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexAbortRequested: false,
        codexDiagnosticsPresent: true,
        codexExitSignal: 'SIGKILL',
        codexFailureStage: 'process_exit',
        codexJsonEventCount: 2,
        codexLifecycleStage: 'turn_start',
        codexLiveTurnOpen: false,
        codexPendingRpcCount: 1,
        codexPendingRpcMethod: 'turn/start',
        // True since the provider-start barrier arms at request write: an
        // exit during turn/start is post-admission (the child may have
        // executed commands), never pre-provider work.
        codexProviderRequestStarted: true,
        codexShutdownRequested: false,
        codexSignalPresent: true,
        codexStderrBytes: 'killed while waiting for turn/start response\n'.length,
        codexThreadIdPresent: true,
        providerActionCount: 0,
        retryable: false,
      },
      message: expect.stringContaining('Codex app-server failed. signal SIGKILL.'),
    })
  })

  it('ignores post-shutdown EPIPE from stdin.end during explicit warm shutdown', async () => {
    const workingDirectory = await createTempDir('assistant-codex-clean-shutdown-')
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      child = spawnedChild
      vi.mocked(process.kill).mockImplementation((pid, signal) => {
        if (pid === -spawnedChild.pid && signal === 'SIGTERM') {
          queueMicrotask(() => {
            spawnedChild.emit('exit', null, signal)
            spawnedChild.emit('close', null, signal)
          })
        }
        return true
      })
      spawnedChild.stdin.onEnd = () => {
        queueMicrotask(() => {
          spawnedChild.stdin.emit('error', createErrnoException('EPIPE', 'write EPIPE'))
        })
      }

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(spawnedChild, 'thread/start')
          spawnedChild.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-clean-shutdown',
                },
              },
            }),
          )
          await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-clean-shutdown',
                },
              },
            }),
          )
          spawnedChild.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-clean-shutdown',
                  status: 'completed',
                },
              },
            }),
          )
        })()
      })

      return spawnedChild
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'finish cleanly',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-clean-shutdown',
    })

    const spawnedChild = requireMockChildProcess(child)
    await stopWarmCodexAppServer('explicit-test-shutdown')
    await expect(waitForWarmCodexBackgroundWork()).resolves.toBeUndefined()
    expect(process.kill).toHaveBeenCalledWith(-spawnedChild.pid, 'SIGTERM')
    expect(process.kill).toHaveBeenCalledWith(-spawnedChild.pid, 'SIGKILL')
  })

  it.each([
    { settlement: 'stdin EPIPE' },
    { settlement: 'truncated stdout' },
    { settlement: 'child error' },
    { settlement: 'failed terminal frame' },
  ])('treats abort-race $settlement as interrupted, sends turn/interrupt, and signals the child group', async ({ settlement }) => {
    const workingDirectory = await createTempDir('assistant-codex-abort-')
    const controller = new AbortController()
    const spawnedChildren: MockChildProcess[] = []

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 40_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)
      const processNumber = spawnedChildren.length
      vi.mocked(process.kill).mockImplementation((pid, signal) => {
        if (
          processNumber === 1 &&
          pid === -spawnedChild.pid &&
          signal === 'SIGINT'
        ) {
          if (settlement === 'truncated stdout') {
            spawnedChild.stdout.write('{')
          } else if (settlement === 'child error') {
            spawnedChild.emit('error', new Error('child error after abort'))
          } else if (settlement === 'failed terminal frame') {
            spawnedChild.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-abort-1',
                  status: 'failed',
                },
              },
            }))
          }
          queueMicrotask(() => {
            spawnedChild.emit('exit', null, signal)
            spawnedChild.emit('close', null, signal)
          })
        }
        return true
      })
      if (processNumber === 1 && settlement === 'stdin EPIPE') {
        spawnedChild.stdin.onWrite = (write) => {
          const message = asRecord(JSON.parse(write))
          if (message.method !== 'turn/interrupt') {
            return
          }

          spawnedChild.stdin.onWrite = null
          queueMicrotask(() => {
            spawnedChild.stdin.emit('error', createErrnoException('EPIPE', 'write EPIPE'))
          })
        }
      }

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const thread = await waitForRpcMethod(spawnedChild, 'thread/start')
          spawnedChild.stdout.write(
            jsonLine({
              id: thread.id,
              result: {
                thread: {
                  id: `thread-abort-${processNumber}`,
                },
              },
            }),
          )
          const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(
            jsonLine({
              id: turn.id,
              result: {
                turn: {
                  id: `turn-abort-${processNumber}`,
                },
              },
            }),
          )
          spawnedChild.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: `turn-abort-${processNumber}`,
                },
              },
            }),
          )
          if (processNumber === 1) {
            await waitForRpcMessages(spawnedChild, 4)
            controller.abort()
            return
          }
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-abort-${processNumber}`,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    await expect(
      executeCodexAppServerTurn({
        abortSignal: controller.signal,
        prompt: 'abort me',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        codexAbortRequested: true,
        codexFailureStage: 'interrupted',
        codexShutdownRequested: false,
        codexTerminationSignalSent: 'SIGINT',
        interrupted: true,
        codexThreadIdPresent: true,
        retryable: false,
      },
    })

    const spawnedChild = requireMockChildProcess(spawnedChildren[0] ?? null)
    const messages = await waitForRpcMessages(spawnedChild, 5)
    expect(messages[4]).toEqual({
      id: 4,
      method: 'turn/interrupt',
      params: {
        threadId: 'thread-abort-1',
        turnId: 'turn-abort-1',
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-spawnedChild.pid, 'SIGINT')
    expect(spawnedChild.kill).not.toHaveBeenCalledWith('SIGINT')

    const replacementTrace = vi.fn()
    await expect(
      executeCodexAppServerTurn({
        onTraceEvent: replacementTrace,
        prompt: 'continue after abort',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-abort-2',
      turnId: 'turn-abort-2',
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
  })

  it('terminates Codex app-server process groups during shutdown', async () => {
    if (process.platform === 'win32') {
      return
    }

    const child = new MockChildProcess()
    child.pid = 424_242
    const killSpy = vi.mocked(process.kill)

    const stopped = stopCodexAppServerChild({
      child,
      closeStdin: () => null,
      processGroupPid: child.pid,
    })
    await Promise.resolve()
    child.emit('exit', null, 'SIGTERM')

    await stopped

    expect(killSpy).toHaveBeenCalledWith(-424_242, 'SIGTERM')
    expect(killSpy).toHaveBeenCalledWith(-424_242, 'SIGKILL')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('fails closed when Codex app-server ignores SIGKILL during shutdown', async () => {
    const child = new MockChildProcess()
    child.pid = 434_343
    child.kill.mockImplementation((signal?: NodeJS.Signals) => {
      child.killed = true
      void signal
      return true
    })

    vi.useFakeTimers()
    try {
      const stopped = stopCodexAppServerChild({
        child,
        closeStdin: () => null,
        processGroupPid: process.platform === 'win32' ? null : child.pid,
      })
      const stopError = stopped.then(
        () => null,
        (error: unknown) => error,
      )
      await vi.advanceTimersByTimeAsync(6_000)
      expect(await stopError).toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
    } finally {
      vi.useRealTimers()
    }

    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
    if (process.platform === 'win32') {
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } else {
      expect(process.kill).toHaveBeenCalledWith(-434_343, 'SIGTERM')
      expect(process.kill).toHaveBeenCalledWith(-434_343, 'SIGKILL')
      expect(child.kill).not.toHaveBeenCalled()
    }
  })

  it('registers parent-exit and signal cleanup for detached Codex app-server groups', () => {
    if (process.platform === 'win32') {
      return
    }

    const killSpy = vi.mocked(process.kill)
    const onceSpy = vi.spyOn(process, 'once')
    const offSpy = vi.spyOn(process, 'off')
    const cleanup = attachCodexAppServerProcessExitCleanup({
      processGroupPid: 515_151,
    })
    const exitListener = onceSpy.mock.calls.find(([eventName]) => eventName === 'exit')?.[1]
    const sigtermListener = onceSpy.mock.calls.find(([eventName]) => eventName === 'SIGTERM')?.[1]
    expect(exitListener).toBeTypeOf('function')
    expect(sigtermListener).toBeTypeOf('function')

    ;(sigtermListener as () => void)()
    cleanup()

    expect(killSpy).toHaveBeenCalledWith(-515_151, 'SIGKILL')
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    expect(offSpy).toHaveBeenCalledWith('exit', exitListener)
    expect(offSpy).toHaveBeenCalledWith('SIGTERM', sigtermListener)
  })
})
