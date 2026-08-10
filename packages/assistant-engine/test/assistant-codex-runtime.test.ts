import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import {
  MURPH_MEMBER_READ_PERMISSION_PROFILE,
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
import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
  buildRuntimeIssueInputForFailedCodexAction,
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
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  createVoiceMemoToolRuntimeFromEnv,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  executeCodexAssistantTurnAttempt,
  executeCodexAssistantTurnAttemptFromInput,
} from '../src/assistant/codex-runtime.ts'
import {
  createAssistantActiveTurnInputController,
  steerAssistantActiveTurnInput,
} from '../src/assistant/active-turn-input-controller.ts'
import {
  createAssistantProductFeedbackRecorder,
} from '../src/assistant/turn-progress.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
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

const MURPH_DYNAMIC_TOOLS = resolveMurphDynamicTools({})
const MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS = resolveMurphDynamicTools({
  progressUpdatesAvailable: false,
})
const MURPH_DYNAMIC_TOOLS_WITH_COMPUTER = resolveMurphDynamicTools({
  computerToolsAvailable: true,
})
const MURPH_DYNAMIC_TOOLS_WITH_COMPUTER_WITHOUT_PROGRESS = resolveMurphDynamicTools({
  computerToolsAvailable: true,
  progressUpdatesAvailable: false,
})
const MURPH_DYNAMIC_TOOLS_WITH_STYLE = resolveMurphDynamicTools({
  assistantStyleSettingsAvailable: true,
  progressUpdatesAvailable: false,
})
const DAILY_NUTRITION_RESPONSE_CARD: AssistantResponseCard = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: { target: 220, status: 'on_target' },
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}
const TRACKED_COMPACT_TABLE_RESPONSE_CARD: AssistantResponseCard = {
  kind: 'compact_table',
  version: 1,
  title: 'Strength session',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Set 1'],
  rows: [{ label: 'Bench press', values: ['185 lb × 8'] }],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
}
const CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA =
  'murph.assistant-codex-transport-diagnostics.v1'

const tempRoots: string[] = []

function executeCodexAppServerTurn(
  input: Omit<CodexAppServerTurnInput, 'dynamicTools'> & {
    dynamicTools?: CodexAppServerTurnInput['dynamicTools']
  },
) {
  return executeCodexAppServerTurnUnchecked({
    ...input,
    dynamicTools: input.dynamicTools ?? resolveMurphDynamicTools({
      allowFinishWithoutReply: input.allowFinishWithoutReply,
      automationAvailable:
        input.hostedToolContext?.automationTool != null,
      messageTargetingAvailable:
        input.authorizeAcceptedMessageTarget != null,
      assistantConfigurationAvailable:
        input.hostedToolContext?.assistantConfigurationTool != null,
      computerToolsAvailable:
        input.hostedToolContext?.computerToolsAvailable === true,
      connectedAppsAvailable: input.hostedToolContext?.connectedApps != null,
      deviceAvailable:
        input.hostedToolContext?.deviceTool != null,
      groupAvailable:
        input.hostedToolContext?.groupTool != null,
      productFeedbackAvailable:
        typeof input.productFeedbackRecorder?.recordProductFeedback === 'function',
      progressUpdatesAvailable: input.progressDelivery != null,
      voiceMemoGenerationAvailable: input.voiceMemoRuntime != null,
      vaultFileSendAvailable:
        input.hostedToolContext?.vaultFileSendAvailable === true,
    }),
  })
}

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

function createHostedToolContext(input: {
  beforeToolExecution?: AssistantHostedToolContext['beforeToolExecution']
  computerToolsAvailable?: boolean
  groupTool?: AssistantHostedToolContext['groupTool']
  sendVaultFile?: AssistantHostedToolContext['sendVaultFile']
  vaultFileSendAvailable?: boolean
} = {}): AssistantHostedToolContext {
  return {
    ...(input.beforeToolExecution
      ? { beforeToolExecution: input.beforeToolExecution }
      : {}),
    computerToolsAvailable: input.computerToolsAvailable ?? true,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    groupTool: input.groupTool ?? null,
    persistGeneratedImageCapture: async (write) => await write(),
    sendVaultFile: input.sendVaultFile ?? vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: input.vaultFileSendAvailable ?? false,
  }
}

