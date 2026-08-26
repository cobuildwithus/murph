import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough, type TransformCallback } from 'node:stream'

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
import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import type {
  AssistantResponseCard,
  CompactTableWorkoutResponseCardV1,
} from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'

const codexMocks: {
  fakeHome: string
  spawn: Mock
} = vi.hoisted(() => ({
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
  extractCodexAppServerUserMessageImages,
} from '../src/assistant-codex/images.ts'
import {
  GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
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
const OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD:
  CompactTableWorkoutResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Full workout recovery',
  subtitle: null,
  footer: 'Reply with the exercise, set, and result to log or correct it.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: Array.from({ length: 16 }, (_, exerciseIndex) => ({
      name: `Capacity exercise ${exerciseIndex + 1}`,
      sets: Array.from({ length: 16 }, (_, setIndex) => ({
        status: 'pending',
        target: `Exercise ${exerciseIndex + 1} set ${setIndex + 1} target ${'x'.repeat(12)}`,
        actual: null,
      })),
    })),
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
  imageGenerationLauncher?: AssistantHostedToolContext['imageGenerationLauncher']
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
    imageGenerationLauncher: input.imageGenerationLauncher ?? null,
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
              type: 'agentMessage',
              text: 'Tool media complete',
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
                type: 'userMessage',
                content: [{ type: 'text', text: 'Answer this first' }],
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-before-voice-memo-steer',
                type: 'agentMessage',
                text: input.precedingFinalText,
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-voice-memo-steer',
                type: 'userMessage',
                content: [{
                  type: 'text',
                  text: 'Send that as a voice memo instead',
                }],
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
                type: 'agentMessage',
                phase: 'commentary',
                text: input.commentaryText,
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
              type: 'agentMessage',
              text: '',
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









class MockChildProcess extends EventEmitter {
  exitCode: number | null = null
  killed = false
  pid = 1234
  signalCode: NodeJS.Signals | null = null
  readonly stderr = new PassThrough()
  readonly stdin = new MockStdin()
  readonly stdout = new MockStdout()
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

class MockStdout extends PassThrough {
  private threadId: string | null = null
  private turnId: string | null = null

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const encoded = chunk.toString('utf8').split('\n').map((line) => {
      if (line.trim().length === 0) {
        return line
      }
      try {
        const payload = asRecord(JSON.parse(line))
        const result = isTestRecord(payload.result)
          ? asRecord(payload.result)
          : null
        const resultThread = result && isTestRecord(result.thread)
          ? asRecord(result.thread)
          : null
        if (
          typeof resultThread?.id === 'string' &&
          resultThread.id.length > 0
        ) {
          this.threadId = resultThread.id
        }
        const resultTurn = result && isTestRecord(result.turn)
          ? asRecord(result.turn)
          : null
        if (
          typeof resultTurn?.id === 'string' &&
          resultTurn.id.length > 0
        ) {
          this.turnId = resultTurn.id
        }
        if (payload.method === 'thread/tokenUsage/updated') {
          const params = asRecord(payload.params)
          const tokenUsage = asRecord(params.tokenUsage)
          const last = asRecord(tokenUsage.last)
          return JSON.stringify({
            ...payload,
            params: {
              ...params,
              tokenUsage: {
                last,
                modelContextWindow: tokenUsage.modelContextWindow ?? null,
                total: tokenUsage.total ?? last,
              },
            },
          })
        }
        if (payload.method !== 'item/tool/call') {
          return line
        }
        const params = asRecord(payload.params)
        const preserveMissingIdentity =
          params.__testPreserveMissingIdentity === true
        const requestParams = { ...params }
        delete requestParams.__testPreserveMissingIdentity
        if (preserveMissingIdentity) {
          return JSON.stringify({
            ...payload,
            params: requestParams,
          })
        }
        return JSON.stringify({
          ...payload,
          params: {
            callId: `call-${String(payload.id)}`,
            threadId: this.threadId ?? 'thread-test',
            turnId: this.turnId ?? 'turn-test',
            ...requestParams,
          },
        })
      } catch {
        return line
      }
    }).join('\n')
    this.push(encoded)
    callback()
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
          content: [{ type: 'text', text: userMessage.message }],
          type: 'userMessage',
        },
        threadId: input.threadId,
        turnId: input.turnId,
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
      threadId: input.threadId,
      turnId: input.turnId,
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
        text: input.finalMessage,
        type: 'agentMessage',
      },
      threadId: input.threadId,
      turnId: input.turnId,
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

function isTestRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const messages = readWrittenRpcMessages(child)
    if (messages.length >= count) {
      return messages
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const observed = readWrittenRpcMessages(child).map((message) =>
    typeof message.method === 'string'
      ? message.method
      : `response:${String(message.id)}`
  )
  throw new Error(
    `Expected at least ${count} RPC messages from Murph; observed ${observed.join(', ')}.`,
  )
}

async function waitForRpcResponse(
  child: MockChildProcess,
  id: number,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
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
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
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
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
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
        modelContextWindow: null,
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
      threadId,
      turn: {
        id: turnId,
        status,
      },
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
        type: 'commandExecution',
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
        type: 'agentMessage',
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
      threadId: input.threadId,
      turn: {
        id: input.turnId,
        status: 'completed',
      },
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

export {
  CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
  DAILY_NUTRITION_RESPONSE_CARD,
  MURPH_DYNAMIC_TOOLS,
  MURPH_DYNAMIC_TOOLS_WITHOUT_PROGRESS,
  MURPH_DYNAMIC_TOOLS_WITH_COMPUTER,
  MURPH_DYNAMIC_TOOLS_WITH_COMPUTER_WITHOUT_PROGRESS,
  MURPH_DYNAMIC_TOOLS_WITH_STYLE,
  MockChildProcess,
  MockStdin,
  MockStdout,
  OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD,
  TRACKED_COMPACT_TABLE_RESPONSE_CARD,
  asRecord,
  codexMocks,
  codexSandboxPolicyForMode,
  createDeferred,
  createErrnoException,
  createHostedToolContext,
  createProgressDeliveryMock,
  createTempDir,
  emitMockStdinError,
  emitProcessErrorAndExit,
  executeBackgroundBoundaryTurn,
  executeCodexAppServerTurn,
  initializeWarmTurn,
  isTestRecord,
  jsonLine,
  mockHostedCodexIdentityServer,
  mockProcessGroupSignalsForChildren,
  mockWarmCodexProcess,
  readLocalImagePath,
  readTurnStartInputItems,
  readWrittenRpcMessages,
  requireMockChildProcess,
  respondToBackgroundTerminals,
  runCodexResponseMediaToolTurn,
  runCodexTelegramVoiceMemoOnlyTurn,
  runToolAfterNoReply,
  sentProgressResult,
  tempRoots,
  waitForMockCall,
  waitForProcessKill,
  waitForProcessKillWithFakeTimers,
  waitForRpcMessages,
  waitForRpcMethod,
  waitForRpcMethodCount,
  waitForRpcResponse,
  waitForStableMicrotask,
  writeCodexV2AssistantEventTurn,
  writeCompletedTurn,
  writeContextCompactionStarted,
  writeStartedTurn,
  writeSubAgentActivity,
  writeSuccessfulContextCompactionTurn,
  writeTokenUsage,
  writeWarmTurnStarted,
};

export type {
  Deferred,
};
