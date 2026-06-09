import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import {
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
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
  readCodexAppServerTurnFailureContext,
  resolveCodexDisplayOptions,
  snapshotExpectedCodexRootProcess,
  stopWarmCodexAppServer,
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
  MURPH_DYNAMIC_TOOLS,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  executeCodexAssistantTurnAttempt,
} from '../src/assistant/codex-runtime.ts'
import {
  CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS,
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

function sentProgressResult(source: 'model' | 'system' = 'model') {
  return {
    kind: 'sent' as const,
    source,
  }
}

function createProgressDeliveryMock(
  result: ReturnType<typeof sentProgressResult> = sentProgressResult(),
) {
  return {
    send: vi.fn(async (_text: string) => {
      void _text
      return result
    }),
  }
}

type Deferred<T> = {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

beforeEach(() => {
  vi.spyOn(process, 'kill').mockImplementation(() => true)
})

afterEach(async () => {
  vi.mocked(process.kill).mockImplementation(() => {
    throw createErrnoException('ESRCH', 'process not found')
  })
  await stopWarmCodexAppServer('test-cleanup')
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

async function runCodexResponseMediaToolTurn(
  toolCalls: Array<{
    expectedText: string
    id: number
    media: readonly unknown[]
  }>,
) {
  const workingDirectory = await createTempDir('assistant-codex-response-media-tool-work-')
  const codexHome = await createTempDir('assistant-codex-response-media-tool-home-')

  codexMocks.spawn.mockImplementation((_command, args, options) => {
    const child = new MockChildProcess()

    expect(args).toEqual(['app-server'])
    expect(options).toMatchObject({
      cwd: path.resolve(workingDirectory),
      env: {
        CODEX_HOME: codexHome,
        PATH: '/custom/bin',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    queueMicrotask(() => {
      void (async () => {
        const initialize = await waitForRpcMethod(child, 'initialize')
        child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

        const threadStart = await waitForRpcMethod(child, 'thread/start')
        child.stdout.write(jsonLine({
          id: threadStart.id,
          result: {
            thread: {
              id: 'thread-response-media-tool',
            },
          },
        }))

        const turnStart = await waitForRpcMethod(child, 'turn/start')
        child.stdout.write(jsonLine({
          id: turnStart.id,
          result: {
            turn: {
              id: 'turn-response-media-tool',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/started',
          params: {
            turn: {
              id: 'turn-response-media-tool',
            },
          },
        }))

        for (const toolCall of toolCalls) {
          child.stdout.write(jsonLine({
            id: toolCall.id,
            method: 'item/tool/call',
            params: {
              namespace: 'murph',
              tool: 'attach_response_media',
              arguments: {
                media: toolCall.media,
              },
              turnId: 'turn-response-media-tool',
            },
          }))
          await expect(waitForRpcResponse(child, toolCall.id)).resolves.toEqual({
            id: toolCall.id,
            result: {
              success: true,
              contentItems: [
                {
                  type: 'inputText',
                  text: toolCall.expectedText,
                },
              ],
            },
          })
        }

        child.stdout.write(jsonLine({
          method: 'item/completed',
          params: {
            item: {
              id: 'assistant-response-media-tool',
              type: 'assistant_message',
              message: 'Tool media complete',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/completed',
          params: {
            turn: {
              id: 'turn-response-media-tool',
              status: 'completed',
            },
          },
        }))
      })()
    })

    return child
  })

  return await executeCodexAppServerTurn({
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome,
    env: {
      PATH: '/custom/bin',
    },
    prompt: 'Attach response media',
    sandbox: 'workspace-write',
    workingDirectory,
  })
}

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
      '--config',
      'model="gpt-5"',
      '--config',
      'theme="clean"',
      '--profile',
      'daily',
      '--oss',
      'app-server',
    ])

    expect(buildCodexAppServerArgs({})).toEqual(['app-server'])
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

  it('puts instructions and dynamic tools on thread start but keeps resume and turn input scoped', () => {
    const baseInput = {
      approvalPolicy: 'never',
      baseInstructions: 'Do not use this in normal Murph config.',
      developerInstructions: 'Stable Murph instructions.',
      excludeResumeTurns: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      prompt: 'User message:\nWhat changed?',
      reasoningEffort: 'high',
      sandbox: 'workspace-write' as const,
      workingDirectory: '/workspace',
    }

    expect(buildCodexThreadStartParams(baseInput)).toEqual({
      approvalPolicy: 'never',
      baseInstructions: 'Do not use this in normal Murph config.',
      cwd: '/workspace',
      developerInstructions: 'Stable Murph instructions.',
      dynamicTools: MURPH_DYNAMIC_TOOLS,
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
      }),
    ).toMatchObject({
      dynamicTools: MURPH_DYNAMIC_TOOLS,
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        progressDelivery: {
          async send() {
            return sentProgressResult()
          },
        },
      }),
    ).toMatchObject({
      dynamicTools: MURPH_DYNAMIC_TOOLS,
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        progressDelivery: {
          async send() {
            return sentProgressResult()
          },
        },
      }),
    ).toMatchObject({
      dynamicTools: MURPH_DYNAMIC_TOOLS,
    })

    expect(
      buildCodexThreadResumeParams({
        input: baseInput,
        codexThreadId: 'thread-1',
      }),
    ).toEqual({
      approvalPolicy: 'never',
      cwd: '/workspace',
      excludeTurns: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      sandbox: 'workspace-write',
      threadId: 'thread-1',
    })
    expect(
      buildCodexThreadResumeParams({
        input: {
          ...baseInput,
          progressDelivery: {
            async send() {
              return sentProgressResult()
            },
          },
        },
        codexThreadId: 'thread-1',
      }),
    ).toEqual({
      approvalPolicy: 'never',
      cwd: '/workspace',
      excludeTurns: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      sandbox: 'workspace-write',
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
              dynamicTools: MURPH_DYNAMIC_TOOLS,
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
          child.stdout.write(
            jsonLine({
              id: 17,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'attach_response_media',
                arguments: {
                  media: [
                    {
                      url: 'https://cdn.example.test/assistant/cat.png',
                      alt: 'A cat image',
                      source: 'cat-catalog-item',
                    },
                  ],
                },
                turnId: 'turn-1',
              },
            }),
          )
          messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 17,
            result: {
              success: true,
              contentItems: [
                {
                  type: 'inputText',
                  text: '1 response image attached',
                },
              ],
            },
          })
          child.stdout.write(
            jsonLine({
              id: 18,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'attach_response_media',
                arguments: {
                  media: [
                    {
                      url: 'http://cdn.example.test/assistant/not-https.png',
                    },
                  ],
                },
                turnId: 'turn-1',
              },
            }),
          )
          messages = await waitForRpcMessages(child, 6)
          expect(messages[5]).toEqual({
            id: 18,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'invalid response media arguments',
                },
              ],
            },
          })
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
          child.stdout.write(
            jsonLine({
              id: 19,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'attach_response_media',
                arguments: {
                  media: [
                    {
                      url: 'https://cdn.example.test/assistant/late.png',
                    },
                  ],
                },
                turnId: 'turn-1',
              },
            }),
          )
          messages = await waitForRpcMessages(child, 7)
          expect(messages[6]).toEqual({
            id: 19,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'turn already completed',
                },
              ],
            },
          })
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
      responseMedia: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/assistant/cat.png',
          alt: 'A cat image',
          source: 'cat-catalog-item',
        },
      ],
      providerActionCount: 1,
      rolloutRelativePath,
      sessionId: threadId,
      stderr: 'Retrying after timeout',
      threadId,
      turnId: 'turn-1',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      ['--config', 'model="gpt-5"', 'app-server'],
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

  it('uses the latest valid attach_response_media batch for final response media', async () => {
    const firstMedia = [
      {
        kind: 'image' as const,
        url: 'https://cdn.example.test/assistant/first.png',
        alt: 'First image',
        source: 'first-source',
      },
    ]
    const replacementMedia = [
      {
        kind: 'image' as const,
        url: 'https://cdn.example.test/assistant/replacement-one.png',
        alt: 'Replacement one',
        source: 'replacement-one',
      },
      {
        kind: 'image' as const,
        url: 'https://cdn.example.test/assistant/replacement-two.png',
        alt: 'Replacement two',
        source: 'replacement-two',
      },
    ]

    await expect(
      runCodexResponseMediaToolTurn([
        {
          id: 41,
          media: firstMedia,
          expectedText: '1 response image attached',
        },
        {
          id: 42,
          media: replacementMedia,
          expectedText: '2 response images attached',
        },
      ]),
    ).resolves.toMatchObject({
      finalMessage: 'Tool media complete',
      responseMedia: replacementMedia,
    })
  })

  it('clears response media when attach_response_media receives an empty batch', async () => {
    await expect(
      runCodexResponseMediaToolTurn([
        {
          id: 51,
          media: [
            {
              kind: 'image',
              url: 'https://cdn.example.test/assistant/to-clear.png',
              alt: 'Cleared image',
              source: 'clear-source',
            },
          ],
          expectedText: '1 response image attached',
        },
        {
          id: 52,
          media: [],
          expectedText: 'response media cleared',
        },
      ]),
    ).resolves.toMatchObject({
      finalMessage: 'Tool media complete',
      responseMedia: [],
    })
  })

  it('applies overlapping dynamic media tools in request order', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-order-work-')
    const releaseImageFetch = createDeferred<void>()
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    const fetchImpl = vi.fn(async () => {
      await releaseImageFetch.promise
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })
    const uploader = {
      uploadGeneratedImage: vi.fn(async (uploadInput: { alt: string | null; source: string | null }) => ({
        alt: uploadInput.alt,
        kind: 'image' as const,
        source: uploadInput.source,
        url: 'https://imagedelivery.net/account/generated/public',
      })),
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
                  id: 'thread-image-order',
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
                  id: 'turn-image-order',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 61,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'Render the product.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 62,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'attach_response_media',
                arguments: {
                  media: [],
                },
              },
            }),
          )
          releaseImageFetch.resolve()

          const messages = await waitForRpcMessages(child, 6)
          expect(messages[4]).toMatchObject({
            id: 61,
            result: { success: true },
          })
          expect(messages[5]).toMatchObject({
            id: 62,
            result: { success: true },
          })

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-image-order',
                  type: 'assistant_message',
                  message: 'Ordered media complete',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-image-order',
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
        env: { OPENAI_API_KEY: 'openai-test-key' },
        fetchImpl,
        hostedGeneratedImageUploader: uploader,
        prompt: 'generate then clear media',
        requireHostedGeneratedImageUploader: true,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Ordered media complete',
      responseMedia: [],
      additionalUsages: [
        { provider: 'openai-images' },
      ],
    })
    expect(uploader.uploadGeneratedImage).toHaveBeenCalledOnce()
  })

  it('aborts and drains in-flight image generation when the turn fails', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-failure-work-')
    const codexHome = await createTempDir('assistant-codex-image-failure-home-')
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    let fetchAborted = false
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          // Settle only after the failing turn aborts in-flight dynamic tools,
          // proving the drain waits for completed image usage.
          const respond = () => {
            fetchAborted = true
            resolve(new Response(JSON.stringify({
              data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            }), {
              headers: { 'content-type': 'application/json' },
              status: 200,
            }))
          }
          if (init?.signal?.aborted) {
            respond()
            return
          }
          init?.signal?.addEventListener('abort', respond)
        }),
    )

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
                  id: 'thread-image-failure',
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
                  id: 'turn-image-failure',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 71,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'Render the product.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-image-failure',
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

    const error: unknown = await executeCodexAppServerTurn({
      codexHome,
      env: { OPENAI_API_KEY: 'openai-test-key' },
      fetchImpl,
      prompt: 'generate during turn failure',
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
    expect(fetchAborted).toBe(true)
    const failureContext = readCodexAppServerTurnFailureContext(error)
    expect(failureContext?.additionalUsages).toMatchObject([
      {
        provider: 'openai-images',
        providerRequestOrdinal: 1,
      },
    ])
  })

  it('answers progress updates immediately while image generation is in flight', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-progress-work-')
    const releaseImageFetch = createDeferred<void>()
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    const fetchImpl = vi.fn(async () => {
      await releaseImageFetch.promise
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })
    const uploader = {
      uploadGeneratedImage: vi.fn(async (uploadInput: { alt: string | null; source: string | null }) => ({
        alt: uploadInput.alt,
        kind: 'image' as const,
        source: uploadInput.source,
        url: 'https://imagedelivery.net/account/generated/public',
      })),
    }
    const progressDelivery = {
      send: vi.fn(async (_text: string) => sentProgressResult()),
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
                  id: 'thread-image-progress',
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
                  id: 'turn-image-progress',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 81,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'Render the product.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 82,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'send_progress_update',
                arguments: {
                  text: 'Still generating the image.',
                },
              },
            }),
          )

          // The progress response must arrive while the image fetch is held.
          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toMatchObject({
            id: 82,
            result: { success: true },
          })
          releaseImageFetch.resolve()

          const allMessages = await waitForRpcMessages(child, 6)
          expect(allMessages[5]).toMatchObject({
            id: 81,
            result: { success: true },
          })

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-image-progress',
                  type: 'assistant_message',
                  message: 'Progress and image complete',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-image-progress',
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
        env: { OPENAI_API_KEY: 'openai-test-key' },
        fetchImpl,
        hostedGeneratedImageUploader: uploader,
        progressDelivery,
        prompt: 'generate with progress',
        requireHostedGeneratedImageUploader: true,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Progress and image complete',
      responseMedia: [
        {
          url: 'https://imagedelivery.net/account/generated/public',
        },
      ],
    })
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Still generating the image.',
      { source: 'model' },
    )
  })

  it('reports a structured failure when a generated image exceeds the media limit', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-limit-work-')
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
    const uploader = {
      uploadGeneratedImage: vi.fn(async (uploadInput: { alt: string | null; source: string | null }) => ({
        alt: uploadInput.alt,
        kind: 'image' as const,
        source: uploadInput.source,
        url: 'https://imagedelivery.net/account/generated/public',
      })),
    }
    const attachedMedia = Array.from({ length: 40 }, (_, index) => ({
      kind: 'image' as const,
      url: `https://cdn.example.test/assistant/full-${index}.png`,
      alt: `Image ${index}`,
      source: 'media-limit-source',
    }))

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
                  id: 'thread-image-limit',
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
                  id: 'turn-image-limit',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 91,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'attach_response_media',
                arguments: {
                  media: attachedMedia,
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 92,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'Render one more image.',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 6)
          expect(messages[4]).toMatchObject({
            id: 91,
            result: { success: true },
          })
          expect(messages[5]).toEqual({
            id: 92,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'response media limit reached',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-image-limit',
                  type: 'assistant_message',
                  message: 'Media limit handled',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-image-limit',
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
      env: { OPENAI_API_KEY: 'openai-test-key' },
      fetchImpl,
      hostedGeneratedImageUploader: uploader,
      prompt: 'attach media then exceed the limit',
      requireHostedGeneratedImageUploader: true,
      workingDirectory,
    })

    expect(result.finalMessage).toBe('Media limit handled')
    expect(result.responseMedia).toHaveLength(40)
    // The image was generated and paid for, so its usage is still recorded.
    expect(result.additionalUsages).toMatchObject([
      { provider: 'openai-images' },
    ])
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
        cwd: path.resolve(workingDirectory),
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-warm-1',
                type: 'assistant_message',
              },
              delta: 'First answer',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-local-warm-1',
                type: 'assistant_message',
                message: 'First answer',
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-warm-2',
                type: 'assistant_message',
              },
              delta: 'Second answer',
              turnId: 'turn-local-warm-2',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-local-warm-2',
                type: 'assistant_message',
                message: 'Second answer',
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
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 26_250
      child = spawnedChild

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-local-busy-1',
            turnId: 'turn-local-busy-1',
          })
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-stop-busy',
                type: 'assistant_message',
              },
              delta: 'Still completed',
            },
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

  it.each([
    {
      label: 'previous-turn completion before current turn/start response',
      staleEvent: {
        method: 'turn/completed',
        params: {
          turn: {
            id: 'turn-provider-stale-usage-1',
            status: 'completed',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
            },
          },
          turnId: 'turn-provider-stale-usage-1',
        },
      },
    },
    {
      label: 'untagged token usage before current turn/start response',
      staleEvent: {
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: {
            last: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
            },
            total: {
              input_tokens: 110,
              output_tokens: 55,
              total_tokens: 165,
            },
          },
        },
      },
    },
  ])('keeps stale warm-process usage out of failed provider turns: $label', async ({
    staleEvent,
  }) => {
    const workingDirectory = await createTempDir('assistant-codex-provider-stale-usage-work-')
    const codexHome = await createTempDir('assistant-codex-provider-stale-usage-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 25_700 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-provider-stale-usage-1',
            turnId: 'turn-provider-stale-usage-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-provider-stale-usage-1',
                status: 'completed',
                usage: {
                  input_tokens: 10,
                  output_tokens: 5,
                  total_tokens: 15,
                },
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-provider-stale-usage-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine(staleEvent))
          if (staleEvent.method === 'turn/completed') {
            child.stdout.write(jsonLine({
              id: secondTurn.id,
              result: {
                turn: {
                  id: 'turn-provider-stale-usage-2',
                },
              },
            }))
          }
        })()
      })

      return child
    })

    const providerConfig = normalizeAssistantProviderConfig({
      approvalPolicy: 'never',
      codexHome,
      provider: 'codex-cli',
      sandbox: 'workspace-write',
    })
    const baseInput = {
      developerInstructions: 'Stable Murph instructions.',
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
        userPrompt: 'First provider turn before stale usage',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    const failedAttempt = await executeCodexAssistantTurnAttempt({
      ...baseInput,
      userPrompt: 'Second provider turn with stale usage',
    })

    expect(failedAttempt).toMatchObject({
      ok: false,
    })
    if (failedAttempt.ok) {
      throw new Error('Expected stale usage provider attempt to fail.')
    }
    expect(failedAttempt.usage).toBeUndefined()
    expect(failedAttempt.rawEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: staleEvent.method,
        }),
      ]),
    )
    expect(process.kill).toHaveBeenCalledWith(-25_700, 'SIGTERM')
  })

  it('accepts reused warm events with alternate current-turn id shapes', async () => {
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
              turn_id: 'turn-local-turn-id-shape-2',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'assistant.message.delta',
            data: {
              turn_id: 'turn-local-turn-id-shape-2',
            },
            params: {
              item: {
                id: 'assistant-local-turn-id-shape-2',
                type: 'assistant_message',
              },
              delta: 'Second answer',
            },
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
    ).resolves.toMatchObject({
      finalMessage: 'Second answer',
      sessionId: 'thread-local-turn-id-shape-2',
      turnId: 'turn-local-turn-id-shape-2',
    })
  })

  it('buffers tagged reused warm events until the turn/start response confirms the turn', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-prestart-tagged-work-')
    const codexHome = await createTempDir('assistant-codex-local-prestart-tagged-home-')
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
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-local-prestart-tagged-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {
              turn: {
                id: 'turn-local-prestart-tagged-2',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-prestart-tagged-2',
                type: 'assistant_message',
              },
              delta: 'Buffered event succeeded',
              turnId: 'turn-local-prestart-tagged-2',
            },
          }))
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
        prompt: 'second local turn with tagged prestart event',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Buffered event succeeded',
      sessionId: 'thread-local-prestart-tagged-2',
      turnId: 'turn-local-prestart-tagged-2',
    })
  })

  it('buffers tagged pre-start warm server requests until the turn/start response confirms the turn', async () => {
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
            id: 99,
            method: 'item/tool/call',
            params: {
              arguments: {
                text: 'Starting early work',
              },
              namespace: 'murph',
              tool: 'send_progress_update',
              turnId: 'turn-local-prestart-request-2',
            },
          }))

          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(
            readWrittenRpcMessages(child).some((message) => message.id === 99),
          ).toBe(false)

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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-prestart-request-2',
                type: 'assistant_message',
              },
              delta: 'Pre-start request completed',
              turnId: 'turn-local-prestart-request-2',
            },
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
        prompt: 'second local turn with prestart server request',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Pre-start request completed',
      sessionId: 'thread-local-prestart-request-2',
      turnId: 'turn-local-prestart-request-2',
    })
    expect(progressUpdates).toEqual(['Starting early work'])
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

  it('completes reused warm turns from dotted lifecycle event names', async () => {
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
                type: 'assistant_message',
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
    ).resolves.toMatchObject({
      finalMessage: 'Dotted lifecycle completed',
      sessionId: 'thread-local-dotted-events-2',
      turnId: 'turn-local-dotted-events-2',
    })
  })

  it('rejects failed turn/completed status carried in data fields', async () => {
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
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexTurnStatus: 'failed',
      },
      message: expect.stringContaining('data failure detail'),
    })
  })

  it('poisons warm Codex when a reused process emits untagged turn output', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-untagged-work-')
    const codexHome = await createTempDir('assistant-codex-local-untagged-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 26_000 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-untagged-1',
            turnId: 'turn-local-untagged-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-untagged-1',
                status: 'completed',
              },
            },
          }))

          await writeWarmTurnStarted({
            child,
            requestCount: 2,
            threadId: 'thread-local-untagged-2',
            turnId: 'turn-local-untagged-2',
          })
          child.stdout.write(jsonLine({
            method: 'assistant.message.delta',
            params: {
              delta: 'stale untagged text',
              item: {
                id: 'assistant-local-untagged-2',
                type: 'assistant_message',
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
        prompt: 'first local turn before untagged output',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-untagged-1',
      turnId: 'turn-local-untagged-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn with untagged output',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT',
      context: {
        eventMethod: 'assistant.message.delta',
        eventTurnIdPresent: false,
        expectedTurnIdPresent: true,
        retryable: true,
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-26_000, 'SIGTERM')
  })

  it.each([
    {
      label: 'unsupported dynamic tool',
      params: {
        namespace: 'murph',
        tool: 'send_message',
        arguments: {
          text: 'stale progress',
        },
      },
    },
    {
      label: 'invalid progress arguments',
      params: {
        namespace: 'murph',
        tool: 'send_progress_update',
        arguments: {
          text: '',
        },
      },
    },
  ])('poisons warm Codex before replying to an untagged reused-process $label request', async (scenario) => {
    const workingDirectory = await createTempDir('assistant-codex-local-untagged-tool-work-')
    const codexHome = await createTempDir('assistant-codex-local-untagged-tool-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 26_500 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-untagged-tool-1',
            turnId: 'turn-local-untagged-tool-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-untagged-tool-1',
                status: 'completed',
              },
            },
          }))

          await writeWarmTurnStarted({
            child,
            requestCount: 2,
            threadId: 'thread-local-untagged-tool-2',
            turnId: 'turn-local-untagged-tool-2',
          })
          child.stdout.write(jsonLine({
            id: 99,
            method: 'item/tool/call',
            params: scenario.params,
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
        prompt: 'first local turn before untagged dynamic tool',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-untagged-tool-1',
      turnId: 'turn-local-untagged-tool-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn with untagged dynamic tool',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT',
      context: {
        eventMethod: 'item/tool/call',
        eventTurnIdPresent: false,
        expectedTurnIdPresent: true,
        retryable: true,
      },
    })

    expect(process.kill).toHaveBeenCalledWith(-26_500, 'SIGTERM')
    expect(
      readWrittenRpcMessages(requireMockChildProcess(spawnedChildren[0] ?? null))
      .some((message) => message.id === 99),
    ).toBe(false)
  })

  it('requires turn/start ids before reusing warm Codex event correlation', async () => {
    const workingDirectory = await createTempDir('assistant-codex-local-missing-turn-id-work-')
    const codexHome = await createTempDir('assistant-codex-local-missing-turn-id-home-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.pid = 27_000 + spawnedChildren.length
      spawnedChildren.push(child)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-local-missing-turn-id-1',
            turnId: 'turn-local-missing-turn-id-1',
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-local-missing-turn-id-1',
                status: 'completed',
              },
            },
          }))

          const secondThread = await waitForRpcMethodCount(child, 'thread/start', 2)
          child.stdout.write(jsonLine({
            id: secondThread.id,
            result: {
              thread: {
                id: 'thread-local-missing-turn-id-2',
              },
            },
          }))
          const secondTurn = await waitForRpcMethodCount(child, 'turn/start', 2)
          child.stdout.write(jsonLine({
            id: secondTurn.id,
            result: {},
          }))
          child.stdout.write(jsonLine({
            method: 'assistant.message.delta',
            params: {
              delta: 'stale tagged text',
              item: {
                id: 'assistant-local-missing-turn-id-2',
                type: 'assistant_message',
              },
              turnId: 'turn-local-missing-turn-id-1',
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
        prompt: 'first local turn before missing id',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-missing-turn-id-1',
      turnId: 'turn-local-missing-turn-id-1',
    })

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'second local turn without turn/start id',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_TURN_ID_MISSING',
      context: {
        retryable: true,
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-27_000, 'SIGTERM')
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

    await expect(
      executeCodexAppServerTurn({
        ...stableInput,
        prompt: 'next local turn after malformed output',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-local-malformed-2',
      turnId: 'turn-local-malformed-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(requireMockChildProcess(spawnedChildren[1] ?? null).pid)
      .not.toBe(requireMockChildProcess(spawnedChildren[0] ?? null).pid)
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
              method: 'item/completed',
              params: {
                completedAtMs: 340,
                item: {
                  id: 'mcp-1',
                  type: 'mcpToolCall',
                  server_name: 'web',
                  name: 'search_query',
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
          tool: 'readSummary',
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
    })
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('/tmp/raw')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('raw output')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('mcp raw output')
    expect(JSON.stringify(diagnosticEvent?.rawEvent)).not.toContain('secretPath')
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
      codexActionOutputBytesMax: 26,
      codexActionOutputBytesTotal: 26,
      codexActionOutputItemCount: 1,
      codexActionOutputUnitMax: 45,
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
      codexActionUsageSampleCount: 1,
    })
    expect(JSON.stringify(trace)).not.toContain('999999')
    expect(JSON.stringify(trace)).not.toContain('raw-action-id')
    expect(JSON.stringify(trace)).not.toContain('raw output')
  })

  it('dedupes Codex action diagnostics without item ids when normalized identity is available', () => {
    const reducer = createCodexActionDiagnosticsReducer()
    const activeTurnId = 'turn-current'
    const rawCompletedEvent = {
      event: 'item.completed',
      turnId: activeTurnId,
      data: {
        item: {
          type: 'mcpToolCall',
          server_name: 'web',
          name: 'search_query',
          status: 'completed',
          result: {
            content: [
              {
                type: 'text',
                text: 'raw output must not appear',
              },
            ],
          },
        },
      },
    }
    const normalized: CodexNormalizedEvent = {
      itemId: null,
      itemState: 'completed',
      kind: 'tool_call',
      rawEvent: rawCompletedEvent,
      toolName: 'search_query',
      toolServer: 'web',
    }

    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: normalized,
      rawEvent: rawCompletedEvent,
    })
    reducer.recordEvent({
      activeTurnId,
      normalizedEvent: normalized,
      rawEvent: rawCompletedEvent,
    })

    const trace = reducer.buildTraceEvent({
      codexThreadId: 'thread-current',
      providerActionCount: 0,
      turnId: activeTurnId,
    })
    expect(trace).toMatchObject({
      codexActionCompletedCount: 1,
      codexActionMcpToolCallCount: 1,
      codexActionOutputBytesMax: 26,
      codexActionOutputBytesTotal: 26,
      codexActionToolSummaries: [
        {
          callCount: 1,
          kind: 'mcp.tool.call',
          outputBytesMax: 26,
          outputBytesTotal: 26,
          serverPresent: true,
          tool: 'search_query',
        },
      ],
    })
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
      ['app-server'],
      expect.objectContaining({
        cwd: path.resolve(workingDirectory),
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
      expect(args).toEqual(['app-server'])
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
      ['app-server'],
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
        ['app-server'],
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
      ['app-server'],
      expect.any(Object),
    )
  })

  it('does not reuse warm Codex after a CLI bridge off-invocation stop', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-cli-bridge-stop-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-cli-bridge-stop-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      const processNumber = spawnedChildren.length + 1
      spawnedChild.pid = 34_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const thread = await waitForRpcMethod(spawnedChild, 'thread/start')
          spawnedChild.stdout.write(jsonLine({
            id: thread.id,
            result: {
              thread: {
                id: `thread-warm-cli-bridge-stop-${processNumber}`,
              },
            },
          }))

          const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(jsonLine({
            id: turn.id,
            result: {
              turn: {
                id: `turn-warm-cli-bridge-stop-${processNumber}`,
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: `turn-warm-cli-bridge-stop-${processNumber}`,
                status: 'completed',
              },
            },
          }))
        })()
      })

      return spawnedChild
    })

    const hostedEnv = {
      [HOSTED_CLI_BRIDGE_TOKEN_ENV]: 'bridge-token-stable',
      [HOSTED_CLI_BRIDGE_URL_ENV]: 'http://127.0.0.1:9174/',
      CODEX_HOME: hostedCodexHome,
      HOSTED_ASSISTANT_MODEL: 'gpt-warm-stop',
      MURPH_HOSTED_CODEX_MODEL_PROVIDER_ID: 'hosted-provider',
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'first warm stop turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-cli-bridge-stop-1',
      turnId: 'turn-warm-cli-bridge-stop-1',
    })

    const firstChild = requireMockChildProcess(spawnedChildren[0] ?? null)
    await stopWarmCodexAppServer('cli-bridge-off-invocation-request')
    expect(process.kill).toHaveBeenCalledWith(-34_000, 'SIGTERM')

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'second warm stop turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-cli-bridge-stop-2',
      turnId: 'turn-warm-cli-bridge-stop-2',
    })

    const secondChild = requireMockChildProcess(spawnedChildren[1] ?? null)
    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(secondChild.pid).not.toBe(firstChild.pid)
  })

  it.each([
    {
      name: 'stable bridge token',
      secondEnv: {
        [HOSTED_CLI_BRIDGE_TOKEN_ENV]: 'bridge-token-two',
      },
      useSecondCodexHome: false,
    },
    {
      name: 'stable bridge URL',
      secondEnv: {
        [HOSTED_CLI_BRIDGE_URL_ENV]: 'http://127.0.0.1:9175/',
      },
      useSecondCodexHome: false,
    },
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
        [HOSTED_CLI_BRIDGE_TOKEN_ENV]: 'bridge-token-one',
        [HOSTED_CLI_BRIDGE_URL_ENV]: 'http://127.0.0.1:9174/',
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

      await expect(
        executeCodexAppServerTurn({
          env: {
            ...baseEnv,
            ...scenario.secondEnv,
            CODEX_HOME: secondCodexHome,
          },
          prompt: 'second stable identity',
          workingDirectory,
        }),
      ).resolves.toMatchObject({
        sessionId: 'thread-warm-identity-2',
        turnId: 'turn-warm-identity-2',
      })

      expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
      expect(process.kill).toHaveBeenCalledWith(-32_000, 'SIGTERM')
      expect(requireMockChildProcess(spawnedChildren[0] ?? null).pid)
        .not.toBe(requireMockChildProcess(spawnedChildren[1] ?? null).pid)
    },
  )

  it('rejects stale warm turn completion events', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-stale-complete-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-stale-complete-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 21_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-stale-complete-one',
            turnId: 'turn-stale-complete-one',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-stale-complete-one',
                status: 'completed',
              },
            },
          }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
            threadId: 'thread-stale-complete-two',
            turnId: 'turn-stale-complete-two',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-stale-complete-one',
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
        prompt: 'first stale completion turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-stale-complete-one',
      turnId: 'turn-stale-complete-one',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'second stale completion turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT',
      context: {
        eventMethod: 'turn/completed',
        eventTurnIdPresent: true,
        expectedTurnIdPresent: true,
        retryable: true,
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-spawnedChildren[0]!.pid, 'SIGTERM')
  })

  it('handles current Codex v2 turn-tagged assistant events across warm turns', async () => {
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

  it('rejects stale warm assistant progress events before delivery', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-stale-progress-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-stale-progress-work-')
    const progressDelivery = createProgressDeliveryMock()
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 22_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-stale-progress-one',
            turnId: 'turn-stale-progress-one',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-stale-progress-one',
                status: 'completed',
              },
            },
          }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
            threadId: 'thread-stale-progress-two',
            turnId: 'turn-stale-progress-two',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              turnId: 'turn-stale-progress-one',
              item: {
                id: 'assistant-stale-progress',
                type: 'assistant_message',
                phase: 'commentary',
                message: 'This stale progress must not be delivered.',
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
        prompt: 'first stale progress turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      turnId: 'turn-stale-progress-one',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        progressDelivery,
        prompt: 'second stale progress turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT',
      context: {
        eventMethod: 'item/completed',
        eventTurnIdPresent: true,
        expectedTurnIdPresent: true,
        retryable: true,
      },
    })
    expect(progressDelivery.send).not.toHaveBeenCalled()
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

          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              status: 'completed',
              turnId: 'turn-unsupported-request',
            },
          }))
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

  it('rejects stale unsupported warm server requests before replying', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-stale-unsupported-request-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-stale-unsupported-request-work-')
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 22_550
      child = spawnedChild

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-stale-unsupported-request',
            turnId: 'turn-stale-unsupported-request-one',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              status: 'completed',
              turnId: 'turn-stale-unsupported-request-one',
            },
          }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
            threadId: 'thread-stale-unsupported-request',
            turnId: 'turn-stale-unsupported-request-two',
          })
          spawnedChild.stdout.write(jsonLine({
            id: 99,
            method: 'approval/request',
            params: {
              reason: 'stale unsupported request shape',
              turnId: 'turn-stale-unsupported-request-one',
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
        prompt: 'first stale unsupported request turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      turnId: 'turn-stale-unsupported-request-one',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'second stale unsupported request turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT',
      context: {
        eventMethod: 'approval/request',
        eventTurnIdPresent: true,
        expectedTurnIdPresent: true,
        retryable: true,
      },
    })

    expect(
      readWrittenRpcMessages(requireMockChildProcess(child)).some(
        (message) => message.id === 99,
      ),
    ).toBe(false)
  })

  it('poisons warm Codex on unknown RPC responses during an active turn', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-late-rpc-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-late-rpc-work-')
    const spawnedChildren: MockChildProcess[] = []
    mockProcessGroupSignalsForChildren(spawnedChildren)

    codexMocks.spawn.mockImplementation(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 23_000 + spawnedChildren.length
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-late-rpc-one',
            turnId: 'turn-late-rpc-one',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-late-rpc-one',
                status: 'completed',
              },
            },
          }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
            threadId: 'thread-late-rpc-two',
            turnId: 'turn-late-rpc-two',
          })
          spawnedChild.stdout.write(jsonLine({
            id: 999_999,
            result: {},
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
        prompt: 'first late rpc turn',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      turnId: 'turn-late-rpc-one',
    })

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'second late rpc turn',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_LATE_RESPONSE',
      context: {
        retryable: true,
      },
    })
    expect(process.kill).toHaveBeenCalledWith(-spawnedChildren[0]!.pid, 'SIGTERM')
  })

  it('stops warm Codex when output arrives outside an active turn', async () => {
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
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              status: 'completed',
              turnId: 'turn-off-turn-one',
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
    await waitForProcessKill(-spawnedChildren[0]!.pid, 'SIGTERM')

    expect(await snapshotExpectedCodexRootProcess()).toBeNull()

    codexMocks.spawn.mockImplementationOnce(() => {
      const spawnedChild = new MockChildProcess()
      spawnedChild.pid = 24_500
      spawnedChildren.push(spawnedChild)

      queueMicrotask(() => {
        void (async () => {
          const initialized = await waitForRpcMethod(spawnedChild, 'initialize')
          spawnedChild.stdout.write(jsonLine({ id: initialized.id, result: {} }))

          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 1,
            threadId: 'thread-off-turn-two',
            turnId: 'turn-off-turn-two',
          })
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              status: 'completed',
              turnId: 'turn-off-turn-two',
            },
          }))
        })()
      })

      return spawnedChild
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
    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
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
      const externalStopExpectation = expect(externalStop).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
      await waitForProcessKillWithFakeTimers(-31_000, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(6_000)
      await externalStopExpectation
      vi.mocked(process.kill).mockClear()

      const replacementAttempt = executeCodexAppServerTurn({
        env: {
          ...hostedEnv,
          PATH: '/usr/local/bin',
        },
        prompt: 'second stop failure launch',
        workingDirectory,
      })
      const replacementExpectation = expect(replacementAttempt).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
      await waitForProcessKillWithFakeTimers(-31_000, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(6_000)
      await replacementExpectation
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

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'next turn after abort',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-abort-two',
      turnId: 'turn-warm-abort-two',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(process.kill).toHaveBeenCalledWith(-20_000, 'SIGINT')
    expect(process.kill).toHaveBeenCalledWith(-20_000, 'SIGTERM')
  })

  it('rejects and frees the warm slot when an aborted turn never completes', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-abort-timeout-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-abort-timeout-work-')
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
      spawnedChild.pid = 21_000 + spawnedChildren.length
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
                id: `thread-warm-abort-timeout-${processNumber}`,
              },
            },
          }))

          const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(jsonLine({
            id: turn.id,
            result: {
              turn: {
                id: `turn-warm-abort-timeout-${processNumber}`,
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: `turn-warm-abort-timeout-${processNumber}`,
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
                id: `turn-warm-abort-timeout-${processNumber}`,
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

    const abortedTurn = executeCodexAppServerTurn({
      abortSignal: controller.signal,
      env: hostedEnv,
      onLiveTurn: (turn) => {
        liveTurnReady.resolve(turn)
      },
      prompt: 'abort without completion',
      workingDirectory,
    })
    void abortedTurn.catch(() => undefined)

    await liveTurnReady.promise

    try {
      vi.useFakeTimers()
      controller.abort()
      await vi.advanceTimersByTimeAsync(1)
      await interruptSeen.promise
      expect(process.kill).toHaveBeenCalledWith(-21_000, 'SIGINT')

      await vi.advanceTimersByTimeAsync(15_000)
      await expect(abortedTurn).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_INTERRUPT_TIMEOUT',
        context: {
          interruptCleanupTimeoutMs: 15_000,
          liveInterruptRequested: false,
          retryable: true,
        },
      })
    } finally {
      vi.useRealTimers()
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'next turn after abort timeout',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-abort-timeout-2',
      turnId: 'turn-warm-abort-timeout-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(process.kill).toHaveBeenCalledWith(-21_000, 'SIGTERM')
  })

  it('rejects and frees the warm slot when a live interrupt never completes', async () => {
    const hostedCodexHome = await createTempDir('assistant-codex-warm-live-interrupt-timeout-home-')
    const workingDirectory = await createTempDir('assistant-codex-warm-live-interrupt-timeout-work-')
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
      spawnedChild.pid = 22_000 + spawnedChildren.length
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
                id: `thread-warm-live-interrupt-timeout-${processNumber}`,
              },
            },
          }))

          const turn = await waitForRpcMethod(spawnedChild, 'turn/start')
          spawnedChild.stdout.write(jsonLine({
            id: turn.id,
            result: {
              turn: {
                id: `turn-warm-live-interrupt-timeout-${processNumber}`,
              },
            },
          }))
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: `turn-warm-live-interrupt-timeout-${processNumber}`,
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
                id: `turn-warm-live-interrupt-timeout-${processNumber}`,
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

    const interruptedTurn = executeCodexAppServerTurn({
      env: hostedEnv,
      onLiveTurn: (turn) => {
        liveTurnReady.resolve(turn)
      },
      prompt: 'interrupt without completion',
      workingDirectory,
    })
    void interruptedTurn.catch(() => undefined)

    const liveTurn = await liveTurnReady.promise

    try {
      vi.useFakeTimers()
      const interruptPromise = liveTurn.interrupt()
      await vi.advanceTimersByTimeAsync(1)
      await interruptSeen.promise
      await interruptPromise
      expect(process.kill).not.toHaveBeenCalledWith(-22_000, 'SIGINT')

      await vi.advanceTimersByTimeAsync(15_000)
      await expect(interruptedTurn).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_INTERRUPT_TIMEOUT',
        context: {
          interruptCleanupTimeoutMs: 15_000,
          liveInterruptRequested: true,
          retryable: true,
        },
      })
    } finally {
      vi.useRealTimers()
    }

    await expect(
      executeCodexAppServerTurn({
        env: hostedEnv,
        prompt: 'next turn after live interrupt timeout',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-warm-live-interrupt-timeout-2',
      turnId: 'turn-warm-live-interrupt-timeout-2',
    })

    expect(codexMocks.spawn).toHaveBeenCalledTimes(2)
    expect(process.kill).toHaveBeenCalledWith(-22_000, 'SIGTERM')
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
        mismatchedFields: expect.arrayContaining([
          'cwd',
          'model',
          'modelProvider',
          'sandbox',
        ]),
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

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        model: 'gpt-5.1',
        modelProvider: 'openai',
        prompt: 'resume with wrong returned id',
        resumeSessionId: 'requested-thread',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        mismatchedFields: ['threadId'],
        resumeContextMismatch: true,
        retryable: true,
        staleResume: true,
      },
    })

    const child = requireMockChildProcess(spawnedChildren[0] ?? null)
    expect(
      readWrittenRpcMessages(child).some((message) => message.method === 'turn/start'),
    ).toBe(false)
    expect(process.kill).toHaveBeenCalledWith(-35_200, 'SIGTERM')
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
        dynamicTools: MURPH_DYNAMIC_TOOLS,
        serviceName: 'murph',
      })
      expect(asRecord(threadRequests[1]?.params)).toEqual(expectedResumeThreadContext)

      for (const [index, expectedThreadId] of ['thread-fresh', 'thread-resume-request'].entries()) {
        const turnParams = asRecord(turnRequests[index]?.params)
        expect(turnParams).toMatchObject({
          effort: 'high',
          threadId: expectedThreadId,
        })
        expect(turnParams.approvalPolicy).toBeUndefined()
        expect(turnParams.cwd).toBeUndefined()
        expect(turnParams.model).toBeUndefined()
        expect(turnParams.modelProvider).toBeUndefined()
        expect(turnParams.sandbox).toBeUndefined()
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
      { source: 'model' },
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
      { source: 'model' },
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
      { source: 'model' },
    )
  })

  it('counts commentary progress and progress tool calls against the same model budget', async () => {
    const workingDirectory = await createTempDir('assistant-codex-commentary-progress-')
    let sendCount = 0
    const progressDelivery = {
      send: vi.fn(async (_text: string, options?: { source?: 'model' | 'system' }) => {
        sendCount += 1
        const source = options?.source ?? 'model'
        return sendCount === 1
          ? {
              kind: 'sent' as const,
              source,
            }
          : {
              kind: 'skipped' as const,
              reason: 'limit' as const,
              source,
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
                  type: 'assistant_message',
                  phase: 'commentary',
                  message: 'Reading the report now.',
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
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-commentary-final',
                  type: 'assistant_message',
                  phase: 'final_answer',
                  message: 'Final answer after commentary.',
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
        prompt: 'answer with commentary progress',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Final answer after commentary.',
      sessionId: 'thread-commentary-progress',
    })
    expect(progressDelivery.send).toHaveBeenNthCalledWith(
      1,
      'Reading the report now.',
      { source: 'model' },
    )
    expect(progressDelivery.send).toHaveBeenNthCalledWith(
      2,
      'Checking the saved context now.',
      { source: 'model' },
    )
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
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-drain',
                  type: 'assistant_message',
                  phase: 'commentary',
                  message: 'Checking the thread now.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-drain-final',
                  type: 'assistant_message',
                  phase: 'final_answer',
                  message: 'Final answer after progress.',
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
      'Checking the thread now.',
      { source: 'model' },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    progressSent.resolve(sentProgressResult())
    await expect(turnPromise).resolves.toMatchObject({
      finalMessage: 'Final answer after progress.',
      sessionId: 'thread-progress-drain',
      turnId: 'turn-progress-drain',
    })
  })

  it('releases the final turn when current-channel progress never settles', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-drain-timeout-')
    const stalledProgress = createDeferred<ReturnType<typeof sentProgressResult>>()
    const progressDelivery = {
      close: vi.fn(() => {
        stalledProgress.resolve(sentProgressResult())
      }),
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
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-drain-timeout',
                  type: 'assistant_message',
                  phase: 'commentary',
                  message: 'Checking the thread now.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-progress-drain-timeout-final',
                  type: 'assistant_message',
                  phase: 'final_answer',
                  message: 'Final answer after stalled progress.',
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

    const turnPromise = executeCodexAppServerTurn({
      prompt: 'answer with stalled progress',
      progressDelivery,
      workingDirectory,
    })

    for (
      let attempt = 0;
      attempt < 200 && progressDelivery.send.mock.calls.length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Checking the thread now.',
      { source: 'model' },
    )

    await expect(turnPromise).resolves.toMatchObject({
      finalMessage: 'Final answer after stalled progress.',
      sessionId: 'thread-progress-drain-timeout',
      turnId: 'turn-progress-drain-timeout',
    })
    expect(progressDelivery.close).toHaveBeenCalledTimes(1)
  })

  it('returns unavailable for progress tool calls when no progress sink exists', async () => {
    const workingDirectory = await createTempDir('assistant-codex-progress-disabled-')

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

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress updates are not available for this turn',
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
        prompt: 'try disabled progress tool',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-disabled',
    })
  })

  it('sends one current-channel progress update when Codex compacts context', async () => {
    const workingDirectory = await createTempDir('assistant-codex-context-compact-')
    const onProgress = vi.fn()
    const onTraceEvent = vi.fn()
    const selectedProgressText = CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS[4]
    expect(CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS).toEqual([
      'Hang on, refreshing my memory real quick.',
      'One moment while I catch up on our conversation.',
      'Bear with me, pulling my thoughts together.',
      'Hang on, piecing everything together real quick.',
      'One sec, getting everything sorted in my head.',
      'Give me a moment — lots to keep track of here.',
      'Hold on, gathering my thoughts on all of this.',
      'One sec — just making sure I\'m not missing anything.',
    ])
    expect(CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\bcontext\b/iu)]),
    )
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
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
                  id: 'thread-context-compact',
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
                  id: 'turn-context-compact',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/started',
              params: {
                item: {
                  id: 'context-compact-1',
                  type: 'ContextCompaction',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/started',
              params: {
                item: {
                  id: 'context-compact-1',
                  type: 'context_compaction',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'context-compact-1',
                  type: 'context.compaction',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-context-compact-final',
                  type: 'assistant_message',
                  message: 'Final answer after compaction.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-context-compact',
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
      { source: 'system' },
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
        })()
      })

      return child
    })

    await expect(
      executeCodexAppServerTurn({
        prompt: 'try invalid progress tool',
        progressDelivery,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-progress-invalid',
    })
    expect(progressDelivery.send).not.toHaveBeenCalled()
  })

  it('handles progress dynamic tool calls on resumed threads when a real sink exists', async () => {
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
      { source: 'model' },
    )
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
        codexProviderRequestStarted: false,
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
    expect(process.kill).toHaveBeenCalledWith(-spawnedChild.pid, 'SIGTERM')
    expect(process.kill).toHaveBeenCalledWith(-spawnedChild.pid, 'SIGKILL')
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
        codexAbortRequested: true,
        codexFailureStage: 'interrupted',
        codexShutdownRequested: false,
        codexTerminationSignalSent: 'SIGINT',
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
      const stopExpectation = expect(stopped).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
        context: {
          retryable: false,
        },
      })
      await vi.advanceTimersByTimeAsync(6_000)
      await stopExpectation
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
      messagePhase: null,
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

