import {
  cliTimingLaunchArgs,
  CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
  MockChildProcess,
  asRecord,
  codexMocks,
  createDeferred,
  createErrnoException,
  createHostedToolContext,
  createProgressDeliveryMock,
  createTempDir,
  emitProcessErrorAndExit,
  executeCodexAppServerTurn,
  isTestRecord,
  jsonLine,
  mockHostedCodexIdentityServer,
  mockProcessGroupSignalsForChildren,
  requireMockChildProcess,
  waitForProcessKill,
  waitForProcessKillWithFakeTimers,
  waitForRpcMethod,
  waitForRpcMethodCount,
  waitForRpcResponse,
  waitForStableMicrotask,
  writeCodexV2AssistantEventTurn,
  writeWarmTurnStarted,
} from "./assistant-codex-runtime.harness.ts";

import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import {
  initializeVault,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePort,
} from '@murphai/core'
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
  AssistantRuntimeIssueInput,
} from '../src/assistant/issue-reporting.ts'
import {
  CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA,
  CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE,
  createCodexActionDiagnosticsReducer,
  createCodexActionRuntimeIssueTracker,
} from '../src/assistant-codex/action-diagnostics.ts'
import {
  createAssistantProductFeedbackRecorder,
} from '../src/assistant/turn-progress.ts'
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

