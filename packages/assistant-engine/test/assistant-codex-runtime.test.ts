import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { HOSTED_RUNTIME_CODEX_APP_SERVER_TEST_COMMAND_ENV } from '@murphai/hosted-execution/cli-runtime-bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const codexMocks = vi.hoisted(() => ({
  fakeHome: '/home/tester',
  spawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: codexMocks.spawn,
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => codexMocks.fakeHome,
  }
})

import {
  buildCodexAppServerSteerRequest,
  buildCodexAppServerArgs,
  executeCodexAppServerTurn,
  resolveCodexDisplayOptions,
} from '../src/assistant-codex.ts'
import type { CodexAppServerLiveTurn } from '../src/assistant-codex.ts'
import {
  CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA,
  CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE,
  createCodexActionDiagnosticsReducer,
} from '../src/assistant-codex/action-diagnostics.ts'
import {
  buildCodexThreadResumeParams,
  buildCodexThreadStartParams,
  buildCodexTurnStartParams,
  type CodexAppServerInputItem,
} from '../src/assistant-codex/app-server-requests.ts'
import {
  attachCodexAppServerProcessExitCleanup,
  stopCodexAppServerChild,
} from '../src/assistant-codex/app-server-rpc.ts'
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  extractAssistantMessageFallback,
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

const tempRoots: string[] = []