function emitProcessErrorAndExit(
  child: MockChildProcess,
  error: Error,
): void {
  child.emit('error', error)
  child.emit('exit', 1, null)
  child.emit('close', 1, null)
}

function emitMockStdinError(
  child: MockChildProcess,
  error: Error,
): void {
  for (const listener of child.stdin.listeners('error')) {
    if (typeof listener === 'function') {
      listener(error)
    }
  }
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

async function waitForRpcResponse(
  child: MockChildProcess,
  id: number,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const message = readWrittenRpcMessages(child).find(
      (candidate) => candidate.id === id,
    )
    if (message) {
      return message
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected RPC response ${id} from Murph.`)
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

async function waitForRpcMethodCount(
  child: MockChildProcess,
  method: string,
  count: number,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const messages = readWrittenRpcMessages(child).filter(
      (candidate) => candidate.method === method,
    )
    if (messages.length >= count) {
      const message = messages[count - 1]
      if (message) {
        return message
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected ${count} RPC ${method} messages from Murph.`)
}

async function waitForProcessKill(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (
      vi.mocked(process.kill).mock.calls.some(
        (call) => call[0] === pid && call[1] === signal,
      )
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected process.kill(${pid}, ${signal}) to be called.`)
}

async function waitForProcessKillWithFakeTimers(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (
      vi.mocked(process.kill).mock.calls.some(
        (call) => call[0] === pid && call[1] === signal,
      )
    ) {
      return
    }
    await vi.advanceTimersByTimeAsync(1)
  }

  throw new Error(`Expected process.kill(${pid}, ${signal}) to be called.`)
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

function codexSandboxPolicyForMode(
  mode: 'danger-full-access' | 'read-only' | 'workspace-write',
): Record<string, unknown> {
  switch (mode) {
    case 'danger-full-access':
      return {
        type: 'dangerFullAccess',
      }
    case 'read-only':
      return {
        networkAccess: false,
        type: 'readOnly',
      }
    case 'workspace-write':
      return {
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: false,
        type: 'workspaceWrite',
        writableRoots: [],
      }
  }
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

function mockProcessGroupSignalsForChildren(children: readonly MockChildProcess[]): void {
  vi.mocked(process.kill).mockImplementation((pid, signal) => {
    const child = children.find((candidate) => pid === -candidate.pid || pid === candidate.pid)
    if (
      child &&
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
}

function mockHostedCodexIdentityServer(children: MockChildProcess[]): void {
  mockProcessGroupSignalsForChildren(children)
  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()
    const processNumber = children.length + 1
    let threadCount = 0
    let turnCount = 0
    child.pid = 40_000 + children.length
    children.push(child)

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
              threadCount += 1
              child.stdout.write(jsonLine({
                id: message.id,
                result: {
                  thread: {
                    id: `thread-warm-identity-${processNumber}-${threadCount}`,
                  },
                },
              }))
              break
            case 'turn/start':
              turnCount += 1
              child.stdout.write(jsonLine({
                id: message.id,
                result: {
                  turn: {
                    id: `turn-warm-identity-${processNumber}-${turnCount}`,
                  },
                },
              }))
              child.stdout.write(jsonLine({
                method: 'turn/completed',
                params: {
                  turn: {
                    id: `turn-warm-identity-${processNumber}-${turnCount}`,
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
}

async function writeWarmTurnStarted(input: {
  child: MockChildProcess
  requestCount: number
  threadId: string
  turnId: string
}): Promise<void> {
  const thread = await waitForRpcMethodCount(
    input.child,
    'thread/start',
    input.requestCount,
  )
  input.child.stdout.write(jsonLine({
    id: thread.id,
    result: {
      thread: {
        id: input.threadId,
      },
    },
  }))

  const turn = await waitForRpcMethodCount(
    input.child,
    'turn/start',
    input.requestCount,
  )
  input.child.stdout.write(jsonLine({
    id: turn.id,
    result: {
      turn: {
        id: input.turnId,
      },
    },
  }))
}

function writeCodexV2AssistantEventTurn(input: {
  child: MockChildProcess
  finalMessage: string
  threadId: string
  turnId: string
}): void {
  const itemId = `message-${input.turnId}`
  input.child.stdout.write(jsonLine({
    method: 'item/agentMessage/delta',
    params: {
      delta: input.finalMessage,
      itemId,
      threadId: input.threadId,
      turnId: input.turnId,
    },
  }))
  input.child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: `status-${input.turnId}`,
        type: 'command_execution',
        command: 'true',
      },
      threadId: input.threadId,
      turnId: input.turnId,
    },
  }))
  input.child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: itemId,
        type: 'agent_message',
        phase: 'final_answer',
        text: input.finalMessage,
      },
      threadId: input.threadId,
      turnId: input.turnId,
    },
  }))
  input.child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      status: 'completed',
      threadId: input.threadId,
      turnId: input.turnId,
    },
  }))
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
