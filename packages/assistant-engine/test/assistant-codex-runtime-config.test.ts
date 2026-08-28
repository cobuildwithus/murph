import {
  MURPH_DYNAMIC_TOOLS,
  MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
  MURPH_DYNAMIC_TOOLS_WITH_COMPUTER,
  MURPH_DYNAMIC_TOOLS_WITH_COMPUTER_WITHOUT_PROGRESS,
  MockChildProcess,
  asRecord,
  codexMocks,
  createDeferred,
  createHostedToolContext,
  createProgressDeliveryMock,
  createTempDir,
  executeCodexAppServerTurn,
  jsonLine,
  readLocalImagePath,
  readTurnStartInputItems,
  readWrittenRpcMessages,
  runCodexResponseMediaToolTurn,
  runCodexTelegramVoiceMemoOnlyTurn,
  runToolAfterNoReply,
  sentProgressResult,
  waitForMockCall,
  waitForRpcMessages,
  waitForRpcMethod,
  waitForRpcMethodCount,
  waitForRpcResponse,
  writeWarmTurnStarted,
} from "./assistant-codex-runtime.harness.ts";

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import {
  MURPH_MEMBER_READ_PERMISSION_PROFILE,
  MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
} from '@murphai/hosted-execution/assistant-permissions'
import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_PROVIDERS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  type HostedAssistantProductModel,
  type HostedAssistantReasoningEffort,
} from '@murphai/hosted-execution/assistant-model'
import {
  initializeVault,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePort,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
  buildCodexThreadResumeParams,
  buildCodexThreadStartParams,
  buildCodexTurnStartParams,
  type CodexAppServerInputItem,
} from '../src/assistant-codex/app-server-requests.ts'
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
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'