describe('assistant codex runtime', () => {it('rejects alternate current-turn id shapes on reused warm processes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-turn-id-shapes-work-')
    const codexHome = await createTempDir('assistant-codex-local-turn-id-shapes-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_800 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-turn-id-shape-1',
            turnId: 'turn-local-turn-id-shape-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-turn-id-shape-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-turn-id-shape-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-turn-id-shape-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            data: {
              turn_id: 'turn-local-turn-id-shape-2',
            },
            params: { itemId: 'assistant-local-turn-id-shape-2', delta: 'Second answer' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            data: {
              turn_id: 'turn-local-turn-id-shape-2',
            },
            params: {
              status: 'completed',
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
        prompt: 'first local turn before alternate id shapes',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-turn-id-shape-1',
      turnId: 'turn-local-turn-id-shape-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn with alternate id shapes',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
      context: {
        retryable: false,
      },
    })
  })

  it('rebinds canonical writes to the current turn on a reused warm process', async () => {
    const workingDirectory = await createTempDir('assistant-codex-warm-write-work-')
    const codexHome = await createTempDir('assistant-codex-warm-write-home-')
    const vaultRoot = await createTempDir('assistant-codex-warm-write-vault-')
    await initializeVault({ vaultRoot })
    const firstPersistCanonicalWrite = vi.fn(async () => undefined)
    const secondPersistCanonicalWrite = vi.fn(async () => undefined)
    const firstPort: HostedCanonicalWritePort = {
      persistCanonicalWrite: firstPersistCanonicalWrite,
    }
    const secondPort: HostedCanonicalWritePort = {
      persistCanonicalWrite: secondPersistCanonicalWrite,
    }
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }))
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-warm-write-1',
            turnId: 'turn-warm-write-1',
          })
          writeCodexV2AssistantEventTurn({
            child,
            finalMessage: 'First warm turn complete',
            threadId: 'thread-warm-write-1',
            turnId: 'turn-warm-write-1',
          })

          await writeWarmTurnStarted({
            child,
            requestCount: 2,
            threadId: 'thread-warm-write-2',
            turnId: 'turn-warm-write-2',
          })
          child.stdout.write(jsonLine({
            id: 91,
            method: 'item/tool/call',
            params: {
              namespace: 'murph',
              tool: 'generate_image',
              arguments: {
                prompt: 'Render the current turn.',
              },
              threadId: 'thread-warm-write-2',
              turnId: 'turn-warm-write-2',
            },
          }))
          await expect(waitForRpcResponse(child, 91)).resolves.toMatchObject({
            id: 91,
            result: {
              success: true,
            },
          })
          writeCodexV2AssistantEventTurn({
            child,
            finalMessage: 'Second warm turn complete',
            threadId: 'thread-warm-write-2',
            turnId: 'turn-warm-write-2',
          })
        })()
      })

      return child
    })

    await expect(withHostedCanonicalWritePort(
      firstPort,
      async () => await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          OPENAI_API_KEY: 'openai-test-key',
          PATH: '/custom/bin',
        },
        fetchImpl,
        hostedToolContext: createHostedToolContext({
          computerToolsAvailable: false,
        }),
        prompt: 'start the warm process',
        requireHostedPrivateImageDelivery: true,
        sandbox: 'workspace-write',
        vaultRoot,
        workingDirectory,
      }),
    )).resolves.toMatchObject({
      finalMessage: 'First warm turn complete',
    })

    await expect(withHostedCanonicalWritePort(
      secondPort,
      async () => await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          OPENAI_API_KEY: 'openai-test-key',
          PATH: '/custom/bin',
        },
        fetchImpl,
        hostedToolContext: createHostedToolContext({
          computerToolsAvailable: false,
        }),
        prompt: 'write from the current warm turn',
        requireHostedPrivateImageDelivery: true,
        sandbox: 'workspace-write',
        vaultRoot,
        workingDirectory,
      }),
    )).resolves.toMatchObject({
      finalMessage: 'Second warm turn complete',
    })

    expect(firstPersistCanonicalWrite).not.toHaveBeenCalled()
    expect(secondPersistCanonicalWrite).toHaveBeenCalled()
  })

  it('trusts tagged starts and retains first notification timing across duplicates', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-prestart-tagged-work-')
    const codexHome = await createTempDir('assistant-codex-local-prestart-tagged-home-')
    const realDateNow = Date.now.bind(Date)
    let controlledNowMs: number | null = null
    vi.spyOn(Date, 'now').mockImplementation(
      () => controlledNowMs ?? realDateNow(),
    )
    const onProviderRequestStarted = vi.fn()
    const onTraceEvent = vi.fn()
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_900 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-prestart-tagged-1',
            turnId: 'turn-local-prestart-tagged-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-prestart-tagged-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-prestart-tagged-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          const secondProviderStartedAtMs = Date.parse(
            onProviderRequestStarted.mock.calls.at(-1)?.[0]?.startedAt ?? '',
          )
          expect(Number.isFinite(secondProviderStartedAtMs)).toBe(true)
          controlledNowMs = secondProviderStartedAtMs + 10
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-local-prestart-tagged-2',
              },
            },
          }))
          controlledNowMs = secondProviderStartedAtMs + 20
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-local-prestart-tagged-2',
              },
            },
          }))
          controlledNowMs = secondProviderStartedAtMs + 30
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {},
          }))
          controlledNowMs = secondProviderStartedAtMs + 40
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-prestart-tagged-2', delta: 'Tagged event succeeded', turnId: 'turn-local-prestart-tagged-2' },
          }))
          controlledNowMs = secondProviderStartedAtMs + 50
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-prestart-tagged-2',
                status: 'completed',
              },
            },
          }))
          controlledNowMs = secondProviderStartedAtMs + 60
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-prestart-tagged-2',
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
      onProviderRequestStarted,
      onTraceEvent,
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'first local turn before tagged prestart event',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-prestart-tagged-1',
      turnId: 'turn-local-prestart-tagged-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        providerRequestOrdinal: 7,
        prompt: 'second local turn with tagged prestart turn/started',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Tagged event succeeded',
      sessionId: 'thread-local-prestart-tagged-2',
      turnId: 'turn-local-prestart-tagged-2',
    })
    controlledNowMs = null

    const secondTurnCompletedTiming = onTraceEvent.mock.calls
      .map(([event]) => event?.rawEvent)
      .filter((event) =>
        event?.type === 'assistant.codex.app_server_timing' &&
        event.codexTimingStage === 'turn-completed'
      )
      .at(-1)
    expect(secondTurnCompletedTiming).toEqual(expect.objectContaining({
      codexTimingProviderRequestOrdinal: 7,
      codexTimingTurnCompleteElapsedMs: 60,
      codexTimingTurnCompletedNotificationElapsedMs: 50,
      codexTimingTurnStartAckElapsedMs: 30,
      codexTimingTurnStartedNotificationElapsedMs: 10,
    }))
  })

  it('accepts tagged warm server requests after turn/started establishes the current turn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-prestart-request-work-')
    const codexHome = await createTempDir('assistant-codex-local-prestart-request-home-')
    const progressUpdates: string[] = []
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_925 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-prestart-request-1',
            turnId: 'turn-local-prestart-request-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-prestart-request-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-prestart-request-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-local-prestart-request-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: {
              arguments: {
                text: 'Starting early work',
              },
              callId: 'call-local-prestart-request-2',
              namespace: 'murph',
              threadId: 'thread-local-prestart-request-2',
              tool: 'send_progress_update',
              turnId: 'turn-local-prestart-request-2',
            },
          }))
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-prestart-request-2',
              },
            },
          }))

          const response = await waitForRpcResponse(child, 99)
          expect(response).toMatchObject({
            id: 99,
            result: {
              success: true,
            },
          })

          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-prestart-request-2', delta: 'Pre-start request completed', turnId: 'turn-local-prestart-request-2' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-prestart-request-2',
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
      progressDelivery: {
        send: vi.fn(async (text: string) => {
          progressUpdates.push(text)
          return { kind: 'sent' as const, source: 'model' as const }
        }),
      },
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'first local turn before prestart server request',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-prestart-request-1',
      turnId: 'turn-local-prestart-request-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn with started server request',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Pre-start request completed',
      sessionId: 'thread-local-prestart-request-2',
      turnId: 'turn-local-prestart-request-2',
    })
    expect(progressUpdates).toEqual(['Starting early work'])
  })

  it('attributes only post-start unscoped reroutes on a reused warm process', async () => {
    const workingDirectory = await createTempDir('assistant-codex-warm-reroute-work-')
    const codexHome = await createTempDir('assistant-codex-warm-reroute-home-')
    const onTraceEvent = vi.fn()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-warm-reroute',
            turnId: 'turn-warm-reroute-1',
          })
          writeCodexV2AssistantEventTurn({
            child,
            finalMessage: 'First warm turn complete',
            threadId: 'thread-warm-reroute',
            turnId: 'turn-warm-reroute-1',
          })

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: { id: 'thread-warm-reroute' },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: { id: 'turn-warm-reroute-2' },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'model/rerouted',
            params: { toModel: 'gpt-5.6-terra' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              threadId: 'thread-warm-reroute',
              turn: { id: 'turn-warm-reroute-2' },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'model/rerouted',
            params: { toModel: 'gpt-5.6-sol' },
          }))
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId: 'thread-warm-reroute',
              tokenUsage: {
                last: {
                  cacheWriteInputTokens: 0,
                  cachedInputTokens: 12,
                  inputTokens: 120,
                  outputTokens: 45,
                  reasoningOutputTokens: 8,
                  totalTokens: 165,
                },
                modelContextWindow: 258_400,
                total: {
                  cacheWriteInputTokens: 0,
                  cachedInputTokens: 12,
                  inputTokens: 120,
                  outputTokens: 45,
                  reasoningOutputTokens: 8,
                  totalTokens: 165,
                },
              },
              turnId: 'turn-warm-reroute-2',
            },
          }))
          writeCodexV2AssistantEventTurn({
            child,
            finalMessage: 'Current turn used the rerouted model',
            threadId: 'thread-warm-reroute',
            turnId: 'turn-warm-reroute-2',
          })
        })()
      })

      return child
    })

    const stableInput = {
      approvalPolicy: 'never',
      codexHome,
      env: { PATH: '/custom/bin' },
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }
    await expect(executeCodexAppServerTurn({
      ...stableInput,
      prompt: 'seed the warm process',
    })).resolves.toMatchObject({
      sessionId: 'thread-warm-reroute',
      turnId: 'turn-warm-reroute-1',
    })

    const result = await executeCodexAppServerTurn({
      ...stableInput,
      onTraceEvent,
      prompt: 'use the current rerouted model',
    })

    expect(result).toMatchObject({
      finalMessage: 'Current turn used the rerouted model',
      sessionId: 'thread-warm-reroute',
      turnId: 'turn-warm-reroute-2',
    })
    expect(result.jsonEvents.filter(
      (event) => isTestRecord(event) && asRecord(event).method === 'model/rerouted',
    )).toEqual([
      {
        method: 'model/rerouted',
        params: { toModel: 'gpt-5.6-sol' },
      },
    ])
    expect(onTraceEvent).toHaveBeenCalledWith(expect.objectContaining({
      rawEvent: {
        method: 'model/rerouted',
        params: { toModel: 'gpt-5.6-sol' },
      },
      updates: [{
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:model-reroute',
        text: 'Switched to gpt-5.6-sol.',
      }],
    }))
    expect(onTraceEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      rawEvent: {
        method: 'model/rerouted',
        params: { toModel: 'gpt-5.6-terra' },
      },
    }))
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('ignores stale same-thread messages tagged with an older turn id', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-stale-turn-id-work-')
    const codexHome = await createTempDir('assistant-codex-local-stale-turn-id-home-')
    const progressDelivery = createProgressDeliveryMock()
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_940 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-stale-turn-id',
            turnId: 'turn-local-stale-turn-id-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-stale-turn-id',
              turn: {
                id: 'turn-local-stale-turn-id-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-stale-turn-id',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: 98,
            method: 'item/tool/call',
            params: {
              arguments: {
                text: 'This pre-start stale progress must not send',
              },
              namespace: 'murph',
              threadId: 'thread-local-stale-turn-id',
              tool: 'send_progress_update',
              turnId: 'turn-local-stale-turn-id-1',
            },
          }))

          await expect(waitForRpcResponse(child, 98)).resolves.toMatchObject({
            error: {
              code: -32000,
              message: 'Codex parent-thread request arrived before the active turn id was known.',
            },
          })

          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-stale-turn-id-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-stale-turn-id',
              turn: {
                id: 'turn-local-stale-turn-id-1',
                status: 'completed',
              },
            },
          }))
          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: {
              arguments: {
                text: 'This stale progress must not send',
              },
              namespace: 'murph',
              threadId: 'thread-local-stale-turn-id',
              tool: 'send_progress_update',
              turnId: 'turn-local-stale-turn-id-1',
            },
          }))

          await expect(waitForRpcResponse(child, 99)).resolves.toMatchObject({
            error: {
              code: -32000,
              message: 'Codex message turn id does not match the active turn.',
            },
          })

          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-stale-turn-id-2', delta: 'Current turn survived stale output', threadId: 'thread-local-stale-turn-id', turnId: 'turn-local-stale-turn-id-2' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-stale-turn-id',
              turn: {
                id: 'turn-local-stale-turn-id-2',
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
      progressDelivery,
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'first local turn before stale same-thread output',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-stale-turn-id',
      turnId: 'turn-local-stale-turn-id-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn should ignore stale same-thread output after start',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Current turn survived stale output',
      sessionId: 'thread-local-stale-turn-id',
      turnId: 'turn-local-stale-turn-id-2',
    })
    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects untagged parent-thread server requests on reused warm processes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-untagged-request-work-')
    const codexHome = await createTempDir('assistant-codex-local-untagged-request-home-')
    const progressDelivery = createProgressDeliveryMock()
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_955 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-untagged-request',
            turnId: 'turn-local-untagged-request-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-untagged-request',
              turn: {
                id: 'turn-local-untagged-request-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-untagged-request',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: {
              __testPreserveMissingIdentity: true,
              arguments: {
                text: 'This unscoped progress must not send',
              },
              namespace: 'murph',
              tool: 'send_progress_update',
            },
          }))

          await expect(waitForRpcResponse(child, 99)).resolves.toMatchObject({
            error: {
              code: -32000,
              message: 'Codex parent-thread request did not include the active turn id.',
            },
          })
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-untagged-request-2',
              },
            },
          }))

          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-untagged-request-2', delta: 'Current turn rejected untagged request', threadId: 'thread-local-untagged-request', turnId: 'turn-local-untagged-request-2' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-untagged-request',
              turn: {
                id: 'turn-local-untagged-request-2',
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
      progressDelivery,
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'first local turn before untagged server request',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-untagged-request',
      turnId: 'turn-local-untagged-request-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn should reject untagged server request',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Current turn rejected untagged request',
      sessionId: 'thread-local-untagged-request',
      turnId: 'turn-local-untagged-request-2',
    })
    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('drops untagged parent-thread assistant output on reused warm processes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-untagged-output-work-')
    const codexHome = await createTempDir('assistant-codex-local-untagged-output-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_970 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-untagged-output',
            turnId: 'turn-local-untagged-output-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-untagged-output',
              turn: {
                id: 'turn-local-untagged-output-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-untagged-output',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-untagged-output-2', delta: 'This unscoped output must not be accepted' },
          }))
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-untagged-output-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-local-untagged-output-current', delta: 'Current turn ignored untagged output', threadId: 'thread-local-untagged-output', turnId: 'turn-local-untagged-output-2' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-local-untagged-output',
              turn: {
                id: 'turn-local-untagged-output-2',
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
        prompt: 'first local turn before untagged assistant output',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-untagged-output',
      turnId: 'turn-local-untagged-output-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn should ignore untagged assistant output',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Current turn ignored untagged output',
      sessionId: 'thread-local-untagged-output',
      turnId: 'turn-local-untagged-output-2',
    })
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('keeps live steering closed after a pre-lifecycle computer pause request', async () => {
    const workingDirectory = await createTempDir('assistant-codex-prestart-pause-live-turn-work-')
    const codexHome = await createTempDir('assistant-codex-prestart-pause-live-turn-home-')
    const spawnedChildren: MockChildProcess[] = []
    let liveTurnRegistrations = 0
    mockProcessGroupSignalsForChildren(spawnedChildren)

    const hostedToolContext = createHostedToolContext()
    const progressDelivery = createProgressDeliveryMock()
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestUrl = String(url)
      if (!requestUrl.endsWith('/pause-for-user')) {
        throw new Error(`Unexpected fetch URL: ${requestUrl}`)
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({
        reason: 'final_confirmation',
      })
      return new Response(JSON.stringify({
        awaitingReason: 'final_confirmation',
        handoffUrl: null,
        runId: 'run_123',
        status: 'awaiting_user',
        suggestedReply: 'yes',
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_950 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-prestart-pause-live-turn-1',
            turnId: 'turn-prestart-pause-live-turn-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-prestart-pause-live-turn-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-prestart-pause-live-turn-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-prestart-pause-live-turn-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            id: 103,
            method: 'item/tool/call',
            params: {
              arguments: {
                handoffPurpose: 'manual_browser_help',
                reason: 'final_confirmation',
                runId: 'run_123',
                suggestedReply: 'yes',
              },
              namespace: 'murph',
              tool: 'computer_pause_for_user',
              turnId: 'turn-prestart-pause-live-turn-2',
            },
          }))

          await expect(waitForRpcResponse(child, 103)).resolves.toMatchObject({
            id: 103,
            result: {
              success: true,
            },
          })
          expect(liveTurnRegistrations).toBe(0)

          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-prestart-pause-live-turn-2',
              },
            },
          }))

          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-prestart-pause-live-turn-2', delta: 'Paused for confirmation.', turnId: 'turn-prestart-pause-live-turn-2' },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-prestart-pause-live-turn-2',
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
      fetchImpl,
      hostedToolContext,
      progressDelivery,
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'first local turn before prestart pause',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-prestart-pause-live-turn-1',
      turnId: 'turn-prestart-pause-live-turn-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        onLiveTurn: () => {
          liveTurnRegistrations += 1
          return () => {}
        },
        prompt: 'second local turn with prestart pause',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Paused for confirmation.',
      sessionId: 'thread-prestart-pause-live-turn-2',
      turnId: 'turn-prestart-pause-live-turn-2',
    })
    expect(liveTurnRegistrations).toBe(0)
  })

  it('preserves reused turn/start JSON-RPC errors instead of reporting missing turn ids', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-turn-start-error-work-')
    const codexHome = await createTempDir('assistant-codex-local-turn-start-error-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_935 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-turn-start-error-1',
            turnId: 'turn-local-turn-start-error-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-turn-start-error-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-turn-start-error-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            error: {
              code: -32000,
              message: 'turn/start failed before a turn id was allocated',
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
        prompt: 'first local turn before turn/start error',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-turn-start-error-1',
      turnId: 'turn-local-turn-start-error-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn with turn/start error',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED',
      context: {
        method: 'turn/start',
        retryable: false,
        staleResume: false,
      },
      message: 'turn/start failed before a turn id was allocated',
    })
    expect(process.kill).toHaveBeenCalledWith(-25_935, 'SIGTERM')
  })

  it('rejects dotted lifecycle event aliases on reused warm processes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-dotted-events-work-')
    const codexHome = await createTempDir('assistant-codex-local-dotted-events-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_940 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-dotted-events-1',
            turnId: 'turn-local-dotted-events-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-dotted-events-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-dotted-events-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-dotted-events-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            data: {
              turn_id: 'turn-local-dotted-events-2',
            },
            params: {
              item: {
                id: 'assistant-local-dotted-events-2',
                type: 'agentMessage',
              },
              delta: 'Dotted lifecycle completed',
            },
            type: 'assistant.message.delta',
          }))
          child.stdout.write(jsonLine({
            data: {
              status: 'completed',
              turn_id: 'turn-local-dotted-events-2',
            },
            type: 'turn.completed',
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
        prompt: 'first local turn before dotted events',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-dotted-events-1',
      turnId: 'turn-local-dotted-events-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn with dotted events',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
      context: {
        retryable: false,
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-25_940, 'SIGTERM')
  })

  it('rejects turn completion status carried outside exact params', async () => {
    const workingDirectory = await createTempDir('assistant-codex-data-failed-work-')
    const codexHome = await createTempDir('assistant-codex-data-failed-home-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_950

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-data-failed',
            turnId: 'turn-data-failed',
          })
          child.stdout.write(jsonLine({
            data: {
              error: {
                message: 'data failure detail',
              },
              status: 'failed',
              turn_id: 'turn-data-failed',
            },
            method: 'turn/completed',
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
        prompt: 'turn fails through data status',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
      context: {
        retryable: false,
      },
    })
  })

  it('poisons warm Codex after malformed active-turn output before local reuse', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-malformed-work-')
    const codexHome = await createTempDir('assistant-codex-local-malformed-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      spawnedChild.pid = 25_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: `thread-local-malformed-${processNumber}`,
            turnId: `turn-local-malformed-${processNumber}`,
          })

          if (processNumber === 1) {
            spawnedChild.stdout.write('not-json\n')
            return
          }

          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-local-malformed-${processNumber}`,
                status: 'completed',
              },
            },
          }))
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

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'malformed local warm turn',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
      context: {
        retryable: false,
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-25_000, 'SIGTERM')

    const replacementTrace = vi.fn()

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        onTraceEvent: replacementTrace,
        prompt: 'next local turn after malformed output',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-malformed-2',
      turnId: 'turn-local-malformed-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-turn-failure',
          codexTimingStage: 'initialized',
        }),
      }),
    )
    expect(requireMockChildProcess(spawnedChildren[1] ?? null).pid)
      .not.toBe(requireMockChildProcess(spawnedChildren[0] ?? null).pid)
  })

  it('preserves turn-failure attribution across a failed teardown retry', async () => {
    const workingDirectory = await createTempDir('assistant-codex-teardown-retry-work-')
    const codexHome = await createTempDir('assistant-codex-teardown-retry-home-')
    const spawnedChildren: MockChildProcess[] = []
    const firstTurnReady = createDeferred<void>()

    vi.mocked(process.kill).mockImplementation(() => true)
    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      spawnedChild.pid = 25_500 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))
          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: `thread-teardown-retry-${processNumber}`,
            turnId: `turn-teardown-retry-${processNumber}`,
          })
          if (processNumber === 1) {
            firstTurnReady.resolve()
            return
          }
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-teardown-retry-${processNumber}`,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    const stableInput = {
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    }
    const failedTurn = executeCodexAppServerTurn({
      ...stableInput,
      prompt: 'turn with failed teardown',
    })
    const failureError = failedTurn.then(
      () => null,
      (error: unknown) => error,
    )
    await firstTurnReady.promise

    try {
      vi.useFakeTimers()
      requireMockChildProcess(spawnedChildren[0] ?? null).stdout.write('not-json\n')
      await waitForProcessKillWithFakeTimers(-25_500, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(await failureError).toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
      })
    } finally {
      vi.useRealTimers()
    }

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

    const replacementTrace = vi.fn()
    await executeCodexAppServerTurn({
      ...stableInput,
      onTraceEvent: replacementTrace,
      prompt: 'turn after teardown retry',
    })

    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-turn-failure',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it('bounds fake-time process-kill polling at two virtual seconds', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()

    try {
      await expect(
        waitForProcessKillWithFakeTimers(-25_550, 'SIGTERM'),
      ).rejects.toThrow(
        'Expected process.kill(-25550, SIGTERM) to be called.',
      )
      expect(Date.now() - startedAt).toBe(2_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the exact failed process teardown before replacement', async () => {
    const workingDirectory = await createTempDir('assistant-codex-teardown-race-work-')
    const codexHome = await createTempDir('assistant-codex-teardown-race-home-')
    const spawnedChildren: MockChildProcess[] = []
    const firstTurnReady = createDeferred<void>()

    vi.mocked(process.kill).mockImplementation(() => true)
    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      spawnedChild.pid = 25_600 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))
          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: `thread-teardown-race-${processNumber}`,
            turnId: `turn-teardown-race-${processNumber}`,
          })
          if (processNumber === 1) {
            firstTurnReady.resolve()
            return
          }
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-teardown-race-${processNumber}`,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    const stableInput = {
      codexHome,
      env: { PATH: '/custom/bin' },
      workingDirectory,
    }
    const failedTurn = executeCodexAppServerTurn({
      ...stableInput,
      prompt: 'turn with racing teardown',
    })
    void failedTurn.catch(() => undefined)
    await firstTurnReady.promise

    const failedChild = requireMockChildProcess(spawnedChildren[0] ?? null)
    failedChild.stdout.write('not-json\n')
    await waitForProcessKill(-25_600, 'SIGTERM')

    const concurrentStop = stopWarmCodexAppServer('operator-stop')
    void concurrentStop.catch(() => undefined)
    await waitForStableMicrotask()
    expect(
      vi.mocked(process.kill).mock.calls.filter(
        ([pid, signal]) => pid === -25_600 && signal === 'SIGTERM',
      ),
    ).toHaveLength(1)

    const replacementTrace = vi.fn()
    const replacementTurn = executeCodexAppServerTurn({
      ...stableInput,
      onTraceEvent: replacementTrace,
      prompt: 'replacement racing teardown cleanup',
    })
    void replacementTurn.catch(() => undefined)
    await waitForStableMicrotask()
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)

    failedChild.emit('exit', null, 'SIGTERM')
    failedChild.emit('close', null, 'SIGTERM')

    await expect(failedTurn).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
    })
    await expect(concurrentStop).resolves.toBeUndefined()
    await expect(replacementTurn).resolves.toMatchObject({
      sessionId: 'thread-teardown-race-2',
      turnId: 'turn-teardown-race-2',
    })
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-turn-failure',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it('emits one metadata-only Codex action diagnostics trace after a turn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-action-diagnostics-')
    const onTraceEvent = vi.fn()

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
                  id: 'thread-diagnostics',
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
                  id: 'turn-diagnostics',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/started',
              params: {
                startedAtMs: 100,
                item: {
                  id: 'cmd-1',
                  type: 'commandExecution',
                  command: 'cat /tmp/raw-private-file',
                  cwd: '/tmp/raw-private-cwd',
                  status: 'running',
                },
                threadId: 'thread-diagnostics',
                turnId: 'turn-diagnostics',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                completedAtMs: 160,
                item: {
                  id: 'cmd-1',
                  type: 'commandExecution',
                  command: 'cat /tmp/raw-private-file',
                  cwd: '/tmp/raw-private-cwd',
                  status: 'completed',
                  exitCode: 0,
                  aggregatedOutput: 'command raw output must not appear',
                },
                threadId: 'thread-diagnostics',
                turnId: 'turn-diagnostics',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                completedAtMs: 300,
                item: {
                  id: 'dyn-1',
                  type: 'dynamicToolCall',
                  namespace: 'murph',
                  tool: 'send_progress_update',
                  status: 'completed',
                  success: true,
                  durationMs: 123,
                  arguments: {
                    secretPath: '/tmp/raw-argument',
                  },
                  contentItems: [
                    {
                      type: 'inputText',
                      text: 'dynamic raw output must not appear',
                    },
                    {
                      type: 'inputImage',
                      imageUrl: 'data:image/png;base64,AAA',
                    },
                  ],
                },
                threadId: 'thread-diagnostics',
                turnId: 'turn-diagnostics',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                completedAtMs: 340,
                item: {
                  id: 'mcp-1',
                  type: 'mcpToolCall',
                  server: 'web',
                  tool: 'search_query',
                  status: 'completed',
                  durationMs: 80,
                  arguments: {
                    secretPath: '/tmp/raw-mcp-argument',
                  },
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: 'mcp raw output must not appear',
                      },
                    ],
                    structuredContent: {
                      ok: true,
                    },
                    _meta: {
                      more: 'meta',
                    },
                  },
                },
                threadId: 'thread-diagnostics',
                turnId: 'turn-diagnostics',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-diagnostics',
                turnId: 'turn-diagnostics',
                tokenUsage: {
                  last: { cacheWriteInputTokens: 0,
                    cachedInputTokens: 1000,
                    inputTokens: 81000,
                    outputTokens: 1200,
                    reasoningOutputTokens: 300,
                    totalTokens: 82500,
                  },
                  total: { cacheWriteInputTokens: 0,
                    cachedInputTokens: 1000,
                    inputTokens: 81000,
                    outputTokens: 1200,
                    reasoningOutputTokens: 300,
                    totalTokens: 82500,
                  },
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-diagnostics',
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
        onTraceEvent,
        prompt: 'diagnose usage',
        providerRequestOrdinal: 4,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      providerActionCount: 3,
      sessionId: 'thread-diagnostics',
    })

    const diagnosticEvents = onTraceEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => {
        const rawEvent = asRecord(event.rawEvent)
        return rawEvent.schema === CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA
      })
    expect(diagnosticEvents).toHaveLength(1)
    const diagnosticEvent = diagnosticEvents[0]
    expect(diagnosticEvent).toBeTruthy()
    expect(diagnosticEvent?.codexThreadId).toBeNull()
    expect(diagnosticEvent?.rawEvent).toMatchObject({
      schema: CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA,
      type: CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE,
      codexActionCommandCount: 1,
      codexActionDynamicToolCallCount: 1,
      codexActionMcpToolCallCount: 1,
      codexActionInputUnitMax: 81000,
      codexActionKinds: ['command.execution', 'dynamic.tool.call', 'mcp.tool.call'],
      codexActionOutputBytesMax: 59,
      codexActionOutputBytesTotal: 149,
      codexActionOutputItemCount: 6,
      codexActionProgressUpdateCallCount: 1,
      codexActionProgressUpdateFirstCallElapsedMs: expect.any(Number),
      codexActionProgressUpdateSentCount: 1,
      codexActionProviderActionCount: 3,
      codexActionSlowDurationMs: [123, 80, 60],
      codexActionSlowKinds: [
        'dynamic.tool.call',
        'mcp.tool.call',
        'command.execution',
      ],
      codexActionToolSummaries: [
        {
          callCount: 1,
          kind: 'dynamic.tool.call',
          namespacePresent: true,
          outputBytesMax: 59,
          outputBytesTotal: 59,
          tool: 'send_progress_update',
        },
        {
          callCount: 1,
          kind: 'mcp.tool.call',
          outputBytesMax: 56,
          outputBytesTotal: 56,
          serverPresent: true,
          tool: 'search_query',
        },
        {
          callCount: 1,
          kind: 'command.execution',
          outputBytesMax: 34,
          outputBytesTotal: 34,
        },
      ],
      codexActionUsageSampleCount: 1,
      codexActionTurnCorrelation: expect.any(Number),
    })
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('/tmp/raw')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('raw output')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('mcp raw output')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('secretPath')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('thread-diagnostics')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('turn-diagnostics')
    const completionTimingEvent = onTraceEvent.mock.calls
      .map(([event]) => event)
      .find((event) => {
        const rawEvent = asRecord(event.rawEvent)
        return rawEvent.type === 'assistant.codex.app_server_timing'
          && rawEvent.codexTimingStage === 'turn-completed'
      })
    expect(
      asRecord(completionTimingEvent?.rawEvent).codexTimingTurnCorrelation,
    ).toBe(
      asRecord(diagnosticEvent?.rawEvent).codexActionTurnCorrelation,
    )
  })

  it('emits metadata-only Codex transport diagnostics for stream retry and fallback', async () => {
    const workingDirectory = await createTempDir('assistant-codex-transport-diagnostics-')
    const onTraceEvent = vi.fn()

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
                  id: 'thread-transport',
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
                  id: 'turn-transport',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-transport',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'error',
              params: {
                error: {
                  message: 'Reconnecting... 2/5',
                  codexErrorInfo: {
                    responseStreamDisconnected: {
                      httpStatusCode: null,
                    },
                  },
                  additionalDetails:
                    'stream disconnected before completion: idle timeout waiting for websocket at https://api.openai.com/v1/responses',
                },
                threadId: 'thread-transport',
                turnId: 'turn-transport',
                willRetry: true,
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'warning',
              params: {
                threadId: 'thread-transport',
                message:
                  'Falling back from WebSockets to HTTPS transport. raw endpoint https://api.openai.com/v1/responses',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-transport',
                  type: 'agentMessage',
                  text: 'Recovered.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-transport',
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
        onTraceEvent,
        prompt: 'diagnose transport',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Recovered.',
      sessionId: 'thread-transport',
      turnId: 'turn-transport',
    })

    const diagnosticEvents = onTraceEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => {
        const rawEvent = asRecord(event.rawEvent)
        return rawEvent.schema === CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA
      })
    expect(diagnosticEvents).toHaveLength(2)

    const retryDiagnostic = asRecord(diagnosticEvents[0]?.rawEvent)
    expect(retryDiagnostic).toMatchObject({
      schema: CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
      type: 'assistant.codex.transport_diagnostics',
      codexTransportAdditionalDetailsPresent: true,
      codexTransportEventKind: 'stream-idle-timeout',
      codexTransportFallbackActivated: false,
      codexTransportIdleTimeout: true,
      codexTransportRetryExhausted: false,
      codexTransportRetryCount: 2,
      codexTransportRetryMax: 5,
      codexTransportSourceMethod: 'error',
      codexTransportStreamDisconnected: true,
      codexTransportTerminalAfterProviderAction: false,
      codexTransportThreadIdPresent: true,
      codexTransportTransport: 'websocket',
      codexTransportTurnIdPresent: true,
      codexTransportWillRetry: true,
    })

    const fallbackDiagnostic = asRecord(diagnosticEvents[1]?.rawEvent)
    expect(fallbackDiagnostic).toMatchObject({
      schema: CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
      type: 'assistant.codex.transport_diagnostics',
      codexTransportEventKind: 'transport-fallback',
      codexTransportFallbackActivated: true,
      codexTransportRetryExhausted: false,
      codexTransportSourceMethod: 'warning',
      codexTransportTerminalAfterProviderAction: false,
      codexTransportTransport: 'websocket',
      codexTransportWillRetry: null,
    })

    expect(JSON.stringify(diagnosticEvents)).not.toContain('api.openai.com')
  })

  it('discards feedback from a disconnected stream and keeps native retry safe', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-product-feedback-retry-',
    )
    const acceptProductFeedbackCandidate = vi.fn()
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{
        id: 'assistant_input_feedback_retry',
        source: 'assistant-input',
      }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate,
      },
    })
    if (!productFeedbackRecorder) {
      throw new Error('Expected product feedback collection to be available.')
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
            result: {
              thread: {
                id: 'thread-product-feedback-retry',
              },
            },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: {
              turn: {
                id: 'turn-product-feedback-retry',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-product-feedback-retry',
              },
            },
          }))

          child.stdout.write(jsonLine({
            id: 81,
            method: 'item/tool/call',
            params: {
              arguments: {
                kind: 'feature_request',
                summary: 'Speculative: first disconnected candidate.',
              },
              namespace: 'murph',
              tool: 'submit_product_feedback',
              turnId: 'turn-product-feedback-retry',
            },
          }))
          await expect(waitForRpcResponse(child, 81)).resolves.toMatchObject({
            result: {
              success: true,
            },
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'feedback-disconnected',
                namespace: 'murph',
                status: 'completed',
                success: true,
                tool: 'submit_product_feedback',
                type: 'dynamicToolCall',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'error',
            params: {
              error: {
                message: 'Reconnecting... 1/5',
                additionalDetails:
                  'stream disconnected before completion',
              },
              threadId: 'thread-product-feedback-retry',
              turnId: 'turn-product-feedback-retry',
              willRetry: true,
            },
          }))

          child.stdout.write(jsonLine({
            id: 82,
            method: 'item/tool/call',
            params: {
              arguments: {
                kind: 'feature_request',
                summary: 'Speculative: recovered candidate.',
              },
              namespace: 'murph',
              tool: 'submit_product_feedback',
              turnId: 'turn-product-feedback-retry',
            },
          }))
          await expect(waitForRpcResponse(child, 82)).resolves.toMatchObject({
            result: {
              success: true,
            },
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'feedback-recovered',
                namespace: 'murph',
                status: 'completed',
                success: true,
                tool: 'submit_product_feedback',
                type: 'dynamicToolCall',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-product-feedback-retry',
                text: 'Recovered response.',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-product-feedback-retry',
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
        productFeedbackRecorder,
        prompt: 'retry after collecting feedback',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Recovered response.',
      providerActionCount: 0,
    })
    expect(productFeedbackRecorder.readProductFeedback()).toMatchObject({
      kind: 'feature_request',
      summary: 'Speculative: recovered candidate.',
    })
    expect(acceptProductFeedbackCandidate).not.toHaveBeenCalled()
  })

  it('emits terminal Codex transport diagnostics after provider actions', async () => {
    const workingDirectory = await createTempDir('assistant-codex-transport-terminal-')
    const onTraceEvent = vi.fn()

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
                  id: 'thread-transport-terminal',
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
                  id: 'turn-transport-terminal',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-transport-terminal',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'cmd-transport-terminal',
                  type: 'commandExecution',
                  status: 'completed',
                  exitCode: 0,
                  aggregatedOutput: 'command raw output must not appear',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'error',
              params: {
                error: {
                  message: 'stream disconnected before completion',
                  codexErrorInfo: {
                    responseStreamDisconnected: {
                      httpStatusCode: null,
                    },
                  },
                  additionalDetails:
                    'stream disconnected before completion at https://api.openai.com/v1/responses',
                },
                threadId: 'thread-transport-terminal',
                turnId: 'turn-transport-terminal',
                willRetry: false,
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-transport-terminal',
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
        onTraceEvent,
        prompt: 'diagnose terminal transport',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
    })

    const diagnosticEvents = onTraceEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => {
        const rawEvent = asRecord(event.rawEvent)
        return rawEvent.schema === CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA
      })
    expect(diagnosticEvents).toHaveLength(1)

    const terminalDiagnostic = asRecord(diagnosticEvents[0]?.rawEvent)
    expect(terminalDiagnostic).toMatchObject({
      schema: CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
      type: 'assistant.codex.transport_diagnostics',
      codexTransportAdditionalDetailsPresent: true,
      codexTransportEventKind: 'stream-disconnected',
      codexTransportProviderActionCount: 1,
      codexTransportRetryExhausted: true,
      codexTransportSourceMethod: 'error',
      codexTransportStreamDisconnected: true,
      codexTransportTerminalAfterProviderAction: true,
      codexTransportThreadIdPresent: true,
      codexTransportTransport: 'http',
      codexTransportTurnIdPresent: true,
      codexTransportWillRetry: false,
    })
    expect(JSON.stringify(diagnosticEvents)).not.toContain('api.openai.com')
    expect(JSON.stringify(diagnosticEvents)).not.toContain('command raw output')
  })

  it('keeps Codex action diagnostics scoped and deduped per active turn', () => {
    const reducer = createCodexActionDiagnosticsReducer()
    const activeTurnId = 'turn-current'
    const staleTokenEvent = {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-current',
        turnId: 'turn-previous',
        tokenUsage: {
          last: { cacheWriteInputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
            inputTokens: 999999,
            outputTokens: 999999,
            totalTokens: 999999,
          },
          modelContextWindow: null,
          total: { cacheWriteInputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
            inputTokens: 999999,
            outputTokens: 999999,
            totalTokens: 999999,
          },
        },
      },
    }
    const currentTokenEvent = {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-current',
        turnId: activeTurnId,
        tokenUsage: {
          last: { cacheWriteInputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
            inputTokens: 123,
            outputTokens: 45,
            totalTokens: 168,
          },
          modelContextWindow: null,
          total: { cacheWriteInputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
            inputTokens: 123,
            outputTokens: 45,
            totalTokens: 168,
          },
        },
      },
    }
    const rawStartedEvent = {
      method: 'item/started',
      params: {
        startedAtMs: 10,
        item: {
          id: 'raw-action-id',
          type: 'commandExecution',
          status: 'running',
        },
        threadId: 'thread-current',
        turnId: activeTurnId,
      },
    }
    const rawCompletedEvent = {
      method: 'item/completed',
      params: {
        completedAtMs: 70,
        item: {
          id: 'raw-action-id',
          type: 'commandExecution',
          status: 'completed',
          aggregatedOutput: 'raw output must not appear',
        },
        threadId: 'thread-current',
        turnId: activeTurnId,
      },
    }
    const rawStartedNormalized = normalizeCodexEvent(rawStartedEvent)
    const rawCompletedNormalized = normalizeCodexEvent(rawCompletedEvent)

    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: normalizeCodexEvent(staleTokenEvent),
      observedAtMs: 0,
      rawEvent: staleTokenEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: normalizeCodexEvent(currentTokenEvent),
      observedAtMs: 0,
      rawEvent: currentTokenEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawStartedNormalized,
      observedAtMs: 10,
      rawEvent: rawStartedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawStartedNormalized,
      observedAtMs: 10,
      rawEvent: rawStartedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawCompletedNormalized,
      observedAtMs: 70,
      rawEvent: rawCompletedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawCompletedNormalized,
      observedAtMs: 70,
      rawEvent: rawCompletedEvent,
    })

    const trace = reducer.buildTraceEvent({
      codexThreadId: 'thread-current',
      providerActionCount: 0,
      providerStartedAtMs: 0,
      turnCorrelation: 1234,
      turnId: activeTurnId,
    })
    expect(trace).toMatchObject({
      codexActionCommandCount: 1,
      codexActionCompletedCount: 1,
      codexActionDurationMsMax: 60,
      codexActionDurationMsTotal: 60,
      codexActionInputUnitMax: 123,
      codexActionOutputBytesMax: 26,
      codexActionOutputBytesTotal: 26,
      codexActionOutputItemCount: 1,
      codexActionOutputUnitMax: 45,
      codexActionProgressUpdateCallCount: 0,
      codexActionProgressUpdateSentCount: 0,
      codexActionStartedCount: 1,
      codexActionToolSummaries: [
        {
          callCount: 1,
          kind: 'command.execution',
          outputBytesMax: 26,
          outputBytesTotal: 26,
        },
      ],
      codexActionTotalUnitMax: 168,
      codexActionTurnCorrelation: 1234,
      codexActionUsageSampleCount: 1,
    })
    expect(JSON.stringify(trace)).not.toContain('999999')
    expect(JSON.stringify(trace)).not.toContain('raw-action-id')
    expect(JSON.stringify(trace)).not.toContain('raw output')
  })

  it('records progress call timing and delivery outcomes without progress text', () => {
    const reducer = createCodexActionDiagnosticsReducer()
    const activeTurnId = 'turn-progress-diagnostics'
    const events = [
      {
        observedAtMs: 1_200,
        rawEvent: {
          method: 'item/started',
          params: {
            item: {
              id: 'progress-sent',
              namespace: 'murph',
              status: 'running',
              tool: 'send_progress_update',
              type: 'dynamicToolCall',
            },
            turnId: activeTurnId,
          },
        },
      },
      {
        observedAtMs: 1_250,
        rawEvent: {
          method: 'item/completed',
          params: {
            item: {
              contentItems: [{
                text: 'progress update sent',
                type: 'inputText',
              }],
              durationMs: 50,
              id: 'progress-sent',
              namespace: 'murph',
              status: 'completed',
              success: true,
              tool: 'send_progress_update',
              type: 'dynamicToolCall',
            },
            turnId: activeTurnId,
          },
        },
      },
      {
        observedAtMs: 1_500,
        rawEvent: {
          method: 'item/completed',
          params: {
            item: {
              contentItems: [{
                text: 'progress update failed during best-effort delivery',
                type: 'inputText',
              }],
              durationMs: 20,
              id: 'progress-failed',
              namespace: 'murph',
              status: 'failed',
              success: false,
              tool: 'send_progress_update',
              type: 'dynamicToolCall',
            },
            turnId: activeTurnId,
          },
        },
      },
    ]

    for (const event of events) {
      reducer.recordEvent({
        activeTurnId,
        normalizedEvent: normalizeCodexEvent(event.rawEvent),
        observedAtMs: event.observedAtMs,
        rawEvent: event.rawEvent,
      })
    }

    const trace = reducer.buildTraceEvent({
      codexThreadId: 'thread-progress-diagnostics',
      providerActionCount: 2,
      providerStartedAtMs: 1_000,
      turnCorrelation: 5678,
      turnId: activeTurnId,
    })

    expect(trace).toMatchObject({
      codexActionProgressUpdateCallCount: 2,
      codexActionProgressUpdateFirstCallElapsedMs: 200,
      codexActionProgressUpdateSentCount: 1,
      codexActionTurnCorrelation: 5678,
    })
    expect(
      Number(trace?.codexActionProgressUpdateCallCount)
      - Number(trace?.codexActionProgressUpdateSentCount),
    ).toBe(1)
    expect(JSON.stringify(trace)).not.toContain('best-effort delivery')
    expect(JSON.stringify(trace)).not.toContain('thread-progress-diagnostics')
    expect(JSON.stringify(trace)).not.toContain(activeTurnId)
  })

  it('builds privacy-safe runtime issues for failed Codex action events', () => {
    const issueTracker = createCodexActionRuntimeIssueTracker()
    const failedCommandEvent = {
      method: 'item/completed',
      params: {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          exitCode: 2,
          durationMs: 6_000,
          command: 'cat /tmp/private-file',
          filePaths: ['/tmp/private-file'],
          stdout: 'private stdout',
          stderr: 'private stderr',
          aggregatedOutput: 'private aggregate',
        },
        threadId: 'thread-current',
        turnId: 'turn-current',
      },
    }
    const failedCommandIssue = issueTracker.recordEvent({
      activeTurnId: 'turn-current',
      normalizedEvent: normalizeCodexEvent(failedCommandEvent),
      rawEvent: failedCommandEvent,
    })
    expect(failedCommandIssue).toEqual({
      component: 'assistant.codex-action',
      operation: 'command.execution',
      phase: 'provider_turn',
      issueKind: 'tool_error',
      severity: 'warning',
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      summary: 'Codex command execution failed during provider turn.',
      details: {
        actionKind: 'command.execution',
        commandFamily: 'cat',
        commandOrdinal: 1,
        durationMsBucket: '5_30s',
        exitCode: 2,
        outputBytesBucket: 'lt_1kb',
      },
    })

    const successfulCommandEvent = {
      method: 'item/completed',
      params: {
        item: {
          id: 'cmd-2',
          type: 'commandExecution',
          exitCode: 0,
          stdout: 'ok',
        },
        threadId: 'thread-current',
        turnId: 'turn-current',
      },
    }
    expect(issueTracker.recordEvent({
      activeTurnId: 'turn-current',
      normalizedEvent: normalizeCodexEvent(successfulCommandEvent),
      rawEvent: successfulCommandEvent,
    })).toBeNull()

    const failedMcpEvent = {
      method: 'item/completed',
      params: {
        item: {
          id: 'mcp-1',
          type: 'mcpToolCall',
          status: 'failed',
          server: 'web',
          tool: 'search_query',
          result: {
            content: [
              {
                type: 'text',
                text: 'mcp private output',
              },
            ],
          },
        },
        threadId: 'thread-current',
        turnId: 'turn-current',
      },
    }
    expect(issueTracker.recordEvent({
      activeTurnId: 'turn-current',
      normalizedEvent: normalizeCodexEvent(failedMcpEvent),
      rawEvent: failedMcpEvent,
    })).toEqual({
      component: 'assistant.codex-action',
      operation: 'mcp.tool.call',
      phase: 'tool_call',
      issueKind: 'tool_error',
      severity: 'warning',
      errorCode: 'CODEX_TOOL_CALL_FAILED',
      summary: 'Codex tool call failed during provider turn.',
      details: {
        actionKind: 'mcp.tool.call',
        durationMsBucket: 'unknown',
        outputBytesBucket: 'lt_1kb',
        tool: 'search_query',
      },
    })

    const failedDynamicEvent = {
      method: 'item/completed',
      params: {
        item: {
          id: 'dynamic-1',
          type: 'dynamicToolCall',
          namespace: 'murph',
          tool: 'connected_apps_execute',
          success: false,
          arguments: {
            prompt: 'private prompt',
          },
          formattedOutput: 'dynamic private output',
        },
        threadId: 'thread-current',
        turnId: 'turn-current',
      },
    }
    const dynamicIssue = issueTracker.recordEvent({
      activeTurnId: 'turn-current',
      normalizedEvent: normalizeCodexEvent(failedDynamicEvent),
      rawEvent: failedDynamicEvent,
    })
    expect(dynamicIssue).toEqual({
      component: 'assistant.codex-action',
      operation: 'dynamic.tool.call',
      phase: 'tool_call',
      issueKind: 'tool_error',
      severity: 'warning',
      errorCode: 'CODEX_DYNAMIC_TOOL_CALL_FAILED',
      summary: 'Codex dynamic tool call failed during provider turn.',
      details: {
        actionKind: 'dynamic.tool.call',
        durationMsBucket: 'unknown',
        outputBytesBucket: 'lt_1kb',
        // Names the failing surface without the arguments or output around it.
        tool: 'connected_apps_execute',
      },
    })

    const encodedIssues = JSON.stringify([
      dynamicIssue,
      failedCommandIssue,
    ])
    expect(encodedIssues).not.toContain('private stdout')
    expect(encodedIssues).not.toContain('private stderr')
    expect(encodedIssues).not.toContain('private aggregate')
    expect(encodedIssues).not.toContain('/tmp/private-file')
    expect(encodedIssues).not.toContain('private prompt')
    expect(encodedIssues).not.toContain('dynamic private output')
  })

  it('attributes command failures without retaining private command data', () => {
    const issueTracker = createCodexActionRuntimeIssueTracker()
    const commandEvent = (input: {
      command?: string
      event: 'completed' | 'started'
      exitCode?: number
      id: string
      output?: string
    }) => ({
      method: `item/${input.event}`,
      params: {
        item: {
          id: input.id,
          type: 'commandExecution',
          ...(input.command === undefined
            ? {}
            : { command: input.command }),
          ...(input.exitCode === undefined
            ? {}
            : { exitCode: input.exitCode }),
          ...(input.output === undefined
            ? {}
            : { aggregatedOutput: input.output }),
        },
      },
    })
    const record = (event: ReturnType<typeof commandEvent>) =>
      issueTracker.recordEvent({
        activeTurnId: 'turn-current',
        normalizedEvent: normalizeCodexEvent(event),
        rawEvent: event,
      })

    record(commandEvent({
      command: 'rg private-query /tmp/private-record',
      event: 'started',
      id: 'search-no-match',
    }))
    expect(record(commandEvent({
      event: 'completed',
      exitCode: 1,
      id: 'search-no-match',
      output: 'private search output',
    }))).toBeNull()
    expect(record(commandEvent({
      command: 'grep private-query /tmp/private-record',
      event: 'completed',
      exitCode: 1,
      id: 'grep-no-match',
    }))).toBeNull()

    record(commandEvent({
      command: 'rg private-query /tmp/private-record',
      event: 'started',
      id: 'search-error',
    }))
    const searchIssue = record(commandEvent({
      event: 'completed',
      exitCode: 2,
      id: 'search-error',
      output: 'private regex error',
    }))
    expect(searchIssue).toMatchObject({
      details: {
        actionKind: 'command.execution',
        commandFamily: 'search',
        commandOrdinal: 3,
        exitCode: 2,
        recoveredAfterFailure: false,
      },
    })
    expect(searchIssue).not.toHaveProperty('details.failureClass')

    expect(record(commandEvent({
      command: 'rg narrower-query /tmp/private-record',
      event: 'completed',
      exitCode: 0,
      id: 'search-recovery',
    }))).toBeNull()
    expect(searchIssue).toMatchObject({
      details: {
        recoveredAfterFailure: true,
      },
    })

    const operationalFailures = [
      {
        command: 'cat /tmp/private-record',
        exitCode: 126,
        expectedFamily: 'cat',
      },
      {
        command: 'cat /tmp/private-record',
        exitCode: 127,
        expectedFamily: 'cat',
      },
      {
        command: 'cat /tmp/private-record',
        exitCode: 124,
        expectedFamily: 'cat',
      },
      {
        command: 'bash -lc "rg private-query /tmp/private-record"',
        exitCode: 1,
        expectedFamily: 'command',
      },
      {
        command: 'rg private-query /tmp/private-record | head',
        exitCode: 1,
        expectedFamily: 'command',
      },
      {
        command: 'vault-cli knowledge show page_test --format json',
        exitCode: 2,
        expectedFamily: 'vault-cli knowledge',
      },
    ] as const
    const operationalIssues: AssistantRuntimeIssueInput[] = []

    for (const [index, example] of operationalFailures.entries()) {
      const event = commandEvent({
        command: example.command,
        event: 'completed',
        exitCode: example.exitCode,
        id: `classified-${index}`,
        output: 'private command output',
      })
      const issue = record(event)
      expect(issue).toMatchObject({
        details: {
          commandFamily: example.expectedFamily,
          commandOrdinal: index + 5,
          exitCode: example.exitCode,
        },
      })
      expect(issue).not.toHaveProperty('details.failureClass')
      if (issue) {
        operationalIssues.push(issue)
      }
      expect(record(event)).toBeNull()
    }

    const encodedIssues = JSON.stringify([
      searchIssue,
      ...operationalIssues,
    ])
    expect(encodedIssues).not.toContain('private-query')
    expect(encodedIssues).not.toContain('/tmp/private-record')
    expect(encodedIssues).not.toContain('private search output')
    expect(encodedIssues).not.toContain('private regex error')
    expect(encodedIssues).not.toContain('private command output')
    expect(encodedIssues).not.toContain('search-error')
  })

  it('recognizes quoted and escaped direct search arguments conservatively', () => {
    const issueTracker = createCodexActionRuntimeIssueTracker()
    let commandSequence = 0
    const recordCommand = (input: {
      command: string
      exitCode: number
      output?: string
    }) => {
      const id = `item-sensitive-${++commandSequence}`
      const startedEvent = {
        method: 'item/started',
        params: {
          item: {
            command: input.command,
            id,
            type: 'commandExecution',
          },
        },
      }
      const completedEvent = {
        method: 'item/completed',
        params: {
          item: {
            aggregatedOutput: input.output ?? 'private search output',
            exitCode: input.exitCode,
            id,
            type: 'commandExecution',
          },
        },
      }
      expect(issueTracker.recordEvent({
        activeTurnId: 'turn-current',
        normalizedEvent: normalizeCodexEvent(startedEvent),
        rawEvent: startedEvent,
      })).toBeNull()
      return issueTracker.recordEvent({
        activeTurnId: 'turn-current',
        normalizedEvent: normalizeCodexEvent(completedEvent),
        rawEvent: completedEvent,
      })
    }

    const expectedNoMatches = [
      "rg -n 'private(foo|bar)$' /tmp/private-record",
      'grep -E "private(foo|bar){2}$" /tmp/private-record',
      'rg private\\(foo\\|bar\\)\\{2\\}\\$ /tmp/private-record',
      "rg 'private$(literal)`text`' /tmp/private-record",
    ]
    for (const command of expectedNoMatches) {
      expect(recordCommand({ command, exitCode: 1 })).toBeNull()
    }

    const searchIssue = recordCommand({
      command: "rg 'private(foo|bar){2}$' /tmp/private-record",
      exitCode: 2,
      output: 'private regex error',
    })
    expect(searchIssue).toMatchObject({
      details: {
        commandFamily: 'search',
        commandOrdinal: 5,
        exitCode: 2,
        recoveredAfterFailure: false,
      },
    })
    expect(recordCommand({
      command: 'grep -E "private(foo|bar){2}$" /tmp/private-record',
      exitCode: 0,
    })).toBeNull()
    expect(searchIssue).toMatchObject({
      details: {
        recoveredAfterFailure: true,
      },
    })

    const wrappedVaultIssue = recordCommand({
      command:
        'bash -lc "vault-cli knowledge show private-page --format json"',
      exitCode: 2,
      output: 'private vault output',
    })
    expect(wrappedVaultIssue).toMatchObject({
      details: {
        commandFamily: 'vault-cli knowledge',
        commandOrdinal: 7,
        exitCode: 2,
      },
    })

    const commandsWithExecutableShellSyntax = [
      'bash -lc "rg private-query /tmp/private-record"',
      'rg private-query /tmp/private-record | head',
      'rg private-query /tmp/private-record; head /tmp/private-record',
      'rg private-query /tmp/private-record && head /tmp/private-record',
      'rg private-query /tmp/private-record || head /tmp/private-record',
      'rg private-query > /tmp/private-record',
      'rg (private-query) /tmp/private-record',
      'rg "$(private-command)" /tmp/private-record',
      'rg "`private-command`" /tmp/private-record',
      "rg 'private-query /tmp/private-record",
      'rg "private-query /tmp/private-record',
      'rg private-query\n/tmp/private-record',
      `rg ${'x'.repeat(4096)}`,
    ]
    const executableShellIssues = commandsWithExecutableShellSyntax.map(
      (command, index) => {
        const issue = recordCommand({ command, exitCode: 1 })
        expect(issue).toMatchObject({
          details: {
            commandFamily: 'command',
            commandOrdinal: index + 8,
            exitCode: 1,
          },
        })
        return issue
      },
    )

    const encodedIssues = JSON.stringify([
      searchIssue,
      wrappedVaultIssue,
      ...executableShellIssues,
    ])
    expect(encodedIssues).not.toContain('private(foo|bar)')
    expect(encodedIssues).not.toContain('private-query')
    expect(encodedIssues).not.toContain('private-command')
    expect(encodedIssues).not.toContain('/tmp/private-record')
    expect(encodedIssues).not.toContain('private search output')
    expect(encodedIssues).not.toContain('private regex error')
    expect(encodedIssues).not.toContain('private vault output')
    expect(encodedIssues).not.toContain('private-page')
    expect(encodedIssues).not.toContain('item-sensitive')
    expect(encodedIssues).not.toContain('turn-current')
  })

  it('saturates command ordinals without retaining boundary command data', () => {
    const issueTracker = createCodexActionRuntimeIssueTracker()
    const recordCompletedCommand = (input: {
      command: string
      exitCode: number
      id: string
      output?: string
    }) => {
      const event = {
        method: 'item/completed',
        params: {
          item: {
            aggregatedOutput: input.output ?? '',
            command: input.command,
            exitCode: input.exitCode,
            id: input.id,
            type: 'commandExecution',
          },
        },
      }
      return issueTracker.recordEvent({
        activeTurnId: 'turn-current',
        normalizedEvent: normalizeCodexEvent(event),
        rawEvent: event,
      })
    }

    for (let index = 0; index < 10_005; index += 1) {
      expect(recordCompletedCommand({
        command: 'true',
        exitCode: 0,
        id: `successful-command-${index}`,
      })).toBeNull()
    }

    const boundaryIssue = recordCompletedCommand({
      command: 'cat /tmp/private-ordinal-record',
      exitCode: 127,
      id: 'private-boundary-item',
      output: 'private boundary output',
    })
    expect(boundaryIssue).toMatchObject({
      details: {
        commandFamily: 'cat',
        commandOrdinal: 10_000,
        exitCode: 127,
      },
    })

    const encodedIssue = JSON.stringify(boundaryIssue)
    expect(encodedIssue).not.toContain('/tmp/private-ordinal-record')
    expect(encodedIssue).not.toContain('private boundary output')
    expect(encodedIssue).not.toContain('private-boundary-item')
    expect(encodedIssue).not.toContain('turn-current')
  })

  it('propagates a recovered command failure through a successful provider turn', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-command-failure-recovery-',
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
              thread: { id: 'thread-command-failure-recovery' },
            },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: {
              turn: { id: 'turn-command-failure-recovery' },
            },
          }))

          child.stdout.write(jsonLine({
            method: 'item/started',
            params: {
              item: {
                command: 'rg private-query /tmp/private-record',
                id: 'command-private-failure',
                type: 'commandExecution',
              },
              turnId: 'turn-command-failure-recovery',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                aggregatedOutput: 'private command failure output',
                exitCode: 2,
                id: 'command-private-failure',
                status: 'failed',
                type: 'commandExecution',
              },
              turnId: 'turn-command-failure-recovery',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/started',
            params: {
              item: {
                command: 'rg narrower-query /tmp/private-record',
                id: 'command-private-recovery',
                type: 'commandExecution',
              },
              turnId: 'turn-command-failure-recovery',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                aggregatedOutput: 'private command recovery output',
                exitCode: 0,
                id: 'command-private-recovery',
                status: 'completed',
                type: 'commandExecution',
              },
              turnId: 'turn-command-failure-recovery',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-command-failure-recovery',
                phase: 'final_answer',
                text: 'Recovered safely.',
                type: 'agentMessage',
              },
              turnId: 'turn-command-failure-recovery',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-command-failure-recovery',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const result = await executeCodexAppServerTurn({
      prompt: 'recover from a failed search',
      workingDirectory,
    })
    expect(result.finalMessage).toBe('Recovered safely.')
    expect(result.runtimeIssueInputs).toEqual([
      {
        component: 'assistant.codex-action',
        operation: 'command.execution',
        phase: 'provider_turn',
        issueKind: 'tool_error',
        severity: 'warning',
        errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
        summary: 'Codex command execution failed during provider turn.',
        details: {
          actionKind: 'command.execution',
          commandFamily: 'search',
          commandOrdinal: 1,
          durationMsBucket: 'unknown',
          exitCode: 2,
          outputBytesBucket: 'lt_1kb',
          recoveredAfterFailure: true,
        },
      },
    ])
    const encodedIssues = JSON.stringify(result.runtimeIssueInputs)
    expect(encodedIssues).not.toContain('private-query')
    expect(encodedIssues).not.toContain('narrower-query')
    expect(encodedIssues).not.toContain('/tmp/private-record')
    expect(encodedIssues).not.toContain('private command failure output')
    expect(encodedIssues).not.toContain('private command recovery output')
    expect(encodedIssues).not.toContain('command-private-failure')
    expect(encodedIssues).not.toContain('command-private-recovery')
    expect(encodedIssues).not.toContain('thread-command-failure-recovery')
    expect(encodedIssues).not.toContain('turn-command-failure-recovery')
  })

  it('emits Codex action diagnostics when a turn fails', async () => {
    const workingDirectory = await createTempDir('assistant-codex-failed-diagnostics-')
    const onTraceEvent = vi.fn()

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
                  id: 'thread-failed-diagnostics',
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
                  id: 'turn-failed-diagnostics',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'cmd-failed-diagnostics',
                  type: 'commandExecution',
                  status: 'failed',
                  exitCode: 1,
                  durationMs: 42,
                  aggregatedOutput: 'failed raw output must not appear',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-failed-diagnostics',
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

    await expect(
      executeCodexAppServerTurn({
        onTraceEvent,
        prompt: 'diagnose failed turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
    })

    const diagnosticEvents = onTraceEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => {
        const rawEvent = asRecord(event.rawEvent)
        return rawEvent.schema === CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA
      })
    expect(diagnosticEvents).toHaveLength(1)
    expect(diagnosticEvents[0]?.codexThreadId).toBeNull()
    expect(diagnosticEvents[0]?.rawEvent).toMatchObject({
      schema: CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA,
      type: CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE,
      codexActionCommandCount: 1,
      codexActionCompletedCount: 1,
      codexActionDurationMsMax: 42,
      codexActionFailedCount: 1,
      codexActionSlowKinds: ['command.execution'],
    })
    expect(JSON.stringify(diagnosticEvents[0]?.rawEvent)).not.toContain('failed raw output')
    expect(JSON.stringify(diagnosticEvents[0]?.rawEvent)).not.toContain('thread-failed-diagnostics')
    expect(JSON.stringify(diagnosticEvents[0]?.rawEvent)).not.toContain('turn-failed-diagnostics')
  })

  it('uses explicit Codex executable selectors from the caller', async () => {
    const workingDirectory = await createTempDir('assistant-codex-explicit-command-')
    const codexCommand = '/tmp/caller-controlled-codex'

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          const error = new Error(`spawn ${codexCommand} ENOENT`) as NodeJS.ErrnoException
          error.code = 'ENOENT'
          emitProcessErrorAndExit(child, error)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        codexCommand,
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/usr/bin',
        },
        prompt: 'explicit command guard',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        `Codex app-server executable "${codexCommand}" was not found. Install @openai/codex or pass --codexCommand.`,
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      codexCommand,
      [...cliTimingLaunchArgs, 'app-server'],
      expect.objectContaining({
        cwd: tmpdir(),
        env: expect.objectContaining({
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/usr/bin',
        }),
      }),
    )
  })

  it('uses explicit Codex home selectors from the caller', async () => {
    const envCodexHome = await createTempDir('assistant-codex-env-home-')
    const explicitCodexHome = await createTempDir('assistant-codex-explicit-home-')
    const workingDirectory = await createTempDir('assistant-codex-explicit-home-work-')
    const codexCommand = '/tmp/caller-controlled-codex'

    codexMocks.spawn.mockImplementation((command, args, options) => {
      const child = new MockChildProcess()

      expect(command).toBe(codexCommand)
      expect(args).toEqual([...cliTimingLaunchArgs, 'app-server'])
      expect(options).toMatchObject({
        env: expect.objectContaining({
          CODEX_HOME: explicitCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/usr/bin',
        }),
      })
      expect(options.env.CODEX_HOME).not.toBe(envCodexHome)

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))

          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: {
              thread: {
                id: 'thread-hosted-home',
              },
            },
          }))

          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: {
              turn: {
                id: 'turn-hosted-home',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-hosted-home',
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
        codexHome: explicitCodexHome,
        codexCommand,
        env: {
          CODEX_HOME: envCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/usr/bin',
        },
        prompt: 'explicit codex home guard',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-hosted-home',
      threadId: 'thread-hosted-home',
      turnId: 'turn-hosted-home',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      codexCommand,
      [...cliTimingLaunchArgs, 'app-server'],
      expect.any(Object),
    )
  })

  it('ignores ambient hosted guards when an explicit child env omits the hosted marker', async () => {
    const ambientCodexHome = await createTempDir('assistant-codex-ambient-hosted-home-')
    const explicitCodexHome = await createTempDir('assistant-codex-explicit-home-')
    const workingDirectory = await createTempDir('assistant-codex-ambient-hosted-work-')

    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    vi.stubEnv('CODEX_HOME', ambientCodexHome)

    try {
      codexMocks.spawn.mockImplementation((_command, _args, options) => {
        const child = new MockChildProcess()

        expect(options.env).toMatchObject({
          CODEX_HOME: explicitCodexHome,
          PATH: '/tmp/attacker-controlled-bin',
        })
        expect(options.env.MURPH_HOSTED_RUNTIME_PROCESS).toBeUndefined()
        expect(options.env.CODEX_HOME).not.toBe(ambientCodexHome)

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
          codexHome: explicitCodexHome,
          codexCommand: '/tmp/attacker-controlled-codex',
          env: {
            PATH: '/tmp/attacker-controlled-bin',
          },
          prompt: 'ambient hosted guard',
          workingDirectory,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_NOT_FOUND',
      })

      expect(codexMocks.spawn).toHaveBeenCalledWith(
        '/tmp/attacker-controlled-codex',
        [...cliTimingLaunchArgs, 'app-server'],
        expect.any(Object),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not read hosted command override env in the low-level Codex runner', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-hosted-stub-home-')
    const hostedCommandOverride = path.join(hostedCodexHome, 'bin', 'codex')
    const workingDirectory = await createTempDir('assistant-codex-hosted-stub-work-')

    codexMocks.spawn.mockImplementation((_command, _args, options) => {
      const child = new MockChildProcess()

      expect(options.env).toMatchObject({
        [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: hostedCommandOverride,
        CODEX_HOME: hostedCodexHome,
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        NODE_ENV: 'test',
      })

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
        env: {
          [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: hostedCommandOverride,
          CODEX_HOME: hostedCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          NODE_ENV: 'test',
          PATH: '/usr/bin',
        },
        prompt: 'hosted command env guard',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      [...cliTimingLaunchArgs, 'app-server'],
      expect.any(Object),
    )
  })

  it('keeps the stopped process reason when replacement construction throws', async () => {
    const codexHome = await createTempDir('assistant-codex-constructor-retry-home-')
    const workingDirectory = await createTempDir('assistant-codex-constructor-retry-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const env = {
      CODEX_HOME: codexHome,
      PATH: '/usr/bin',
    }
    await executeCodexAppServerTurn({
      env,
      prompt: 'first constructor retry turn',
      workingDirectory,
    })
    await stopWarmCodexAppServer('operator-stop')

    codexMocks.spawn.mockImplementationOnce(() => {
      throw new Error('synthetic constructor failure')
    })
    await expect(
      executeCodexAppServerTurn({
        env,
        prompt: 'constructor failure turn',
        workingDirectory,
      }),
    ).rejects.toThrow('synthetic constructor failure')

    const replacementTrace = vi.fn()
    await executeCodexAppServerTurn({
      env,
      onTraceEvent: replacementTrace,
      prompt: 'constructor retry succeeds',
      workingDirectory,
    })

    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-explicit-stop',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it('attributes process exit before a simultaneous launch identity change', async () => {
    const codexHome = await createTempDir('assistant-codex-exit-precedence-home-')
    const workingDirectory = await createTempDir('assistant-codex-exit-precedence-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const env = {
      CODEX_HOME: codexHome,
      PATH: '/usr/bin',
    }
    await executeCodexAppServerTurn({
      env,
      prompt: 'first exit precedence turn',
      workingDirectory,
    })
    const exitedChild = requireMockChildProcess(spawnedChildren[0] ?? null)
    exitedChild.emit('exit', 1, null)
    exitedChild.emit('close', 1, null)

    const replacementTrace = vi.fn()
    await executeCodexAppServerTurn({
      env: {
        ...env,
        PATH: '/usr/local/bin',
      },
      onTraceEvent: replacementTrace,
      prompt: 'replacement after exit and identity change',
      workingDirectory,
    })

    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-process-exit',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it.each([
    { settlement: 'stdin EPIPE' },
    { settlement: 'interrupt cleanup timeout' },
    { settlement: 'truncated stdout' },
    { settlement: 'child error' },
    { settlement: 'interrupted terminal frame' },
    { settlement: 'turn/start RPC error' },
  ])('keeps process-exit precedence through $settlement when abort follows exit', async ({ settlement }) => {
    const codexHome = await createTempDir('assistant-codex-exit-abort-precedence-home-')
    const workingDirectory = await createTempDir('assistant-codex-exit-abort-precedence-work-')
    const controller = new AbortController()
    const firstTurnStarted = createDeferred<void>()
    const spawnedChildren: MockChildProcess[] = []
    let firstTurnStartRequestId: number | null = null

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      child.pid = 41_000 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const thread = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: thread.id,
            result: {
              thread: {
                id: `thread-exit-abort-precedence-${processNumber}`,
              },
            },
          }))

          const turn = await waitForRpcMethod(child, 'turn/start')
          if (processNumber === 1 && settlement === 'turn/start RPC error') {
            if (typeof turn.id !== 'number') {
              throw new Error('Expected numeric turn/start request id.')
            }
            firstTurnStartRequestId = turn.id
            firstTurnStarted.resolve()
            return
          }
          child.stdout.write(jsonLine({
            id: turn.id,
            result: {
              turn: {
                id: `turn-exit-abort-precedence-${processNumber}`,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: `turn-exit-abort-precedence-${processNumber}`,
              },
            },
          }))

          if (processNumber === 1) {
            firstTurnStarted.resolve()
            return
          }

          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-exit-abort-precedence-${processNumber}`,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const failedTurn = executeCodexAppServerTurn({
      abortSignal: controller.signal,
      env: {
        CODEX_HOME: codexHome,
        PATH: '/usr/bin',
      },
      prompt: 'process exits before abort',
      workingDirectory,
    })
    void failedTurn.catch(() => undefined)

    await firstTurnStarted.promise
    const exitedChild = requireMockChildProcess(spawnedChildren[0] ?? null)
    const usesFakeTimers = settlement === 'interrupt cleanup timeout'
    if (usesFakeTimers) {
      vi.useFakeTimers()
    }
    try {
      exitedChild.emit('exit', 1, null)
      // `close` is deliberately withheld here: a descendant can retain an
      // inherited pipe, so exact-group cleanup must already have happened.
      if (process.platform === 'win32') {
        expect(exitedChild.kill).toHaveBeenCalledWith('SIGKILL')
      } else {
        expect(process.kill).toHaveBeenCalledWith(-41_000, 'SIGKILL')
      }
      controller.abort()
      if (settlement === 'stdin EPIPE') {
        exitedChild.stdin.emit(
          'error',
          createErrnoException('EPIPE', 'write EPIPE'),
        )
      } else if (settlement === 'interrupt cleanup timeout') {
        await vi.advanceTimersByTimeAsync(15_000)
      } else if (settlement === 'truncated stdout') {
        exitedChild.stdout.write('{')
      } else if (settlement === 'interrupted terminal frame') {
        exitedChild.stdout.write(jsonLine({
          method: 'turn/completed',
          params: {
            turn: {
              id: 'turn-exit-abort-precedence-1',
              status: 'interrupted',
            },
          },
        }))
      } else if (settlement === 'turn/start RPC error') {
        exitedChild.stdout.write(jsonLine({
          error: {
            message: 'turn/start failed after process exit',
          },
          id: firstTurnStartRequestId,
        }))
      } else {
        exitedChild.emit('error', new Error('child error after exit'))
      }
      exitedChild.emit('close', 1, null)

      await expect(failedTurn).rejects.toMatchObject({
        context: {
          codexExitCode: 1,
          codexFailureStage: 'process_exit',
        },
      })
    } finally {
      if (usesFakeTimers) {
        vi.useRealTimers()
      }
    }
    if (process.platform === 'win32') {
      expect(exitedChild.kill).toHaveBeenCalledWith('SIGKILL')
    } else {
      expect(process.kill).toHaveBeenCalledWith(-41_000, 'SIGKILL')
    }

    const replacementTrace = vi.fn()
    await expect(
      executeCodexAppServerTurn({
        env: {
          CODEX_HOME: codexHome,
          PATH: '/usr/bin',
        },
        onTraceEvent: replacementTrace,
        prompt: 'replacement after process exit and abort',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-exit-abort-precedence-2',
      turnId: 'turn-exit-abort-precedence-2',
    })
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-process-exit',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it('attributes an idle process failure as process unhealthy', async () => {
    const codexHome = await createTempDir('assistant-codex-process-unhealthy-home-')
    const workingDirectory = await createTempDir('assistant-codex-process-unhealthy-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)

    const env = {
      CODEX_HOME: codexHome,
      PATH: '/usr/bin',
    }
    await executeCodexAppServerTurn({
      env,
      prompt: 'first process unhealthy turn',
      workingDirectory,
    })
    requireMockChildProcess(spawnedChildren[0] ?? null).emit(
      'error',
      new Error('idle process failure'),
    )

    const replacementTrace = vi.fn()
    await executeCodexAppServerTurn({
      env,
      onTraceEvent: replacementTrace,
      prompt: 'replacement after process unhealthy',
      workingDirectory,
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(replacementTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingColdStartReason: 'previous-process-unhealthy',
          codexTimingStage: 'initialized',
        }),
      }),
    )
  })

  it('keeps one resident process while thread-scoped config and working directories change', async () => {
    const codexHome = await createTempDir('assistant-codex-stable-launch-home-')
    const ordinaryWorkingDirectory = await createTempDir(
      'assistant-codex-stable-launch-ordinary-',
    )
    const restrictedWorkingDirectory = await createTempDir(
      'assistant-codex-stable-launch-restricted-',
    )
    const spawnedChildren: MockChildProcess[] = []
    mockHostedCodexIdentityServer(spawnedChildren)
    const env = {
      CODEX_HOME: codexHome,
      PATH: '/usr/bin',
    }

    await executeCodexAppServerTurn({
      env,
      prompt: 'ordinary turn before restricted work',
      workingDirectory: ordinaryWorkingDirectory,
    })
    await executeCodexAppServerTurn({
      env,
      prompt: 'restricted background turn',
      threadConfig: {
        'features.shell_tool': false,
        'memories.use_memories': false,
      },
      workingDirectory: restrictedWorkingDirectory,
    })
    await executeCodexAppServerTurn({
      env,
      prompt: 'ordinary turn after restricted work',
      workingDirectory: ordinaryWorkingDirectory,
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    const threadStarts = child.stdin.writes
      .flatMap((write) => write.split('\n'))
      .filter(Boolean)
      .map((line) => asRecord(JSON.parse(line)))
      .filter((message) => message.method === 'thread/start')
    expect(threadStarts).toHaveLength(3)
    expect(threadStarts.map((message) => asRecord(message.params).cwd)).toEqual([
      path.resolve(ordinaryWorkingDirectory),
      path.resolve(restrictedWorkingDirectory),
      path.resolve(ordinaryWorkingDirectory),
    ])
    expect(asRecord(threadStarts[1]?.params).config).toEqual({
      'features.shell_tool': false,
      'memories.use_memories': false,
    })
  })

  it.each([
    {
      name: 'PATH',
      secondEnv: {
        PATH: '/custom/hosted/bin',
      },
      useSecondCodexHome: false,
    },
    {
      name: 'provider auth',
      secondEnv: {
        OPENAI_API_KEY: 'openai-key-two',
      },
      useSecondCodexHome: false,
    },
    {
      name: 'custom child env',
      secondEnv: {
        CUSTOM_TOOL_SECRET: 'custom-tool-secret-two',
      },
      useSecondCodexHome: false,
    },
    {
      name: 'Codex home',
      secondEnv: {},
      useSecondCodexHome: true,
    },
  ] as const)(
    'starts a fresh warm Codex app-server process when child env field $name changes',
    async (scenario) => {
      const firstCodexHome = await createTempDir('assistant-codex-warm-identity-home-a-')
      const secondCodexHome = scenario.useSecondCodexHome === true
        ? await createTempDir('assistant-codex-warm-identity-home-b-')
        : firstCodexHome
      const workingDirectory = await createTempDir('assistant-codex-warm-identity-work-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const spawnedChild = new MockChildProcess()
        spawnedChild.pid = 32_000 + spawnedChildren.length
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
                  id: `thread-warm-identity-${processNumber}`,
                },
              },
            }))

            const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
            spawnedChild.stdout.write(jsonLine({
              id: turn.id,
              result: {
                turn: {
                  id: `turn-warm-identity-${processNumber}`,
                },
              },
            }))
            spawnedChild.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: `turn-warm-identity-${processNumber}`,
                  status: 'completed',
                },
              },
            }))
          })()
        })

        return spawnedChild
      })

      const baseEnv = {
        CODEX_HOME: firstCodexHome,
        CUSTOM_TOOL_SECRET: 'custom-tool-secret-one',
        HOSTED_ASSISTANT_MODEL: 'gpt-identity-one',
        MURPH_HOSTED_CODEX_MODEL_PROVIDER_ID: 'hosted-provider-one',
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'openai-key-one',
        PATH: '/usr/bin',
      }

      await expect(
        executeCodexAppServerTurn({
          env: baseEnv,
          prompt: 'first stable identity',
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-warm-identity-1',
        turnId: 'turn-warm-identity-1',
      })

      const replacementTrace = vi.fn()

      await expect(
        executeCodexAppServerTurn({
          env: {
            ...baseEnv,
            ...scenario.secondEnv,
            CODEX_HOME: secondCodexHome,
          },
          onTraceEvent: replacementTrace,
          prompt: 'second stable identity',
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-warm-identity-2',
        turnId: 'turn-warm-identity-2',
      })

      expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
      expect(replacementTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          rawEvent: expect.objectContaining({
            codexTimingColdStartReason: 'previous-launch-identity-change',
            codexTimingStage: 'initialized',
          }),
        }),
      )
      expect(process.kill).toHaveBeenCalledWith(-32_000, 'SIGTERM')
      expect(requireMockChildProcess(spawnedChildren[0] ?? null).pid)
        .not.toBe(requireMockChildProcess(spawnedChildren[1] ?? null).pid)
    },
  )

  })