async function runToolAfterNoReply(input: {
  arguments: Record<string, unknown>
  executeTurn(context: {
    beforeToolExecution: () => Promise<void>
    onFinishWithoutReplyAccepted: NonNullable<
      CodexAppServerTurnInput['onFinishWithoutReplyAccepted']
    >
    onFinishWithoutReplyRecorded: NonNullable<
      CodexAppServerTurnInput['onFinishWithoutReplyRecorded']
    >
    workingDirectory: string
  }): ReturnType<typeof executeCodexAppServerTurn>
  expectedSuccess: boolean
  expectedText: string
  finalText: string
  followupNoReplyExpectedText?: string
  ordering: 'applied' | 'reserved'
  tool: string
}) {
  const workingDirectory = await createTempDir(
    'assistant-codex-tool-after-no-reply-work-',
  )
  const firstToolExecutionStarted = createDeferred<void>()
  const releaseFirstToolExecution = createDeferred<void>()
  const onFinishWithoutReplyAccepted = vi.fn<NonNullable<
    CodexAppServerTurnInput['onFinishWithoutReplyAccepted']
  >>()
  const onFinishWithoutReplyRecorded = vi.fn<NonNullable<
    CodexAppServerTurnInput['onFinishWithoutReplyRecorded']
  >>()
  let toolExecutionCount = 0
  const beforeToolExecution = async (): Promise<void> => {
    toolExecutionCount += 1
    if (input.ordering === 'reserved' && toolExecutionCount === 1) {
      firstToolExecutionStarted.resolve(undefined)
      await releaseFirstToolExecution.promise
    }
  }

  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()

    queueMicrotask(() => {
      void (async () => {
        const initialize = await waitForRpcMethod(child, 'initialize')
        child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
        await writeWarmTurnStarted({
          child,
          requestCount: 1,
          threadId: 'thread-tool-after-no-reply',
          turnId: 'turn-tool-after-no-reply',
        })

        child.stdout.write(jsonLine({
          id: 70,
          method: 'item/tool/call',
          params: {
            arguments: {},
            namespace: 'murph',
            tool: 'finish_without_reply',
            turnId: 'turn-tool-after-no-reply',
          },
        }))
        const noReplyResponse = waitForRpcResponse(child, 70)
        if (input.ordering === 'applied') {
          await expect(noReplyResponse).resolves.toMatchObject({
            id: 70,
            result: { success: true },
          })
        } else {
          await firstToolExecutionStarted.promise
        }

        child.stdout.write(jsonLine({
          id: 71,
          method: 'item/tool/call',
          params: {
            arguments: input.arguments,
            callId: 'call-tool-after-no-reply',
            namespace: 'murph',
            tool: input.tool,
            turnId: 'turn-tool-after-no-reply',
          },
        }))
        const toolResponse = waitForRpcResponse(child, 71)
        if (input.ordering === 'reserved') {
          releaseFirstToolExecution.resolve(undefined)
          await expect(noReplyResponse).resolves.toMatchObject({
            id: 70,
            result: { success: true },
          })
        }
        await expect(toolResponse).resolves.toEqual({
          id: 71,
          result: {
            contentItems: [{
              text: input.expectedText,
              type: 'inputText',
            }],
            success: input.expectedSuccess,
          },
        })

        if (input.followupNoReplyExpectedText) {
          child.stdout.write(jsonLine({
            id: 72,
            method: 'item/tool/call',
            params: {
              arguments: {},
              namespace: 'murph',
              tool: 'finish_without_reply',
              turnId: 'turn-tool-after-no-reply',
            },
          }))
          await expect(waitForRpcResponse(child, 72)).resolves.toEqual({
            id: 72,
            result: {
              contentItems: [{
                text: input.followupNoReplyExpectedText,
                type: 'inputText',
              }],
              success: false,
            },
          })
        }

        writeCodexV2AssistantEventTurn({
          child,
          finalMessage: input.finalText,
          threadId: 'thread-tool-after-no-reply',
          turnId: 'turn-tool-after-no-reply',
        })
      })()
    })

    return child
  })

  const result = await input.executeTurn({
    beforeToolExecution,
    onFinishWithoutReplyAccepted,
    onFinishWithoutReplyRecorded,
    workingDirectory,
  })
  return {
    onFinishWithoutReplyAccepted,
    onFinishWithoutReplyRecorded,
    result,
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

async function runCodexTelegramVoiceMemoOnlyTurn(input: {
  commentaryText?: string
  precedingFinalText?: string
  progressDelivery?: CodexAppServerTurnInput['progressDelivery']
} = {}) {
  const workingDirectory = await createTempDir('assistant-codex-voice-memo-only-work-')
  const codexHome = await createTempDir('assistant-codex-voice-memo-only-home-')
  const voiceMemoText = 'Voice-only reply.'

  codexMocks.spawn.mockImplementation((_command, args, options) => {
    const child = new MockChildProcess()

    expect(args).toEqual(['app-server'])
    expect(options).toMatchObject({
      cwd: tmpdir(),
      env: {
        CODEX_HOME: codexHome,
        ELEVENLABS_API_KEY: 'elevenlabs-test-key',
        MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
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
              id: 'thread-voice-memo-only',
            },
          },
        }))

        const turnStart = await waitForRpcMethod(child, 'turn/start')
        child.stdout.write(jsonLine({
          id: turnStart.id,
          result: {
            turn: {
              id: 'turn-voice-memo-only',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/started',
          params: {
            turn: {
              id: 'turn-voice-memo-only',
            },
          },
        }))

        if (input.precedingFinalText) {
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-before-voice-memo-steer',
                type: 'user_message',
                message: 'Answer this first',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-before-voice-memo-steer',
                type: 'assistant_message',
                message: input.precedingFinalText,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-voice-memo-steer',
                type: 'user_message',
                message: 'Send that as a voice memo instead',
              },
            },
          }))
        }

        if (input.commentaryText) {
          child.stdout.write(jsonLine({
            method: 'item/agentMessage/delta',
            params: {
              delta: input.commentaryText,
              itemId: 'assistant-voice-memo-commentary',
              threadId: 'thread-voice-memo-only',
              turnId: 'turn-voice-memo-only',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-voice-memo-commentary',
                type: 'assistant_message',
                phase: 'commentary',
                message: input.commentaryText,
              },
            },
          }))
        }

        child.stdout.write(jsonLine({
          id: 61,
          method: 'item/tool/call',
          params: {
            namespace: 'murph',
            tool: 'generate_voice_memo',
            arguments: {
              text: voiceMemoText,
            },
            turnId: 'turn-voice-memo-only',
          },
        }))
        await expect(waitForRpcResponse(child, 61)).resolves.toEqual({
          id: 61,
          result: {
            success: true,
            contentItems: [
              {
                type: 'inputText',
                text: 'generated voice memo attached to the final response',
              },
            ],
          },
        })

        child.stdout.write(jsonLine({
          method: 'item/completed',
          params: {
            item: {
              id: 'assistant-voice-memo-only',
              type: 'assistant_message',
              message: '',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/completed',
          params: {
            turn: {
              id: 'turn-voice-memo-only',
              status: 'completed',
            },
          },
        }))
      })()
    })

    return child
  })

  const env = {
    ELEVENLABS_API_KEY: 'elevenlabs-test-key',
    MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
    MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
    PATH: '/custom/bin',
  }

  return await executeCodexAppServerTurn({
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome,
    env,
    progressDelivery: input.progressDelivery,
    prompt: 'Send only a voice memo',
    sandbox: 'workspace-write',
    voiceMemoRuntime: createVoiceMemoToolRuntimeFromEnv({
      env,
      fetchImpl: fetch,
      voiceMemoDeliveryChannel: 'telegram',
    }),
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
        imagePaths: [],
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
        imagePaths: [],
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
        imagePaths: [],
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

  it.each([0, 3])(
    'executes Codex app-server turns, sanitizes env, and streams assistant output through JSON-RPC at provider ordinal %i',
    async (providerRequestOrdinal) => {
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
              model: 'gpt-5',
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
            mimeType: 'image/jpeg',
          },
        ],
        onProgress,
        onProviderRequestStarted,
        onTraceEvent,
        approvalPolicy: 'never',
        configOverrides: ['model="gpt-5"'],
        model: 'gpt-5',
        modelProvider: 'vercel-ai-gateway',
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
        'model="gpt-5"',
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
                message: 'Configuration updates complete',
                type: 'assistant_message',
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
                message: 'Subscription actions complete',
                type: 'assistant_message',
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
                  type: 'assistant_message',
                  message: scenario.modelMessage,
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
                  type: 'assistant_message',
                  message: 'Paused for confirmation.',
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
                  type: 'assistant_message',
                  message:
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
                message: 'Approval is required.',
                type: 'assistant_message',
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
                message: 'Send the report.',
                type: 'user_message',
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
                message: 'Now attach a different image.',
                type: 'user_message',
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
                message: 'Here is the separate image.',
                type: 'assistant_message',
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
              status: 'failed',
              threadId: 'thread-vault-approval-failure',
              turnId: 'turn-vault-approval-failure',
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

  it('reports a structured failure when a generated image exceeds the media limit', async () => {
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
      hostedToolContext: createHostedToolContext({
        computerToolsAvailable: false,
      }),
      prompt: 'attach media then exceed the limit',
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
      workingDirectory,
    })

    expect(result.finalMessage).toBe('Media limit handled')
    expect(result.responseMedia).toHaveLength(40)
    // The image was generated and paid for, so its usage is still recorded.
    expect(result.additionalUsages).toMatchObject([
      { provider: 'openai-images' },
    ])
  })

  it('coalesces process-only preinitialization and keeps the first foreground turn cold-scoped', async () => {
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
                message: 'Prepared answer',
                type: 'assistant_message',
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
          message: 'Foreground replacement answer',
          type: 'assistant_message',
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
                  message: 'Fresh process answer',
                  type: 'assistant_message',
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
                  message: 'Unexpected replacement answer',
                  type: 'assistant_message',
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
                message: 'Replacement answer',
                type: 'assistant_message',
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
                  message: 'Fallback answer',
                  type: 'assistant_message',
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
                message: 'First boundary answer',
                type: 'assistant_message',
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
                message: 'Second boundary answer',
                type: 'assistant_message',
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
                message:
                  '{"kind":"skip","privateSummary":"No useful check-in now."}',
                type: 'assistant_message',
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

  it('fails closed before turn start when permission attestation drifts', async () => {
    const workingDirectory = await createTempDir('assistant-codex-attest-work-')
    const workspaceRoot = await createTempDir('assistant-codex-attest-root-')
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
              activePermissionProfile: {
                id: 'murph-group-read',
              },
              approvalPolicy: 'never',
              cwd: workingDirectory,
              instructionSources: [{ source: 'workspace' }],
              runtimeWorkspaceRoots: [workspaceRoot],
              thread: {
                id: 'thread-attestation-drift',
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
        prompt: 'must never reach turn start',
        runtimeWorkspaceRoots: [workspaceRoot],
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_APP_SERVER_PERMISSION_ATTESTATION_FAILED',
      context: {
        mismatchedFields: ['instructionSources'],
        retryable: false,
      },
    })

    const child = requireMockChildProcess(children[0] ?? null)
    expect(readWrittenRpcMessages(child).some(
      (message) => message.method === 'turn/start',
    )).toBe(false)
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
                last: {
                  cachedInputTokens: 25_000,
                  inputTokens: 75_000,
                  outputTokens: 12,
                  totalTokens: 75_012,
                },
                total: {
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
                message: 'Seeded personal thread below its threshold',
                type: 'assistant_message',
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
                  last: {
                    cachedInputTokens: 25_000,
                    inputTokens: 75_000,
                    outputTokens: 12,
                    totalTokens: 75_012,
                  },
                  total: {
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
                  message: 'The group reply completed before its detached work.',
                  type: 'assistant_message',
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

  it('uses-the-lower-group-threshold and preserves pre-compaction usage attribution', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-provider-usage-work-')
    const codexHome = await createTempDir('assistant-codex-compact-provider-usage-home-')
    const threadId = 'thread-compact-provider-usage'
    const turnId = 'turn-compact-provider-usage'

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
                last: {
                  cachedInputTokens: 25_000,
                  inputTokens: 50_000,
                  outputTokens: 12,
                  totalTokens: 50_012,
                },
                total: {
                  cachedInputTokens: 25_000,
                  inputTokens: 50_000,
                  outputTokens: 12,
                  totalTokens: 50_012,
                },
                modelContextWindow: 128_000,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-compact-provider-usage',
                type: 'assistant_message',
                message: 'Seeded before compact',
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
                last: {
                  cachedInputTokens: 24_000,
                  inputTokens: 125_000,
                  outputTokens: 700,
                  totalTokens: 125_700,
                },
                total: {
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
                last: {
                  cachedInputTokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 43_000,
                },
                total: {
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
  })

  it('uses provider usage attached to the context compaction completion', async () => {
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
                last: {
                  cachedInputTokens: 25_000,
                  inputTokens: 125_000,
                  outputTokens: 12,
                  totalTokens: 125_012,
                },
                total: {
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
                type: 'assistant_message',
                message: 'Seeded before explicit compact',
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
                providerUsage: {
                  last: {
                    cached_input_tokens: 24_000,
                    input_tokens: 125_000,
                    output_tokens: 700,
                    total_tokens: 125_700,
                  },
                  total: {
                    cached_input_tokens: 24_000,
                    input_tokens: 125_000,
                    output_tokens: 700,
                    total_tokens: 125_700,
                  },
                },
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
        cachedInputTokens: 24_000,
        inputTokens: 125_000,
        outputTokens: 700,
        source: 'provider',
        totalTokens: 125_700,
      },
    })
  })

  it('falls back to pre-compact estimate when compaction provider usage is impossible', async () => {
    const workingDirectory = await createTempDir('assistant-codex-compact-estimated-usage-work-')
    const codexHome = await createTempDir('assistant-codex-compact-estimated-usage-home-')
    const threadId = 'thread-compact-estimated-usage'
    const turnId = 'turn-compact-estimated-usage'

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
                last: {
                  cachedInputTokens: 25_000,
                  inputTokens: 125_000,
                  outputTokens: 12,
                  totalTokens: 125_012,
                },
                total: {
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
                id: 'assistant-compact-estimated-usage',
                type: 'assistant_message',
                message: 'Seeded before estimated compact',
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
            itemId: 'context-compact-estimated-usage',
            threadId,
          })
          child.stdout.write(jsonLine({
            method: 'thread/tokenUsage/updated',
            params: {
              threadId,
              turnId,
              tokenUsage: {
                last: {
                  cachedInputTokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 43_000,
                },
                total: {
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
                id: 'context-compact-estimated-usage',
                type: 'contextCompaction',
                providerUsage: {
                  cached_input_tokens: 150_000,
                  input_tokens: 125_000,
                  output_tokens: 700,
                  total_tokens: 125_700,
                },
              },
              tokenUsage: {
                last: {
                  cached_input_tokens: 24_000,
                  input_tokens: 125_000,
                  output_tokens: 700,
                  total_tokens: 125_700,
                },
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
        codexHome,
        env: {
          PATH: '/custom/bin',
        },
        prompt: 'seed compact estimated usage',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Seeded before estimated compact',
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
                last: {
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
                last: {
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
                type: 'assistant_message',
                message: 'Seeded parent before compact',
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
                last: {
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
                last: {
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
                type: 'assistant_message',
                message: 'Seeded before stale completion',
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
                last: {
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
                last: {
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
                last: {
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
                type: 'assistant_message',
                message: 'Seeded before legacy completion',
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
                last: {
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
                type: 'assistant_message',
                message: seedMessage,
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
                last: {
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
                type: 'assistant_message',
                message: seedMessage,
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
                last: {
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
                type: 'assistant_message',
                message: 'Seeded before stale after rpc',
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
                last: {
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
                type: 'assistant_message',
                message: 'Seeded before abort barrier',
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

  it('trusts tagged turn/started when the turn/start response omits the turn id', async () => {
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-prestart-tagged-2',
                type: 'assistant_message',
              },
              delta: 'Tagged event succeeded',
              turnId: 'turn-local-prestart-tagged-2',
            },
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
      codexTimingTurnCompleteElapsedMs: 50,
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
              namespace: 'murph',
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
        prompt: 'second local turn with started server request',
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Pre-start request completed',
      sessionId: 'thread-local-prestart-request-2',
      turnId: 'turn-local-prestart-request-2',
    })
    expect(progressUpdates).toEqual(['Starting early work'])
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-stale-turn-id-2',
                type: 'assistant_message',
              },
              delta: 'Current turn survived stale output',
              threadId: 'thread-local-stale-turn-id',
              turnId: 'turn-local-stale-turn-id-2',
            },
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-local-untagged-request-2',
                type: 'assistant_message',
              },
              delta: 'Current turn rejected untagged request',
              threadId: 'thread-local-untagged-request',
              turnId: 'turn-local-untagged-request-2',
            },
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
            method: 'assistant.message.delta',
            params: {
              delta: 'This unscoped output must not be accepted',
              item: {
                id: 'assistant-local-untagged-output-2',
                type: 'assistant_message',
              },
            },
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
            method: 'assistant.message.delta',
            params: {
              delta: 'Current turn ignored untagged output',
              item: {
                id: 'assistant-local-untagged-output-current',
                type: 'assistant_message',
              },
              threadId: 'thread-local-untagged-output',
              turnId: 'turn-local-untagged-output-2',
            },
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
            method: 'assistant.message.delta',
            params: {
              item: {
                id: 'assistant-prestart-pause-live-turn-2',
                type: 'assistant_message',
              },
              delta: 'Paused for confirmation.',
              turnId: 'turn-prestart-pause-live-turn-2',
            },
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
                  type: 'assistant_message',
                  message: 'Recovered.',
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
                message: 'Recovered response.',
                type: 'assistant_message',
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

  it('builds privacy-safe runtime issues for failed Codex action events', () => {
    const failedCommandEvent = {
      event: 'item.completed',
      data: {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          exitCode: 2,
          durationMs: 6_000,
          commandLabel: 'cat /tmp/private-file',
          filePaths: ['/tmp/private-file'],
          stdout: 'private stdout',
          stderr: 'private stderr',
          aggregatedOutput: 'private aggregate',
        },
      },
    }
    expect(
      buildRuntimeIssueInputForFailedCodexAction({
        normalizedEvent: normalizeCodexEvent(failedCommandEvent),
        rawEvent: failedCommandEvent,
      }),
    ).toEqual({
      component: 'assistant.codex-action',
      operation: 'command.execution',
      phase: 'provider_turn',
      issueKind: 'tool_error',
      severity: 'warning',
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      summary: 'Codex command execution failed during provider turn.',
      details: {
        actionKind: 'command.execution',
        durationMsBucket: '5_30s',
        exitCode: 2,
        outputBytesBucket: 'lt_1kb',
      },
    })

    const successfulCommandEvent = {
      event: 'item.completed',
      data: {
        item: {
          id: 'cmd-2',
          type: 'commandExecution',
          exitCode: 0,
          stdout: 'ok',
        },
      },
    }
    expect(
      buildRuntimeIssueInputForFailedCodexAction({
        normalizedEvent: normalizeCodexEvent(successfulCommandEvent),
        rawEvent: successfulCommandEvent,
      }),
    ).toBeNull()

    const failedSnakeCaseCommandEvent = {
      event: 'item.completed',
      data: {
        item: {
          id: 'cmd-3',
          type: 'command_execution',
          exit_code: '2',
          duration_ms: '120',
        },
      },
    }
    expect(
      buildRuntimeIssueInputForFailedCodexAction({
        normalizedEvent: normalizeCodexEvent(failedSnakeCaseCommandEvent),
        rawEvent: failedSnakeCaseCommandEvent,
      }),
    ).toMatchObject({
      component: 'assistant.codex-action',
      operation: 'command.execution',
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      details: {
        exitCode: 2,
      },
    })

    const failedMcpEvent = {
      event: 'item.completed',
      data: {
        item: {
          id: 'mcp-1',
          type: 'mcpToolCall',
          status: 'failed',
          server_name: 'web',
          name: 'search_query',
          result: {
            content: [
              {
                type: 'text',
                text: 'mcp private output',
              },
            ],
          },
        },
      },
    }
    expect(
      buildRuntimeIssueInputForFailedCodexAction({
        normalizedEvent: normalizeCodexEvent(failedMcpEvent),
        rawEvent: failedMcpEvent,
      }),
    ).toEqual({
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
      event: 'item.completed',
      data: {
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
      },
    }
    const dynamicIssue = buildRuntimeIssueInputForFailedCodexAction({
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
      buildRuntimeIssueInputForFailedCodexAction({
        normalizedEvent: normalizeCodexEvent(failedCommandEvent),
        rawEvent: failedCommandEvent,
      }),
    ])
    expect(encodedIssues).not.toContain('private stdout')
    expect(encodedIssues).not.toContain('private stderr')
    expect(encodedIssues).not.toContain('private aggregate')
    expect(encodedIssues).not.toContain('/tmp/private-file')
    expect(encodedIssues).not.toContain('private prompt')
    expect(encodedIssues).not.toContain('dynamic private output')
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
          spawnedChild.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              status: 'completed',
              turnId: 'turn-off-turn-one',
            },
          }))
          await writeWarmTurnStarted({
            child: spawnedChild,
            requestCount: 2,
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
                message: 'Process this blood test.',
                type: 'user_message',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-progress-steered',
                message: 'Include the late result too.',
                type: 'user_message',
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

          const messages = await waitForRpcMessages(child, 5)
          expect(messages[4]).toEqual({
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
        lookupId: 'hidden',
        routeBinding: 'preserved' as const,
        status: 'paused' as const,
      })),
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
              namespace: 'murph',
              tool: 'device',
              arguments: { action: 'list_accounts' },
            },
          }))
          await expect(waitForRpcResponse(child, 99)).resolves.toEqual({
            id: 99,
            result: {
              success: false,
              contentItems: [{
                type: 'inputText',
                text: 'tool is unavailable outside the active root turn',
              }],
            },
          })

          child.stdout.write(jsonLine({
            id: 1000,
            method: 'item/tool/call',
            params: {
              arguments: { action: 'list' },
              namespace: 'murph',
              threadId: 'thread-root-tool-scope',
              tool: 'pending_vault_files',
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
              arguments: {
                action: 'patch',
                lookup: 'hidden',
                status: 'paused',
              },
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
                text: 'invalid pending vault-file arguments',
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
        errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
        details: expect.objectContaining({
          detailsSchema: 'murph.tool-call-validation-digest.v1',
          invalidPaths: ['intentIds.[]'],
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

  describe('codex subagent thread events', () => {
    it('uses protocol-carried V2 child models without a lookup and keeps V1 parent fallback', async () => {
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
            // Newer V2 activity can carry the effective child model directly.
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'spawn-v2-terra',
                  type: 'subAgentActivity',
                  kind: 'started',
                  agentThreadId: 'thread-subagent-child-a',
                  agentPath: 'root/terra_check',
                  model: 'gpt-5.6-terra',
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
                  total: {
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                  last: {
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
                  type: 'command_execution',
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
                  total: {
                    totalTokens: 5_000,
                    inputTokens: 4_000,
                    cachedInputTokens: 2_000,
                    outputTokens: 1_000,
                    reasoningOutputTokens: 120,
                  },
                  last: {
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
              method: 'turn.started',
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
                  total: {
                    totalTokens: 700,
                    inputTokens: 600,
                    cachedInputTokens: 100,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                  },
                  last: {
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
          requestedModel: 'gpt-5.6-terra',
          servedModel: 'gpt-5.6-terra',
          totalTokens: 5_000,
        },
      })
      expect(result.additionalUsages[0]?.usage.rawUsageJson).toEqual({
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
                    cachedInputTokens: 0,
                    inputTokens: 80,
                    outputTokens: 20,
                    reasoningOutputTokens: 0,
                    totalTokens: 100,
                  },
                  threadId: 'thread-subagent-reset-child',
                  total: {
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
                  method: 'turn.started',
                  params: {
                    threadId: 'thread-subagent-reset-child',
                    turn: { id: 'turn-subagent-after-reset' },
                  },
                }))
                writeTokenUsage({
                  child,
                  last: {
                    cachedInputTokens: 0,
                    inputTokens: 40,
                    outputTokens: 10,
                    reasoningOutputTokens: 0,
                    totalTokens: 50,
                  },
                  threadId: 'thread-subagent-reset-child',
                  total: {
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
                    cachedInputTokens: 0,
                    inputTokens: 80,
                    outputTokens: 20,
                    reasoningOutputTokens: 0,
                    totalTokens: 100,
                  },
                  threadId: 'thread-subagent-reset-child',
                  total: {
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
                  total: {
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                  last: {
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
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'failed',
                threadId: 'thread-subagent-fail-parent',
                turnId: 'turn-subagent-fail-parent',
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
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'failed',
                threadId: 'thread-reaction-fail-parent',
                turnId: 'turn-reaction-fail-parent',
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
                  type: 'user_message',
                  message: 'react to my earlier message',
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'user-cross-context-steered',
                  type: 'user_message',
                  message: 'steered follow up',
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
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'failed',
                threadId: 'thread-cross-context-reaction',
                turnId: 'turn-cross-context-reaction',
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

    it('caps distinct subagent usage threads without charging reused turns against the cap', async () => {
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
            // The overflow thread emits a second event: the dropped count
            // must stay per-thread, not per-event.
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: overflowThreadId,
                turnId: `turn-subagent-cap-${trackedThreadCount + 1}`,
                tokenUsage: {
                  total: {
                    totalTokens: 9_900,
                    inputTokens: 9_000,
                    cachedInputTokens: 0,
                    outputTokens: 900,
                    reasoningOutputTokens: 0,
                  },
                  last: {
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
                totalTokens: 50,
                inputTokens: 40,
                cachedInputTokens: 0,
                outputTokens: 10,
                reasoningOutputTokens: 0,
              },
              threadId: 'thread-subagent-cap-1',
              total: {
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
        prompt: 'spawn more children than the usage cap',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Survived the spawn storm')
      expect(result.additionalUsages).toHaveLength(trackedThreadCount + 1)
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
          totalTokens: 50,
        },
      })
      expect(
        result.additionalUsages.map((draft) => draft.usage.totalTokens),
      ).not.toContain(9_900)
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
                  total: {
                    totalTokens: 1_000,
                    inputTokens: 800,
                    cachedInputTokens: 0,
                    outputTokens: 200,
                    reasoningOutputTokens: 0,
                  },
                  last: {
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
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'completed',
                threadId: 'thread-subagent-idle-parent',
                turnId: 'turn-subagent-idle-one',
              },
            }))

            await writeWarmTurnStarted({
              child,
              requestCount: 2,
              threadId: 'thread-subagent-idle-parent-2',
              turnId: 'turn-subagent-idle-two',
            })
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'completed',
                threadId: 'thread-subagent-idle-parent-2',
                turnId: 'turn-subagent-idle-two',
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
            total: {
              totalTokens: 400,
              inputTokens: 300,
              cachedInputTokens: 0,
              outputTokens: 100,
              reasoningOutputTokens: 0,
            },
            last: {
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
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'completed',
                threadId: 'thread-subagent-prestart-one',
                turnId: 'turn-subagent-prestart-one',
              },
            }))

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
                  total: {
                    totalTokens: 600,
                    inputTokens: 500,
                    cachedInputTokens: 0,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                  },
                  last: {
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
            child.stdout.write(jsonLine({
              method: 'turn/completed',
              params: {
                status: 'completed',
                threadId: 'thread-subagent-prestart-two',
                turnId: 'turn-subagent-prestart-two',
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

    it('evicts unattributed foreign threads from a full buffer in favor of spawned children', async () => {
      const workingDirectory = await createTempDir('assistant-codex-subagent-evict-work-')
      const codexHome = await createTempDir('assistant-codex-subagent-evict-home-')
      const spawnedChildren: MockChildProcess[] = []
      mockProcessGroupSignalsForChildren(spawnedChildren)
      const ghostThreadCount = 32

      codexMocks.spawn.mockImplementation(() => {
        const child = new MockChildProcess()
        child.pid = 31_800 + spawnedChildren.length
        spawnedChildren.push(child)

        queueMicrotask(() => {
          void (async () => {
            const initialize = await waitForRpcMethod(child, 'initialize')
            child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
            await writeWarmTurnStarted({
              child,
              requestCount: 1,
              threadId: 'thread-subagent-evict-parent',
              turnId: 'turn-subagent-evict-parent',
            })
            // Stale/unattributed foreign threads fill the buffer first.
            for (let ghostIndex = 1; ghostIndex <= ghostThreadCount; ghostIndex += 1) {
              const totals = {
                totalTokens: ghostIndex,
                inputTokens: ghostIndex,
                cachedInputTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
              }
              child.stdout.write(jsonLine({
                method: 'turn/started',
                params: {
                  threadId: `thread-subagent-ghost-${ghostIndex}`,
                  turn: {
                    id: `turn-subagent-ghost-${ghostIndex}`,
                  },
                },
              }))
              child.stdout.write(jsonLine({
                method: 'thread/tokenUsage/updated',
                params: {
                  threadId: `thread-subagent-ghost-${ghostIndex}`,
                  turnId: `turn-subagent-ghost-${ghostIndex}`,
                  tokenUsage: {
                    total: totals,
                    last: totals,
                  },
                },
              }))
            }
            // A real spawned child arrives after the buffer is full: it must
            // still get a slot (an unattributed ghost is evicted) and bill.
            child.stdout.write(jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'collab-spawn-evict-1',
                  type: 'collabAgentToolCall',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'thread-subagent-evict-parent',
                  receiverThreadIds: ['thread-subagent-evict-child'],
                  model: 'gpt-5.6-terra-mini',
                },
                threadId: 'thread-subagent-evict-parent',
                turnId: 'turn-subagent-evict-parent',
              },
            }))
            child.stdout.write(jsonLine({
              method: 'turn/started',
              params: {
                threadId: 'thread-subagent-evict-child',
                turn: {
                  id: 'turn-subagent-evict-child',
                },
              },
            }))
            child.stdout.write(jsonLine({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-subagent-evict-child',
                turnId: 'turn-subagent-evict-child',
                tokenUsage: {
                  total: {
                    totalTokens: 2_500,
                    inputTokens: 2_000,
                    cachedInputTokens: 500,
                    outputTokens: 500,
                    reasoningOutputTokens: 0,
                  },
                  last: {
                    totalTokens: 2_500,
                    inputTokens: 2_000,
                    cachedInputTokens: 500,
                    outputTokens: 500,
                    reasoningOutputTokens: 0,
                  },
                },
              },
            }))
            writeCodexV2AssistantEventTurn({
              child,
              finalMessage: 'Evicted a ghost for the real child',
              threadId: 'thread-subagent-evict-parent',
              turnId: 'turn-subagent-evict-parent',
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
        prompt: 'spawned child arrives after ghosts fill the buffer',
        sandbox: 'workspace-write',
        workingDirectory,
      })

      expect(result.finalMessage).toBe('Evicted a ghost for the real child')
      expect(result.additionalUsages).toHaveLength(1)
      expect(result.additionalUsages[0]).toMatchObject({
        provider: 'codex-cli',
        providerRequestOrdinal: 1,
        usage: {
          inputTokens: 2_000,
          outputTokens: 500,
          requestedModel: 'gpt-5.6-terra-mini',
          servedModel: 'gpt-5.6-terra-mini',
          totalTokens: 2_500,
        },
      })
      expect(result.additionalUsages[0]?.usage.rawUsageJson).toEqual({
        cachedInputTokens: 500,
        inputTokens: 2_000,
        outputTokens: 500,
        reasoningOutputTokens: 0,
        totalTokens: 2_500,
      })
    })
  })
})

describe('steered final segments', () => {
  type ScriptedSteeredFinalStep =
    | {
        kind?: 'event'
        event: Record<string, unknown>
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'attach-response-media'
        media: readonly unknown[]
      }
    | {
        card: AssistantResponseCard
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'attach-response-card'
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'finish-without-reply'
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'send-vault-file'
        ref: string
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'react-to-message'
        messageRef: string
        reaction: 'heart' | 'thumbs_up' | 'laugh'
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'select-reply-target'
        messageRef: string
      }
    | {
        expectedText: string
        id: number
        kind: 'list-memberships'
      }

  function isAttachResponseMediaStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'attach-response-media' }> {
    return 'kind' in step && step.kind === 'attach-response-media'
  }

  function isAttachResponseCardStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'attach-response-card' }> {
    return 'kind' in step && step.kind === 'attach-response-card'
  }

  function isFinishWithoutReplyStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'finish-without-reply' }> {
    return 'kind' in step && step.kind === 'finish-without-reply'
  }

  function isListMembershipsStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'list-memberships' }> {
    return 'kind' in step && step.kind === 'list-memberships'
  }

  function isSendVaultFileStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'send-vault-file' }> {
    return 'kind' in step && step.kind === 'send-vault-file'
  }

  function isReactToMessageStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'react-to-message' }> {
    return 'kind' in step && step.kind === 'react-to-message'
  }

  function isSelectReplyTargetStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'select-reply-target' }> {
    return 'kind' in step && step.kind === 'select-reply-target'
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function isScriptedEventStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { event: Record<string, unknown> }> {
    return 'event' in step && isRecord(step.event)
  }

  function normalizeScriptedSteeredFinalEvent(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): Record<string, unknown> {
    return isScriptedEventStep(step) ? step.event : step
  }

  async function runScriptedSteeredFinalSegmentsTurn(
    steps: Array<Record<string, unknown> | ScriptedSteeredFinalStep>,
    input: {
      abortSignal?: CodexAppServerTurnInput['abortSignal']
      authorizeAcceptedMessageTarget?:
        CodexAppServerTurnInput['authorizeAcceptedMessageTarget']
      hostedToolContext?: CodexAppServerTurnInput['hostedToolContext']
      onFirstAssistantResponseCompleted?:
        CodexAppServerTurnInput['onFirstAssistantResponseCompleted']
      onProgress?: CodexAppServerTurnInput['onProgress']
      onTraceEvent?: CodexAppServerTurnInput['onTraceEvent']
      progressDelivery?: CodexAppServerTurnInput['progressDelivery']
      responseCardsAvailable?: boolean
      turnStatus?: 'completed' | 'failed'
    } = {},
  ) {
    const workingDirectory = await createTempDir('assistant-codex-steered-finals-work-')
    const codexHome = await createTempDir('assistant-codex-steered-finals-home-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              thread: {
                id: 'thread-steered-finals',
              },
            },
          }))

          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-steered-finals',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-steered-finals',
              },
            },
          }))

          for (const step of steps) {
            if (isAttachResponseCardStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'attach_response_card',
                  arguments: {
                    card: step.card,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isAttachResponseMediaStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'attach_response_media',
                  arguments: {
                    media: step.media,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isFinishWithoutReplyStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'finish_without_reply',
                  arguments: {},
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isSendVaultFileStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  arguments: { ref: step.ref },
                  callId: `call-steered-vault-${step.id}`,
                  namespace: 'murph',
                  tool: 'send_vault_file',
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  contentItems: [{
                    text: step.expectedText,
                    type: 'inputText',
                  }],
                  success: step.expectedSuccess ?? true,
                },
              })
              continue
            }

            if (isListMembershipsStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'group',
                  arguments: { action: 'list_memberships' },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isReactToMessageStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'react_to_message',
                  arguments: {
                    message_ref: step.messageRef,
                    reaction: step.reaction,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isSelectReplyTargetStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'select_reply_target',
                  arguments: {
                    message_ref: step.messageRef,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            child.stdout.write(jsonLine(normalizeScriptedSteeredFinalEvent(step)))
          }

          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-steered-finals',
                status: input.turnStatus ?? 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    return await executeCodexAppServerTurn({
      approvalPolicy: 'never',
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      authorizeAcceptedMessageTarget:
        input.authorizeAcceptedMessageTarget ?? null,
      codexCommand: 'codex',
      codexHome,
      ...(input.responseCardsAvailable === true
        ? {
            dynamicTools: resolveMurphDynamicTools({
              responseCardsAvailable: true,
            }),
            groupConversation: false,
          }
        : {}),
      hostedToolContext: input.hostedToolContext,
      onFirstAssistantResponseCompleted:
        input.onFirstAssistantResponseCompleted,
      onProgress: input.onProgress,
      onTraceEvent: input.onTraceEvent,
      progressDelivery: input.progressDelivery,
      prompt: 'First question',
      sandbox: 'workspace-write',
      workingDirectory,
    })
  }

  function completedItemEvent(item: Record<string, unknown>) {
    return {
      method: 'item/completed',
      params: {
        item,
      },
    }
  }

  it('returns successful membership reads while preserving Codex continuity', async () => {
    const response = {
      action: 'list_memberships' as const,
      result: {
        disclosureGrants: [],
        memberships: [{
          displayName: 'Sunday runners sentinel',
          grantedVaultShareProjectionScopes: [
            { projectionKind: 'profile-name.v0' as const },
          ],
          kind: 'friends',
          memberCount: 4,
          membershipId: 'hgm_current_member',
          permissionsUrl: 'https://example.test/groups/join/sentinel',
          requestedVaultShareProjectionScopes: [
            { projectionKind: 'hrv-days.v0' as const },
          ],
          role: 'owner',
          sponsorshipUrl: 'https://example.test/groups/fund/funding_locator',
        }],
        status: 'ok' as const,
        truncated: false,
      },
    }
    const groupTool = {
      request: vi.fn(async (
        _request: unknown,
        _context?: { signal?: AbortSignal | null },
      ) => response),
    }
    const abortController = new AbortController()

    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: JSON.stringify(response),
        id: 83,
        kind: 'list-memberships',
      },
      completedItemEvent({
        id: 'assistant-memberships',
        type: 'assistant_message',
        message: 'You belong to Sunday runners.',
      }),
    ], {
      abortSignal: abortController.signal,
      hostedToolContext: createHostedToolContext({ groupTool }),
    })

    expect(groupTool.request).toHaveBeenCalledWith(
      { action: 'list_memberships' },
      { signal: expect.any(AbortSignal) },
    )
    const forwardedSignal = groupTool.request.mock.calls[0]?.[1]?.signal
    if (!forwardedSignal) {
      throw new Error('Expected current-turn abort signal at group-tool boundary.')
    }
    expect(forwardedSignal.aborted).toBe(false)
    abortController.abort(new DOMException('turn cancelled', 'AbortError'))
    expect(forwardedSignal.aborted).toBe(true)
    expect(result.finalMessage).toBe('You belong to Sunday runners.')
  })

  it('keeps a steered follow-up text-only after an earlier response card', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-card-1',
        type: 'user_message',
        message: 'First nutrition question',
      }),
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 84,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'assistant-card-1',
        type: 'assistant_message',
        message: 'Model prose replaced by card text.',
      }),
      completedItemEvent({
        id: 'user-card-2',
        type: 'user_message',
        message: 'One more thought',
      }),
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedSuccess: false,
        expectedText: 'response card unavailable for this final response',
        id: 85,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'assistant-card-2',
        type: 'assistant_message',
        message: 'Final follow-up answer.',
      }),
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.finalMessage).toBe('Final follow-up answer.')
    expect(result.providerAuthoredFinalMessage).toBe('Final follow-up answer.')
    expect(result.precedingAgentMessageSegments).toEqual([{
      deliveryContextOrdinal: 0,
      media: [],
      response:
        'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (UNDER TARGET) · 100g protein (ON TARGET) · 220g carbs (ON TARGET) · 40g fat (ON TARGET) · 30g fiber (UNDER TARGET).',
    }])
  })

  it('keeps tracked-card authority out of a steered preceding delivery', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-tracked-card-1',
        type: 'user_message',
        message: 'Track this workout in a table',
      }),
      {
        card: TRACKED_COMPACT_TABLE_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 840,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'assistant-tracked-card-1',
        type: 'assistant_message',
        message: 'Model prose replaced by card text.',
      }),
      completedItemEvent({
        id: 'user-tracked-card-2',
        type: 'user_message',
        message: 'One more thought',
      }),
      completedItemEvent({
        id: 'assistant-tracked-card-2',
        type: 'assistant_message',
        message: 'Final follow-up answer.',
      }),
    ], { responseCardsAvailable: true })

    expect(result.precedingAgentMessageSegments).toEqual([{
      deliveryContextOrdinal: 0,
      media: [],
      response: 'Strength session\n\nBench press: Set 1: 185 lb × 8',
      transcriptResponse:
        'Strength session\n\nBench press: Set 1: 185 lb × 8\n\n' +
        '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-04T21:30:00.000Z]',
    }])
  })

  it('keeps a response card when the model finishes without authored text', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 87,
        kind: 'attach-response-card',
      },
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toEqual(DAILY_NUTRITION_RESPONSE_CARD)
    expect(result.providerAuthoredFinalMessage).toBe('')
    expect(result.finalMessage).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (UNDER TARGET) · 100g protein (ON TARGET) · 220g carbs (ON TARGET) · 40g fat (ON TARGET) · 30g fiber (UNDER TARGET).',
    )
  })

  it('keeps tracked-card authority only in the final transcript message', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        card: TRACKED_COMPACT_TABLE_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 870,
        kind: 'attach-response-card',
      },
    ], { responseCardsAvailable: true })

    expect(result.finalMessage).toBe(
      'Strength session\n\nBench press: Set 1: 185 lb × 8',
    )
    expect(result.finalMessage).not.toContain('evt_')
    expect(result.transcriptMessage).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ;',
    )
  })

  it('invalidates a card-only response when a live steer adds accepted work', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-card-only-request',
        type: 'user_message',
        message: 'Send today\'s nutrition card',
      }),
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 86,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'user-card-follow-up',
        type: 'user_message',
        message: 'Also explain how to reach my protein goal',
      }),
      completedItemEvent({
        id: 'assistant-card-follow-up',
        type: 'assistant_message',
        message: 'Complete combined nutrition answer.',
      }),
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.finalMessage).toBe('Complete combined nutrition answer.')
    expect(result.providerAuthoredFinalMessage).toBe(
      'Complete combined nutrition answer.',
    )
  })

  it('keeps independent last-successful reply and reaction targets per steered segment', async () => {
    const firstReplyRef = `ain_${'1'.repeat(32)}`
    const firstReactionRef = `ain_${'2'.repeat(32)}`
    const rejectedRef = `ain_${'3'.repeat(32)}`
    const finalReplyRef = `ain_${'4'.repeat(32)}`
    const authorizeAcceptedMessageTarget = vi.fn(async (input: {
      action: 'native-reply' | 'participant-effect' | 'reaction'
      deliveryContextOrdinal: number
      messageRef: string
    }) => input.messageRef === rejectedRef
      ? null
      : { targetInputId: input.messageRef })

    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        expectedText: 'selection recorded',
        id: 90,
        kind: 'select-reply-target',
        messageRef: firstReactionRef,
      },
      {
        expectedText: 'selection recorded',
        id: 91,
        kind: 'select-reply-target',
        messageRef: firstReplyRef,
      },
      {
        expectedSuccess: false,
        expectedText: 'message target unavailable',
        id: 92,
        kind: 'select-reply-target',
        messageRef: rejectedRef,
      },
      {
        expectedText: 'reaction queued',
        id: 93,
        kind: 'react-to-message',
        messageRef: firstReactionRef,
        reaction: 'heart',
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      {
        expectedText: 'selection recorded',
        id: 94,
        kind: 'select-reply-target',
        messageRef: finalReplyRef,
      },
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
    ], { authorizeAcceptedMessageTarget })

    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        media: [],
        response: 'Answer one.',
        targetInputId: firstReplyRef,
      },
    ])
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.targetInputId).toBe(finalReplyRef)
    expect(result.reactions).toEqual([
      {
        deliveryContextOrdinal: 0,
        reaction: 'heart',
        targetInputId: firstReactionRef,
      },
    ])
  })

  it('clears only the reply selection when finish_without_reply wins', async () => {
    const replyRef = `ain_${'5'.repeat(32)}`
    const reactionRef = `ain_${'6'.repeat(32)}`
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: 'selection recorded',
        id: 95,
        kind: 'select-reply-target',
        messageRef: replyRef,
      },
      {
        expectedText: 'reaction queued',
        id: 96,
        kind: 'react-to-message',
        messageRef: reactionRef,
        reaction: 'thumbs_up',
      },
      {
        expectedText: 'finished without reply',
        id: 97,
        kind: 'finish-without-reply',
      },
      completedItemEvent({
        id: 'assistant-suppressed',
        type: 'assistant_message',
        message: 'Do not deliver this.',
      }),
    ], {
      authorizeAcceptedMessageTarget: async (input) => ({
        targetInputId: input.messageRef,
      }),
    })

    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalMessage).toBe('')
    expect(result.targetInputId).toBeNull()
    expect(result.reactions).toEqual([
      {
        deliveryContextOrdinal: 0,
        reaction: 'thumbs_up',
        targetInputId: reactionRef,
      },
    ])
  })

  it('returns no final text or outbound progress for a commentary-only turn', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'assistant-commentary-only',
        type: 'assistant_message',
        message: 'Internal status only.',
        phase: 'commentary',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('')
    expect(result.precedingAgentMessageSegments).toEqual([])
    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.transcriptMessage).toBeNull()
  })

  it('keeps a pre-steer final when only commentary follows the steer', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const retainedMedia = {
      url: 'https://cdn.example.test/assistant/retained-final.png',
      alt: 'Retained final image',
      source: 'retained-final',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        kind: 'attach-response-media',
        id: 81,
        expectedText: '1 response image attached',
        media: [retainedMedia],
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'One more thought',
      }),
      completedItemEvent({
        id: 'assistant-2-commentary',
        type: 'assistant_message',
        message: 'Considering that.',
        phase: 'commentary',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('Answer one.')
    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.responseMedia).toEqual([
      {
        ...retainedMedia,
        kind: 'image',
      },
    ])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('keeps steered final answers while commentary remains internal', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks mate I appreciate all this',
      }),
      completedItemEvent({
        id: 'assistant-2-commentary',
        type: 'assistant_message',
        message: 'Reworking that now.',
        phase: 'commentary',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('Answer two.')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })

  it('collects every pre-steer final answer in order across multiple steer boundaries', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
      completedItemEvent({
        id: 'user-3',
        type: 'user_message',
        message: 'Third question',
      }),
      completedItemEvent({
        id: 'assistant-3',
        type: 'assistant_message',
        message: 'Answer three.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer three.')
    expect(result.responseDeliveryContextOrdinal).toBe(2)
    expect(result.precedingAgentMessageSegments.map((segment) => ({
      deliveryContextOrdinal: segment.deliveryContextOrdinal,
      response: segment.response,
    }))).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
      },
      {
        deliveryContextOrdinal: 1,
        response: 'Answer two.',
      },
    ])
  })

  it('does not return a trailing-steer final answer as a preceding segment', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks mate I appreciate all this',
      }),
    ])

    expect(result.finalMessage).toBe('Answer one.')
    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('promotes a trailing-steer answer when the current segment has fallback text', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Answer this differently',
      }),
      {
        method: 'item/agentMessage/delta',
        params: {
          delta: 'Answer two from fallback.',
          itemId: 'assistant-2',
          threadId: 'thread-steered-finals',
          turnId: 'turn-steered-finals',
        },
      },
    ])

    expect(result.finalMessage).toBe('Answer two from fallback.')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })

  it('keeps repeated same-text final answers when they are distinct steered segments', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Done.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Say it again',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Done.',
      }),
    ])

    expect(result.finalMessage).toBe('Done.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Done.',
        media: [],
      },
    ])
  })

  it('segments response media at the same boundary as pre-steer final text', async () => {
    const firstMedia = {
      url: 'https://cdn.example.test/assistant/first.png',
      alt: 'First segment image',
      source: 'first-segment',
    }
    const finalMedia = {
      url: 'https://cdn.example.test/assistant/final.png',
      alt: 'Final segment image',
      source: 'final-segment',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'attach-response-media',
        id: 41,
        expectedText: '1 response image attached',
        media: [firstMedia],
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one with image.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Now answer differently',
      }),
      {
        kind: 'attach-response-media',
        id: 42,
        expectedText: '1 response image attached',
        media: [finalMedia],
      },
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two with a different image.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer two with a different image.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one with image.',
        media: [
          {
            ...firstMedia,
            kind: 'image',
          },
        ],
      },
    ])
    expect(result.responseMedia).toEqual([
      {
        ...finalMedia,
        kind: 'image',
      },
    ])
  })

  it('closes admission and preserves a media-only response before a steer boundary', async () => {
    const firstMedia = {
      url: 'https://cdn.example.test/assistant/media-only.png',
      alt: 'Media-only first response',
      source: 'media-only-first-response',
    }
    const callbackOrder: string[] = []
    const onFirstAssistantResponseCompleted = vi.fn(() => {
      callbackOrder.push('response-completed')
    })
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'attach-response-media',
        id: 43,
        expectedText: '1 response image attached',
        media: [firstMedia],
      },
      completedItemEvent({
        id: 'assistant-media-only',
        type: 'assistant_message',
        message: '   ',
      }),
      completedItemEvent({
        id: 'user-after-media',
        type: 'user_message',
        message: 'This must wait for the next ordinary turn',
      }),
      completedItemEvent({
        id: 'assistant-after-media',
        type: 'assistant_message',
        message: 'Later response.',
      }),
    ], {
      onFirstAssistantResponseCompleted,
      onTraceEvent(event) {
        if (
          JSON.stringify(event.rawEvent).includes('"id":"user-after-media"')
        ) {
          callbackOrder.push('later-user-item')
        }
      },
    })

    expect(onFirstAssistantResponseCompleted).toHaveBeenCalledTimes(1)
    expect(callbackOrder).toEqual([
      'response-completed',
      'later-user-item',
    ])
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: '',
        media: [
          {
            ...firstMedia,
            kind: 'image',
          },
        ],
      },
    ])
    expect(result.finalMessage).toBe('Later response.')
    expect(result.responseMedia).toEqual([])
  })

  it('preserves provider acknowledgement when a steer response and first completion share one stdout batch', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-batched-steer-ack-work-',
    )
    const liveTurnReady = createDeferred<void>()
    const controller = createAssistantActiveTurnInputController({
      conversationKeys: [
        'channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1',
      ],
      sessionId: 'session-batched-steer',
      turnId: 'turn-batched-owner',
      vault: '/vaults/test',
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              thread: {
                id: 'thread-batched-steer',
              },
            },
          }))
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-batched-steer',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-initial-question',
                message: 'Initial question',
                type: 'user_message',
              },
              threadId: 'thread-batched-steer',
              turnId: 'turn-batched-steer',
            },
          }))

          await liveTurnReady.promise
          const steerRequest = await waitForRpcMethod(child, 'turn/steer')
          child.stdout.write([
            jsonLine({ id: steerRequest.id, result: {} }),
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-before-batched-steer',
                  message: 'First response.',
                  type: 'assistant_message',
                },
                threadId: 'thread-batched-steer',
                turnId: 'turn-batched-steer',
              },
            }),
          ].join(''))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-batched-steer',
                message: 'Clarification accepted by the provider',
                type: 'user_message',
              },
              threadId: 'thread-batched-steer',
              turnId: 'turn-batched-steer',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-after-batched-steer',
                message: 'Revised response.',
                type: 'assistant_message',
              },
              threadId: 'thread-batched-steer',
              turnId: 'turn-batched-steer',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-batched-steer',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    try {
      const turn = executeCodexAppServerTurn({
        onFirstAssistantResponseCompleted: () => {
          controller.closeInputAdmission()
        },
        onLiveTurn: (liveTurn) => {
          const releaseLiveTurn = controller.registerLiveProviderTurn({
            interrupt: () => liveTurn.interrupt(),
            codexThreadId: liveTurn.threadId,
            providerTurnId: liveTurn.turnId,
            sessionId: 'session-batched-steer',
            steer: (input) => liveTurn.steer(input),
            turnId: 'turn-batched-owner',
          })
          liveTurnReady.resolve()
          return releaseLiveTurn
        },
        prompt: 'Initial question',
        workingDirectory,
      })

      await liveTurnReady.promise
      const completion = steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-batched-owner',
        prompt: 'Clarification accepted by the provider',
        vault: '/vaults/test',
      })
      expect(completion).not.toBeNull()
      completion?.catch(() => undefined)

      await expect(turn).resolves.toMatchObject({
        finalMessage: 'Revised response.',
        precedingAgentMessageSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'First response.',
          },
        ],
        responseDeliveryContextOrdinal: 1,
      })
      await expect(controller.admitLiveSteered()).resolves.toMatchObject({
        acceptedInputs: [
          expect.objectContaining({
            id: 'manual-1',
          }),
        ],
        providerAlreadySteered: true,
      })
    } finally {
      controller.fail(new Error('batched steer acknowledgement test complete'))
      controller.close()
    }
  })

  it('keeps last-wins behavior for multiple finals without a steer boundary', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer two.')
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('detects steer boundaries on the camelCase v2 wire item types', async () => {
    // Production app-server notifications use camelCase ThreadItem tags
    // (userMessage/agentMessage); the snake_case variants in the other tests
    // normalize to the same identifiers.
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'userMessage',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'agentMessage',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'userMessage',
        message: 'Thanks mate I appreciate all this',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'agentMessage',
        message: 'Answer two.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer two.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })

  it('ignores commentary messages and steers that arrive before any final answer', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-commentary',
        type: 'assistant_message',
        message: 'Working on it.',
        phase: 'commentary',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question while tools run',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Consolidated answer.',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('Consolidated answer.')
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('uses the latest answered user-message ordinal when an earlier steer had no final answer', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question before the first final',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Consolidated answer.',
      }),
      completedItemEvent({
        id: 'user-3',
        type: 'user_message',
        message: 'Third question',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Final answer.',
      }),
    ])

    expect(result.finalMessage).toBe('Final answer.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 1,
        response: 'Consolidated answer.',
        media: [],
      },
    ])
  })

  it('scopes finish_without_reply to the selected steered message', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        kind: 'finish-without-reply',
        id: 71,
        expectedText: 'finished without reply',
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'This first answer should not be delivered.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Visible answer.',
      }),
    ])

    expect(result.finalAction).toBeNull()
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(result.finalMessage).toBe('Visible answer.')
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('rejects finish_without_reply after response media is attached', async () => {
    const media = {
      kind: 'image',
      url: 'https://cdn.example.test/assistant/no-reply.png',
      alt: 'No-reply media that should still be delivered',
      source: 'no-reply-media-test',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'attach-response-media',
        id: 76,
        media: [media],
        expectedText: '1 response image attached',
      },
      {
        kind: 'finish-without-reply',
        id: 77,
        expectedSuccess: false,
        expectedText: 'finish_without_reply unavailable after assistant output',
      },
      completedItemEvent({
        id: 'assistant-no-reply-media',
        type: 'assistant_message',
        message: 'This final text should be delivered.',
      }),
    ])

    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
    expect(result.finalMessage).toBe('This final text should be delivered.')
    expect(result.responseMedia).toEqual([media])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('keeps a different generated-file request replyable while a prior send is active', async () => {
    const media = {
      alt: 'Explanation attachment',
      kind: 'image' as const,
      source: 'active-vault-send-explanation',
      url: 'https://cdn.example.test/assistant/active-vault-send.png',
    }
    const sendVaultFile = vi.fn(async () => {
      throw new VaultCliError(
        'ASSISTANT_VAULT_FILE_SEND_ALREADY_ACTIVE',
        'A prior generated file remains active.',
      )
    })
    const note =
      'A different generated vault-file send for this conversation remains active, so this file was not queued. Do not call finish_without_reply; explain that the earlier send must finish before retrying this file.'
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: JSON.stringify({
          note,
          status: 'already_in_progress',
        }),
        id: 76,
        kind: 'send-vault-file',
        ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/file-b.pdf`,
      },
      {
        expectedText: '1 response image attached',
        id: 77,
        kind: 'attach-response-media',
        media: [media],
      },
      completedItemEvent({
        id: 'assistant-active-vault-send',
        message: 'The earlier file must finish before I can retry this one.',
        type: 'assistant_message',
      }),
    ], {
      hostedToolContext: createHostedToolContext({
        computerToolsAvailable: false,
        sendVaultFile,
        vaultFileSendAvailable: true,
      }),
    })

    expect(sendVaultFile).toHaveBeenCalledWith(
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/file-b.pdf`,
      'call-steered-vault-76',
    )
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
    expect(result.finalAction).toBeNull()
    expect(result.finalMessage).toBe(
      'The earlier file must finish before I can retry this one.',
    )
    expect(result.responseMedia).toEqual([media])
  })

  it('rejects response media after finish_without_reply selects no final response', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'finish-without-reply',
        id: 78,
        expectedText: 'finished without reply',
      },
      {
        kind: 'attach-response-media',
        id: 79,
        media: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/assistant/no-reply-late.png',
            alt: 'Late no-reply media that should not be attached',
            source: 'no-reply-media-test',
          },
        ],
        expectedSuccess: false,
        expectedText: 'response media unavailable after finish_without_reply',
      },
      completedItemEvent({
        id: 'assistant-no-reply-late-media',
        type: 'assistant_message',
        message: 'This final text should not be delivered.',
      }),
    ])

    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalActionExplicit).toBe(true)
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(result.finalMessage).toBe('')
    expect(result.responseMedia).toEqual([])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('allows response media for a later steered message after earlier finish_without_reply', async () => {
    const media = {
      kind: 'image',
      url: 'https://cdn.example.test/assistant/later-after-no-reply.png',
      alt: 'Later steered message media',
      source: 'later-no-reply-media-test',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        kind: 'finish-without-reply',
        id: 80,
        expectedText: 'finished without reply',
      },
      completedItemEvent({
        id: 'assistant-earlier-no-reply',
        type: 'assistant_message',
        message: 'This first answer should not be delivered.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      {
        kind: 'attach-response-media',
        id: 81,
        media: [media],
        expectedText: '1 response image attached',
      },
      completedItemEvent({
        id: 'assistant-later-media',
        type: 'assistant_message',
        message: 'Visible answer with media.',
      }),
    ])

    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(result.finalMessage).toBe('Visible answer with media.')
    expect(result.responseMedia).toEqual([media])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('rejects a later no-reply while an earlier steered answer is still pending', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks, no need to answer this',
      }),
      {
        kind: 'finish-without-reply',
        id: 74,
        expectedSuccess: false,
        expectedText: 'finish_without_reply unavailable after assistant output',
      },
    ])

    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
    expect(result.finalMessage).toBe('Answer one.')
    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('rejects a later no-reply after an earlier steered answer was promoted', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks, no need to answer this',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
      {
        kind: 'finish-without-reply',
        id: 75,
        expectedSuccess: false,
        expectedText: 'finish_without_reply unavailable after assistant output',
      },
    ])

    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
    expect(result.finalMessage).toBe('Answer two.')
    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })
})