describe('assistant codex runtime', () => {
  it('runs RPC timeout cleanup only when the timeout wins', async () => {
    vi.useFakeTimers()
    try {
      const timedOutCleanup = vi.fn()
      const timedOutRequest = withCodexRpcTimeout(
        new Promise<never>(() => undefined),
        25,
        'subagent thread/resume',
        timedOutCleanup,
      )
      const timeoutExpectation = expect(timedOutRequest).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APP_SERVER_TIMEOUT',
      })

      await vi.advanceTimersByTimeAsync(25)
      await timeoutExpectation
      expect(timedOutCleanup).toHaveBeenCalledOnce()

      const completedCleanup = vi.fn()
      await expect(withCodexRpcTimeout(
        Promise.resolve('metadata'),
        25,
        'subagent thread/resume',
        completedCleanup,
      )).resolves.toBe('metadata')
      expect(completedCleanup).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

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
        images: [{ path: '/tmp/steer-image.png' }],
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
      approvalPolicy: 'never' as const,
      baseInstructions: 'Do not use this in normal Murph config.',
      developerInstructions: 'Stable Murph instructions.',
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
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
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      sandbox: 'workspace-write',
      serviceName: 'murph',
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        environments: [],
      }),
    ).toMatchObject({
      environments: [],
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
        threadConfig: {
          'features.shell_tool': false,
        },
      }),
    ).toMatchObject({
      config: {
        'features.shell_tool': false,
      },
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
      }),
    ).toMatchObject({
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        dynamicTools: MURPH_DYNAMIC_TOOLS,
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
        dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_COMPUTER_WITHOUT_PROGRESS,
        hostedToolContext: createHostedToolContext(),
      }),
    ).toMatchObject({
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_COMPUTER_WITHOUT_PROGRESS,
    })
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_COMPUTER,
        hostedToolContext: createHostedToolContext(),
        progressDelivery: {
          async send() {
            return sentProgressResult()
          },
        },
      }),
    ).toMatchObject({
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITH_COMPUTER,
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
          threadConfig: {
            'features.shell_tool': false,
          },
        },
        codexThreadId: 'thread-restricted-resume',
      }),
    ).toEqual({
      approvalPolicy: 'never',
      config: {
        'features.shell_tool': false,
      },
      cwd: '/workspace',
      excludeTurns: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      sandbox: 'workspace-write',
      threadId: 'thread-restricted-resume',
    })
    expect(
      buildCodexThreadResumeParams({
        input: {
          ...baseInput,
          dynamicTools: MURPH_DYNAMIC_TOOLS,
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
    expect(
      buildCodexThreadResumeParams({
        input: {
          ...baseInput,
          permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
          runtimeWorkspaceRoots: ['/workspace'],
          sandbox: undefined,
        },
        codexThreadId: 'thread-member-workspace',
      }),
    ).toEqual({
      approvalPolicy: 'never',
      cwd: '/workspace',
      excludeTurns: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
      runtimeWorkspaceRoots: ['/workspace'],
      threadId: 'thread-member-workspace',
    })

    const turnStart = buildCodexTurnStartParams({
      images: [],
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
      model: 'gpt-5',
      serviceTier: null,
      threadId: 'thread-1',
    })
    const firstInputItem = (turnStart.input as CodexAppServerInputItem[])[0]
    expect(firstInputItem?.type === 'text' ? firstInputItem.text : '').not.toContain(
      'Stable Murph instructions.',
    )
    expect(
      buildCodexTurnStartParams({
        images: [],
        input: {
          ...baseInput,
          serviceTier: 'flex',
        },
        codexThreadId: 'thread-1',
      }),
    ).toMatchObject({
      serviceTier: 'flex',
      threadId: 'thread-1',
    })

    expect(
      buildCodexTurnStartParams({
        images: [],
        input: baseInput,
        codexThreadId: 'thread-1',
      }),
    ).toMatchObject({
      serviceTier: null,
      threadId: 'thread-1',
    })

    const outputSchema = {
      properties: {
        answer: { type: 'string' },
      },
      type: 'object',
    }
    expect(
      buildCodexThreadStartParams({
        ...baseInput,
        ephemeral: true,
        permissions: 'murph-group-read',
        runtimeWorkspaceRoots: ['/group-vault'],
        sandbox: undefined,
        threadConfig: {
          project_doc_max_bytes: 0,
          'features.multi_agent_v2': false,
        },
      }),
    ).toEqual({
      approvalPolicy: 'never',
      baseInstructions: 'Do not use this in normal Murph config.',
      config: {
        project_doc_max_bytes: 0,
        'features.multi_agent_v2': false,
      },
      cwd: '/workspace',
      developerInstructions: 'Stable Murph instructions.',
      dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
      ephemeral: true,
      model: 'gpt-5',
      modelProvider: 'vercel-ai-gateway',
      permissions: 'murph-group-read',
      runtimeWorkspaceRoots: ['/group-vault'],
      serviceName: 'murph',
    })
    expect(
      buildCodexTurnStartParams({
        images: [],
        input: {
          ...baseInput,
          outputSchema,
        },
        codexThreadId: 'thread-structured',
      }),
    ).toMatchObject({
      outputSchema,
      threadId: 'thread-structured',
    })
    expect(() =>
      buildCodexThreadStartParams({
        ...baseInput,
        permissions: 'murph-group-read',
        runtimeWorkspaceRoots: ['/group-vault'],
      }),
    ).toThrowError(
      'Codex app-server requests cannot combine named permissions with a legacy sandbox.',
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

  it.each([
    {
      expectedImageDetail: 'original',
      model: 'gpt-5.6-luna',
      modelProvider: 'openai',
      providerRequestOrdinal: 0,
    },
    {
      expectedImageDetail: 'original',
      model: 'gpt-5.6-terra',
      modelProvider: 'openai',
      providerRequestOrdinal: 1,
    },
    {
      expectedImageDetail: 'original',
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      providerRequestOrdinal: 2,
    },
    {
      expectedImageDetail: 'high',
      model: 'gpt-5.2',
      modelProvider: 'openai',
      providerRequestOrdinal: 3,
    },
    {
      expectedImageDetail: 'high',
      model: 'member-model',
      modelProvider: 'hosted-custom-inference',
      providerRequestOrdinal: 4,
    },
  ] as const)(
    'executes Codex app-server turns for $modelProvider at provider ordinal $providerRequestOrdinal',
    async ({
      expectedImageDetail,
      model,
      modelProvider,
      providerRequestOrdinal,
    }) => {
    const workingDirectory = await createTempDir('assistant-codex-workdir-')
    const codexHome = await createTempDir('assistant-codex-home-')
    const threadId = '00000000-0000-4000-8000-000000000001'
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff])
    const onProgress = vi.fn()
    const onProviderRequestStarted = vi.fn()
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
              dynamicTools: MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
              model,
              modelProvider,
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
              model,
              serviceTier: null,
              threadId,
            },
          })
          expect(asRecord(turnStart.params).approvalPolicy).toBeUndefined()
          expect(asRecord(turnStart.params).cwd).toBeUndefined()
          expect(asRecord(turnStart.params).modelProvider).toBeUndefined()
          expect(asRecord(turnStart.params).sandboxPolicy).toBeUndefined()
          const inputItems = readTurnStartInputItems(turnStart)
          expect(inputItems[0]).toEqual({
            type: 'text',
            text: 'Explain this',
          })
          expect(inputItems[1]).toMatchObject({
            detail: expectedImageDetail,
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
                      url: 'http://cdn.example.test/assistant/not-https.png',
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
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: '{"error":"invalid_response_media_arguments","validationIssues":[{"code":"custom","message":"Assistant response media URLs must be valid public HTTPS image URLs.","params":{"murphExpectedShape":"public_https_image_url"},"path":["media",0,"url"]}]}',
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
          messages = await waitForRpcMessages(child, 6)
          expect(messages[5]).toEqual({
            id: 18,
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
          child.stderr.write('Retrying after timeout\n')
          child.stdout.write(
            jsonLine({
              method: 'item/started',
              params: {
                item: {
                  id: 'command-1',
                  type: 'commandExecution',
                  command: 'pwd',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/agentMessage/delta',
              params: {
                delta: 'Hello ',
                itemId: 'assistant-1',
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-1',
                  type: 'agentMessage',
                  text: 'Hello world',
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
                  type: 'commandExecution',
                  command: 'pwd',
                  exitCode: 0,
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
        cwd: tmpdir(),
        env: {
          CODEX_HOME: codexHome,
          [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
            '/opt/murph/codex-model-catalog.openai-flex.json',
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
          [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
            '/opt/murph/codex-model-catalog.openai-flex.json',
          NODE_V8_COVERAGE: '/coverage',
          PATH: '/custom/bin',
        },
        images: [
          {
            bytes: imageBytes,
            detail: 'original',
            mimeType: 'image/jpeg',
          },
        ],
        onProgress,
        onProviderRequestStarted,
        onTraceEvent,
        approvalPolicy: 'never',
        configOverrides: [`model="${model}"`],
        model,
        modelProvider,
        reasoningEffort: 'high',
        providerRequestOrdinal,
        providerStartCriticalPath: {
          assistantPhaseStartedAtMonotonicMs: 0,
          assistantServiceStartedAtMonotonicMs: 0,
          assistantTurnLockAcquiredAtMonotonicMs: 0,
          assistantTurnLockWaitStartedAtMonotonicMs: 0,
          automationLaneStartedAtMonotonicMs: 0,
          mailboxImportDoneAtMonotonicMs: 0,
          preProviderSetupDoneAtMonotonicMs: 0,
        },
        prompt: 'Explain this',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Hello world',
      responseDeliveryContextOrdinal: 0,
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
      transcriptMessage: 'Hello world',
      turnId: 'turn-1',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      [
        '--config',
        `model="${model}"`,
        '--config',
        'model_catalog_json="/opt/murph/codex-model-catalog.openai-flex.json"',
        'app-server',
      ],
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
    const turnCompletedTiming = onTraceEvent.mock.calls
      .map(([event]) => event?.rawEvent)
      .find((event) =>
        event?.type === 'assistant.codex.app_server_timing' &&
        event.codexTimingStage === 'turn-completed'
      )
    expect(turnCompletedTiming).toEqual(expect.objectContaining({
      codexTimingProviderRequestOrdinal: providerRequestOrdinal,
      codexTimingTurnCompleteElapsedMs: expect.any(Number),
      codexTimingTurnCompletedNotificationElapsedMs: expect.any(Number),
      codexTimingTurnStartAckElapsedMs: expect.any(Number),
      codexTimingTurnStartedNotificationElapsedMs: expect.any(Number),
      schema: 'murph.assistant-codex-app-server-timing.v1',
      type: 'assistant.codex.app_server_timing',
    }))
    expect(onTraceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEvent: expect.objectContaining({
          ...(providerRequestOrdinal === 0
            ? { codexTimingColdStartReason: 'node-process-first-use' }
            : {}),
          codexTimingStage: 'initialized',
        }),
        updates: [],
      }),
    )
    expect(onProviderRequestStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        codexAppServerInitializeMs: expect.any(Number),
        codexAppServerPreProviderMs: expect.any(Number),
        codexAppServerSpawnReadyMs: expect.any(Number),
        codexAppServerThreadStartMs: expect.any(Number),
        startedAt: expect.any(String),
      }),
    )
    const providerStartEvent = onProviderRequestStarted.mock.calls[0]?.[0]
    if (providerRequestOrdinal === 0) {
      expect(providerStartEvent).toMatchObject({
        providerStartCriticalPath: {
          assistantServicePreLockMs: expect.any(Number),
          automationLaneToAssistantServiceMs: expect.any(Number),
          codexAppServerPreProviderMs: expect.any(Number),
          codexProcessPreparationMs: expect.any(Number),
          mailboxImportDoneToAssistantPhaseMs: expect.any(Number),
          preProviderSetupMs: expect.any(Number),
          providerPlanAndGateMs: expect.any(Number),
          turnLockWaitMs: expect.any(Number),
          workspaceAssistantPreAutomationMs: expect.any(Number),
        },
      })
    } else {
      expect(providerStartEvent).not.toHaveProperty('providerStartCriticalPath')
    }
    },
  )

  it('starts cold and warm App Server turns before any lazy shared-data read', async () => {
    const workingDirectory = await createTempDir('assistant-codex-group-shared-work-')
    const codexHome = await createTempDir('assistant-codex-group-shared-home-')
    const threadId = 'thread-group-shared-lazy-read'
    const boundaryObservations: Array<{
      providerStarts: number
      rpcMethod: 'thread/start' | 'thread/resume' | 'turn/start'
      sharedReaderCalls: number
    }> = []
    const executionOrder: string[] = []
    let providerStartOrdinal = 0
    let sharedReaderOrdinal = 0
    let turnStartOrdinal = 0
    const onProviderRequestStarted = vi.fn(() => {
      providerStartOrdinal += 1
      executionOrder.push(`provider-started:${providerStartOrdinal}`)
    })
    const groupSharedRead = vi.fn(async () => {
      sharedReaderOrdinal += 1
      executionOrder.push(`shared-reader:${sharedReaderOrdinal}`)
      return {
        members: [] as const,
        requestedProjectionScopeKeys: ['steps-days.v0'],
        status: 'none' as const,
      }
    })
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext({ computerToolsAvailable: false }),
      groupSharedReader: { request: groupSharedRead },
    }
    const dynamicTools = resolveMurphDynamicTools({
      groupSharedReadAvailable: true,
      progressUpdatesAvailable: false,
    })

    const observeBoundary = (
      rpcMethod: 'thread/start' | 'thread/resume' | 'turn/start',
    ) => {
      boundaryObservations.push({
        providerStarts: onProviderRequestStarted.mock.calls.length,
        rpcMethod,
        sharedReaderCalls: groupSharedRead.mock.calls.length,
      })
    }

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      child.stdin.onWrite = (write) => {
        for (const line of write.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) {
            continue
          }
          const message = asRecord(JSON.parse(trimmed))
          if (message.method === 'turn/start') {
            turnStartOrdinal += 1
            executionOrder.push(`turn-start:${turnStartOrdinal}`)
            observeBoundary('turn/start')
          }
        }
      }

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const runTurn = async (input: {
            threadMethod: 'thread/start' | 'thread/resume'
            turnOrdinal: number
          }) => {
            const threadRequest = await waitForRpcMethod(
              child,
              input.threadMethod,
            )
            observeBoundary(input.threadMethod)
            const threadParams = asRecord(threadRequest.params)
            child.stdout.write(jsonLine({
              id: threadRequest.id,
              result: {
                ...(input.threadMethod === 'thread/resume'
                  ? {
                      approvalPolicy: threadParams.approvalPolicy,
                      cwd: threadParams.cwd,
                    }
                  : {}),
                thread: { id: threadId },
              },
            }))

            const turnStart = await waitForRpcMethodCount(
              child,
              'turn/start',
              input.turnOrdinal,
            )
            await waitForMockCall(
              onProviderRequestStarted,
              input.turnOrdinal,
            )

            const turnId = `turn-group-shared-${input.turnOrdinal}`
            child.stdout.write(jsonLine({
              id: turnStart.id,
              result: { turn: { id: turnId } },
            }))
            child.stdout.write(jsonLine({
              method: 'turn/started',
              params: { turn: { id: turnId } },
            }))

            const toolCallId = 70 + input.turnOrdinal
            child.stdout.write(jsonLine({
              id: toolCallId,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'group',
                arguments: {
                  action: 'read_shared',
                  projectionScopes: [{ projectionKind: 'steps-days.v0' }],
                },
                turnId,
              },
            }))
            await expect(waitForRpcResponse(child, toolCallId)).resolves.toEqual({
              id: toolCallId,
              result: {
                success: true,
                contentItems: [{
                  type: 'inputText',
                  text: JSON.stringify({
                    action: 'read_shared',
                    result: {
                      members: [],
                      requestedProjectionScopeKeys: ['steps-days.v0'],
                      status: 'none',
                    },
                  }),
                }],
              },
            })

            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                turn: { id: turnId, status: 'completed' },
              },
            }))
          }

          await runTurn({ threadMethod: 'thread/start', turnOrdinal: 1 })
          await runTurn({ threadMethod: 'thread/resume', turnOrdinal: 2 })
        })()
      })

      return child
    })

    const env = {
      CODEX_HOME: codexHome,
      MURPH_HOSTED_RUNTIME_PROCESS: '1',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    }

    await expect(executeCodexAppServerTurn({
      dynamicTools,
      env,
      hostedToolContext,
      onProviderRequestStarted,
      prompt: 'Check shared steps.',
      workingDirectory,
    })).resolves.toMatchObject({
      sessionId: threadId,
      turnId: 'turn-group-shared-1',
    })

    await expect(executeCodexAppServerTurn({
      dynamicTools,
      env,
      hostedToolContext,
      onProviderRequestStarted,
      prompt: 'Check shared steps again.',
      resumeSessionId: threadId,
      workingDirectory,
    })).resolves.toMatchObject({
      sessionId: threadId,
      turnId: 'turn-group-shared-2',
    })

    expect(boundaryObservations).toEqual([
      {
        providerStarts: 0,
        rpcMethod: 'thread/start',
        sharedReaderCalls: 0,
      },
      {
        providerStarts: 0,
        rpcMethod: 'turn/start',
        sharedReaderCalls: 0,
      },
      {
        providerStarts: 1,
        rpcMethod: 'thread/resume',
        sharedReaderCalls: 1,
      },
      {
        providerStarts: 1,
        rpcMethod: 'turn/start',
        sharedReaderCalls: 1,
      },
    ])
    expect(executionOrder).toEqual([
      'turn-start:1',
      'provider-started:1',
      'shared-reader:1',
      'turn-start:2',
      'provider-started:2',
      'shared-reader:2',
    ])
    expect(groupSharedRead).toHaveBeenCalledTimes(2)
    expect(groupSharedRead).toHaveBeenNthCalledWith(1, {
      projectionScopes: [{ projectionKind: 'steps-days.v0' }],
    })
    expect(groupSharedRead).toHaveBeenNthCalledWith(2, {
      projectionScopes: [{ projectionKind: 'steps-days.v0' }],
    })
    expect(codexMocks.spawn).toHaveBeenCalledTimes(1)
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

  it('keeps Telegram voice memo media attached to an empty final response', async () => {
    await expect(runCodexTelegramVoiceMemoOnlyTurn()).resolves.toMatchObject({
      finalMessage: '',
      responseDeliveryContextOrdinal: 0,
      responseMedia: [
        {
          filename: expect.stringMatching(/^voice-memo-.+\.mp3$/u),
          kind: 'voice_memo',
          transport: {
            generation: {
              kind: 'elevenlabs_speech',
              modelId: 'eleven_multilingual_v2',
              outputFormat: 'mp3_44100_128',
              text: 'Voice-only reply.',
              voiceId: 'voice_murph',
            },
            kind: 'telegram_generation',
          },
        },
      ],
      transcriptMessage: '',
    })
  })

  it('keeps commentary internal for a voice-only response', async () => {
    const commentaryText = 'I’ll record that now.'
    const progressDelivery = createProgressDeliveryMock()

    const result = await runCodexTelegramVoiceMemoOnlyTurn({
      commentaryText,
      progressDelivery,
    })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('')
    expect(result.responseMedia).toEqual([
      expect.objectContaining({
        kind: 'voice_memo',
      }),
    ])
  })

  it('keeps a steered voice-only response in the current response segment', async () => {
    const commentaryText = 'I’ll record that now.'
    const precedingFinalText = 'Earlier answer.'
    const progressDelivery = createProgressDeliveryMock()

    const result = await runCodexTelegramVoiceMemoOnlyTurn({
      commentaryText,
      precedingFinalText,
      progressDelivery,
    })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: precedingFinalText,
        media: [],
      },
    ])
    expect(result.responseMedia).toEqual([
      expect.objectContaining({
        kind: 'voice_memo',
      }),
    ])
  })

  it('applies overlapping dynamic media tools in request order', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-order-work-')
    const vaultRoot = await createTempDir('assistant-codex-image-order-vault-')
    await initializeVault({ vaultRoot })
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
                  type: 'agentMessage',
                  text: 'Ordered media complete',
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
        hostedToolContext: createHostedToolContext({
          computerToolsAvailable: false,
        }),
        prompt: 'generate then clear media',
        requireHostedPrivateImageDelivery: true,
        vaultRoot,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Ordered media complete',
      responseMedia: [],
      additionalUsages: [
        { provider: 'openai-images' },
      ],
    })
  })

  it('applies overlapping assistant configuration updates in request order', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-configuration-order-work-',
    )
    const firstUpdateStarted = createDeferred<void>()
    const releaseFirstUpdate = createDeferred<void>()
    const configurationCalls: string[] = []
    let savedModel: HostedAssistantProductModel = HOSTED_ASSISTANT_TERRA_MODEL
    let savedReasoningEffort: HostedAssistantReasoningEffort = 'low'
    let updateCount = 0

    const configurationSnapshot = () => ({
      availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
      availableProviders: [...HOSTED_ASSISTANT_PROVIDERS],
      availableReasoningEfforts: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
      configurationAvailable: true,
      dormantSolPreference: false,
      model: savedModel,
      provider: "openai" as const,
      reasoningEffort: savedReasoningEffort,
      solAvailable: true,
    })
    const assistantConfigurationTool: NonNullable<
      AssistantHostedToolContext['assistantConfigurationTool']
    > = {
      async request(request) {
        if (request.action === 'read') {
          configurationCalls.push(`read:${savedModel}`)
          return {
            action: 'read',
            result: configurationSnapshot(),
          }
        }

        updateCount += 1
        configurationCalls.push(`update:${request.model ?? savedModel}`)
        if (updateCount === 1) {
          firstUpdateStarted.resolve()
          await releaseFirstUpdate.promise
        }
        savedModel = request.model ?? savedModel
        savedReasoningEffort = request.reasoningEffort ?? savedReasoningEffort
        return {
          action: 'update',
          result: {
            ...configurationSnapshot(),
            appliesAt: 'next_turn',
            requiredPlan: null,
            status: 'updated',
          },
        }
      },
    }
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext(),
      assistantConfigurationTool,
      currentAssistantInputId: () => `ain_${'a'.repeat(32)}`,
      currentAssistantTarget: () => ({
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        provider: "openai",
        reasoningEffort: 'low',
      }),
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
            result: { thread: { id: 'thread-configuration-order' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-configuration-order' } },
          }))
          child.stdout.write(jsonLine({
            id: 71,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'update',
                model: HOSTED_ASSISTANT_SOL_MODEL,
              },
              namespace: 'murph',
              tool: 'assistant_configuration',
            },
          }))
          child.stdout.write(jsonLine({
            id: 72,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'update',
                model: HOSTED_ASSISTANT_TERRA_MODEL,
              },
              namespace: 'murph',
              tool: 'assistant_configuration',
            },
          }))

          await firstUpdateStarted.promise
          try {
            expect(configurationCalls).toEqual([
              `update:${HOSTED_ASSISTANT_SOL_MODEL}`,
            ])
          } finally {
            releaseFirstUpdate.resolve()
          }

          const messages = await waitForRpcMessages(child, 6)
          expect(messages[4]).toMatchObject({
            id: 71,
            result: { success: true },
          })
          expect(messages[5]).toMatchObject({
            id: 72,
            result: { success: true },
          })
          expect(configurationCalls).toEqual([
            `update:${HOSTED_ASSISTANT_SOL_MODEL}`,
            `update:${HOSTED_ASSISTANT_TERRA_MODEL}`,
          ])

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-configuration-order',
                text: 'Configuration updates complete',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-configuration-order',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      env: { OPENAI_API_KEY: 'openai-test-key' },
      hostedToolContext,
      prompt: 'switch to Sol, then back to Terra',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: 'Configuration updates complete',
    })
    expect(savedModel).toBe(HOSTED_ASSISTANT_TERRA_MODEL)
  })

  it('allows only the first overlapping subscription action in a provider turn', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-subscription-order-work-',
    )
    const firstRequestStarted = createDeferred<void>()
    const releaseFirstRequest = createDeferred<void>()
    const subscriptionCalls: string[] = []
    const subscriptionTool: NonNullable<
      AssistantHostedToolContext['subscriptionTool']
    > = {
      async request(request) {
        subscriptionCalls.push(request.action)
        if (subscriptionCalls.length === 1) {
          firstRequestStarted.resolve()
          await releaseFirstRequest.promise
        }

        return request.action === 'upgrade_edge'
          ? {
              action: request.action,
              plan: {
                code: 'launch_edge_monthly',
                displayName: 'Edge',
                interval: 'month',
                recurringAmountUsdCents: 2_000,
              },
              status: 'completed',
            }
          : {
              action: request.action,
              plan: {
                code: 'launch_monthly',
                displayName: 'Pulse',
                interval: 'month',
                recurringAmountUsdCents: 800,
              },
              status: 'completed',
            }
      },
    }
    let subscriptionActionClaimed = false
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext(),
      claimSubscriptionAssistantInputId: () => {
        if (subscriptionActionClaimed) {
          return null
        }
        subscriptionActionClaimed = true
        return `ain_${'b'.repeat(32)}`
      },
      subscriptionTool,
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
            result: { thread: { id: 'thread-subscription-order' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-subscription-order' } },
          }))
          child.stdout.write(jsonLine({
            id: 73,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'start_pulse_now' },
              namespace: 'murph',
              tool: 'subscription',
            },
          }))
          child.stdout.write(jsonLine({
            id: 74,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'upgrade_edge' },
              namespace: 'murph',
              tool: 'subscription',
            },
          }))

          await firstRequestStarted.promise
          try {
            expect(subscriptionCalls).toEqual(['start_pulse_now'])
          } finally {
            releaseFirstRequest.resolve()
          }

          const messages = await waitForRpcMessages(child, 6)
          expect(messages[4]).toMatchObject({
            id: 73,
            result: { success: true },
          })
          expect(messages[5]).toMatchObject({
            id: 74,
            result: { success: false },
          })
          expect(subscriptionCalls).toEqual(['start_pulse_now'])

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-subscription-order',
                text: 'Subscription actions complete',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-subscription-order',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      dynamicTools: resolveMurphDynamicTools({
        progressUpdatesAvailable: false,
        subscriptionAvailable: true,
      }),
      env: { OPENAI_API_KEY: 'openai-test-key' },
      hostedToolContext,
      prompt: 'start Pulse, then upgrade to Edge',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: 'Subscription actions complete',
    })
  })

  const computerPauseFinalMessageScenarios = [
    {
      expectedFinalMessage: 'Paused for confirmation.',
      modelMessage: 'Paused for confirmation.',
      name: 'does not append an omitted handoff URL',
    },
    {
      expectedFinalMessage:
        'Open the secure checkout: https://web.example.test/computer/handoff/raw-token',
      modelMessage:
        'Open the secure checkout: https://web.example.test/computer/handoff/raw-token',
      name: 'preserves a model-supplied handoff URL',
    },
  ] as const

  const runComputerPauseFinalMessageScenario = async (
    scenario: (typeof computerPauseFinalMessageScenarios)[number],
  ): Promise<void> => {
    const workingDirectory = await createTempDir('assistant-codex-computer-order-work-')
    const releaseAct = createDeferred<void>()
    const actStarted = createDeferred<void>()
    const fetchOrder: string[] = []
    const hostedToolContext = createHostedToolContext()
    const progressDelivery = createProgressDeliveryMock(sentProgressResult())
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestUrl = String(url)
      if (requestUrl.endsWith('/act')) {
        fetchOrder.push('act:start')
        actStarted.resolve()
        await releaseAct.promise
        fetchOrder.push('act:end')
        return new Response(JSON.stringify({
          result: null,
          title: 'Checkout',
          url: 'https://shop.example.test/checkout',
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      if (requestUrl.endsWith('/pause-for-user')) {
        fetchOrder.push('pause')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          handoffPurpose: 'manual_browser_help',
          reason: 'final_confirmation',
        })
        return new Response(JSON.stringify({
          awaitingReason: 'final_confirmation',
          handoffUrl: 'https://web.example.test/computer/handoff/raw-token',
          runId: 'run_123',
          status: 'awaiting_user',
          suggestedReply: 'yes',
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      throw new Error(`Unexpected fetch URL: ${requestUrl}`)
    })

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
                  id: 'thread-computer-order',
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
                  id: 'turn-computer-order',
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
                tool: 'computer_act',
                arguments: {
                  code: "await page.goto('https://shop.example.test/checkout');",
                  runId: 'run_123',
                  timeoutMs: 25000,
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
                tool: 'computer_pause_for_user',
                arguments: {
                  handoffPurpose: 'manual_browser_help',
                  reason: 'final_confirmation',
                  runId: 'run_123',
                  suggestedReply: 'done',
                },
              },
            }),
          )

          await actStarted.promise
          await Promise.resolve()
          expect(fetchOrder).toEqual(['act:start'])
          releaseAct.resolve()

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
                  id: 'assistant-computer-order',
                  type: 'agentMessage',
                  text: scenario.modelMessage,
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-computer-order',
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
        fetchImpl,
        hostedToolContext,
        progressDelivery,
        prompt: 'navigate then pause',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: scenario.expectedFinalMessage,
    })
    expect(fetchOrder).toEqual(['act:start', 'act:end', 'pause'])
  }

  it.each(computerPauseFinalMessageScenarios)(
    'serializes overlapping computer tools and $name',
    runComputerPauseFinalMessageScenario,
  )

  it('closes live steering before saving a computer pause', async () => {
    const workingDirectory = await createTempDir('assistant-codex-computer-pause-live-turn-work-')
    const pauseRequestStarted = createDeferred<void>()
    const releasePauseRequest = createDeferred<void>()
    const liveTurnReady = createDeferred<void>()
    let liveTurn: CodexAppServerLiveTurn | null = null
    let liveTurnReleased = 0

    const progressDelivery = createProgressDeliveryMock()
    const hostedToolContext = createHostedToolContext()
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestUrl = String(url)
      if (!requestUrl.endsWith('/pause-for-user')) {
        throw new Error(`Unexpected fetch URL: ${requestUrl}`)
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({
        handoffPurpose: 'manual_browser_help',
        reason: 'final_confirmation',
      })
      pauseRequestStarted.resolve()
      await releasePauseRequest.promise
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
                  id: 'thread-computer-pause-live-turn',
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
                  id: 'turn-computer-pause-live-turn',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/started',
              params: {
                turn: {
                  id: 'turn-computer-pause-live-turn',
                },
              },
            }),
          )
          await liveTurnReady.promise
          child.stdout.write(
            jsonLine({
              id: 61,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'computer_pause_for_user',
                arguments: {
                  handoffPurpose: 'manual_browser_help',
                  reason: 'final_confirmation',
                  runId: 'run_123',
                  suggestedReply: 'yes',
                },
              },
            }),
          )

          await pauseRequestStarted.promise
          try {
            expect(liveTurnReleased).toBe(1)
            expect(liveTurn).not.toBeNull()
            await expect(liveTurn!.steer({
              prompt: 'yes, continue while pause is saving',
            })).rejects.toMatchObject({
              code: 'ASSISTANT_CODEX_APP_SERVER_LIVE_TURN_INACTIVE',
            })
          } finally {
            releasePauseRequest.resolve()
          }

          await expect(waitForRpcResponse(child, 61)).resolves.toMatchObject({
            id: 61,
            result: { success: true },
          })
          expect(
            readWrittenRpcMessages(child).some((message) =>
              message.method === 'turn/steer'
            ),
          ).toBe(false)

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-computer-pause-live-turn',
                  type: 'agentMessage',
                  text: 'Paused for confirmation.',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-computer-pause-live-turn',
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
        fetchImpl,
        hostedToolContext,
        onLiveTurn: (turn) => {
          liveTurn = turn
          liveTurnReady.resolve()
          return () => {
            liveTurnReleased += 1
          }
        },
        progressDelivery,
        prompt: 'pause for confirmation',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Paused for confirmation.',
    })
    expect(liveTurnReleased).toBe(1)
  })

  it('clears an earlier no-reply and rejects overlapping and later ones after a computer pause', async () => {
    const workingDirectory = await createTempDir('assistant-codex-computer-pause-no-reply-work-')
    const progressDelivery = createProgressDeliveryMock()
    const hostedToolContext = createHostedToolContext()
    const onFinishWithoutReplyAccepted = vi.fn()
    const onFinishWithoutReplyRecorded = vi.fn()
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        'http://web-control.worker/api/internal/computer/runs/run_123/pause-for-user',
      )
      expect(JSON.parse(String(init?.body))).toEqual({
        handoffPurpose: 'manual_browser_help',
        pauseDeliveryContext: null,
        reason: 'final_confirmation',
        suggestedReply: 'done',
      })
      return new Response(JSON.stringify({
        awaitingReason: 'final_confirmation',
        handoffUrl: 'https://web.example.test/computer/handoff/raw-token',
        runId: 'run_123',
        status: 'awaiting_user',
        suggestedReply: 'done',
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })

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
                  id: 'thread-computer-pause-no-reply',
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
                  id: 'turn-computer-pause-no-reply',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              id: 59,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'finish_without_reply',
                arguments: {},
              },
            }),
          )
          await expect(waitForRpcResponse(child, 59)).resolves.toMatchObject({
            id: 59,
            result: { success: true },
          })

          child.stdout.write([
            jsonLine({
              id: 60,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'finish_without_reply',
                arguments: {},
              },
            }),
            jsonLine({
              id: 61,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'computer_pause_for_user',
                arguments: {
                  handoffPurpose: 'manual_browser_help',
                  reason: 'final_confirmation',
                  runId: 'run_123',
                  suggestedReply: 'done',
                },
              },
            }),
          ].join(''))
          await expect(waitForRpcResponse(child, 60)).resolves.toMatchObject({
            id: 60,
            result: { success: false },
          })
          await expect(waitForRpcResponse(child, 61)).resolves.toMatchObject({
            id: 61,
            result: { success: true },
          })

          child.stdout.write(
            jsonLine({
              id: 62,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'computer_act',
                arguments: {
                  code: "await page.getByRole('button', { name: 'Place your order' }).click();",
                  runId: 'run_123',
                  timeoutMs: 25000,
                },
              },
            }),
          )
          await expect(waitForRpcResponse(child, 62)).resolves.toEqual({
            id: 62,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'computer run is paused for user input; end this turn and wait for the next user reply',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              id: 63,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'finish_without_reply',
                arguments: {},
              },
            }),
          )
          await expect(waitForRpcResponse(child, 63)).resolves.toEqual({
            id: 63,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'finish_without_reply is unavailable after pausing a computer run for the user',
                },
              ],
            },
          })

          child.stdout.write(
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-computer-pause-no-reply',
                  type: 'agentMessage',
                  text:
                    'Open the secure checkout: https://web.example.test/computer/handoff/raw-token',
                },
              },
            }),
          )
          child.stdout.write(
            jsonLine({
              method: 'turn/completed',
              params: {
                turn: {
                  id: 'turn-computer-pause-no-reply',
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
        fetchImpl,
        hostedToolContext,
        onFinishWithoutReplyAccepted,
        onFinishWithoutReplyRecorded,
        progressDelivery,
        prompt: 'pause for confirmation',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [],
      finalAction: null,
      finalMessage:
        'Open the secure checkout: https://web.example.test/computer/handoff/raw-token',
      responseDeliveryContextOrdinal: 0,
      transcriptMessage:
        'Open the secure checkout: https://web.example.test/computer/handoff/raw-token',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(onFinishWithoutReplyAccepted).not.toHaveBeenCalled()
    expect(onFinishWithoutReplyRecorded).not.toHaveBeenCalled()
  })

  const vaultApprovalUrlScenarios = [
    {
      expectedFinalMessage: `Approval is required.\n\nhttps://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`,
      expectedTranscriptMessage: 'Approval is required.',
      name: 'appends the exact owner URL outside model context',
      noReplyBeforeApproval: 'none',
    },
    {
      expectedFinalMessage: `https://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`,
      expectedTranscriptMessage: null,
      name: 'overrides an earlier no-reply selection',
      noReplyBeforeApproval: 'applied',
    },
    {
      expectedFinalMessage: `https://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`,
      expectedTranscriptMessage: null,
      name: 'overrides an in-flight no-reply reservation',
      noReplyBeforeApproval: 'reserved',
    },
    {
      approvalCount: 2,
      expectedFinalMessage: [
        'Approval is required.',
        `https://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`,
        `https://www.withmurph.ai/approve/haa_${'b'.repeat(32)}`,
      ].join('\n\n'),
      expectedTranscriptMessage: 'Approval is required.',
      name: 'preserves every exact owner URL when multiple vault approvals are pending',
      noReplyBeforeApproval: 'none',
    },
  ] as const

  async function runVaultApprovalUrlScenario(
    scenario: (typeof vaultApprovalUrlScenarios)[number],
  ): Promise<void> {
    const workingDirectory = await createTempDir('assistant-codex-vault-approval-url-work-')
    const approvalCount = 'approvalCount' in scenario ? scenario.approvalCount : 1
    const exactApprovalUrls = [
      `https://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`,
      `https://www.withmurph.ai/approve/haa_${'b'.repeat(32)}`,
    ].slice(0, approvalCount)
    let nextApprovalIndex = 0
    const onFinishWithoutReplyAccepted = vi.fn()
    const onFinishWithoutReplyRecorded = vi.fn()
    const sendVaultFile = vi.fn(async (
      _ref: string,
      _toolCallId?: string | null,
    ) => {
      const approvalUrl = exactApprovalUrls[nextApprovalIndex]
      if (!approvalUrl) {
        throw new Error('Unexpected vault approval request.')
      }
      nextApprovalIndex += 1
      return {
        approvalUrl,
        filename: `report-${nextApprovalIndex}.pdf`,
        status: 'pending' as const,
      }
    })
    const hostedToolContext = createHostedToolContext({
      computerToolsAvailable: false,
      sendVaultFile,
      vaultFileSendAvailable: true,
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: { thread: { id: 'thread-vault-approval-url' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-vault-approval-url' } },
          }))

          let pendingNoReplyResponse: Promise<unknown> | null = null
          if (scenario.noReplyBeforeApproval !== 'none') {
            child.stdout.write(jsonLine({
              id: 70,
              method: 'item/tool/call',
              params: {
                arguments: {},
                namespace: 'murph',
                tool: 'finish_without_reply',
              },
            }))
            pendingNoReplyResponse = waitForRpcResponse(child, 70)
            if (scenario.noReplyBeforeApproval === 'applied') {
              await expect(pendingNoReplyResponse).resolves.toMatchObject({
                id: 70,
                result: { success: true },
              })
              pendingNoReplyResponse = null
            }
          }

          for (let approvalIndex = 0; approvalIndex < approvalCount; approvalIndex += 1) {
            const requestId = 71 + approvalIndex
            child.stdout.write(jsonLine({
              id: requestId,
              method: 'item/tool/call',
              params: {
                arguments: { ref: `documents/report-${approvalIndex + 1}.pdf` },
                callId: `call-vault-approval-${approvalIndex + 1}`,
                namespace: 'murph',
                tool: 'send_vault_file',
              },
            }))
            await expect(waitForRpcResponse(child, requestId)).resolves.toEqual({
              id: requestId,
              result: {
                contentItems: [{
                  text: JSON.stringify({
                    filename: `report-${approvalIndex + 1}.pdf`,
                    status: 'pending',
                  }),
                  type: 'inputText',
                }],
                success: true,
              },
            })
          }

          if (pendingNoReplyResponse) {
            await expect(pendingNoReplyResponse).resolves.toMatchObject({
              id: 70,
              result: { success: true },
            })
          }

          child.stdout.write(jsonLine({
            id: 80,
            method: 'item/tool/call',
            params: {
              arguments: {},
              namespace: 'murph',
              tool: 'finish_without_reply',
            },
          }))
          await expect(waitForRpcResponse(child, 80)).resolves.toEqual({
            id: 80,
            result: {
              contentItems: [{
                text: 'finish_without_reply is unavailable while a vault-file approval link must be delivered',
                type: 'inputText',
              }],
              success: false,
            },
          })

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-vault-approval-url',
                text: 'Approval is required.',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-vault-approval-url',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    const result = await executeCodexAppServerTurn({
      allowFinishWithoutReply: true,
      hostedToolContext,
      onFinishWithoutReplyAccepted,
      onFinishWithoutReplyRecorded,
      prompt: 'send the report',
      workingDirectory,
    })

    expect(result).toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [],
      finalAction: null,
      finalMessage: scenario.expectedFinalMessage,
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: scenario.expectedTranscriptMessage,
    })
    for (const exactApprovalUrl of exactApprovalUrls) {
      expect(result.finalMessage.split(exactApprovalUrl)).toHaveLength(2)
      expect(result.transcriptMessage ?? '').not.toContain(exactApprovalUrl)
    }
    expect(sendVaultFile).toHaveBeenCalledTimes(approvalCount)
    expect(sendVaultFile.mock.calls).toEqual(
      Array.from({ length: approvalCount }, (_, index) => [
        `documents/report-${index + 1}.pdf`,
        `call-vault-approval-${index + 1}`,
      ]),
    )
    expect(onFinishWithoutReplyAccepted).not.toHaveBeenCalled()
    expect(onFinishWithoutReplyRecorded).not.toHaveBeenCalled()
  }

  it.each(vaultApprovalUrlScenarios)(
    '$name for a pending vault approval',
    runVaultApprovalUrlScenario,
  )

  const nonOwningVaultSendScenarios = [
    {
      expectedSuccess: true,
      expectedText: JSON.stringify({
        note:
          'A different generated vault-file send for this conversation remains active, so this file was not queued. Do not call finish_without_reply; explain that the earlier send must finish before retrying this file.',
        status: 'already_in_progress',
      }),
      name: 'a different active file',
      run: async () => {
        throw new VaultCliError(
          'ASSISTANT_VAULT_FILE_SEND_ALREADY_ACTIVE',
          'A prior generated file remains active.',
        )
      },
    },
    {
      expectedSuccess: false,
      expectedText: 'vault-file delivery was denied',
      name: 'a denied approval',
      run: async () => ({
        filename: 'report.pdf',
        status: 'denied' as const,
      }),
    },
    {
      expectedSuccess: false,
      expectedText: 'vault-file delivery approval expired',
      name: 'an expired approval',
      run: async () => ({
        filename: 'report.pdf',
        status: 'expired' as const,
      }),
    },
    {
      expectedSuccess: false,
      expectedText: 'secure vault-file approval could not be prepared',
      name: 'a preparation failure',
      run: async () => {
        throw new Error('approval service unavailable')
      },
    },
  ] as const

  it.each(
    nonOwningVaultSendScenarios.flatMap((scenario) =>
      (['applied', 'reserved'] as const).map((ordering) => ({
        ...scenario,
        ordering,
      }))
    ),
  )(
    'keeps $name replyable after an $ordering no-reply request',
    async (scenario) => {
      const sendVaultFile = vi.fn(scenario.run)
      const visibleExplanation =
        'The file was not sent, so I need to explain what happened.'
      const {
        onFinishWithoutReplyAccepted,
        onFinishWithoutReplyRecorded,
        result,
      } = await runToolAfterNoReply({
        arguments: {
          ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`,
        },
        executeTurn: ({
          beforeToolExecution,
          onFinishWithoutReplyAccepted,
          onFinishWithoutReplyRecorded,
          workingDirectory,
        }) => executeCodexAppServerTurn({
          allowFinishWithoutReply: true,
          hostedToolContext: createHostedToolContext({
            beforeToolExecution,
            computerToolsAvailable: false,
            sendVaultFile,
            vaultFileSendAvailable: true,
          }),
          onFinishWithoutReplyAccepted,
          onFinishWithoutReplyRecorded,
          prompt: 'send the report',
          workingDirectory,
        }),
        expectedSuccess: scenario.expectedSuccess,
        expectedText: scenario.expectedText,
        finalText: visibleExplanation,
        followupNoReplyExpectedText:
          'finish_without_reply unavailable after assistant output',
        ordering: scenario.ordering,
        tool: 'send_vault_file',
      })

      expect(sendVaultFile).toHaveBeenCalledOnce()
      expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
      expect(result.finalAction).toBeNull()
      expect(result.finalActionExplicit).toBe(false)
      expect(result.finalMessage).toBe(visibleExplanation)
      expect(result.responseMedia).toEqual([])
      expect(onFinishWithoutReplyAccepted).not.toHaveBeenCalled()
      expect(onFinishWithoutReplyRecorded).not.toHaveBeenCalled()
    },
  )

  const noReplyMediaEffectScenarios = [
    {
      arguments: { prompt: 'Render a private report cover.' },
      name: 'image generation',
      tool: 'generate_image',
    },
    {
      arguments: { text: 'Read the private report summary.' },
      name: 'voice-memo generation and upload',
      tool: 'generate_voice_memo',
    },
    {
      arguments: {
        durationSeconds: 10,
        instrumental: false,
        prompt: 'Sing the private report summary.',
      },
      name: 'song generation and upload',
      tool: 'generate_song',
    },
  ] as const

  it.each(
    noReplyMediaEffectScenarios.flatMap((scenario) =>
      (['applied', 'reserved'] as const).map((ordering) => ({
        ...scenario,
        ordering,
      }))
    ),
  )(
    'blocks $name before effects after an $ordering no-reply request',
    async (scenario) => {
      const vaultRoot = await createTempDir(
        'assistant-codex-no-reply-media-vault-',
      )
      await initializeVault({ vaultRoot })
      const providerFetch = vi.fn(async () => new Response('{}'))
      const generateAndUpload = vi.fn(async () => ({
        attachmentId: 'attachment_should_not_exist',
        filename: 'media-should-not-exist.mp3',
      }))
      const persistCanonicalWrite = vi.fn(async () => undefined)
      const voiceMemoRuntime = scenario.tool === 'generate_image'
        ? null
        : {
            elevenLabs: {
              apiKeyAvailable: true,
              modelId: 'eleven_multilingual_v2',
              voiceId: 'voice_murph',
            },
            generateAndUpload,
            kind: 'linq' as const,
          }
      const {
        onFinishWithoutReplyAccepted,
        onFinishWithoutReplyRecorded,
        result,
      } = await runToolAfterNoReply({
        arguments: scenario.arguments,
        executeTurn: ({
          beforeToolExecution,
          onFinishWithoutReplyAccepted,
          onFinishWithoutReplyRecorded,
          workingDirectory,
        }) => withHostedCanonicalWritePort(
          { persistCanonicalWrite },
          async () => await executeCodexAppServerTurn({
            allowFinishWithoutReply: true,
            env: {
              ELEVENLABS_API_KEY: 'elevenlabs-test-key',
              LINQ_API_TOKEN: 'linq-test-token',
              OPENAI_API_KEY: 'openai-test-key',
            },
            fetchImpl: providerFetch,
            hostedToolContext: createHostedToolContext({
              beforeToolExecution,
              computerToolsAvailable: false,
            }),
            onFinishWithoutReplyAccepted,
            onFinishWithoutReplyRecorded,
            prompt: 'finish without replying, then generate media',
            requireHostedPrivateImageDelivery: true,
            vaultRoot,
            voiceMemoRuntime,
            workingDirectory,
          }),
        ),
        expectedSuccess: false,
        expectedText: 'response media unavailable after finish_without_reply',
        finalText: 'This media response must stay suppressed.',
        ordering: scenario.ordering,
        tool: scenario.tool,
      })

      expect(providerFetch).not.toHaveBeenCalled()
      expect(generateAndUpload).not.toHaveBeenCalled()
      expect(persistCanonicalWrite).not.toHaveBeenCalled()
      expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
      expect(result.finalAction).toEqual({ kind: 'none' })
      expect(result.finalActionExplicit).toBe(true)
      expect(result.finalMessage).toBe('')
      expect(result.responseMedia).toEqual([])
      expect(onFinishWithoutReplyAccepted).toHaveBeenCalledOnce()
      expect(onFinishWithoutReplyRecorded).toHaveBeenCalledOnce()
    },
  )

  it('serializes overlapping vault-file sends before a second approval can start', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-vault-send-order-work-',
    )
    const firstSendStarted = createDeferred<void>()
    const releaseFirstSend = createDeferred<void>()
    const sendVaultFile = vi.fn(async () => {
      firstSendStarted.resolve()
      await releaseFirstSend.promise
      return {
        filename: 'report.pdf',
        status: 'approved' as const,
      }
    })
    const hostedToolContext = createHostedToolContext({
      computerToolsAvailable: false,
      sendVaultFile,
      vaultFileSendAvailable: true,
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: { thread: { id: 'thread-vault-send-order' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-vault-send-order' } },
          }))

          for (const requestId of [91, 92]) {
            child.stdout.write(jsonLine({
              id: requestId,
              method: 'item/tool/call',
              params: {
                arguments: { ref: 'documents/report.pdf' },
                callId: `call-vault-send-order-${requestId}`,
                namespace: 'murph',
                tool: 'send_vault_file',
              },
            }))
          }

          await firstSendStarted.promise
          try {
            expect(sendVaultFile).toHaveBeenCalledOnce()
          } finally {
            releaseFirstSend.resolve()
          }

          await expect(waitForRpcResponse(child, 91)).resolves.toMatchObject({
            id: 91,
            result: { success: true },
          })
          await expect(waitForRpcResponse(child, 92)).resolves.toEqual({
            id: 92,
            result: {
              contentItems: [{
                text: 'vault-file sending cannot be combined with other response media',
                type: 'inputText',
              }],
              success: false,
            },
          })

          child.stdout.write(jsonLine({
            id: 94,
            method: 'item/tool/call',
            params: {
              arguments: {
                media: [{
                  alt: 'A second attachment',
                  kind: 'image',
                  source: 'second-attachment',
                  url: 'https://cdn.example.test/assistant/second.png',
                }],
              },
              namespace: 'murph',
              tool: 'attach_response_media',
            },
          }))
          await expect(waitForRpcResponse(child, 94)).resolves.toEqual({
            id: 94,
            result: {
              contentItems: [{
                text: 'response media cannot be changed after a vault-file send',
                type: 'inputText',
              }],
              success: false,
            },
          })

          child.stdout.write(jsonLine({
            id: 93,
            method: 'item/tool/call',
            params: {
              arguments: {},
              namespace: 'murph',
              tool: 'finish_without_reply',
            },
          }))
          await expect(waitForRpcResponse(child, 93)).resolves.toMatchObject({
            id: 93,
            result: { success: true },
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-vault-send-order',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      allowFinishWithoutReply: true,
      hostedToolContext,
      prompt: 'send the report twice',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: '',
      responseMedia: [],
    })
    expect(sendVaultFile).toHaveBeenCalledOnce()
  })

  it('orders current-sender clarification and continuation without blocking an independent ref', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-current-sender-order-work-',
    )
    const clarificationStarted = createDeferred<void>()
    const releaseClarification = createDeferred<void>()
    const earlierInputId = `ain_${'a'.repeat(32)}`
    const laterInputId = `ain_${'b'.repeat(32)}`
    const independentInputId = `ain_${'c'.repeat(32)}`
    const groupRequest = vi.fn<
      NonNullable<AssistantHostedToolContext['groupTool']>['request']
    >(async (request) => {
      if (
        request.action === 'ask_current_sender' &&
        request.mode === 'clarification'
      ) {
        clarificationStarted.resolve()
        await releaseClarification.promise
      }
      return {
        action: 'ask_current_sender' as const,
        result: { status: 'clarification_required' as const },
      }
    })
    const groupTool: NonNullable<AssistantHostedToolContext['groupTool']> = {
      request: groupRequest,
    }
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext({ groupTool }),
      currentUserActionScope: () => ({
        acceptedInputIds: [
          earlierInputId,
          independentInputId,
          laterInputId,
        ],
        conversationId: 'conversation_group',
        conversationScope: 'group',
        inboundMailboxItemIds: ['mailbox_group'],
        originSessionId: 'session_group',
        recipientKey: 'recipient_group',
      }),
    }
    const progressDelivery = createProgressDeliveryMock(
      sentProgressResult('system'),
    )
    let requestsBeforeClarificationReleased = 0
    let noticesBeforeClarificationReleased = 0

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: { thread: { id: 'thread-current-sender-order' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-current-sender-order' } },
          }))

          child.stdout.write(jsonLine({
            id: 91,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'clarify_current_sender',
                message_ref: earlierInputId,
              },
              namespace: 'murph',
              tool: 'group_consult',
            },
          }))
          child.stdout.write(jsonLine({
            id: 93,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'ask_current_sender',
                message_ref: independentInputId,
              },
              namespace: 'murph',
              tool: 'group_consult',
            },
          }))
          child.stdout.write(jsonLine({
            id: 92,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'continue_current_sender_in_group',
                message_ref: laterInputId,
              },
              namespace: 'murph',
              tool: 'group_consult',
            },
          }))

          await clarificationStarted.promise
          await new Promise((resolve) => setTimeout(resolve, 0))
          requestsBeforeClarificationReleased = groupRequest.mock.calls.length
          noticesBeforeClarificationReleased =
            progressDelivery.send.mock.calls.length
          releaseClarification.resolve()

          await expect(waitForRpcResponse(child, 91)).resolves.toMatchObject({
            id: 91,
            result: { success: true },
          })
          await expect(waitForRpcResponse(child, 92)).resolves.toMatchObject({
            id: 92,
            result: { success: true },
          })
          await expect(waitForRpcResponse(child, 93)).resolves.toMatchObject({
            id: 93,
            result: { success: true },
          })
          expect(groupRequest).toHaveBeenCalledTimes(3)

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-current-sender-order',
                text: 'I still need a destination.',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-current-sender-order',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      hostedToolContext,
      progressDelivery,
      prompt: 'clarify in causal order',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: 'I still need a destination.',
    })
    expect(requestsBeforeClarificationReleased).toBe(2)
    expect(noticesBeforeClarificationReleased).toBe(1)
  })

  it('claims one current-sender decision before concurrent same-ref tool effects', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-current-sender-decision-work-',
    )
    const privateStarted = createDeferred<void>()
    const releasePrivate = createDeferred<void>()
    const inputId = `ain_${'d'.repeat(32)}`
    const groupRequest = vi.fn<
      NonNullable<AssistantHostedToolContext['groupTool']>['request']
    >(async (request) => {
      if (
        request.action === 'ask_current_sender' &&
        request.audience === 'current_sender'
      ) {
        privateStarted.resolve()
        await releasePrivate.promise
      }
      return {
        action: 'ask_current_sender' as const,
        result: { status: 'accepted' as const },
      }
    })
    const groupTool: NonNullable<AssistantHostedToolContext['groupTool']> = {
      request: groupRequest,
    }
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext({ groupTool }),
      currentUserActionScope: () => ({
        acceptedInputIds: [inputId],
        conversationId: 'conversation_group',
        conversationScope: 'group',
        inboundMailboxItemIds: ['mailbox_group'],
        originSessionId: 'session_group',
        recipientKey: 'recipient_group',
      }),
    }
    const progressDelivery = createProgressDeliveryMock(
      sentProgressResult('system'),
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
            result: { thread: { id: 'thread-current-sender-decision' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-current-sender-decision' } },
          }))

          child.stdout.write(jsonLine({
            id: 94,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'continue_current_sender_privately',
                message_ref: inputId,
              },
              namespace: 'murph',
              tool: 'group_consult',
            },
          }))
          await privateStarted.promise
          child.stdout.write(jsonLine({
            id: 95,
            method: 'item/tool/call',
            params: {
              arguments: {
                action: 'ask_current_sender',
                message_ref: inputId,
              },
              namespace: 'murph',
              tool: 'group_consult',
            },
          }))

          await expect(waitForRpcResponse(child, 95)).resolves.toMatchObject({
            id: 95,
            result: { success: false },
          })
          expect(progressDelivery.send).not.toHaveBeenCalled()
          expect(groupRequest).toHaveBeenCalledTimes(1)

          releasePrivate.resolve()
          const interrupt = await waitForRpcMethod(child, 'turn/interrupt')
          child.stdout.write(jsonLine({ id: interrupt.id, result: {} }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-current-sender-decision',
                status: 'interrupted',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      hostedToolContext,
      progressDelivery,
      prompt: 'answer privately',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: '',
    })
  })

  it.each([
    {
      earlierAction: 'clarify_current_sender' as const,
      expectedMode: 'clarification' as const,
      expectedNoticeCount: 0,
      label: 'clarification',
      laterAction: 'ask_current_sender' as const,
    },
    {
      earlierAction: 'continue_current_sender_in_group' as const,
      expectedMode: 'continuation' as const,
      expectedNoticeCount: 1,
      label: 'group continuation',
      laterAction: 'continue_current_sender_privately' as const,
    },
  ])('claims an earlier current-sender $label before a contradictory new request', async ({
    earlierAction,
    expectedMode,
    expectedNoticeCount,
    laterAction,
  }) => {
    const workingDirectory = await createTempDir(
      'assistant-codex-current-sender-arrival-order-work-',
    )
    const releaseSecondPreTool = createDeferred<void>()
    const inputId = `ain_${'e'.repeat(32)}`
    let preToolCallCount = 0
    let earlierResponse: unknown = null
    let laterResponse: unknown = null
    const groupRequest = vi.fn<
      NonNullable<AssistantHostedToolContext['groupTool']>['request']
    >(async (request) => ({
      action: 'ask_current_sender' as const,
      result: request.action === 'ask_current_sender'
          && request.mode === 'clarification'
        ? { status: 'clarification_required' as const }
        : {
            status: 'unavailable' as const,
            unavailableReason: 'synthetic unavailable result',
          },
    }))
    const groupTool: NonNullable<AssistantHostedToolContext['groupTool']> = {
      request: groupRequest,
    }
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext({ groupTool }),
      beforeToolExecution: async () => {
        preToolCallCount += 1
        if (preToolCallCount === 2) {
          await releaseSecondPreTool.promise
        }
      },
      currentUserActionScope: () => ({
        acceptedInputIds: [inputId],
        conversationId: 'conversation_group',
        conversationScope: 'group',
        inboundMailboxItemIds: ['mailbox_group'],
        originSessionId: 'session_group',
        recipientKey: 'recipient_group',
      }),
    }
    const progressDelivery = createProgressDeliveryMock(
      sentProgressResult('system'),
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
            result: { thread: { id: 'thread-current-sender-arrival-order' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-current-sender-arrival-order' } },
          }))

          child.stdout.write([
            jsonLine({
              id: 96,
              method: 'item/tool/call',
              params: {
                arguments: {
                  action: earlierAction,
                  message_ref: inputId,
                },
                namespace: 'murph',
                tool: 'group_consult',
              },
            }),
            jsonLine({
              id: 97,
              method: 'item/tool/call',
              params: {
                arguments: {
                  action: laterAction,
                  message_ref: inputId,
                },
                namespace: 'murph',
                tool: 'group_consult',
              },
            }),
          ].join(''))

          try {
            laterResponse = await waitForRpcResponse(child, 97)
          } finally {
            releaseSecondPreTool.resolve()
          }
          earlierResponse = await waitForRpcResponse(child, 96)

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-current-sender-arrival-order',
                text: 'Should I share that here or send it privately?',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-current-sender-arrival-order',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      hostedToolContext,
      progressDelivery,
      prompt: 'clarify before choosing a destination',
      workingDirectory,
    })).resolves.toMatchObject({
      finalMessage: 'Should I share that here or send it privately?',
    })
    expect(laterResponse).toMatchObject({
      id: 97,
      result: { success: false },
    })
    expect(earlierResponse).toMatchObject({
      id: 96,
      result: { success: true },
    })
    expect(progressDelivery.send).toHaveBeenCalledTimes(expectedNoticeCount)
    expect(preToolCallCount).toBe(1)
    expect(groupRequest).toHaveBeenCalledTimes(1)
    expect(groupRequest.mock.calls[0]?.[0]).toMatchObject({
      mode: expectedMode,
    })
  })

  it('allows response media for a later steered message after an approved vault send', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-vault-send-steer-work-',
    )
    const media = {
      alt: 'Later steered attachment',
      kind: 'image' as const,
      source: 'later-steered-attachment',
      url: 'https://cdn.example.test/assistant/later-steered.png',
    }
    const sendVaultFile = vi.fn(async () => ({
      filename: 'report.pdf',
      status: 'approved' as const,
    }))
    const hostedToolContext = createHostedToolContext({
      computerToolsAvailable: false,
      sendVaultFile,
      vaultFileSendAvailable: true,
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: 1, result: {} }))
          await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: 2,
            result: { thread: { id: 'thread-vault-send-steer' } },
          }))
          await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: 3,
            result: { turn: { id: 'turn-vault-send-steer' } },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-vault-send-steer-1',
                content: [{ type: 'text', text: 'Send the report.' }],
                type: 'userMessage',
              },
            },
          }))

          child.stdout.write(jsonLine({
            id: 95,
            method: 'item/tool/call',
            params: {
              arguments: { ref: 'documents/report.pdf' },
              callId: 'call-vault-send-steer',
              namespace: 'murph',
              tool: 'send_vault_file',
            },
          }))
          await expect(waitForRpcResponse(child, 95)).resolves.toMatchObject({
            id: 95,
            result: { success: true },
          })

          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-vault-send-steer-2',
                content: [{
                  type: 'text',
                  text: 'Now attach a different image.',
                }],
                type: 'userMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            id: 96,
            method: 'item/tool/call',
            params: {
              arguments: { media: [media] },
              namespace: 'murph',
              tool: 'attach_response_media',
            },
          }))
          await expect(waitForRpcResponse(child, 96)).resolves.toEqual({
            id: 96,
            result: {
              contentItems: [{
                text: '1 response image attached',
                type: 'inputText',
              }],
              success: true,
            },
          })
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-vault-send-steer-2',
                text: 'Here is the separate image.',
                type: 'agentMessage',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-vault-send-steer',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    await expect(executeCodexAppServerTurn({
      allowFinishWithoutReply: true,
      hostedToolContext,
      prompt: 'send the report',
      workingDirectory,
    })).resolves.toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      finalAction: null,
      finalMessage: 'Here is the separate image.',
      responseDeliveryContextOrdinal: 1,
      responseMedia: [media],
    })
    expect(sendVaultFile).toHaveBeenCalledOnce()
  })

  it('leaves an earlier no-reply unsettled when the provider fails after creating a vault approval', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-vault-approval-failure-work-',
    )
    const exactApprovalUrl =
      `https://www.withmurph.ai/approve/haa_${'c'.repeat(32)}`
    const sendVaultFile = vi.fn(async () => ({
      approvalUrl: exactApprovalUrl,
      filename: 'report.pdf',
      status: 'pending' as const,
    }))
    const hostedToolContext = createHostedToolContext({
      computerToolsAvailable: false,
      sendVaultFile,
      vaultFileSendAvailable: true,
    })
    const onFinishWithoutReplyAccepted = vi.fn()
    const onFinishWithoutReplyRecorded = vi.fn()

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          await writeWarmTurnStarted({
            child,
            requestCount: 1,
            threadId: 'thread-vault-approval-failure',
            turnId: 'turn-vault-approval-failure',
          })
          child.stdout.write(jsonLine({
            id: 81,
            method: 'item/tool/call',
            params: {
              arguments: {},
              namespace: 'murph',
              tool: 'finish_without_reply',
            },
          }))
          await expect(waitForRpcResponse(child, 81)).resolves.toMatchObject({
            id: 81,
            result: { success: true },
          })
          child.stdout.write(jsonLine({
            id: 82,
            method: 'item/tool/call',
            params: {
              arguments: { ref: 'documents/report.pdf' },
              namespace: 'murph',
              tool: 'send_vault_file',
            },
          }))
          await expect(waitForRpcResponse(child, 82)).resolves.toEqual({
            id: 82,
            result: {
              contentItems: [{
                text: JSON.stringify({
                  filename: 'report.pdf',
                  status: 'pending',
                }),
                type: 'inputText',
              }],
              success: true,
            },
          })
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-vault-approval-failure',
              turn: {
                id: 'turn-vault-approval-failure',
                status: 'failed',
              },
            },
          }))
        })()
      })

      return child
    })

    const error: unknown = await executeCodexAppServerTurn({
      allowFinishWithoutReply: true,
      hostedToolContext,
      onFinishWithoutReplyAccepted,
      onFinishWithoutReplyRecorded,
      prompt: 'send the report',
      workingDirectory,
    }).then(
      () => {
        throw new Error('expected the Codex turn to fail')
      },
      (turnError: unknown) => turnError,
    )

    expect(error).toMatchObject({ code: 'ASSISTANT_CODEX_FAILED' })
    expect(readCodexAppServerTurnFailureContext(error)).toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [],
    })
    expect(sendVaultFile).toHaveBeenCalledOnce()
    expect(onFinishWithoutReplyAccepted).not.toHaveBeenCalled()
    expect(onFinishWithoutReplyRecorded).not.toHaveBeenCalled()
  })

  it('aborts and drains in-flight image generation when the turn fails', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-failure-work-')
    const codexHome = await createTempDir('assistant-codex-image-failure-home-')
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    const imageFetchStarted = createDeferred<void>()
    let fetchAborted = false
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          imageFetchStarted.resolve()
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
          await imageFetchStarted.promise
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
    const vaultRoot = await createTempDir('assistant-codex-image-progress-vault-')
    await initializeVault({ vaultRoot })
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
                  type: 'agentMessage',
                  text: 'Progress and image complete',
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
        hostedToolContext: createHostedToolContext({
          computerToolsAvailable: false,
        }),
        progressDelivery,
        prompt: 'generate with progress',
        requireHostedPrivateImageDelivery: true,
        vaultRoot,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Progress and image complete',
      responseMedia: [
        {
          kind: 'vault_image',
        },
      ],
    })
    expect(progressDelivery.send).toHaveBeenCalledWith(
      'Still generating the image.',
      { deliveryContextOrdinal: 0, source: 'model' },
    )
  })

  it('stops synchronous image generation before exceeding the media limit', async () => {
    const workingDirectory = await createTempDir('assistant-codex-image-limit-work-')
    const vaultRoot = await createTempDir('assistant-codex-image-limit-vault-')
    await initializeVault({ vaultRoot })
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
    const attachedMedia = Array.from({ length: 7 }, (_, index) => ({
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
          child.stdout.write(
            jsonLine({
              id: 93,
              method: 'item/tool/call',
              params: {
                namespace: 'murph',
                tool: 'generate_image',
                arguments: {
                  prompt: 'Render one image after the limit is full.',
                },
              },
            }),
          )

          const messages = await waitForRpcMessages(child, 7)
          expect(messages[4]).toMatchObject({
            id: 91,
            result: { success: true },
          })
          expect(messages[5]).toMatchObject({
            id: 92,
            result: { success: true },
          })
          expect(messages[6]).toEqual({
            id: 93,
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
                  type: 'agentMessage',
                  text: 'Media limit handled',
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
      hostedToolContext: createHostedToolContext({
        computerToolsAvailable: false,
      }),
      prompt: 'attach media then exceed the limit',
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
      workingDirectory,
    })

    expect(result.finalMessage).toBe('Media limit handled')
    expect(result.responseMedia).toHaveLength(8)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.additionalUsages).toMatchObject([
      { provider: 'openai-images' },
    ])
  })

  })