type Deferred<T> = {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

beforeEach(() => {
  vi.spyOn(process, 'kill').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  codexMocks.spawn.mockReset()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant codex runtime', () => {
  it('builds Codex app-server args for configured turns', () => {
    expect(
      buildCodexAppServerArgs({
        approvalPolicy: 'never',
        configOverrides: ['model="gpt-5"', 'theme="clean"'],
        oss: true,
        profile: 'daily',
        sandbox: 'workspace-write',
      }),
    ).toEqual([
      '-s',
      'workspace-write',
      '-a',
      'never',
      '--config',
      'model="gpt-5"',
      '--config',
      'theme="clean"',
      '--profile',
      'daily',
      '--oss',
      'app-server',
    ])

    expect(buildCodexAppServerArgs({})).toEqual(['-a', 'never', 'app-server'])
  })

  it('builds typed Codex app-server turn steer requests for live turns', () => {
    expect(
      buildCodexAppServerSteerRequest({
        imagePaths: ['/tmp/steer-image.png'],
        prompt: 'Add this context',
        threadId: ' thread-steer ',
        turnId: ' turn-steer ',
      }),
    ).toEqual({
      method: 'turn/steer',
      params: {
        expectedTurnId: 'turn-steer',
        input: [
          {
            type: 'text',
            text: 'Add this context',
          },
          {
            type: 'localImage',
            path: '/tmp/steer-image.png',
          },
        ],
        threadId: 'thread-steer',
      },
    })

    expect(() =>
      buildCodexAppServerSteerRequest({
        prompt: 'missing turn',
        threadId: 'thread-steer',
        turnId: ' ',
      }),
    ).toThrowError('Codex app-server turnId is required for live turn requests.')
  })

  it('puts instructions on thread lifecycle requests but keeps turn input user-scoped', () => {
    const baseInput = {
      approvalPolicy: 'never',
      baseInstructions: 'Do not use this in normal Murph config.',
      developerInstructions: 'Stable Murph instructions.',
      excludeResumeTurns: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      prompt: 'User message:\nWhat changed?',
      reasoningEffort: 'high',
      refreshThreadInstructions: false,
      sandbox: 'workspace-write' as const,
      workingDirectory: '/workspace',
    }

    expect(buildCodexThreadStartParams(baseInput)).toEqual({
      approvalPolicy: 'never',
      baseInstructions: 'Do not use this in normal Murph config.',
      cwd: '/workspace',
      developerInstructions: 'Stable Murph instructions.',
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      sandbox: 'workspace-write',
      serviceName: 'murph',
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        modelProvider: 'venice',
      }),
    ).toMatchObject({
      model: 'gpt-5',
      modelProvider: 'venice',
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        turnProgress: {
          async send() {},
        },
      }),
    ).toMatchObject({
      dynamicTools: [MURPH_SEND_PROGRESS_UPDATE_TOOL],
    })

    expect(
      buildCodexThreadResumeParams({
        input: baseInput,
        codexThreadId: 'thread-1',
      }),
    ).toEqual({
      excludeTurns: true,
      threadId: 'thread-1',
    })

    expect(
      buildCodexThreadResumeParams({
        input: {
          ...baseInput,
          refreshThreadInstructions: true,
        },
        codexThreadId: 'thread-1',
      }),
    ).toEqual({
      developerInstructions: 'Stable Murph instructions.',
      excludeTurns: true,
      threadId: 'thread-1',
    })

    const turnStart = buildCodexTurnStartParams({
      imagePaths: [],
      input: baseInput,
      codexThreadId: 'thread-1',
    })
    expect(turnStart).toEqual({
      effort: 'high',
      input: [
        {
          type: 'text',
          text: 'User message:\nWhat changed?',
        },
      ],
      threadId: 'thread-1',
    })
    const firstInputItem = (turnStart.input as CodexAppServerInputItem[])[0]
    expect(firstInputItem?.type === 'text' ? firstInputItem.text : '').not.toContain(
      'Stable Murph instructions.',
    )
  })

  it('resolves display options from config files and explicit overrides', async () => {
    const configRoot = await createTempDir('assistant-codex-config-')
    const configPath = path.join(configRoot, 'config.toml')

    await writeFile(
      configPath,
      [
        '# comment',
        'model = "root-model"',
        'model_reasoning_effort = "medium"',
        'profile = "daily"',
        '[profiles.daily]',
        'model = "daily-model"',
        'model_reasoning_effort = "high"',
        '[profiles.empty]',
        'model = ""',
      ].join('\n'),
      'utf8',
    )

    await expect(resolveCodexDisplayOptions({ configPath })).resolves.toEqual({
      model: 'daily-model',
      reasoningEffort: 'high',
    })

    await expect(
      resolveCodexDisplayOptions({
        configPath,
        model: 'manual-model',
        profile: 'daily',
      }),
    ).resolves.toEqual({
      model: 'manual-model',
      reasoningEffort: 'high',
    })

    await expect(
      resolveCodexDisplayOptions({
        configPath: path.join(configRoot, 'missing.toml'),
      }),
    ).resolves.toEqual({
      model: null,
      reasoningEffort: null,
    })
  })

  it('executes Codex app-server turns, sanitizes env, and streams assistant output through JSON-RPC', async () => {
    const workingDirectory = await createTempDir('assistant-codex-workdir-')
    const codexHome = await createTempDir('assistant-codex-home-')
    const threadId = '00000000-0000-4000-8000-000000000001'
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff])
    const onProgress = vi.fn()
    const onTraceEvent = vi.fn()

    codexMocks.spawn.mockImplementation((_command, args, options) => {
      const child = new MockChildProcess()
      const expectedWorkingDirectory = path.resolve(workingDirectory)

      queueMicrotask(() => {
        void (async () => {
          let messages = await waitForRpcMessages(child, 1)
          expect(messages[0]).toEqual({
            id: 1,
            method: 'initialize',
            params: {
              clientInfo: {
                name: 'murph',
                title: 'Murph',
                version: '1.0.0',
              },
              capabilities: {
                experimentalApi: true,
              },
            },
          })
          child.stdout.write(jsonLine({ id: 1, result: {} }))

          messages = await waitForRpcMessages(child, 3)
          expect(messages[1]).toEqual({
            method: 'initialized',
            params: {},
          })
          expect(messages[2]).toEqual({
            id: 2,
            method: 'thread/start',
            params: {
              approvalPolicy: 'never',
              cwd: expectedWorkingDirectory,
              model: 'gpt-5',
              modelProvider: 'vercel-ai-gateway',
              sandbox: 'workspace-write',
              serviceName: 'murph',
            },
          })
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: threadId,
                  path: path.join(codexHome, rolloutRelativePath),
                },
              },
            }),
          )

          messages = await waitForRpcMessages(child, 4)
          const turnStart = messages[3]
          expect(turnStart).toMatchObject({
            id: 3,
            method: 'turn/start',
            params: {
              effort: 'high',
              threadId,
            },
          })
          expect(asRecord(turnStart.params).approvalPolicy).toBeUndefined()
          expect(asRecord(turnStart.params).cwd).toBeUndefined()
          expect(asRecord(turnStart.params).model).toBeUndefined()
          expect(asRecord(turnStart.params).modelProvider).toBeUndefined()
          expect(asRecord(turnStart.params).sandboxPolicy).toBeUndefined()
          const inputItems = readTurnStartInputItems(turnStart)
          expect(inputItems[0]).toEqual({
            type: 'text',
            text: 'Explain this',
          })
          expect(inputItems[1]).toMatchObject({
            type: 'localImage',
          })
          const imagePath = readLocalImagePath(inputItems[1])
          expect(imagePath.endsWith('.jpg')).toBe(true)
          await expect(readFile(imagePath)).resolves.toEqual(imageBytes)

          child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-1',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-1',
                },
              },
            }),
          )
          child.stderr.write('Retrying after timeout\n')
          child.stdout.write(
            jsonLine({
              method: 'item/started',
              params: {
                item: {
                  id: 'command-1',
                  type: 'command.execution',
                  command: 'pwd',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'assistant.message.delta',
              params: {
                item: {
                  id: 'assistant-1',
                  type: 'assistant_message',
                },
                delta: 'Hello ',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-1',
                  type: 'assistant_message',
                  message: 'Hello world',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'command-1',
                  type: 'command.execution',
                  command: 'pwd',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-1',
                  status: 'completed',
                },
              },
            }),
          )
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      expect(options).toMatchObject({
        cwd: path.resolve(workingDirectory),
        env: {
          CODEX_HOME: codexHome,
          PATH: '/custom/bin',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      expect(options.env.NODE_V8_COVERAGE).toBeUndefined()

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        codexCommand: '  codex  ',
        codexHome,
        env: {
          NODE_V8_COVERAGE: '/coverage',
          PATH: '/custom/bin',
        },
        images: [
          {
            bytes: imageBytes,
            mimeType: 'image/jpeg',
          },
        ],
        onProgress,
        onTraceEvent,
        approvalPolicy: 'never',
        configOverrides: ['model="gpt-5"'],
        model: 'gpt-5',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
        prompt: 'Explain this',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Hello world',
      providerActionCount: 1,
      rolloutRelativePath,
      sessionId: threadId,
      stderr: 'Retrying after timeout',
      threadId,
      turnId: 'turn-1',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      ['-s', 'workspace-write', '-a', 'never', '--config', 'model="gpt-5"', 'app-server'],
      expect.objectContaining({
        detached: process.platform !== 'win32',
      }),
    )
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'codex-connection-status',
        kind: 'status',
        state: 'running',
        text: 'Retrying after timeout',
      }),
    )
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        kind: 'message',
        state: 'completed',
        text: 'Hello world',
      }),
    )
    expect(onTraceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        codexThreadId: threadId,
        updates: [
          {
            kind: 'assistant',
            mode: 'append',
            streamKey: 'assistant:assistant-1',
            text: 'Hello ',
          },
        ],
      }),
    )
    expect(onTraceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          codexTimingStage: 'turn-completed',
          schema: 'murph.assistant-codex-app-server-timing.v1',
          type: 'assistant.codex.app_server_timing',
        }),
        updates: [],
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
                  namespace: 'vault',
                  tool: 'readSummary',
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
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                turnId: 'turn-diagnostics',
                tokenUsage: {
                  last: {
                    cachedInputTokens: 1000,
                    inputTokens: 81000,
                    outputTokens: 1200,
                    reasoningOutputTokens: 300,
                    totalTokens: 82500,
                  },
                  total: {
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        onTraceEvent,
        prompt: 'diagnose usage',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      providerActionCount: 2,
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
      codexActionInputUnitMax: 81000,
      codexActionKinds: ['command.execution', 'dynamic.tool.call'],
      codexActionProviderActionCount: 2,
      codexActionSlowDurationMs: [123, 60],
      codexActionSlowKinds: ['dynamic.tool.call', 'command.execution'],
      codexActionUsageSampleCount: 1,
    })
    expect(diagnosticEvent?.rawEvent).not.toHaveProperty('codexActionOutputBytesMax')
    expect(diagnosticEvent?.rawEvent).not.toHaveProperty('codexActionOutputBytesTotal')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('/tmp/raw')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('raw output')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('secretPath')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('readSummary')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('thread-diagnostics')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('turn-diagnostics')
  })

  it('keeps Codex action diagnostics scoped and deduped per active turn', () => {
    const reducer = createCodexActionDiagnosticsReducer()
    const activeTurnId = 'turn-current'
    const staleTokenEvent = {
      method: 'thread/tokenUsage/updated',
      params: {
        turnId: 'turn-previous',
        tokenUsage: {
          last: {
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
        turnId: activeTurnId,
        tokenUsage: {
          last: {
            inputTokens: 123,
            outputTokens: 45,
            totalTokens: 168,
          },
        },
      },
    }
    const rawStartedEvent = {
      event: 'item.started',
      startedAtMs: 10,
      turnId: activeTurnId,
      data: {
        item: {
          id: 'raw-action-id',
          type: 'commandExecution',
          status: 'running',
        },
      },
    }
    const rawCompletedEvent = {
      event: 'item.completed',
      completedAtMs: 70,
      turnId: activeTurnId,
      data: {
        item: {
          id: 'raw-action-id',
          type: 'commandExecution',
          status: 'completed',
          aggregatedOutput: 'raw output must not appear',
        },
      },
    }
    const rawStartedNormalized: CodexNormalizedEvent = {
      kind: 'unknown',
      eventType: 'item.started',
      rawEvent: rawStartedEvent,
    }
    const rawCompletedNormalized: CodexNormalizedEvent = {
      kind: 'unknown',
      eventType: 'item.completed',
      rawEvent: rawCompletedEvent,
    }

    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: normalizeCodexEvent(staleTokenEvent),
      rawEvent: staleTokenEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: normalizeCodexEvent(currentTokenEvent),
      rawEvent: currentTokenEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawStartedNormalized,
      rawEvent: rawStartedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawStartedNormalized,
      rawEvent: rawStartedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawCompletedNormalized,
      rawEvent: rawCompletedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: rawCompletedNormalized,
      rawEvent: rawCompletedEvent,
    })

    const trace = reducer.buildTraceEvent({
      codexThreadId: 'thread-current',
      providerActionCount: 0,
      turnId: activeTurnId,
    })
    expect(trace).toMatchObject({
      codexActionCommandCount: 1,
      codexActionCompletedCount: 1,
      codexActionDurationMsMax: 60,
      codexActionDurationMsTotal: 60,
      codexActionInputUnitMax: 123,
      codexActionOutputUnitMax: 45,
      codexActionStartedCount: 1,
      codexActionTotalUnitMax: 168,
      codexActionUsageSampleCount: 1,
    })
    expect(JSON.stringify(trace)).not.toContain('999999')
    expect(JSON.stringify(trace)).not.toContain('raw-action-id')
    expect(JSON.stringify(trace)).not.toContain('raw output')
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

  it('ignores custom Codex executable selectors in hosted runtime processes', async () => {
    const workingDirectory = await createTempDir('assistant-codex-hosted-command-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          child.emit('error', error)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        codexCommand: '/tmp/attacker-controlled-codex',
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/usr/bin',
        },
        prompt: 'hosted command guard',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        'Codex app-server executable "codex" was not found. Install @openai/codex or pass --codexCommand.',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      ['-a', 'never', 'app-server'],
      expect.objectContaining({
        cwd: path.resolve(workingDirectory),
        env: expect.objectContaining({
          PATH: '/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        }),
      }),
    )
  })

  it('ignores custom Codex home selectors in hosted runtime processes', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-hosted-home-')
    const profileCodexHome = await createTempDir('assistant-codex-profile-home-')
    const workingDirectory = await createTempDir('assistant-codex-hosted-home-work-')

    codexMocks.spawn.mockImplementation((_command, _args, options) => {
      const child = new MockChildProcess()

      expect(options).toMatchObject({
        env: expect.objectContaining({
          CODEX_HOME: hostedCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        }),
      })
      expect(options.env.CODEX_HOME).not.toBe(profileCodexHome)

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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        codexHome: profileCodexHome,
        codexCommand: '/tmp/attacker-controlled-codex',
        env: {
          CODEX_HOME: hostedCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/usr/bin',
        },
        prompt: 'hosted codex home guard',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-hosted-home',
      threadId: 'thread-hosted-home',
      turnId: 'turn-hosted-home',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      ['-a', 'never', 'app-server'],
      expect.any(Object),
    )
  })

  it('uses ambient hosted guards when an explicit child env omits the hosted marker', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-ambient-hosted-home-')
    const workingDirectory = await createTempDir('assistant-codex-ambient-hosted-work-')

    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    vi.stubEnv('CODEX_HOME', hostedCodexHome)

    try {
      codexMocks.spawn.mockImplementation((_command, _args, options) => {
        const child = new MockChildProcess()

        expect(options.env).toMatchObject({
          CODEX_HOME: hostedCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          PATH: '/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        })

        queueMicrotask(() => {
          void (async () => {
            await waitForRpcMethod(child, 'initialize')
            const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            child.emit('error', error)
          })()
        })

        return child
      })

      await expect(
        executeCodexAppServerTurn({
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
        'codex',
        ['-a', 'never', 'app-server'],
        expect.any(Object),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses the absolute hosted test stub command only in test environments', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-hosted-stub-home-')
    const hostedTestCommand = path.join(hostedCodexHome, 'bin', 'codex')
    const workingDirectory = await createTempDir('assistant-codex-hosted-stub-work-')

    for (const scenario of [
      {
        command: hostedTestCommand,
        nodeEnv: 'test',
      },
      {
        command: 'codex',
        nodeEnv: 'production',
      },
    ]) {
      codexMocks.spawn.mockReset()
      codexMocks.spawn.mockImplementation((_command, _args, options) => {
        const child = new MockChildProcess()

        expect(options.env).toMatchObject({
          [HOSTED_RUNTIME_CODEX_APP_SERVER_TEST_COMMAND_ENV]: hostedTestCommand,
          CODEX_HOME: hostedCodexHome,
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          NODE_ENV: scenario.nodeEnv,
        })

        queueMicrotask(() => {
          void (async () => {
            await waitForRpcMethod(child, 'initialize')
            const error = new Error(`spawn ${scenario.command} ENOENT`) as NodeJS.ErrnoException
            error.code = 'ENOENT'
            child.emit('error', error)
          })()
        })

        return child
      })

      await expect(
        executeCodexAppServerTurn({
          env: {
            [HOSTED_RUNTIME_CODEX_APP_SERVER_TEST_COMMAND_ENV]: hostedTestCommand,
            CODEX_HOME: hostedCodexHome,
            MURPH_HOSTED_RUNTIME_PROCESS: '1',
            NODE_ENV: scenario.nodeEnv,
            PATH: '/usr/bin',
          },
          prompt: 'hosted test stub guard',
          workingDirectory,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_NOT_FOUND',
      })

      expect(codexMocks.spawn).toHaveBeenCalledWith(
        scenario.command,
        ['-a', 'never', 'app-server'],
        expect.any(Object),
      )
    }
  })

  it('keeps one Codex app-server process open and steers late input into the active turn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-live-steer-')
    const liveTurnReady = createDeferred<CodexAppServerLiveTurn>()
    const releaseLiveTurn = vi.fn()

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
                  id: 'thread-live',
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
                  id: 'turn-live',
                },
              },
            }),
          )

          const steer = await waitForRpcMethod(child, 'turn/steer')
          expect(steer).toEqual({
            id: 4,
            method: 'turn/steer',
            params: {
              expectedTurnId: 'turn-live',
              input: [
                {
                  text: 'Late follow-up',
                  type: 'text',
                },
              ],
              threadId: 'thread-live',
            },
          })
          child.stdout.write(jsonLine({ id: 4, result: {} }))
          child.stdout.write(
            jsonLine({
              method: 'assistant.message.delta',
              params: {
                item: {
                  id: 'assistant-live',
                  type: 'assistant_message',
                },
                delta: 'Final after live steer',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-live',
                  status: 'completed',
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

    const resultPromise = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      onLiveTurn: (turn) => {
        liveTurnReady.resolve(turn)
        return releaseLiveTurn
      },
      prompt: 'Initial prompt',
      workingDirectory,
    })

    const liveTurn = await liveTurnReady.promise
    expect(liveTurn.threadId).toBe('thread-live')
    expect(liveTurn.turnId).toBe('turn-live')
    await liveTurn.steer({
      prompt: 'Late follow-up',
    })

    await expect(resultPromise).resolves.toMatchObject({
      finalMessage: 'Final after live steer',
      threadId: 'thread-live',
      turnId: 'turn-live',
    })
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
    expect(releaseLiveTurn).toHaveBeenCalledTimes(1)
  })

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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
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

    const queueResumeTurn = (input: {
      child: MockChildProcess
      threadPath: string
    }) => {
      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(input.child, 'initialize')
          input.child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(input.child, 'thread/resume')
          input.child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: threadId,
                  path: input.threadPath,
                },
              },
            }),
          )
          await waitForRpcMethod(input.child, 'turn/start')
          input.child.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-resume-rollout',
                },
              },
            }),
          )
          input.child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-resume-rollout',
                  status: 'completed',
                },
              },
            }),
          )
          input.child.emit('exit', 0, null)
          input.child.emit('close', 0, null)
        })()
      })
    }

    codexMocks.spawn
      .mockImplementationOnce(() => {
        const child = new MockChildProcess()
        queueResumeTurn({
          child,
          threadPath: path.join(codexHome, rolloutRelativePath),
        })
        return child
      })
      .mockImplementationOnce(() => {
        const child = new MockChildProcess()
        queueResumeTurn({
          child,
          threadPath: path.join(codexHome, mismatchedRolloutRelativePath),
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
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
          child.emit('error', error)
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
                message: 'thread/resume failed: no rollout found for thread id stale-thread',
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
        resumeSessionId: 'stale-thread',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        retryable: true,
        staleResume: true,
      },
      message: expect.stringContaining('no rollout found for thread id stale-thread'),
    })
  })

  it('keeps model/profile lookup failures as generic thread/resume RPC errors', async () => {
    const workingDirectory = await createTempDir('assistant-codex-non-stale-resume-')

    for (const rpcErrorMessage of [
      'thread/resume failed: model not found',
      'thread/resume failed: profile not found',
    ]) {
      codexMocks.spawn.mockImplementationOnce(() => {
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

  it.each([
    ['read-only', 'read-only'],
    ['workspace-write', 'workspace-write'],
    ['danger-full-access', 'danger-full-access'],
  ] as const)(
    'uses Codex app-server SandboxMode %s on thread/start and thin params on thread/resume',
    async (sandbox, expectedSandbox) => {
      const workingDirectory = await createTempDir('assistant-codex-thread-context-')
      const expectedThreadContext = {
        approvalPolicy: 'never',
        cwd: path.resolve(workingDirectory),
        developerInstructions: 'Stable Murph instructions.',
        model: 'gpt-5',
        modelProvider: 'vercel-ai-gateway',
        sandbox: expectedSandbox,
      }
      const threadRequests: Record<string, unknown>[] = []
      const turnRequests: Record<string, unknown>[] = []

      const queueSuccessfulTurn = (input: {
        child: MockChildProcess
        expectedPrompt: string
        responseThreadId: string
        threadMethod: 'thread/start' | 'thread/resume'
      }) => {
        queueMicrotask(() => {
          void (async () => {
            await waitForRpcMethod(input.child, 'initialize')
            input.child.stdout.write(jsonLine({ id: 1, result: {} }))

            const threadRequest = await waitForRpcMethod(input.child, input.threadMethod)
            threadRequests.push(threadRequest)
            input.child.stdout.write(
              jsonLine({
                id: 2,
                result: {
                  thread: {
                    id: input.responseThreadId,
                  },
                },
              }),
            )

            const turnRequest = await waitForRpcMethod(input.child, 'turn/start')
            turnRequests.push(turnRequest)
            input.child.stdout.write(
              jsonLine({
                id: 3,
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
            input.child.emit('exit', 0, null)
            input.child.emit('close', 0, null)

            const turnInputItems = readTurnStartInputItems(turnRequest)
            expect(turnInputItems).toEqual([
              {
                type: 'text',
                text: input.expectedPrompt,
              },
            ])
          })()
        })
      }

      codexMocks.spawn
        .mockImplementationOnce(() => {
          const child = new MockChildProcess()
          queueSuccessfulTurn({
            child,
            expectedPrompt: 'fresh prompt',
            responseThreadId: 'thread-fresh',
            threadMethod: 'thread/start',
          })
          return child
        })
        .mockImplementationOnce(() => {
          const child = new MockChildProcess()
          queueSuccessfulTurn({
            child,
            expectedPrompt: 'resume prompt',
            responseThreadId: 'thread-resumed',
            threadMethod: 'thread/resume',
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
          sandbox,
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-fresh',
      })

      await expect(
        executeCodexAppServerTurn({
          approvalPolicy: 'never',
          model: 'gpt-5',
          modelProvider: 'vercel-ai-gateway',
          developerInstructions: 'Stable Murph instructions.',
          prompt: 'resume prompt',
          reasoningEffort: 'high',
          refreshThreadInstructions: false,
          resumeSessionId: 'thread-resume-request',
          sandbox,
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-resumed',
      })

      expect(asRecord(threadRequests[0]?.params)).toEqual({
        ...expectedThreadContext,
        serviceName: 'murph',
      })
      expect(asRecord(threadRequests[1]?.params)).toEqual({
        excludeTurns: true,
        threadId: 'thread-resume-request',
      })

      for (const [index, expectedThreadId] of ['thread-fresh', 'thread-resumed'].entries()) {
        const turnParams = asRecord(turnRequests[index]?.params)
        expect(turnParams).toMatchObject({
          effort: 'high',
          threadId: expectedThreadId,
        })
        expect(turnParams.approvalPolicy).toBeUndefined()
        expect(turnParams.cwd).toBeUndefined()
        expect(turnParams.model).toBeUndefined()
        expect(turnParams.modelProvider).toBeUndefined()
      }
    },
  )

  it('fails closed on unexpected app-server requests under approvalPolicy=never', async () => {
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
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

  it('handles the Murph progress dynamic tool without changing the final response', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-tool-')
    const turnProgress = {
      send: vi.fn(async (_text: string) => {
        void _text
      }),
    }

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          expect(asRecord(threadStart.params)).toMatchObject({
            dynamicTools: [MURPH_SEND_PROGRESS_UPDATE_TOOL],
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
                  text:
                    'Blood test received - I will extract the PDF and check the relevant results.',
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
                  text: 'progress update accepted',
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
                  type: 'assistant_message',
                  message: 'Final answer after the progress update.',
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'process this blood test',
        turnProgress,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Final answer after the progress update.',
      sessionId: 'thread-progress-tool',
      turnId: 'turn-progress-tool',
    })

    expect(turnProgress.send).toHaveBeenCalledWith(
      'Blood test received - I will extract the PDF and check the relevant results.',
    )
    expect(turnProgress.send).not.toHaveBeenCalledWith('Provider-side status text')
  })

  it('rejects unsupported dynamic tools while keeping the Codex turn alive', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-unsupported-')
    const turnProgress = {
      send: vi.fn(async (_text: string) => {
        void _text
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'try unsupported tool',
        turnProgress,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-unsupported',
    })
    expect(turnProgress.send).not.toHaveBeenCalled()
  })

  it('returns a tool failure for invalid progress arguments without sending progress', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-invalid-')
    const turnProgress = {
      send: vi.fn(async (_text: string) => {
        void _text
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
                  text: 'invalid progress update arguments',
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'try invalid progress tool',
        turnProgress,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-invalid',
    })
    expect(turnProgress.send).not.toHaveBeenCalled()
  })

  it('handles progress dynamic tool calls on resumed threads when a real sink exists', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-resume-')
    const turnProgress = {
      send: vi.fn(async (_text: string) => {
        void _text
      }),
    }

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          const threadResume = await waitForRpcMethod(child, 'thread/resume')
          expect(asRecord(threadResume.params)).not.toHaveProperty('dynamicTools')
          child.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-progress-resume',
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
                  text: 'progress update accepted',
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'resume and try progress',
        resumeSessionId: 'existing-thread-without-progress-tool',
        turnProgress,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-resume',
    })
    expect(turnProgress.send).toHaveBeenCalledWith('Checking the file now.')
  })

  it('counts slash-form and dot-form provider actions from normalized events and skips pure image.view reads', async () => {
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
              item: {
                id: 'search-dot',
                query: 'murph app server',
                type: 'web_search',
              },
              type: 'item.completed',
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'tool-slash',
                  name: 'search_query',
                  server_name: 'web',
                  type: 'tool_call',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              item: {
                id: 'image-dot',
                path: '/tmp/look.png',
                type: 'image_view',
              },
              type: 'item.completed',
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
          child.emit('exit', 0, null)
          child.emit('close', 0, null)
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
      child.stdin.onWrite = (write) => {
        const message = asRecord(JSON.parse(write))
        if (message.method !== 'initialize') {
          return
        }

        child.stdin.onWrite = null
        queueMicrotask(() => {
          child.stdin.emit('error', createErrnoException('EPIPE', 'write EPIPE'))
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
          child.stdin.emit('error', createErrnoException('EPIPE', 'write EPIPE'))
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

  it('ignores post-shutdown EPIPE from stdin.end after a normal completion', async () => {
    const workingDirectory = await createTempDir('assistant-codex-clean-shutdown-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.stdin.onEnd = () => {
        queueMicrotask(() => {
          child.stdin.emit('error', createErrnoException('EPIPE', 'write EPIPE'))
        })
      }

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
                  id: 'thread-clean-shutdown',
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
                  id: 'turn-clean-shutdown',
                },
              },
            }),
          )
          child.stdout.write(
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

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'finish cleanly',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-clean-shutdown',
    })
  })

  it('treats abort-race stdin EPIPE as interrupted, sends turn/interrupt, and signals the child group', async () => {
    const workingDirectory = await createTempDir('assistant-codex-abort-')
    const controller = new AbortController()
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      child = spawnedChild
      vi.mocked(process.kill).mockImplementation((pid, signal) => {
        if (pid === -spawnedChild.pid && signal === 'SIGINT') {
          queueMicrotask(() => {
            spawnedChild.emit('exit', null, signal)
            spawnedChild.emit('close', null, signal)
          })
        }
        return true
      })
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

      queueMicrotask(() => {
        void (async () => {
          const spawnedChild = requireMockChildProcess(child)
          await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(spawnedChild, 'thread/start')
          spawnedChild.stdout.write(
            jsonLine({
              id: 2,
              result: {
                thread: {
                  id: 'thread-abort',
                },
              },
            }),
          )
          await waitForRpcMessages(spawnedChild, 4)
          spawnedChild.stdout.write(
            jsonLine({
              id: 3,
              result: {
                turn: {
                  id: 'turn-abort',
                },
              },
            }),
          )
          spawnedChild.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-abort',
                },
              },
            }),
          )
          await waitForRpcMessages(spawnedChild, 4)
          controller.abort()
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
        interrupted: true,
        codexThreadIdPresent: true,
        retryable: false,
      },
    })

    const spawnedChild = requireMockChildProcess(child)
    const messages = await waitForRpcMessages(spawnedChild, 5)
    expect(messages[4]).toEqual({
      id: 4,
      method: 'turn/interrupt',
      params: {
        threadId: 'thread-abort',
        turnId: 'turn-abort',
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-spawnedChild.pid, 'SIGINT')
    expect(spawnedChild.kill).not.toHaveBeenCalledWith('SIGINT')
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

describe('assistant codex event shaping', () => {
  it('normalizes Codex raw events across the supported item families', () => {
    expect(
      normalizeCodexEvent({
        targetModel: 'gpt-5-codex',
        type: 'model.rerouted',
      }),
    ).toEqual({
      kind: 'model_rerouted',
      model: 'gpt-5-codex',
      rawEvent: {
        targetModel: 'gpt-5-codex',
        type: 'model.rerouted',
      },
    })

    expect(
      normalizeCodexEvent({
        itemId: 'plan-1',
        summary: 'Inspect files\nPatch tests',
        type: 'agent.plan.updated',
      }),
    ).toEqual({
      kind: 'plan_update',
      itemId: 'plan-1',
      rawEvent: {
        itemId: 'plan-1',
        summary: 'Inspect files\nPatch tests',
        type: 'agent.plan.updated',
      },
      text: 'Inspect files\nPatch tests',
    })

    expect(
      normalizeCodexEvent({
        delta: {
          text: 'token',
        },
        item_id: 'assistant-9',
        type: 'assistant.message.delta',
      }),
    ).toEqual({
      deltaText: 'token',
      itemId: 'assistant-9',
      kind: 'assistant_delta',
      rawEvent: {
        delta: {
          text: 'token',
        },
        item_id: 'assistant-9',
        type: 'assistant.message.delta',
      },
    })

    expect(
      normalizeCodexEvent({
        item: {
          id: 'reason-1',
          type: 'reasoning',
        },
        textDelta: 'thinking',
        type: 'reasoning.text.delta',
      }),
    ).toEqual({
      deltaText: 'thinking',
      itemId: 'reason-1',
      kind: 'reasoning_delta',
      rawEvent: {
        item: {
          id: 'reason-1',
          type: 'reasoning',
        },
        textDelta: 'thinking',
        type: 'reasoning.text.delta',
      },
    })

    expect(
      normalizeCodexEvent({
        item: {
          id: 'assistant-4',
          parts: [{ text: 'structured reply' }],
          type: 'assistant_message',
        },
        type: 'item.completed',
      }),
    ).toEqual({
      itemId: 'assistant-4',
      itemState: 'completed',
      kind: 'assistant_message',
      rawEvent: {
        item: {
          id: 'assistant-4',
          parts: [{ text: 'structured reply' }],
          type: 'assistant_message',
        },
        type: 'item.completed',
      },
      text: 'structured reply',
    })

    expect(
      normalizeCodexEvent({
        item: {
          id: 'search-1',
          query: 'murph coverage',
          type: 'web_search',
        },
        type: 'item.started',
      }),
    ).toEqual({
      itemId: 'search-1',
      itemState: 'running',
      kind: 'web_search',
      query: 'murph coverage',
      rawEvent: {
        item: {
          id: 'search-1',
          query: 'murph coverage',
          type: 'web_search',
        },
        type: 'item.started',
      },
    })

    expect(
      normalizeCodexEvent({
        item: {
          id: 'tool-1',
          name: 'search_query',
          server_name: 'web',
          type: 'tool_call',
        },
        type: 'item.completed',
      }),
    ).toEqual({
      itemId: 'tool-1',
      itemState: 'completed',
      kind: 'tool_call',
      rawEvent: {
        item: {
          id: 'tool-1',
          name: 'search_query',
          server_name: 'web',
          type: 'tool_call',
        },
        type: 'item.completed',
      },
      toolName: 'search_query',
      toolServer: 'web',
    })

    expect(
      normalizeCodexEvent({
        item: {
          command_line: 'node /tmp/bin.js pnpm test --watch',
          exit_code: '2',
          id: 'cmd-1',
          type: 'command_execution',
        },
        type: 'item.completed',
      }),
    ).toEqual({
      commandLabel: 'node /tmp/bin.js pnpm test --watch',
      exitCode: null,
      filePaths: [],
      itemId: 'cmd-1',
      itemState: 'completed',
      itemType: 'command.execution',
      kind: 'status_item',
      planText: null,
      rawEvent: {
        item: {
          command_line: 'node /tmp/bin.js pnpm test --watch',
          exit_code: '2',
          id: 'cmd-1',
          type: 'command_execution',
        },
        type: 'item.completed',
      },
      reasoningText: null,
    })

    expect(
      normalizeCodexEvent({
        errorMessage: 'Connection reset by peer',
        type: 'turn.failed',
      }),
    ).toEqual({
      kind: 'error',
      message: 'Connection reset by peer',
      rawEvent: {
        errorMessage: 'Connection reset by peer',
        type: 'turn.failed',
      },
    })

    expect(normalizeCodexEvent(null)).toEqual({
      eventType: null,
      kind: 'unknown',
      rawEvent: null,
    })

    expect(
      normalizeCodexEvent({
        type: 'model.rerouted',
      }),
    ).toEqual({
      eventType: 'model.rerouted',
      kind: 'unknown',
      rawEvent: {
        type: 'model.rerouted',
      },
    })

    expect(
      normalizeCodexEvent({
        item_id: 'assistant-empty',
        type: 'assistant.message.delta',
      }),
    ).toEqual({
      eventType: 'assistant.message.delta',
      kind: 'unknown',
      rawEvent: {
        item_id: 'assistant-empty',
        type: 'assistant.message.delta',
      },
    })

    expect(
      normalizeCodexEvent({
        type: '   ',
      }),
    ).toEqual({
      eventType: null,
      kind: 'unknown',
      rawEvent: {
        type: '   ',
      },
    })

    expect(
      normalizeCodexEvent({
        item: {
          message: 'pending',
          type: 'assistant_message',
        },
        type: 'item.updated',
      }),
    ).toEqual({
      eventType: 'item.updated',
      kind: 'unknown',
      rawEvent: {
        item: {
          message: 'pending',
          type: 'assistant_message',
        },
        type: 'item.updated',
      },
    })

    expect(
      normalizeCodexEvent({
        item: {
          id: 'reason-raw',
          summary: [{ text: ['First summary', { value: 'Second summary' }] }],
          type: 'reasoning',
        },
        type: 'item.completed',
      }),
    ).toEqual({
      commandLabel: null,
      exitCode: null,
      filePaths: [],
      itemId: 'reason-raw',
      itemState: 'completed',
      itemType: 'reasoning',
      kind: 'status_item',
      planText: null,
      rawEvent: {
        item: {
          id: 'reason-raw',
          summary: [{ text: ['First summary', { value: 'Second summary' }] }],
          type: 'reasoning',
        },
        type: 'item.completed',
      },
      reasoningText: 'First summarySecond summary',
    })

    expect(
      normalizeCodexEvent({
        item: {
          id: 'file-raw',
          nested: [
            {
              relativePath: `${codexMocks.fakeHome}/src/file-a.ts`,
            },
            {
              filePath: 'src/file-b.ts',
            },
          ],
          type: 'file_change',
        },
        type: 'item.completed',
      }),
    ).toEqual({
      commandLabel: null,
      exitCode: null,
      filePaths: ['~/src/file-a.ts', 'src/file-b.ts'],
      itemId: 'file-raw',
      itemState: 'completed',
      itemType: 'file.change',
      kind: 'status_item',
      planText: null,
      rawEvent: {
        item: {
          id: 'file-raw',
          nested: [
            {
              relativePath: `${codexMocks.fakeHome}/src/file-a.ts`,
            },
            {
              filePath: 'src/file-b.ts',
            },
          ],
          type: 'file_change',
        },
        type: 'item.completed',
      },
      reasoningText: null,
    })

    expect(
      normalizeCodexEvent({
        item: {
          details: [{ exitCode: 7 }],
          id: 'cmd-nested',
          type: 'command_execution',
        },
        type: 'item.completed',
      }),
    ).toEqual({
      commandLabel: null,
      exitCode: 7,
      filePaths: [],
      itemId: 'cmd-nested',
      itemState: 'completed',
      itemType: 'command.execution',
      kind: 'status_item',
      planText: null,
      rawEvent: {
        item: {
          details: [{ exitCode: 7 }],
          id: 'cmd-nested',
          type: 'command_execution',
        },
        type: 'item.completed',
      },
      reasoningText: null,
    })

    const recursiveFileItem: Record<string, unknown> = {
      id: 'file-cycle',
      type: 'file_change',
    }
    recursiveFileItem.self = recursiveFileItem
    expect(
      normalizeCodexEvent({
        item: recursiveFileItem,
        type: 'item.completed',
      }),
    ).toMatchObject({
      filePaths: [],
      itemId: 'file-cycle',
      itemType: 'file.change',
      kind: 'status_item',
    })

    const recursiveCommandItem: Record<string, unknown> = {
      id: 'cmd-cycle',
      type: 'command_execution',
    }
    recursiveCommandItem.self = recursiveCommandItem
    expect(
      normalizeCodexEvent({
        item: recursiveCommandItem,
        type: 'item.completed',
      }),
    ).toMatchObject({
      exitCode: null,
      itemId: 'cmd-cycle',
      itemType: 'command.execution',
      kind: 'status_item',
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
        itemType: 'command.execution',
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
        itemType: 'file.change',
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
        itemType: 'command.execution',
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
        itemType: 'file.change',
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
        itemType: 'command.execution',
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
        streamKey: 'status:web.search',
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
        itemType: 'command.execution',
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
        streamKey: 'status:command.execution',
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
        streamKey: 'status:web.search',
        text: 'Finished web search.',
      },
    ])
  })

  it('extracts fallback helpers, session ids, status lines, and connection-loss text accurately', () => {
    expect(
      extractAssistantMessageFallback({
        assistantStreamOrder: [''],
        assistantStreams: new Map(),
      }),
    ).toBeNull()

    expect(
      extractAssistantMessageFallback({
        assistantStreamOrder: ['', 'assistant:empty', 'assistant:last'],
        assistantStreams: new Map([
          ['assistant:empty', ''],
          ['assistant:last', '  Final streamed reply  '],
        ]),
      }),
    ).toBe('Final streamed reply')

    expect(
      extractCodexSessionId({
        data: {
          threadId: 'nested-thread',
        },
        type: 'thread.updated',
      }),
    ).toBe('nested-thread')
    expect(
      extractCodexSessionId({
        conversation_id: 'conv-9',
        type: 'turn.completed',
      }),
    ).toBe('conv-9')

    const recursiveArray: unknown[] = []
    const recursiveThreadEvent = {
      data: recursiveArray,
      type: 'thread.updated',
    }
    recursiveArray.push(recursiveThreadEvent, {
      conversationId: 'recursive-conversation',
    })
    expect(extractCodexSessionId(recursiveThreadEvent)).toBe('recursive-conversation')

    expect(
      extractCodexErrorMessage({
        errorMessage: 'fatal',
        type: 'turn.error',
      }),
    ).toBe('fatal')
    expect(extractCodexErrorMessage(null)).toBeNull()
    expect(
      extractCodexErrorMessage({
        message: 'ignored',
        type: 'item.completed',
      }),
    ).toBeNull()

    expect(
      normalizeStatusText(
        `  connection closed under ${codexMocks.fakeHome}/workspace/project  `,
      ),
    ).toBe('connection closed under ~/workspace/project')
    expect(normalizeStatusText(null)).toBeNull()
    codexMocks.fakeHome = '   '
    expect(normalizeStatusText(' untouched path ')).toBe('untouched path')
    codexMocks.fakeHome = '/home/tester'

    expect(
      extractCodexStatusEventFromStderrLine('Retrying after timeout while contacting OpenAI'),
    ).toEqual({
      id: 'codex-connection-status',
      kind: 'status',
      rawEvent: {
        line: 'Retrying after timeout while contacting OpenAI',
        type: 'stderr',
      },
      state: 'running',
      text: 'Retrying after timeout while contacting OpenAI',
    })
    expect(
      extractCodexStatusEventFromStderrLine('Connection closed by remote host'),
    ).toEqual({
      id: 'codex-connection-status',
      kind: 'status',
      rawEvent: {
        line: 'Connection closed by remote host',
        type: 'stderr',
      },
      state: 'completed',
      text: 'Connection closed by remote host',
    })

    expect(
      extractCodexStatusEventFromStderrLine(
        'required MCP servers failed to initialize: connection closed',
      ),
    ).toBeNull()

    expect(
      isCodexConnectionLossText('socket hang up while waiting for completion'),
    ).toBe(true)
    expect(
      isCodexConnectionLossText('required MCP servers failed to initialize'),
    ).toBe(false)

    expect(
      extractCodexTraceUpdates({
        itemId: 'assistant-10',
        summary: 'Draft answer',
        type: 'agent.plan.updated',
      }),
    ).toEqual([
      {
        kind: 'thinking',
        mode: 'replace',
        streamKey: 'thinking:assistant-10',
        text: 'Draft answer',
      },
    ])
  })
})

class MockChildProcess extends EventEmitter {
  exitCode: number | null = null
  killed = false
  pid = 1234
  signalCode: NodeJS.Signals | null = null
  readonly stderr = new PassThrough()
  readonly stdin = new MockStdin()
  readonly stdout = new PassThrough()
  readonly kill = vi.fn((signal?: NodeJS.Signals) => {
    this.killed = true
    queueMicrotask(() => {
      if (this.exitCode === null && this.signalCode === null) {
        this.emit('exit', null, signal ?? null)
        this.emit('close', null, signal ?? null)
      }
    })
    return true
  })

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'exit' || eventName === 'close') {
      this.exitCode =
        typeof args[0] === 'number' || args[0] === null ? (args[0] as number | null) : null
      this.signalCode =
        typeof args[1] === 'string' || args[1] === null
          ? (args[1] as NodeJS.Signals | null)
          : null
    }
    return super.emit(eventName, ...args)
  }
}

class MockStdin extends EventEmitter {
  onEnd: ((write: string | null) => void) | null = null
  onWrite: ((write: string) => void) | null = null
  readonly writes: string[] = []

  write(chunk: string | Uint8Array): boolean {
    const write = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    this.writes.push(write)
    this.onWrite?.(write)
    return true
  }

  end(chunk?: string | Uint8Array): void {
    let write: string | null = null
    if (typeof chunk === 'string') {
      write = chunk
    } else if (chunk) {
      write = Buffer.from(chunk).toString('utf8')
    }

    if (write !== null) {
      this.writes.push(write)
    }

    this.onEnd?.(write)
    this.emit('finish')
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(rootPath)
  return rootPath
}

function jsonLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify(payload)}\n`
}

function createErrnoException(
  code: string,
  message: string,
): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  return error
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new TypeError('Expected a record value.')
}

function readWrittenRpcMessages(
  child: MockChildProcess,
): Record<string, unknown>[] {
  return child.stdin.writes
    .map((write) => write.trim())
    .filter((write) => write.length > 0)
    .map((write) => asRecord(JSON.parse(write)))
}

async function waitForRpcMessages(
  child: MockChildProcess,
  count: number,
): Promise<Record<string, unknown>[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const messages = readWrittenRpcMessages(child)
    if (messages.length >= count) {
      return messages
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected at least ${count} RPC messages from Murph.`)
}

async function waitForRpcMethod(
  child: MockChildProcess,
  method: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const message = readWrittenRpcMessages(child).find(
      (candidate) => candidate.method === method,
    )
    if (message) {
      return message
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected RPC method ${method} from Murph.`)
}

function readTurnStartInputItems(
  message: Record<string, unknown>,
): Record<string, unknown>[] {
  const params = asRecord(message.params)
  const input = params.input
  if (!Array.isArray(input)) {
    throw new TypeError('Expected turn/start params.input to be an array.')
  }
  return input.map((item) => asRecord(item))
}

function readLocalImagePath(item: Record<string, unknown>): string {
  if (typeof item.path !== 'string') {
    throw new TypeError('Expected a localImage path string.')
  }
  return item.path
}

function requireMockChildProcess(
  child: MockChildProcess | null,
): MockChildProcess {
  expect(child).not.toBeNull()
  if (!child) {
    throw new Error('Expected Codex execution to spawn a child process.')
  }
  return child
}

function createDeferred<T>(): Deferred<T> {
  let rejectDeferred!: (error: unknown) => void
  let resolveDeferred!: (value: T) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject
    resolveDeferred = resolve
  })
  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  }
}