it('rejects finish_without_reply after context compaction progress was sent', async () => {
  const workingDirectory = await createTempDir('assistant-codex-context-compact-no-reply-')
  const codexHome = await createTempDir('assistant-codex-context-compact-no-reply-home-')
  const progressDelivery = createProgressDeliveryMock(sentProgressResult('system'))

  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()

    queueMicrotask(() => {
      void (async () => {
        const initialize = await waitForRpcMethod(child, 'initialize')
        child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

        const threadStart = await waitForRpcMethod(child, 'thread/start')
        child.stdout.write(jsonLine({
          id: threadStart.id,
          result: {
            thread: {
              id: 'thread-context-compact-no-reply',
            },
          },
        }))

        const turnStart = await waitForRpcMethod(child, 'turn/start')
        child.stdout.write(jsonLine({
          id: turnStart.id,
          result: {
            turn: {
              id: 'turn-context-compact-no-reply',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/started',
          params: {
            turn: {
              id: 'turn-context-compact-no-reply',
            },
          },
        }))

        writeContextCompactionStarted({
          child,
          itemId: 'context-compact-no-reply',
          threadId: 'thread-context-compact-no-reply',
        })
        for (let attempt = 0; attempt < 200; attempt += 1) {
          if (progressDelivery.send.mock.calls.length > 0) {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 0))
        }

        child.stdout.write(jsonLine({
          id: 81,
          method: 'item/tool/call',
          params: {
            namespace: 'murph',
            tool: 'finish_without_reply',
            arguments: {},
            turnId: 'turn-context-compact-no-reply',
          },
        }))
        await expect(waitForRpcResponse(child, 81)).resolves.toEqual({
          id: 81,
          result: {
            success: false,
            contentItems: [
              {
                type: 'inputText',
                text: 'finish_without_reply unavailable after assistant output',
              },
            ],
          },
        })

        child.stdout.write(jsonLine({
          method: 'item/completed',
          params: {
            item: {
              id: 'assistant-context-compact-no-reply-final',
              type: 'assistant_message',
              message: 'Final answer after system progress.',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/completed',
          params: {
            turn: {
              id: 'turn-context-compact-no-reply',
              status: 'completed',
            },
          },
        }))
      })()
    })

    return child
  })

  const result = await executeCodexAppServerTurn({
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome,
    progressDelivery,
    prompt: 'question',
    sandbox: 'workspace-write',
    workingDirectory,
  })

  expect(progressDelivery.send).toHaveBeenCalledWith(expect.any(String), {
    deliveryContextOrdinal: 0,
    required: true,
    source: 'system',
  })
  expect(result.finalMessage).toBe('Final answer after system progress.')
  expect(result.finalAction).toBeNull()
  expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
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

function writeContextCompactionStarted(input: {
  child: MockChildProcess
  itemId: string
  threadId: string
}): void {
  input.child.stdout.write(jsonLine({
    method: 'item/started',
    params: {
      item: {
        id: input.itemId,
        type: 'contextCompaction',
      },
      threadId: input.threadId,
    },
  }))
}

async function writeSuccessfulContextCompactionTurn(input: {
  child: MockChildProcess
  finalMessage: string
  itemId: string
  progressText?: string
  threadId: string
  turnId: string
  userMessages?: readonly {
    id: string
    message: string
  }[]
}): Promise<void> {
  const initialize = await waitForRpcMethod(input.child, 'initialize')
  input.child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await waitForRpcMethod(input.child, 'thread/start')
  input.child.stdout.write(jsonLine({
    id: threadStart.id,
    result: {
      thread: {
        id: input.threadId,
      },
    },
  }))
  const turnStart = await waitForRpcMethod(input.child, 'turn/start')
  input.child.stdout.write(jsonLine({
    id: turnStart.id,
    result: {
      turn: {
        id: input.turnId,
      },
    },
  }))
  for (const userMessage of input.userMessages ?? []) {
    input.child.stdout.write(jsonLine({
      method: 'item/completed',
      params: {
        item: {
          id: userMessage.id,
          message: userMessage.message,
          type: 'user_message',
        },
      },
    }))
  }
  if (input.userMessages?.length) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  input.child.stdout.write(jsonLine({
    method: 'item/started',
    params: {
      item: {
        id: input.itemId,
        type: 'contextCompaction',
      },
    },
  }))
  input.child.stdout.write(jsonLine({
    method: 'item/started',
    params: {
      item: {
        id: input.itemId,
        type: 'context_compaction',
      },
    },
  }))
  input.child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: input.itemId,
        type: 'context.compaction',
      },
    },
  }))
  if (input.progressText) {
    input.child.stdout.write(jsonLine({
      id: 99,
      method: 'item/tool/call',
      params: {
        namespace: 'murph',
        tool: 'send_progress_update',
        arguments: {
          text: input.progressText,
        },
      },
    }))
    await expect(waitForRpcResponse(input.child, 99)).resolves.toEqual({
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
  }
  input.child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: `${input.itemId}-final`,
        message: input.finalMessage,
        type: 'assistant_message',
      },
    },
  }))
  input.child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: {
        id: input.turnId,
        status: 'completed',
      },
    },
  }))
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

