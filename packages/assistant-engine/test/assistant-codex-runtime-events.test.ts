import {
  MockChildProcess,
  asRecord,
  codexMocks,
  codexSandboxPolicyForMode,
  createDeferred,
  createHostedToolContext,
  createTempDir,
  executeBackgroundBoundaryTurn,
  executeCodexAppServerTurn,
  initializeWarmTurn,
  jsonLine,
  mockProcessGroupSignalsForChildren,
  mockWarmCodexProcess,
  readWrittenRpcMessages,
  requireMockChildProcess,
  respondToBackgroundTerminals,
  waitForRpcMethod,
  waitForRpcMethodCount,
  waitForRpcResponse,
  writeCodexV2AssistantEventTurn,
  writeCompletedTurn,
  writeStartedTurn,
  writeSubAgentActivity,
  writeTokenUsage,
  writeWarmTurnStarted,
} from "./assistant-codex-runtime.harness.ts";

import path from 'node:path'
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
  CodexAppServerLiveTurn,
  CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import {
  GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
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

describe('assistant codex event shaping', () => {
  it('normalizes exact Codex 0.147 notifications across the consumed item families', () => {
    const modelRerouted = {
      method: 'model/rerouted',
      params: { toModel: 'gpt-5-codex' },
    }
    expect(normalizeCodexEvent(modelRerouted)).toEqual({
      kind: 'model_rerouted',
      model: 'gpt-5-codex',
      rawEvent: modelRerouted,
    })

    const planDelta = {
      method: 'item/plan/delta',
      params: {
        delta: 'Inspect files\nPatch tests',
        itemId: 'plan-1',
      },
    }
    expect(normalizeCodexEvent(planDelta)).toEqual({
      kind: 'plan_update',
      itemId: 'plan-1',
      rawEvent: planDelta,
      text: 'Inspect files\nPatch tests',
    })

    const assistantDelta = {
      method: 'item/agentMessage/delta',
      params: {
        delta: 'token',
        itemId: 'assistant-9',
      },
    }
    expect(normalizeCodexEvent(assistantDelta)).toEqual({
      deltaText: 'token',
      itemId: 'assistant-9',
      kind: 'assistant_delta',
      rawEvent: assistantDelta,
    })

    const reasoningDelta = {
      method: 'item/reasoning/textDelta',
      params: {
        delta: 'thinking',
        itemId: 'reason-1',
      },
    }
    expect(normalizeCodexEvent(reasoningDelta)).toEqual({
      deltaText: 'thinking',
      itemId: 'reason-1',
      kind: 'reasoning_delta',
      rawEvent: reasoningDelta,
    })

    const assistantCompleted = {
      method: 'item/completed',
      params: {
        item: {
          id: 'assistant-4',
          memoryCitation: null,
          phase: null,
          text: 'structured reply',
          type: 'agentMessage',
        },
      },
    }
    expect(normalizeCodexEvent(assistantCompleted)).toEqual({
      itemId: 'assistant-4',
      itemState: 'completed',
      kind: 'assistant_message',
      messagePhase: null,
      rawEvent: assistantCompleted,
      text: 'structured reply',
    })

    const webSearchStarted = {
      method: 'item/started',
      params: {
        item: {
          action: null,
          id: 'search-1',
          query: 'murph coverage',
          results: null,
          type: 'webSearch',
        },
      },
    }
    expect(normalizeCodexEvent(webSearchStarted)).toEqual({
      itemId: 'search-1',
      itemState: 'running',
      kind: 'web_search',
      query: 'murph coverage',
      rawEvent: webSearchStarted,
    })

    const mcpToolCompleted = {
      method: 'item/completed',
      params: {
        item: {
          appContext: null,
          arguments: {},
          durationMs: null,
          error: null,
          id: 'tool-1',
          pluginId: null,
          readOnlyHint: null,
          result: null,
          server: 'web',
          status: 'completed',
          tool: 'search_query',
          type: 'mcpToolCall',
        },
      },
    }
    expect(normalizeCodexEvent(mcpToolCompleted)).toEqual({
      itemId: 'tool-1',
      itemState: 'completed',
      kind: 'tool_call',
      rawEvent: mcpToolCompleted,
      toolName: 'search_query',
      toolServer: 'web',
    })

    const commandCompleted = {
      method: 'item/completed',
      params: {
        item: {
          aggregatedOutput: null,
          command: 'node /tmp/bin.js pnpm test --watch',
          commandActions: [],
          cwd: '/tmp',
          durationMs: null,
          exitCode: 2,
          id: 'cmd-1',
          pluginId: null,
          processId: null,
          scriptPath: null,
          source: 'agent',
          status: 'failed',
          type: 'commandExecution',
        },
      },
    }
    expect(normalizeCodexEvent(commandCompleted)).toEqual({
      commandLabel: 'node /tmp/bin.js pnpm test --watch',
      exitCode: 2,
      filePaths: [],
      itemId: 'cmd-1',
      itemState: 'completed',
      itemType: 'commandExecution',
      kind: 'status_item',
      planText: null,
      rawEvent: commandCompleted,
      reasoningText: null,
    })

    const reasoningCompleted = {
      method: 'item/completed',
      params: {
        item: {
          content: ['First detail'],
          id: 'reason-raw',
          summary: ['First summary', 'Second summary'],
          type: 'reasoning',
        },
      },
    }
    expect(normalizeCodexEvent(reasoningCompleted)).toEqual({
      commandLabel: null,
      exitCode: null,
      filePaths: [],
      itemId: 'reason-raw',
      itemState: 'completed',
      itemType: 'reasoning',
      kind: 'status_item',
      planText: null,
      rawEvent: reasoningCompleted,
      reasoningText: 'First summary\n\nSecond summary',
    })

    const fileCompleted = {
      method: 'item/completed',
      params: {
        item: {
          changes: [
            {
              diff: '',
              kind: 'update',
              path: `${codexMocks.fakeHome}/src/file-a.ts`,
            },
            {
              diff: '',
              kind: 'add',
              path: 'src/file-b.ts',
            },
          ],
          id: 'file-raw',
          status: 'completed',
          type: 'fileChange',
        },
      },
    }
    expect(normalizeCodexEvent(fileCompleted)).toEqual({
      commandLabel: null,
      exitCode: null,
      filePaths: ['~/src/file-a.ts', 'src/file-b.ts'],
      itemId: 'file-raw',
      itemState: 'completed',
      itemType: 'fileChange',
      kind: 'status_item',
      planText: null,
      rawEvent: fileCompleted,
      reasoningText: null,
    })

    const turnError = {
      method: 'error',
      params: {
        error: {
          message: 'Connection reset by peer',
        },
      },
    }
    expect(normalizeCodexEvent(turnError)).toEqual({
      kind: 'error',
      message: 'Connection reset by peer',
      rawEvent: turnError,
    })

    expect(normalizeCodexEvent(null)).toEqual({
      eventType: null,
      kind: 'unknown',
      rawEvent: null,
    })
    expect(
      normalizeCodexEvent({
        method: 'model/rerouted',
        params: {},
      }),
    ).toEqual({
      eventType: 'model/rerouted',
      kind: 'unknown',
      rawEvent: {
        method: 'model/rerouted',
        params: {},
      },
    })
  })

  it('derives progress events from normalized items and redacts command labels safely', () => {
    expect(
      extractCodexProgressEventFromNormalized({
        kind: 'error',
        message: 'fatal status',
        rawEvent: {
          type: 'error',
        },
      }),
    ).toEqual({
      id: 'codex-status',
      kind: 'status',
      rawEvent: {
        type: 'error',
      },
      state: 'completed',
      text: 'fatal status',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: 'bash -lc "node /tmp/bin.js pnpm test --watch"',
        exitCode: 0,
        filePaths: [],
        itemId: 'cmd-2',
        itemState: 'running',
        itemType: 'commandExecution',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.started',
        },
        reasoningText: null,
      }),
    ).toEqual({
      id: 'cmd-2',
      kind: 'command',
      label: 'bash -lc "node /tmp/bin.js pnpm test --watch"',
      rawEvent: {
        type: 'item.started',
      },
      safeLabel: 'bin.js pnpm test --watch',
      safeText: 'running bin.js pnpm test --watch',
      state: 'running',
      text: '$ bash -lc "node /tmp/bin.js pnpm test --watch"',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: ['src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'],
        itemId: 'files-1',
        itemState: 'completed',
        itemType: 'fileChange',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual({
      id: 'files-1',
      kind: 'file',
      label: null,
      rawEvent: {
        type: 'item.completed',
      },
      safeLabel: null,
      safeText: null,
      state: 'completed',
      text: 'Changed files: src/one.ts, src/two.ts, src/three.ts, …',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: [],
        itemId: 'plan-2',
        itemState: 'completed',
        itemType: 'plan',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual({
      id: 'plan-2',
      kind: 'plan',
      label: null,
      rawEvent: {
        type: 'item.completed',
      },
      safeLabel: null,
      safeText: null,
      state: 'completed',
      text: 'Updated the plan.',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: [],
        itemId: 'reason-2',
        itemState: 'running',
        itemType: 'reasoning',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.started',
        },
        reasoningText: null,
      }),
    ).toEqual({
      id: 'reason-2',
      kind: 'reasoning',
      label: null,
      rawEvent: {
        type: 'item.started',
      },
      safeLabel: null,
      safeText: null,
      state: 'running',
      text: 'Thinking…',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        itemId: 'search-2',
        itemState: 'running',
        kind: 'web_search',
        query: null,
        rawEvent: {
          type: 'item.started',
        },
      }),
    ).toEqual({
      id: 'search-2',
      kind: 'search',
      rawEvent: {
        type: 'item.started',
      },
        state: 'running',
        text: 'Ran a web search.',
      })

    expect(
      extractCodexProgressEventFromNormalized({
        itemId: 'tool-4',
        itemState: 'running',
        kind: 'tool_call',
        rawEvent: {
          type: 'item.started',
        },
        toolName: 'search_query',
        toolServer: 'web',
      }),
    ).toEqual({
      id: 'tool-4',
      kind: 'tool',
      label: 'web/search_query',
      rawEvent: {
        type: 'item.started',
      },
      safeLabel: 'web/search_query',
      safeText: 'using web/search_query',
      state: 'running',
      text: 'Tool web.search_query',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        itemId: 'tool-2',
        itemState: 'completed',
        kind: 'tool_call',
        rawEvent: {
          type: 'item.completed',
        },
        toolName: null,
        toolServer: null,
      }),
    ).toBeNull()

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: [],
        itemId: 'reason-4',
        itemState: 'completed',
        itemType: 'reasoning',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual({
      id: 'reason-4',
      kind: 'reasoning',
      label: null,
      rawEvent: {
        type: 'item.completed',
      },
      safeLabel: null,
      safeText: null,
      state: 'completed',
      text: 'Thought through the next step.',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: [],
        itemId: 'plan-4',
        itemState: 'completed',
        itemType: 'plan',
        kind: 'status_item',
        planText: 'Ship tests',
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual({
      id: 'plan-4',
      kind: 'plan',
      label: null,
      rawEvent: {
        type: 'item.completed',
      },
      safeLabel: null,
      safeText: null,
      state: 'completed',
      text: 'Plan:\nShip tests',
    })

    expect(
      extractCodexProgressEventFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: [],
        itemId: 'command-empty',
        itemState: 'running',
        itemType: 'commandExecution',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.started',
        },
        reasoningText: null,
      }),
    ).toBeNull()
  })

  it('derives trace updates for connection status, plan, tool, file, and search branches', () => {
    expect(
      extractCodexTraceUpdatesFromNormalized({
        kind: 'error',
        message: 'Retrying after connection lost',
        rawEvent: {
          type: 'error',
        },
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:connection',
        text: 'Retrying after connection lost',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        kind: 'error',
        message: 'fatal error',
        rawEvent: {
          type: 'error',
        },
      }),
    ).toEqual([
      {
        kind: 'error',
        text: 'fatal error',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        kind: 'model_rerouted',
        model: 'gpt-5-codex',
        rawEvent: {
          type: 'model.rerouted',
        },
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:model-reroute',
        text: 'Switched to gpt-5-codex.',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        itemId: 'assistant-11',
        itemState: 'completed',
        kind: 'assistant_message',
        messagePhase: null,
        rawEvent: {
          type: 'item.completed',
        },
        text: 'final assistant text',
      }),
    ).toEqual([
      {
        kind: 'assistant',
        mode: 'replace',
        streamKey: 'assistant:assistant-11',
        text: 'final assistant text',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        itemId: 'plan-3',
        kind: 'plan_update',
        rawEvent: {
          type: 'agent.plan.updated',
        },
        text: 'Plan step one',
      }),
    ).toEqual([
      {
        kind: 'thinking',
        mode: 'replace',
        streamKey: 'thinking:plan-3',
        text: 'Plan step one',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: ['src/example.ts'],
        itemId: 'file-2',
        itemState: 'completed',
        itemType: 'fileChange',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:file-2',
        text: 'Updated src/example.ts.',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        itemId: 'tool-3',
        itemState: 'running',
        kind: 'tool_call',
        rawEvent: {
          type: 'item.started',
        },
        toolName: 'search_query',
        toolServer: 'web',
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:tool-3',
        text: 'Using web/search_query.',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        itemId: 'search-3',
        itemState: 'completed',
        kind: 'web_search',
        query: 'murph codex',
        rawEvent: {
          type: 'item.completed',
        },
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:search-3',
        text: 'Finished web search for "murph codex".',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        commandLabel: null,
        exitCode: null,
        filePaths: [],
        itemId: 'reason-3',
        itemState: 'completed',
        itemType: 'reasoning',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual([])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        commandLabel: 'pnpm test',
        exitCode: 0,
        filePaths: [],
        itemId: 'cmd-5',
        itemState: 'completed',
        itemType: 'commandExecution',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:cmd-5',
        text: 'Finished pnpm test.',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        itemId: null,
        itemState: 'running',
        kind: 'web_search',
        query: null,
        rawEvent: {
          type: 'item.started',
        },
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:webSearch',
        text: 'Searching the web.',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        commandLabel: null,
        exitCode: 0,
        filePaths: [],
        itemId: null,
        itemState: 'completed',
        itemType: 'commandExecution',
        kind: 'status_item',
        planText: null,
        rawEvent: {
          type: 'item.completed',
        },
        reasoningText: null,
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:commandExecution',
        text: 'Command finished.',
      },
    ])

    expect(
      extractCodexTraceUpdatesFromNormalized({
        itemId: null,
        itemState: 'completed',
        kind: 'web_search',
        query: null,
        rawEvent: {
          type: 'item.completed',
        },
      }),
    ).toEqual([
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:webSearch',
        text: 'Finished web search.',
      },
    ])
  })

  describe('codex subagent thread events', () => {
    const verifyLateChildUsage = async (
      childStatus: 'completed' | 'failed' | 'interrupted',
      expectedOutcome: 'aborted' | 'partial' | 'succeeded',
    ): Promise<void> => {
      const workingDirectory = await createTempDir(
        'assistant-codex-subagent-terminal-usage-work-',
      )
      const codexHome = await createTempDir(
        'assistant-codex-subagent-terminal-usage-home-',
      )
      const spawnedChildren: MockChildProcess[] = []
      const releaseChildUsage = createDeferred<void>()
      const releaseUsageRecording = createDeferred<void>()
      const reportedUsage = createDeferred<
        Parameters<NonNullable<CodexAppServerTurnInput['onAdditionalUsage']>>[0]
      >()
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_050 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            const parentResume = await waitForRpcMethod(child, 'thread/resume')
            child.stdout.write(jsonLine({
              id: parentResume.id,
              result: {
                approvalPolicy: 'never',
                cwd: workingDirectory,
                model: 'gpt-5.6-sol',
                modelProvider: 'openai',
                sandbox: codexSandboxPolicyForMode('workspace-write'),
                serviceTier: 'flex',
                thread: { id: 'thread-subagent-terminal-parent' },
              },
            }))
            const parentTurn = await waitForRpcMethod(child, 'turn/start')
            child.stdout.write(jsonLine({
              id: parentTurn.id,
              result: { turn: { id: 'turn-subagent-terminal-parent' } },
            }))

            // The owned process is the trust boundary. A foreign-thread turn
            // notification correlates the child without parsing a parent
            // collab item as billing authorization.
            writeStartedTurn(
              child,
              'thread-subagent-terminal-child',
              'turn-subagent-terminal-child',
            )
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Parent replied before child usage',
              threadId: 'thread-subagent-terminal-parent',
              turnId: 'turn-subagent-terminal-parent',
            })

            await releaseChildUsage.promise
            writeTokenUsage({
              child,
              last: {
                cacheWriteInputTokens: 8,
                cachedInputTokens: 40,
                inputTokens: 120,
                outputTokens: 30,
                reasoningOutputTokens: 7,
                totalTokens: 150,
              },
              threadId: 'thread-subagent-terminal-child',
              total: {
                cacheWriteInputTokens: 8,
                cachedInputTokens: 40,
                inputTokens: 120,
                outputTokens: 30,
                reasoningOutputTokens: 7,
                totalTokens: 150,
              },
              turnId: 'turn-subagent-terminal-child',
            })
            writeCompletedTurn(
              child,
              'thread-subagent-terminal-child',
              'turn-subagent-terminal-child',
              childStatus,
            )
            writeCompletedTurn(
              child,
              'thread-subagent-terminal-child',
              'turn-subagent-terminal-child',
              childStatus,
            )

            const metadataResume = await waitForRpcMethodCount(
              child,
              'thread/resume',
              2,
            )
            expect(asRecord(metadataResume.params)).toEqual({
              excludeTurns: true,
              threadId: 'thread-subagent-terminal-child',
            })
            child.stdout.write(jsonLine({
              id: metadataResume.id,
              result: {
                model: 'gpt-5.2',
                modelProvider: 'openai',
                reasoningEffort: 'high',
                serviceTier: 'flex',
                thread: { id: 'thread-subagent-terminal-child' },
              },
            }))
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: { PATH: '/custom/bin' },
        model: 'gpt-5.6-sol',
        modelProvider: 'openai',
        onAdditionalUsage: async (usage) => {
          reportedUsage.resolve(usage)
          await releaseUsageRecording.promise
        },
        prompt: 'spawn a metered child',
        reasoningEffort: 'medium',
        resumeSessionId: 'thread-subagent-terminal-parent',
        sandbox: 'workspace-write',
        serviceTier: 'flex',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Parent replied before child usage')
      expect(result.additionalUsages).toEqual([])

      let boundaryFinished = false
      const boundary = waitForWarmCodexBackgroundWork().then(() => {
        boundaryFinished = true
      })
      await Promise.resolve()
      expect(boundaryFinished).toBe(false)
      expect(
        readWrittenRpcMessages(
          requireMockChildProcess(spawnedChildren[0] ?? null),
        ).filter((message) =>
          message.method === 'thread/backgroundTerminals/list'
        ),
      ).toHaveLength(0)

      releaseChildUsage.resolve(undefined)
      const usage = await reportedUsage.promise
      expect(usage).toMatchObject({
        provider: 'codex-cli',
        providerRequestOrdinal: 1,
        providerRequestOutcome: expectedOutcome,
        usage: {
          cacheWriteTokens: 8,
          cachedInputTokens: 40,
          inputTokens: 120,
          outputTokens: 30,
          providerName: 'openai',
          providerRequestId: null,
          reasoningTokens: 7,
          requestedModel: 'gpt-5.2',
          servedModel: 'gpt-5.2',
          tokenPricingBasis: 'standard',
          totalTokens: 150,
          usageExtractionSourcePath: 'subagent.turn.tokenUsage.total.delta',
        },
      })
      expect(usage.usage.rawUsageJson).toEqual({
        cacheWriteInputTokens: 8,
        cachedInputTokens: 40,
        inputTokens: 120,
        outputTokens: 30,
        reasoningOutputTokens: 7,
        totalTokens: 150,
      })
      expect(
        readWrittenRpcMessages(
          requireMockChildProcess(spawnedChildren[0] ?? null),
        ).filter((message) =>
          message.method === 'thread/resume' &&
          asRecord(message.params).threadId === 'thread-subagent-terminal-child'
        ),
      ).toHaveLength(1)

      await Promise.resolve()
      expect(boundaryFinished).toBe(false)

      releaseUsageRecording.resolve(undefined)
      const child = requireMockChildProcess(spawnedChildren[0] ?? null)
      const parentTerminalScan = await respondToBackgroundTerminals(child, 1)
      expect(asRecord(parentTerminalScan.params).threadId)
        .toBe('thread-subagent-terminal-parent')
      const childTerminalScan = await respondToBackgroundTerminals(child, 2)
      expect(asRecord(childTerminalScan.params).threadId)
        .toBe('thread-subagent-terminal-child')
      await expect(boundary).resolves.toBeUndefined()
      expect(boundaryFinished).toBe(true)
    }

    it.each([
      ['completed', 'succeeded'],
      ['failed', 'partial'],
      ['interrupted', 'aborted'],
    ] as const)(
      'holds the workspace boundary for %s child usage reported after the parent reply',
      verifyLateChildUsage,
    )

    it('drops child usage when effective metadata is incomplete without retrying or inheriting the parent', async () => {
      const workingDirectory = await createTempDir(
        'assistant-codex-subagent-metadata-failure-work-',
      )
      const codexHome = await createTempDir(
        'assistant-codex-subagent-metadata-failure-home-',
      )
      const spawnedChildren: MockChildProcess[] = []
      const onAdditionalUsage = vi.fn()
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_060 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-metadata-parent',
              turnId: 'turn-subagent-metadata-parent',
            })
            writeStartedTurn(
              child,
              'thread-subagent-metadata-child',
              'turn-subagent-metadata-child',
            )

            writeTokenUsage({
              child,
              last: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              threadId: 'thread-subagent-metadata-child',
              total: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              turnId: 'turn-subagent-metadata-child',
            })
            writeCompletedTurn(
              child,
              'thread-subagent-metadata-child',
              'turn-subagent-metadata-child',
            )
            const metadataResume = await waitForRpcMethod(child, 'thread/resume')
            child.stdout.write(jsonLine({
              id: metadataResume.id,
              result: {
                // Missing modelProvider: the parent identity is deliberately
                // not used as a billing fallback.
                model: 'gpt-5.6-terra',
                reasoningEffort: 'high',
                serviceTier: null,
                thread: { id: 'thread-subagent-metadata-child' },
              },
            }))
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Metadata failure stayed best effort',
              threadId: 'thread-subagent-metadata-parent',
              turnId: 'turn-subagent-metadata-parent',
            })
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: { PATH: '/custom/bin' },
        model: 'gpt-5.6-sol',
        modelProvider: 'openai',
        onAdditionalUsage,
        prompt: 'spawn a child with unavailable metadata',
        sandbox: 'workspace-write',
        workingDirectory,
      })
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(result.finalMessage).toBe('Metadata failure stayed best effort')
      expect(result.additionalUsages).toEqual([])
      expect(onAdditionalUsage).not.toHaveBeenCalled()
      expect(
        readWrittenRpcMessages(
          requireMockChildProcess(spawnedChildren[0] ?? null),
        ).filter((message) => message.method === 'thread/resume'),
      ).toHaveLength(1)
    })

    it('keeps non-hosted cold-resumed child usage in the parent result', async () => {
      const workingDirectory = await createTempDir(
        'assistant-codex-subagent-cold-resume-work-',
      )
      const codexHome = await createTempDir(
        'assistant-codex-subagent-cold-resume-home-',
      )
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_075 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

            const threadResume = await waitForRpcMethod(child, 'thread/resume')
            expect(asRecord(threadResume.params)).toEqual({
              approvalPolicy: 'never',
              cwd: workingDirectory,
              excludeTurns: true,
              model: 'gpt-5.6-sol',
              modelProvider: 'openai',
              sandbox: 'workspace-write',
              threadId: 'thread-subagent-cold-parent',
            })
            child.stdout.write(jsonLine({
              id: threadResume.id,
              result: {
                approvalPolicy: 'never',
                cwd: workingDirectory,
                model: 'gpt-5.6-sol',
                modelProvider: 'openai',
                sandbox: codexSandboxPolicyForMode('workspace-write'),
                thread: { id: 'thread-subagent-cold-parent' },
              },
            }))

            const turnStart = await waitForRpcMethod(child, 'turn/start')
            child.stdout.write(jsonLine({
              id: turnStart.id,
              result: { turn: { id: 'turn-subagent-cold-parent' } },
            }))
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-cold-child',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'thread-subagent-cold-parent',
                  receiverThreadIds: ['thread-subagent-cold-child'],
                  model: 'gpt-5.6-terra-mini',
                },
                threadId: 'thread-subagent-cold-parent',
                turnId: 'turn-subagent-cold-parent',
              },
            }))
            writeStartedTurn(
              child,
              'thread-subagent-cold-child',
              'turn-subagent-cold-child',
            )
            writeTokenUsage({
              child,
              last: {
                cacheWriteInputTokens: 0,
                cachedInputTokens: 20,
                inputTokens: 70,
                outputTokens: 30,
                reasoningOutputTokens: 4,
                totalTokens: 100,
              },
              threadId: 'thread-subagent-cold-child',
              total: {
                cacheWriteInputTokens: 0,
                cachedInputTokens: 20,
                inputTokens: 70,
                outputTokens: 30,
                reasoningOutputTokens: 4,
                totalTokens: 100,
              },
              turnId: 'turn-subagent-cold-child',
            })
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Cold child usage recorded',
              threadId: 'thread-subagent-cold-parent',
              turnId: 'turn-subagent-cold-parent',
            })
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: { PATH: '/custom/bin' },
        model: 'gpt-5.6-sol',
        modelProvider: 'openai',
        prompt: 'resume and meter a child cumulatively',
        resumeSessionId: 'thread-subagent-cold-parent',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Cold child usage recorded')
      expect(result.additionalUsages).toHaveLength(1)
      expect(result.additionalUsages[0]?.usage).toMatchObject({
        cachedInputTokens: 20,
        inputTokens: 70,
        outputTokens: 30,
        providerRequestId: null,
        reasoningTokens: 4,
        requestedModel: 'gpt-5.6-sol',
        servedModel: 'gpt-5.6-sol',
        totalTokens: 100,
        usageExtractionSourcePath: 'subagent.turn.tokenUsage.total.delta',
      })
      expect(
        readWrittenRpcMessages(
          requireMockChildProcess(spawnedChildren[0] ?? null),
        ).filter((message) => message.method === 'thread/resume'),
      ).toHaveLength(1)
    })

    it('uses the parent model for non-hosted child usage aggregation', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-usage-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-usage-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_100 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-parent',
              turnId: 'turn-subagent-parent',
            })
            // The exact activity item has no model field, so the child
            // inherits the parent model.
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'spawn-v2-terra',
                  type: 'subAgentActivity',
                  kind: 'started',
                  agentThreadId: 'thread-subagent-child-a',
                  agentPath: 'root/terra_check',
                },
                threadId: 'thread-subagent-parent',
                turnId: 'turn-subagent-parent',
              },
            }))
            // Child-thread events interleave on the same connection with
            // foreign thread and turn ids.
            child.stdout.write(jsonLine({
              method: 'turn/started',
              params: {
                threadId: 'thread-subagent-child-a',
                turn: {
                  id: 'turn-subagent-child-a',
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-child-a',
                turnId: 'turn-subagent-child-a',
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'child-cmd-1',
                  type: 'commandExecution',
                  command: 'true',
                },
                threadId: 'thread-subagent-child-a',
                turnId: 'turn-subagent-child-a',
              },
            }))
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-child-a',
                turnId: 'turn-subagent-child-a',
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 5_000,
                    inputTokens: 4_000,
                    cachedInputTokens: 2_000,
                    outputTokens: 1_000,
                    reasoningOutputTokens: 120,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 4_000,
                    inputTokens: 3_200,
                    cachedInputTokens: 2_000,
                    outputTokens: 800,
                    reasoningOutputTokens: 120,
                  },
                },
              },
            }))
            // A V1 child whose spawn item carries no model inherits the
            // parent's model and still bills without a lookup.
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-2',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'thread-subagent-parent',
                  receiverThreadIds: ['thread-subagent-child-b'],
                },
                threadId: 'thread-subagent-parent',
                turnId: 'turn-subagent-parent',
              },
            }))
            child.stdout.write(jsonLine({
              method: 'turn/started',
              params: {
                threadId: 'thread-subagent-child-b',
                turn: {
                  id: 'turn-subagent-child-b',
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-child-b',
                turnId: 'turn-subagent-child-b',
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 700,
                    inputTokens: 600,
                    cachedInputTokens: 100,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 700,
                    inputTokens: 600,
                    cachedInputTokens: 100,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Done with subagents',
              threadId: 'thread-subagent-parent',
              turnId: 'turn-subagent-parent',
            })
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        modelProvider: 'local-test-provider',
        model: 'gpt-5.6-sol',
        prompt: 'spawn a subagent and finish',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Done with subagents')
      expect(result.turnId).toBe('turn-subagent-parent')
      expect(result.additionalUsages).toHaveLength(2)
      expect(result.additionalUsages[0]).toMatchObject({
        provider: 'codex-cli',
        providerRequestOrdinal: 1,
        usage: {
          cachedInputTokens: 2_000,
          inputTokens: 4_000,
          outputTokens: 1_000,
          providerName: 'local-test-provider',
          reasoningTokens: 120,
          requestedModel: 'gpt-5.6-sol',
          servedModel: 'gpt-5.6-sol',
          totalTokens: 5_000,
        },
      })
      expect(result.additionalUsages[0]?.usage.rawUsageJson).toEqual({
        cacheWriteInputTokens: 0,
        cachedInputTokens: 2_000,
        inputTokens: 4_000,
        outputTokens: 1_000,
        reasoningOutputTokens: 120,
        totalTokens: 5_000,
      })
      expect(result.additionalUsages[1]).toMatchObject({
        providerRequestOrdinal: 2,
        usage: {
          inputTokens: 600,
          outputTokens: 100,
          requestedModel: 'gpt-5.6-sol',
          servedModel: 'gpt-5.6-sol',
          totalTokens: 700,
        },
      })
      expect(
        readWrittenRpcMessages(
          requireMockChildProcess(spawnedChildren[0] ?? null),
        ).filter((message) => message.method === 'thread/resume'),
      ).toHaveLength(0)
    })

    it.each(['completed', 'failed'] as const)(
      'keeps reused child-turn usage on each side of a reset when the parent %s',
      async (parentOutcome) => {
        const workingDirectory = await createTempDir(
          `assistant-codex-subagent-reset-${parentOutcome}-work-`,
        )
        const codexHome = await createTempDir(
          `assistant-codex-subagent-reset-${parentOutcome}-home-`,
        )
        const spawnedChildren: MockChildProcess[] = []
        mockProcessGroupSignalsForChildren(spawnedChildren)
        const beforeReset = new Date('2026-07-23T11:59:59.000Z')
        const afterReset = new Date('2026-07-23T12:00:01.000Z')

        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(beforeReset)
        try {
          codexMocks.spawn.mockImplementation(() => {
            const child = new MockChildProcess()
            child.pid = 31_150 + spawnedChildren.length
            spawnedChildren.push(child)

            queueMicrotask(() => {
              void (async () => {
                const initialize = await waitForRpcMethod(child, 'initialize')
                child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
                await writeWarmTurnStarted({
                  child,
                  requestCount: 1,
                  threadId: 'thread-subagent-reset-parent',
                  turnId: 'turn-subagent-reset-parent',
                })
                child.stdout.write(jsonLine({
                  method: 'item/completed',
                  params: {
                    item: {
                      id: 'collab-spawn-reset-child',
                      type: 'collabAgentToolCall',
                      tool: 'spawnAgent',
                      status: 'completed',
                      senderThreadId: 'thread-subagent-reset-parent',
                      receiverThreadIds: ['thread-subagent-reset-child'],
                      model: 'gpt-5.6-terra-mini',
                    },
                    threadId: 'thread-subagent-reset-parent',
                    turnId: 'turn-subagent-reset-parent',
                  },
                }))
                writeStartedTurn(
                  child,
                  'thread-subagent-reset-child',
                  'turn-subagent-before-reset',
                )
                writeTokenUsage({
                  child,
                  last: {
                    cacheWriteInputTokens: 0,
                    cachedInputTokens: 0,
                    inputTokens: 80,
                    outputTokens: 20,
                    reasoningOutputTokens: 0,
                    totalTokens: 100,
                  },
                  threadId: 'thread-subagent-reset-child',
                  total: {
                    cacheWriteInputTokens: 0,
                    cachedInputTokens: 0,
                    inputTokens: 80,
                    outputTokens: 20,
                    reasoningOutputTokens: 0,
                    totalTokens: 100,
                  },
                  turnId: 'turn-subagent-before-reset',
                })
                child.stdout.write(jsonLine({
                  method: 'item/completed',
                  params: {
                    item: {
                      id: 'collab-send-reset-child',
                      type: 'collabAgentToolCall',
                      tool: 'sendInput',
                      status: 'completed',
                      senderThreadId: 'thread-subagent-reset-parent',
                      receiverThreadIds: ['thread-subagent-reset-child'],
                    },
                    threadId: 'thread-subagent-reset-parent',
                    turnId: 'turn-subagent-reset-parent',
                  },
                }))

                vi.setSystemTime(afterReset)
                child.stdout.write(jsonLine({
                  method: 'turn/started',
                  params: {
                    threadId: 'thread-subagent-reset-child',
                    turn: { id: 'turn-subagent-after-reset' },
                  },
                }))
                writeTokenUsage({
                  child,
                  last: {
                    cacheWriteInputTokens: 0,
                    cachedInputTokens: 0,
                    inputTokens: 40,
                    outputTokens: 10,
                    reasoningOutputTokens: 0,
                    totalTokens: 50,
                  },
                  threadId: 'thread-subagent-reset-child',
                  total: {
                    cacheWriteInputTokens: 0,
                    cachedInputTokens: 0,
                    inputTokens: 120,
                    outputTokens: 30,
                    reasoningOutputTokens: 0,
                    totalTokens: 150,
                  },
                  turnId: 'turn-subagent-after-reset',
                })
                writeTokenUsage({
                  child,
                  last: {
                    cacheWriteInputTokens: 0,
                    cachedInputTokens: 0,
                    inputTokens: 80,
                    outputTokens: 20,
                    reasoningOutputTokens: 0,
                    totalTokens: 100,
                  },
                  threadId: 'thread-subagent-reset-child',
                  total: {
                    cacheWriteInputTokens: 0,
                    cachedInputTokens: 0,
                    inputTokens: 200,
                    outputTokens: 50,
                    reasoningOutputTokens: 0,
                    totalTokens: 250,
                  },
                  turnId: 'turn-subagent-after-reset',
                })

                if (parentOutcome === 'completed') {
                  writeCodexV2AssistantEventTurn({
                    child,
                    finalMessage: 'Reused child completed',
                    threadId: 'thread-subagent-reset-parent',
                    turnId: 'turn-subagent-reset-parent',
                  })
                } else {
                  writeCompletedTurn(
                    child,
                    'thread-subagent-reset-parent',
                    'turn-subagent-reset-parent',
                    'failed',
                  )
                }
              })()
            })

            return child
          })

          const turnResult = executeCodexAppServerTurn({
            approvalPolicy: 'never',
            codexHome,
            env: { PATH: '/custom/bin' },
            modelProvider: 'local-test-provider',
            model: 'gpt-5.6-sol',
            prompt: 'reuse one child across a usage reset',
            sandbox: 'workspace-write',
            workingDirectory,
          })
          const additionalUsages = parentOutcome === 'completed'
            ? (await turnResult).additionalUsages
            : readCodexAppServerTurnFailureContext(
              await turnResult.then(
                () => {
                  throw new Error('expected the parent turn to fail')
                },
                (error: unknown) => error,
              ),
            )?.additionalUsages

          expect(additionalUsages).toMatchObject([
            {
              occurredAt: beforeReset.toISOString(),
              providerRequestOrdinal: 1,
              usage: {
                inputTokens: 80,
                outputTokens: 20,
                totalTokens: 100,
                usageExtractionSourcePath:
                  'subagent.turn.tokenUsage.total.delta',
              },
            },
            {
              occurredAt: afterReset.toISOString(),
              providerRequestOrdinal: 2,
              usage: {
                inputTokens: 120,
                outputTokens: 30,
                totalTokens: 150,
                usageExtractionSourcePath:
                  'subagent.turn.tokenUsage.total.delta',
              },
            },
          ])
        } finally {
          vi.useRealTimers()
        }
      },
    )

    it('does not bill parent-authorized child usage without a child turn start', async () => {
      const workingDirectory = await createTempDir(
        'assistant-codex-subagent-missing-start-work-',
      )
      const codexHome = await createTempDir(
        'assistant-codex-subagent-missing-start-home-',
      )
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_175 + spawnedChildren.length
        spawnedChildren.push(child)
        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-missing-start-parent',
              turnId: 'turn-subagent-missing-start-parent',
            })
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-missing-start',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  receiverThreadIds: ['thread-subagent-missing-start-child'],
                },
                threadId: 'thread-subagent-missing-start-parent',
                turnId: 'turn-subagent-missing-start-parent',
              },
            }))
            writeTokenUsage({
              child,
              last: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              threadId: 'thread-subagent-missing-start-child',
              total: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              turnId: 'turn-subagent-missing-start-child',
            })
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Missing child start stayed unbilled',
              threadId: 'thread-subagent-missing-start-parent',
              turnId: 'turn-subagent-missing-start-parent',
            })
          })()
        })
        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: { PATH: '/custom/bin' },
        prompt: 'child usage without a child start',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.additionalUsages).toEqual([])
    })

    it('answers subagent thread server requests with an error without failing the turn', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-deny-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-deny-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_200 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-deny-parent',
              turnId: 'turn-subagent-deny-parent',
            })
            child.stdout.write(jsonLine({
              id: 99,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'a child should not be able to call this',
                },
                threadId: 'thread-subagent-deny-child',
                turnId: 'turn-subagent-deny-child',
              },
            }))
            const denial = await waitForRpcResponse(child, 99)
            expect(denial).toMatchObject({
              id: 99,
              error: {
                code: -32000,
              },
            })
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Parent unaffected',
              threadId: 'thread-subagent-deny-parent',
              turnId: 'turn-subagent-deny-parent',
            })
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'child server requests stay denied',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Parent unaffected')
      expect(result.additionalUsages).toEqual([])
    })

    it('includes observed subagent usage drafts in the failure context when the turn fails', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-fail-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-fail-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_400 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-fail-parent',
              turnId: 'turn-subagent-fail-parent',
            })
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-fail-1',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'thread-subagent-fail-parent',
                  receiverThreadIds: ['thread-subagent-fail-child'],
                  model: 'gpt-5.6-terra-mini',
                },
                threadId: 'thread-subagent-fail-parent',
                turnId: 'turn-subagent-fail-parent',
              },
            }))
            child.stdout.write(jsonLine({
              method: 'turn/started',
              params: {
                threadId: 'thread-subagent-fail-child',
                turn: {
                  id: 'turn-subagent-fail-child',
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-fail-child',
                turnId: 'turn-subagent-fail-child',
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            // The parent turn fails AFTER child usage was observed: the
            // billed child usage must survive into the failure context.
            writeCompletedTurn(
              child,
              'thread-subagent-fail-parent',
              'turn-subagent-fail-parent',
              'failed',
            )
          })()
        })

        return child
      })

      const error: unknown = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'fail after child usage arrives',
        sandbox: 'workspace-write',
        workingDirectory,
      }).then(
        () => {
          throw new Error('expected the Codex turn to fail')
        },
        (turnError: unknown) => turnError,
      )

      expect(error).toMatchObject({
        code: 'ASSISTANT_CODEX_FAILED',
      })
      const failureContext = readCodexAppServerTurnFailureContext(error)
      expect(failureContext?.additionalUsages).toMatchObject([
        {
          provider: 'codex-cli',
          providerRequestOrdinal: 1,
          providerRequestOutcome: 'succeeded',
          usage: {
            inputTokens: 800,
            outputTokens: 200,
            totalTokens: 1_000,
          },
        },
      ])
      expect(failureContext?.additionalUsages[0]?.usage.rawUsageJson).toEqual({
        cacheWriteInputTokens: 0,
        cachedInputTokens: 0,
        inputTokens: 800,
        outputTokens: 200,
        reasoningOutputTokens: 0,
        totalTokens: 1_000,
      })
    })

    it('includes pending reactions in the failure context when a no-reply turn fails', async () => {
      const workingDirectory = await createTempDir('assistant-codex-reaction-fail-work-')
      const codexHome = await createTempDir('assistant-codex-reaction-fail-home-')
      const onFinishWithoutReplyAccepted = vi.fn()
      const onFinishWithoutReplyRecorded = vi.fn()
      const messageRef = `ain_${'d'.repeat(32)}`
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_450 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-reaction-fail-parent',
              turnId: 'turn-reaction-fail-parent',
            })
            child.stdout.write(jsonLine({
              id: 41,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'react_to_message',
                arguments: {
                  message_ref: messageRef,
                  reaction: 'heart',
                },
                threadId: 'thread-reaction-fail-parent',
                turnId: 'turn-reaction-fail-parent',
              },
            }))
            await expect(waitForRpcResponse(child, 41)).resolves.toMatchObject({
              id: 41,
              result: {
                success: true,
              },
            })
            child.stdout.write(jsonLine({
              id: 42,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'finish_without_reply',
                arguments: {},
                threadId: 'thread-reaction-fail-parent',
                turnId: 'turn-reaction-fail-parent',
              },
            }))
            await expect(waitForRpcResponse(child, 42)).resolves.toMatchObject({
              id: 42,
              result: {
                success: true,
              },
            })
            writeCompletedTurn(
              child,
              'thread-reaction-fail-parent',
              'turn-reaction-fail-parent',
              'failed',
            )
          })()
        })

        return child
      })

      const error: unknown = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        authorizeAcceptedMessageTarget: async () => ({
          targetInputId: messageRef,
        }),
        dynamicTools: resolveMurphDynamicTools({
          messageTargetingAvailable: true,
        }),
        onFinishWithoutReplyAccepted,
        onFinishWithoutReplyRecorded,
        prompt: 'react and then finish without reply',
        sandbox: 'workspace-write',
        workingDirectory,
      }).then(
        () => {
          throw new Error('expected the Codex turn to fail')
        },
        (turnError: unknown) => turnError,
      )

      expect(error).toMatchObject({
        code: 'ASSISTANT_CODEX_FAILED',
      })
      expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
        acceptedNoReplyDeliveryContextOrdinals: [0],
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: messageRef,
          },
        ],
      })
      expect(onFinishWithoutReplyAccepted).toHaveBeenCalledOnce()
      expect(onFinishWithoutReplyAccepted).toHaveBeenCalledWith({
        deliveryContextOrdinal: 0,
        messageReactionPending: true,
      })
      expect(onFinishWithoutReplyRecorded).toHaveBeenCalledOnce()
      expect(onFinishWithoutReplyRecorded).toHaveBeenCalledWith({
        deliveryContextOrdinal: 0,
      })
      expect(
        onFinishWithoutReplyAccepted.mock.invocationCallOrder[0],
      ).toBeLessThan(
        onFinishWithoutReplyRecorded.mock.invocationCallOrder[0],
      )
    })

    it('keeps an earlier-context reaction pending for a later-context no-reply settlement', async () => {
      const workingDirectory = await createTempDir('assistant-codex-cross-context-reaction-work-')
      const codexHome = await createTempDir('assistant-codex-cross-context-reaction-home-')
      const onFinishWithoutReplyAccepted = vi.fn()
      const onFinishWithoutReplyRecorded = vi.fn()
      const messageRef = `ain_${'e'.repeat(32)}`
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_550 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-cross-context-reaction',
              turnId: 'turn-cross-context-reaction',
            })
            child.stdout.write(jsonLine({
              id: 45,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'react_to_message',
                arguments: {
                  message_ref: messageRef,
                  reaction: 'heart',
                },
                threadId: 'thread-cross-context-reaction',
                turnId: 'turn-cross-context-reaction',
              },
            }))
            await expect(waitForRpcResponse(child, 45)).resolves.toMatchObject({
              id: 45,
              result: {
                success: true,
              },
            })
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'user-cross-context-initial',
                  type: 'userMessage',
                  content: [{ type: 'text', text: 'react to my earlier message' }],
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'user-cross-context-steered',
                  type: 'userMessage',
                  content: [{ type: 'text', text: 'steered follow up' }],
                },
              },
            }))
            child.stdout.write(jsonLine({
              id: 46,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'finish_without_reply',
                arguments: {},
                threadId: 'thread-cross-context-reaction',
                turnId: 'turn-cross-context-reaction',
              },
            }))
            await expect(waitForRpcResponse(child, 46)).resolves.toMatchObject({
              id: 46,
              result: {
                success: true,
              },
            })
            writeCompletedTurn(
              child,
              'thread-cross-context-reaction',
              'turn-cross-context-reaction',
              'failed',
            )
          })()
        })

        return child
      })

      const error: unknown = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        authorizeAcceptedMessageTarget: async () => ({
          targetInputId: messageRef,
        }),
        dynamicTools: resolveMurphDynamicTools({
          messageTargetingAvailable: true,
        }),
        onFinishWithoutReplyAccepted,
        onFinishWithoutReplyRecorded,
        prompt: 'react then no-reply in a later steered context',
        sandbox: 'workspace-write',
        workingDirectory,
      }).then(
        () => {
          throw new Error('expected the Codex turn to fail')
        },
        (turnError: unknown) => turnError,
      )

      expect(error).toMatchObject({
        code: 'ASSISTANT_CODEX_FAILED',
      })
      expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
        acceptedNoReplyDeliveryContextOrdinals: [1],
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: messageRef,
          },
        ],
      })
      // The accepted event settles the cumulative prefix through ordinal 1,
      // so the ordinal-0 reaction must keep suppression evidence deferred.
      expect(onFinishWithoutReplyAccepted).toHaveBeenCalledOnce()
      expect(onFinishWithoutReplyAccepted).toHaveBeenCalledWith({
        deliveryContextOrdinal: 1,
        messageReactionPending: true,
      })
    })

    it('preserves accepted no-reply and rollout context when the recorded hook fails', async () => {
      const workingDirectory = await createTempDir('assistant-codex-no-reply-recorded-fail-work-')
      const codexHome = await createTempDir('assistant-codex-no-reply-recorded-fail-home-')
      const threadId = '00000000-0000-4000-8000-000000000620'
      const rolloutRelativePath =
        `sessions/2026/07/14/rollout-2026-07-14T01-02-03-${threadId}.jsonl`
      const onFinishWithoutReplyAccepted = vi.fn()
      const markerFailure = new Error('no-reply marker persistence failed')
      const onFinishWithoutReplyRecorded = vi.fn(async () => {
        throw markerFailure
      })
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_475 + spawnedChildren.length
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
                  id: threadId,
                  path: path.join(codexHome, rolloutRelativePath),
                },
              },
            }))
            const turn = await waitForRpcMethod(child, 'turn/start')
            child.stdout.write(jsonLine({
              id: turn.id,
              result: {
                turn: {
                  id: 'turn-no-reply-recorded-fail',
                },
              },
            }))
            child.stdout.write(jsonLine({
              id: 43,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'finish_without_reply',
                arguments: {},
                threadId,
                turnId: 'turn-no-reply-recorded-fail',
              },
            }))
            await expect(waitForRpcResponse(child, 43)).resolves.toMatchObject({
              id: 43,
              result: { success: true },
            })
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-no-reply-recorded-fail',
                  status: 'completed',
                },
              },
            }))
          })()
        })

        return child
      })

      const error: unknown = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        onFinishWithoutReplyAccepted,
        onFinishWithoutReplyRecorded,
        prompt: 'finish without replying',
        sandbox: 'workspace-write',
        workingDirectory,
      }).then(
        () => {
          throw new Error('expected the recorded hook to fail the Codex turn')
        },
        (turnError: unknown) => turnError,
      )

      expect(error).toBe(markerFailure)
      expect(onFinishWithoutReplyAccepted).toHaveBeenCalledWith({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      expect(onFinishWithoutReplyRecorded).toHaveBeenCalledWith({
        deliveryContextOrdinal: 0,
      })
      expect(
        onFinishWithoutReplyAccepted.mock.invocationCallOrder[0],
      ).toBeLessThan(
        onFinishWithoutReplyRecorded.mock.invocationCallOrder[0],
      )
      expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
        acceptedNoReplyDeliveryContextOrdinals: [0],
        codexThreadId: threadId,
        providerTurnId: 'turn-no-reply-recorded-fail',
        rolloutRelativePath,
      })
    })

    it('accounts every observed child thread without an arbitrary fan-out cap', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-cap-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-cap-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)
      const trackedThreadCount = 32
      const overflowThreadId = `thread-subagent-cap-${trackedThreadCount + 1}`

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_500 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-cap-parent',
              turnId: 'turn-subagent-cap-parent',
            })
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-cap-1',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'thread-subagent-cap-parent',
                  receiverThreadIds: Array.from(
                    { length: trackedThreadCount + 1 },
                    (_, index) => `thread-subagent-cap-${index + 1}`,
                  ),
                  model: 'gpt-5.6-terra-mini',
                },
                threadId: 'thread-subagent-cap-parent',
                turnId: 'turn-subagent-cap-parent',
              },
            }))
            for (let childIndex = 1; childIndex <= trackedThreadCount + 1; childIndex += 1) {
              const totals = {
                cacheWriteInputTokens: 0,
                totalTokens: childIndex * 100,
                inputTokens: childIndex * 80,
                cachedInputTokens: 0,
                outputTokens: childIndex * 20,
                reasoningOutputTokens: 0,
              }
              child.stdout.write(jsonLine({
                method: 'turn/started',
                params: {
                  threadId: `thread-subagent-cap-${childIndex}`,
                  turn: {
                    id: `turn-subagent-cap-${childIndex}`,
                  },
                },
              }))
              child.stdout.write(jsonLine({
                method: 'thread/tokenUsage/updated',
                params: {
                  threadId: `thread-subagent-cap-${childIndex}`,
                  turnId: `turn-subagent-cap-${childIndex}`,
                  tokenUsage: {
                    total: totals,
                    last: totals,
                  },
                },
              }))
            }
            // The last child emits a second cumulative checkpoint for the
            // same turn and remains a single usage operation.
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: overflowThreadId,
                turnId: `turn-subagent-cap-${trackedThreadCount + 1}`,
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 9_900,
                    inputTokens: 9_000,
                    cachedInputTokens: 0,
                    outputTokens: 900,
                    reasoningOutputTokens: 0,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 9_900,
                    inputTokens: 9_000,
                    cachedInputTokens: 0,
                    outputTokens: 900,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            writeStartedTurn(
              child,
              'thread-subagent-cap-1',
              'turn-subagent-cap-reused',
            )
            writeTokenUsage({
              child,
              last: {
                cacheWriteInputTokens: 0,
                totalTokens: 50,
                inputTokens: 40,
                cachedInputTokens: 0,
                outputTokens: 10,
                reasoningOutputTokens: 0,
              },
              threadId: 'thread-subagent-cap-1',
              total: {
                cacheWriteInputTokens: 0,
                totalTokens: 150,
                inputTokens: 120,
                cachedInputTokens: 0,
                outputTokens: 30,
                reasoningOutputTokens: 0,
              },
              turnId: 'turn-subagent-cap-reused',
            })
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Survived the spawn storm',
              threadId: 'thread-subagent-cap-parent',
              turnId: 'turn-subagent-cap-parent',
            })
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'spawn many children',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Survived the spawn storm')
      expect(result.additionalUsages).toHaveLength(trackedThreadCount + 2)
      expect(result.additionalUsages[0]).toMatchObject({
        providerRequestOrdinal: 1,
        usage: {
          totalTokens: 100,
        },
      })
      expect(result.additionalUsages[trackedThreadCount - 1]).toMatchObject({
        providerRequestOrdinal: trackedThreadCount,
        usage: {
          totalTokens: trackedThreadCount * 100,
        },
      })
      expect(result.additionalUsages[trackedThreadCount]).toMatchObject({
        providerRequestOrdinal: trackedThreadCount + 1,
        usage: {
          totalTokens: 9_900,
        },
      })
      expect(result.additionalUsages[trackedThreadCount + 1]).toMatchObject({
        providerRequestOrdinal: trackedThreadCount + 2,
        usage: {
          totalTokens: 50,
        },
      })
    })

    it('continues subagent usage ordinals after dynamic tool usage drafts', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-ordinal-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-ordinal-home-')
      const vaultRoot = await createTempDir('assistant-codex-subagent-ordinal-vault-')
      await initializeVault({ vaultRoot })
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)
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
        child.pid = 31_600 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-ordinal-parent',
              turnId: 'turn-subagent-ordinal-parent',
            })
            // Child usage interleaves with a parent dynamic tool call: the
            // image draft takes ordinal 1, so the subagent draft must take 2.
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-ordinal-1',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'thread-subagent-ordinal-parent',
                  receiverThreadIds: ['thread-subagent-ordinal-child'],
                  model: 'gpt-5.6-terra-mini',
                },
                threadId: 'thread-subagent-ordinal-parent',
                turnId: 'turn-subagent-ordinal-parent',
              },
            }))
            child.stdout.write(jsonLine({
              method: 'turn/started',
              params: {
                threadId: 'thread-subagent-ordinal-child',
                turn: {
                  id: 'turn-subagent-ordinal-child',
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-ordinal-child',
                turnId: 'turn-subagent-ordinal-child',
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            child.stdout.write(jsonLine({
              id: 71,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'Render the product.',
                },
                threadId: 'thread-subagent-ordinal-parent',
                turnId: 'turn-subagent-ordinal-parent',
              },
            }))
            await expect(waitForRpcResponse(child, 71)).resolves.toMatchObject({
              id: 71,
              result: {
                success: true,
              },
            })
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Image and subagent usage recorded',
              threadId: 'thread-subagent-ordinal-parent',
              turnId: 'turn-subagent-ordinal-parent',
            })
          })()
        })

        return child
      })

      const result = await executeCodexAppServerTurn({
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
        prompt: 'generate an image while a child reports usage',
        requireHostedPrivateImageDelivery: true,
        sandbox: 'workspace-write',
        vaultRoot,
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Image and subagent usage recorded')
      expect(result.additionalUsages).toMatchObject([
        {
          provider: 'openai-images',
          providerRequestOrdinal: 1,
        },
        {
          provider: 'codex-cli',
          providerRequestOrdinal: 2,
          usage: {
            inputTokens: 800,
            outputTokens: 200,
            totalTokens: 1_000,
          },
        },
      ])
      expect(result.additionalUsages[1]?.usage.rawUsageJson).toEqual({
        cacheWriteInputTokens: 0,
        cachedInputTokens: 0,
        inputTokens: 800,
        outputTokens: 200,
        reasoningOutputTokens: 0,
        totalTokens: 1_000,
      })
    })

    it('tolerates subagent thread notifications between turns without poisoning the warm process', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-idle-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-idle-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_700 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-idle-parent',
              turnId: 'turn-subagent-idle-one',
            })
            writeCompletedTurn(
              child,
              'thread-subagent-idle-parent',
              'turn-subagent-idle-one',
            )

            await writeWarmTurnStarted({
              child,
              requestCount: 2,
              threadId: 'thread-subagent-idle-parent-2',
              turnId: 'turn-subagent-idle-two',
            })
            writeCompletedTurn(
              child,
              'thread-subagent-idle-parent-2',
              'turn-subagent-idle-two',
            )
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
          prompt: 'first turn before idle subagent traffic',
        }),
      ).resolves.toMatchObject({
        turnId: 'turn-subagent-idle-one',
      })

      // Subagent threads outlive parent turns. Global app-server notifications
      // from the child's post-turn work can arrive without a thread id, and
      // late child-thread traffic can follow. None of that may poison the warm
      // process; child server requests still get a deny response.
      spawnedChildren[0]!.stdout.write(jsonLine({
        method: 'account/rateLimits/updated',
        params: {
          rateLimits: [],
        },
      }))
      spawnedChildren[0]!.stdout.write(jsonLine({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'thread-subagent-idle-child',
          turnId: 'turn-subagent-idle-child',
          tokenUsage: {
            total: { cacheWriteInputTokens: 0,
              totalTokens: 400,
              inputTokens: 300,
              cachedInputTokens: 0,
              outputTokens: 100,
              reasoningOutputTokens: 0,
            },
            last: { cacheWriteInputTokens: 0,
              totalTokens: 400,
              inputTokens: 300,
              cachedInputTokens: 0,
              outputTokens: 100,
              reasoningOutputTokens: 0,
            },
          },
        },
      }))
      spawnedChildren[0]!.stdout.write(jsonLine({
        id: 199,
        method: 'item/tool/call',
        params: {
          namespace: 'murph',
          tool: 'generate_image',
          arguments: {
            prompt: 'idle child tool call',
          },
          threadId: 'thread-subagent-idle-child',
          turnId: 'turn-subagent-idle-child',
        },
      }))
      await expect(
        waitForRpcResponse(spawnedChildren[0]!, 199),
      ).resolves.toMatchObject({
        id: 199,
        error: {
          code: -32000,
        },
      })

      const second = await executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second turn reusing the warm process',
      })
      expect(second.turnId).toBe('turn-subagent-idle-two')
      // The idle child usage is tolerated, never billed.
      expect(second.additionalUsages).toEqual([])
      expect(spawnedChildren).toHaveLength(1)
    })

    it('keeps the root reply nonblocking while the workspace boundary waits for descendants', async () => {
      const workingDirectory = await createTempDir('assistant-codex-background-boundary-work-')
      const codexHome = await createTempDir('assistant-codex-background-boundary-home-')
      const spawnedChildren: MockChildProcess[] = []
      const startChild = createDeferred<void>()
      const childStarted = createDeferred<void>()
      const completeChild = createDeferred<void>()
      const terminalScanObserved = createDeferred<void>()
      mockWarmCodexProcess(spawnedChildren, 31_850, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-background-boundary-parent',
          'turn-background-boundary-parent',
        )
        writeSubAgentActivity(
          child,
          'thread-background-boundary-parent',
          'thread-background-boundary-child',
          'started',
          {
            agentPath: '/root/onboarding-import',
            id: 'spawn-background-boundary-child',
            turnId: 'turn-background-boundary-parent',
          },
        )
        writeCompletedTurn(
          child,
          'thread-background-boundary-parent',
          'turn-background-boundary-parent',
        )
        await startChild.promise
        writeStartedTurn(
          child,
          'thread-background-boundary-child',
          'turn-background-boundary-child',
        )
        childStarted.resolve(undefined)
        await completeChild.promise
        writeCompletedTurn(
          child,
          'thread-background-boundary-child',
          'turn-background-boundary-child',
        )

        for (let requestCount = 1; requestCount <= 2; requestCount += 1) {
          await respondToBackgroundTerminals(child, requestCount)
        }
        terminalScanObserved.resolve(undefined)
      })

      const result = await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'delegate ingestion and reply now',
      )
      expect(result.turnId).toBe('turn-background-boundary-parent')

      let boundaryResolved = false
      const boundary = waitForWarmCodexBackgroundWork().then(() => {
        boundaryResolved = true
      })
      expect(boundaryResolved).toBe(false)

      startChild.resolve(undefined)
      await childStarted.promise
      expect(boundaryResolved).toBe(false)

      completeChild.resolve(undefined)
      await terminalScanObserved.promise
      await expect(boundary).resolves.toBeUndefined()
      expect(boundaryResolved).toBe(true)
      expect(spawnedChildren).toHaveLength(1)
    })

    it('preserves the warm process and child boundary when a checkpoint wait is interrupted', async () => {
      const workingDirectory = await createTempDir('assistant-codex-interrupted-boundary-work-')
      const codexHome = await createTempDir('assistant-codex-interrupted-boundary-home-')
      const spawnedChildren: MockChildProcess[] = []
      const firstScanObserved = createDeferred<void>()
      const releaseFirstScanResponse = createDeferred<void>()
      const firstScanResponseWritten = createDeferred<void>()
      mockWarmCodexProcess(spawnedChildren, 31_860, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-interrupted-boundary-parent',
          'turn-interrupted-boundary-parent',
        )
        writeSubAgentActivity(
          child,
          'thread-interrupted-boundary-parent',
          'thread-interrupted-boundary-child',
        )
        writeStartedTurn(
          child,
          'thread-interrupted-boundary-child',
          'turn-interrupted-boundary-child',
        )
        writeCompletedTurn(
          child,
          'thread-interrupted-boundary-child',
          'turn-interrupted-boundary-child',
        )
        writeCompletedTurn(
          child,
          'thread-interrupted-boundary-parent',
          'turn-interrupted-boundary-parent',
        )

        const firstScan = await waitForRpcMethodCount(
          child,
          'thread/backgroundTerminals/list',
          1,
        )
        firstScanObserved.resolve(undefined)
        await releaseFirstScanResponse.promise
        child.stdout.write(jsonLine({
          id: firstScan.id,
          result: {
            data: [],
            nextCursor: null,
          },
        }))
        firstScanResponseWritten.resolve(undefined)
        await respondToBackgroundTerminals(child, 2)
        await respondToBackgroundTerminals(child, 3)
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'delegate one bounded import before checkpointing',
      )

      const controller = new AbortController()
      const interruptedBoundary = waitForWarmCodexBackgroundWork({
        signal: controller.signal,
      })
      await firstScanObserved.promise
      const interruption = new Error('checkpoint interrupted')
      controller.abort(interruption)
      await expect(interruptedBoundary).rejects.toBe(interruption)
      expect(spawnedChildren[0]?.signalCode).toBeNull()

      releaseFirstScanResponse.resolve(undefined)
      await firstScanResponseWritten.promise
      await expect(waitForWarmCodexBackgroundWork()).resolves.toBeUndefined()
      expect(spawnedChildren[0]?.signalCode).toBeNull()
      expect(spawnedChildren).toHaveLength(1)
    })

    it('retains every resident child across an interrupted checkpoint and a later root', async () => {
      const workingDirectory = await createTempDir('assistant-codex-multi-root-boundary-work-')
      const codexHome = await createTempDir('assistant-codex-multi-root-boundary-home-')
      const spawnedChildren: MockChildProcess[] = []
      const startSecondRoot = createDeferred<void>()
      const completeFirstChild = createDeferred<void>()
      const scannedThreadIds: string[] = []
      mockWarmCodexProcess(spawnedChildren, 31_865, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-multi-root-boundary-parent-a',
          'turn-multi-root-boundary-parent-a',
        )
        writeSubAgentActivity(
          child,
          'thread-multi-root-boundary-parent-a',
          'thread-multi-root-boundary-child-a',
        )
        writeStartedTurn(
          child,
          'thread-multi-root-boundary-child-a',
          'turn-multi-root-boundary-child-a',
        )
        writeCompletedTurn(
          child,
          'thread-multi-root-boundary-parent-a',
          'turn-multi-root-boundary-parent-a',
        )

        await startSecondRoot.promise
        await writeWarmTurnStarted({
          child,
          requestCount: 2,
          threadId: 'thread-multi-root-boundary-parent-b',
          turnId: 'turn-multi-root-boundary-parent-b',
        })
        writeSubAgentActivity(
          child,
          'thread-multi-root-boundary-parent-b',
          'thread-multi-root-boundary-child-b',
        )
        writeStartedTurn(
          child,
          'thread-multi-root-boundary-child-b',
          'turn-multi-root-boundary-child-b',
        )
        writeCompletedTurn(
          child,
          'thread-multi-root-boundary-child-b',
          'turn-multi-root-boundary-child-b',
        )
        writeCompletedTurn(
          child,
          'thread-multi-root-boundary-parent-b',
          'turn-multi-root-boundary-parent-b',
        )

        const terminalResponses = (async () => {
          for (let requestCount = 1; requestCount <= 4; requestCount += 1) {
            const request = await respondToBackgroundTerminals(child, requestCount)
            scannedThreadIds.push(String(asRecord(request.params).threadId))
          }
        })()

        await completeFirstChild.promise
        writeCompletedTurn(
          child,
          'thread-multi-root-boundary-child-a',
          'turn-multi-root-boundary-child-a',
        )
        await terminalResponses
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'start the first bounded import and reply',
      )

      const controller = new AbortController()
      const interruptedBoundary = waitForWarmCodexBackgroundWork({
        signal: controller.signal,
      })
      const interruption = new Error('checkpoint interrupted for foreground work')
      controller.abort(interruption)
      await expect(interruptedBoundary).rejects.toBe(interruption)
      expect(spawnedChildren[0]?.signalCode).toBeNull()

      startSecondRoot.resolve(undefined)
      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'start a second bounded import while the first child remains active',
      )

      const publishCheckpoint = vi.fn()
      const retriedBoundary = waitForWarmCodexBackgroundWork().then(
        publishCheckpoint,
      )
      await new Promise((resolve) => setTimeout(resolve, 75))
      expect(publishCheckpoint).not.toHaveBeenCalled()

      completeFirstChild.resolve(undefined)
      await expect(retriedBoundary).resolves.toBeUndefined()
      expect(publishCheckpoint).toHaveBeenCalledOnce()
      expect(scannedThreadIds).toEqual([
        'thread-multi-root-boundary-parent-a',
        'thread-multi-root-boundary-parent-b',
        'thread-multi-root-boundary-child-a',
        'thread-multi-root-boundary-child-b',
      ])
      expect(spawnedChildren[0]?.signalCode).toBeNull()
      expect(spawnedChildren).toHaveLength(1)
    })

    it('waits for and scans three concurrent children from the same root', async () => {
      const workingDirectory = await createTempDir('assistant-codex-three-child-boundary-work-')
      const codexHome = await createTempDir('assistant-codex-three-child-boundary-home-')
      const spawnedChildren: MockChildProcess[] = []
      const completeFirstChild = createDeferred<void>()
      const scannedThreadIds: string[] = []
      mockWarmCodexProcess(spawnedChildren, 31_868, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-three-child-parent',
          'turn-three-child-parent',
        )

        for (const suffix of ['a', 'b', 'c']) {
          writeSubAgentActivity(
            child,
            'thread-three-child-parent',
            `thread-three-child-${suffix}`,
          )
          writeStartedTurn(
            child,
            `thread-three-child-${suffix}`,
            `turn-three-child-${suffix}`,
          )
        }

        writeCompletedTurn(
          child,
          'thread-three-child-b',
          'turn-three-child-b',
        )
        writeCompletedTurn(
          child,
          'thread-three-child-c',
          'turn-three-child-c',
        )
        writeCompletedTurn(
          child,
          'thread-three-child-parent',
          'turn-three-child-parent',
        )

        const terminalResponses = (async () => {
          for (let requestCount = 1; requestCount <= 4; requestCount += 1) {
            const request = await respondToBackgroundTerminals(child, requestCount)
            scannedThreadIds.push(String(asRecord(request.params).threadId))
          }
        })()

        await completeFirstChild.promise
        writeCompletedTurn(
          child,
          'thread-three-child-a',
          'turn-three-child-a',
        )
        await terminalResponses
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'delegate three independent onboarding persistence tasks',
      )

      const publishCheckpoint = vi.fn()
      const boundary = waitForWarmCodexBackgroundWork().then(publishCheckpoint)
      await new Promise((resolve) => setTimeout(resolve, 75))
      expect(publishCheckpoint).not.toHaveBeenCalled()
      expect(scannedThreadIds).toEqual([])

      completeFirstChild.resolve(undefined)
      await expect(boundary).resolves.toBeUndefined()
      expect(publishCheckpoint).toHaveBeenCalledOnce()
      expect(scannedThreadIds).toEqual([
        'thread-three-child-parent',
        'thread-three-child-a',
        'thread-three-child-b',
        'thread-three-child-c',
      ])
      expect(spawnedChildren[0]?.signalCode).toBeNull()
      expect(spawnedChildren).toHaveLength(1)
    })

    it('treats a failed optional child as quiescent without stopping the warm process', async () => {
      const workingDirectory = await createTempDir('assistant-codex-failed-child-work-')
      const codexHome = await createTempDir('assistant-codex-failed-child-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockWarmCodexProcess(spawnedChildren, 31_870, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-failed-child-parent',
          'turn-failed-child-parent',
        )
        writeSubAgentActivity(
          child,
          'thread-failed-child-parent',
          'thread-failed-child-child',
        )
        writeStartedTurn(
          child,
          'thread-failed-child-child',
          'turn-failed-child-child',
        )
        writeCompletedTurn(
          child,
          'thread-failed-child-child',
          'turn-failed-child-child',
          'failed',
        )
        writeCompletedTurn(
          child,
          'thread-failed-child-parent',
          'turn-failed-child-parent',
        )
        await respondToBackgroundTerminals(child, 1)
        await respondToBackgroundTerminals(child, 2)
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'persist the minimum, then try optional enrichment',
      )
      await expect(waitForWarmCodexBackgroundWork()).resolves.toBeUndefined()

      expect(spawnedChildren[0]?.signalCode).toBeNull()
      expect(spawnedChildren).toHaveLength(1)
    })

    it('tracks every sequential child admitted before the boundary', async () => {
      const workingDirectory = await createTempDir('assistant-codex-sequential-child-work-')
      const codexHome = await createTempDir('assistant-codex-sequential-child-home-')
      const spawnedChildren: MockChildProcess[] = []
      const scannedThreadIds: string[] = []
      mockWarmCodexProcess(spawnedChildren, 31_875, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-sequential-parent',
          'turn-sequential-parent',
        )
        writeSubAgentActivity(
          child,
          'thread-sequential-parent',
          'thread-sequential-child-a',
        )
        writeStartedTurn(
          child,
          'thread-sequential-child-a',
          'turn-sequential-child-a',
        )
        writeCompletedTurn(
          child,
          'thread-sequential-child-a',
          'turn-sequential-child-a',
        )

        // Native child completion may beat the parent-side Started item.
        writeStartedTurn(
          child,
          'thread-sequential-child-b',
          'turn-sequential-child-b',
        )
        writeCompletedTurn(
          child,
          'thread-sequential-child-b',
          'turn-sequential-child-b',
        )
        writeSubAgentActivity(
          child,
          'thread-sequential-parent',
          'thread-sequential-child-b',
        )
        writeCompletedTurn(
          child,
          'thread-sequential-parent',
          'turn-sequential-parent',
        )

        for (let requestCount = 1; requestCount <= 3; requestCount += 1) {
          const request = await respondToBackgroundTerminals(child, requestCount)
          scannedThreadIds.push(String(asRecord(request.params).threadId))
        }
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'run two sequential bounded imports',
      )
      await expect(waitForWarmCodexBackgroundWork()).resolves.toBeUndefined()

      expect(scannedThreadIds).toEqual([
        'thread-sequential-parent',
        'thread-sequential-child-a',
        'thread-sequential-child-b',
      ])
      expect(spawnedChildren).toHaveLength(1)
    })

    it('fails closed on child interaction and stops the exact warm process', async () => {
      const workingDirectory = await createTempDir('assistant-codex-child-interaction-work-')
      const codexHome = await createTempDir('assistant-codex-child-interaction-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockWarmCodexProcess(spawnedChildren, 31_880, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-child-interaction-parent',
          'turn-child-interaction-parent',
        )
        writeStartedTurn(
          child,
          'thread-child-interaction-child',
          'turn-child-interaction-child',
        )
        // This child-to-root message can arrive before the parent-side
        // Started item; it still violates the one-shot leaf contract.
        writeSubAgentActivity(
          child,
          'thread-child-interaction-child',
          'thread-child-interaction-parent',
          'interacted',
        )
        writeSubAgentActivity(
          child,
          'thread-child-interaction-parent',
          'thread-child-interaction-child',
        )
        writeCompletedTurn(
          child,
          'thread-child-interaction-parent',
          'turn-child-interaction-parent',
        )
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'attempt an unsupported interactive child',
      )
      await expect(waitForWarmCodexBackgroundWork()).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_BACKGROUND_WORK_UNSUPPORTED',
      })
      expect(spawnedChildren[0]?.signalCode).toBe('SIGTERM')
    })

    it('rejects a child background terminal before snapshotting', async () => {
      const workingDirectory = await createTempDir('assistant-codex-child-terminal-work-')
      const codexHome = await createTempDir('assistant-codex-child-terminal-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockWarmCodexProcess(spawnedChildren, 31_885, async (child) => {
        await initializeWarmTurn(
          child,
          'thread-child-terminal-parent',
          'turn-child-terminal-parent',
        )
        writeSubAgentActivity(
          child,
          'thread-child-terminal-parent',
          'thread-child-terminal-child',
        )
        writeStartedTurn(
          child,
          'thread-child-terminal-child',
          'turn-child-terminal-child',
        )
        writeCompletedTurn(
          child,
          'thread-child-terminal-child',
          'turn-child-terminal-child',
        )
        writeCompletedTurn(
          child,
          'thread-child-terminal-parent',
          'turn-child-terminal-parent',
        )

        await respondToBackgroundTerminals(child, 1)
        await respondToBackgroundTerminals(
          child,
          2,
          [{ id: 'terminal-still-running' }],
        )
      })

      await executeBackgroundBoundaryTurn(
        codexHome,
        workingDirectory,
        'run one bounded child without background terminals',
      )
      await expect(waitForWarmCodexBackgroundWork()).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_BACKGROUND_TERMINAL_UNSUPPORTED',
      })
      expect(spawnedChildren[0]?.signalCode).toBe('SIGTERM')
    })

    it('routes late child events arriving before the next thread/start response resolves', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-prestart-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-prestart-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_900 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-prestart-one',
              turnId: 'turn-subagent-prestart-one',
            })
            writeCompletedTurn(
              child,
              'thread-subagent-prestart-one',
              'turn-subagent-prestart-one',
            )

            // The second turn has bound the warm process, but its
            // thread/start response has not been written yet: a late child
            // event lands in that window and must stay out of the parent
            // turn's output/tool path.
            const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-prestart-child',
                turnId: 'turn-subagent-prestart-child',
                tokenUsage: {
                  total: { cacheWriteInputTokens: 0,
                    totalTokens: 600,
                    inputTokens: 500,
                    cachedInputTokens: 0,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                  },
                  last: { cacheWriteInputTokens: 0,
                    totalTokens: 600,
                    inputTokens: 500,
                    cachedInputTokens: 0,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            child.stdout.write(jsonLine({
              id: secondThread.id,
              result: {
                thread: {
                  id: 'thread-subagent-prestart-two',
                },
              },
            }))
            const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
            child.stdout.write(jsonLine({
              id: secondTurn.id,
              result: {
                turn: {
                  id: 'turn-subagent-prestart-two',
                },
              },
            }))
            writeCompletedTurn(
              child,
              'thread-subagent-prestart-two',
              'turn-subagent-prestart-two',
            )
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
          prompt: 'first turn before the pre-start window race',
        }),
      ).resolves.toMatchObject({
        turnId: 'turn-subagent-prestart-one',
      })

      const second = await executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second turn with a late child event before thread/start resolves',
      })
      expect(second.turnId).toBe('turn-subagent-prestart-two')
      // The late child has no collab evidence in this turn: tolerated, not billed.
      expect(second.additionalUsages).toEqual([])
      expect(spawnedChildren).toHaveLength(1)
    })

  })
})