async function waitForMockCall(
  mock: { mock: { calls: unknown[] } },
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (mock.mock.calls.length >= count) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected mock to be called at least ${count} time(s).`)
}

async function waitForStableMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
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
  // A replacement can be queued behind the failed-stop lock's promise cleanup.
  // Full-workspace coverage load can require more than 200 microtask turns even
  // though no wall-clock delay is involved, so keep this fake-time wait bounded
  // to two virtual seconds rather than a scheduler-sensitive iteration count.
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
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

function mockWarmCodexProcess(
  children: MockChildProcess[],
  pidBase: number,
  run: (child: MockChildProcess) => Promise<void>,
): void {
  mockProcessGroupSignalsForChildren(children)
  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()
    child.pid = pidBase + children.length
    children.push(child)
    queueMicrotask(() => {
      void run(child)
    })
    return child
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
            case 'thread/backgroundTerminals/list':
              child.stdout.write(jsonLine({
                id: message.id,
                result: {
                  data: [],
                  nextCursor: null,
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

async function initializeWarmTurn(
  child: MockChildProcess,
  threadId: string,
  turnId: string,
): Promise<void> {
  const initialize = await waitForRpcMethod(child, 'initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  await writeWarmTurnStarted({
    child,
    requestCount: 1,
    threadId,
    turnId,
  })
}

function writeSubAgentActivity(
  child: MockChildProcess,
  threadId: string,
  agentThreadId: string,
  kind: 'interacted' | 'started' = 'started',
  metadata: {
    agentPath?: string
    id?: string
    turnId?: string
  } = {},
): void {
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        ...(metadata.agentPath ? { agentPath: metadata.agentPath } : {}),
        agentThreadId,
        ...(metadata.id ? { id: metadata.id } : {}),
        kind,
        type: 'subAgentActivity',
      },
      threadId,
      ...(metadata.turnId ? { turnId: metadata.turnId } : {}),
    },
  }))
}

function writeStartedTurn(
  child: MockChildProcess,
  threadId: string,
  turnId: string,
): void {
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: {
      threadId,
      turn: { id: turnId },
    },
  }))
}

function writeTokenUsage(input: {
  child: MockChildProcess
  last: Record<string, number>
  threadId: string
  total: Record<string, number>
  turnId: string
}): void {
  input.child.stdout.write(jsonLine({
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: input.threadId,
      tokenUsage: {
        last: input.last,
        total: input.total,
      },
      turnId: input.turnId,
    },
  }))
}

function writeCompletedTurn(
  child: MockChildProcess,
  threadId: string,
  turnId: string,
  status: 'completed' | 'failed' | 'interrupted' = 'completed',
): void {
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      status,
      threadId,
      turnId,
    },
  }))
}

async function respondToBackgroundTerminals(
  child: MockChildProcess,
  requestCount: number,
  data: readonly Record<string, unknown>[] = [],
): Promise<Record<string, unknown>> {
  const request = await waitForRpcMethodCount(
    child,
    'thread/backgroundTerminals/list',
    requestCount,
  )
  child.stdout.write(jsonLine({
    id: request.id,
    result: {
      data,
      nextCursor: null,
    },
  }))
  return request
}

async function executeBackgroundBoundaryTurn(
  codexHome: string,
  workingDirectory: string,
  prompt: string,
) {
  return await executeCodexAppServerTurn({
    approvalPolicy: 'never',
    codexHome,
    env: { PATH: '/custom/bin' },
    prompt,
    sandbox: 'workspace-write',
    workingDirectory,
  })
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
