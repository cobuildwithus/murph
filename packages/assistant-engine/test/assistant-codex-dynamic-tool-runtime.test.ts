import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

const codexMocks = vi.hoisted(() => ({
  dynamicToolCalls: [] as Array<{
    assistantStyleSettingsAvailable?: boolean
    kind: string
    voiceMemoRuntime: unknown
  }>,
  executionOrder: [] as string[],
  onDynamicToolCall: null as null | ((input: {
    kind: string
    styleValue: number | null
  }) => Promise<void>),
  spawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: codexMocks.spawn,
}))

vi.mock('../src/assistant-codex/dynamic-tools.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/assistant-codex/dynamic-tools.ts')>()

  return {
    ...actual,
    executeMurphDynamicToolRequest: vi.fn(
      async (
        input: Parameters<typeof actual.executeMurphDynamicToolRequest>[0],
      ): Promise<Awaited<ReturnType<typeof actual.executeMurphDynamicToolRequest>>> => {
        codexMocks.dynamicToolCalls.push({
          ...(input.request.kind === 'assistant-style'
            ? {
                assistantStyleSettingsAvailable:
                  input.assistantStyleSettingsAvailable === true,
              }
            : {}),
          kind: input.request.kind,
          voiceMemoRuntime: input.voiceMemoRuntime ?? null,
        })
        codexMocks.executionOrder.push(`tool:${input.request.kind}`)
        await codexMocks.onDynamicToolCall?.({
          kind: input.request.kind,
          styleValue:
            input.request.kind === 'assistant-style' &&
            input.request.args.action === 'set'
              ? input.request.args.value
              : null,
        })
        return {
          rpcResult: {
            success: true,
            contentItems: [
              {
                type: 'inputText',
                text: 'ok',
              },
            ],
          },
          usageDraft: null,
        }
      },
    ),
  }
})

import {
  executeCodexAppServerTurn as executeCodexAppServerTurnUnchecked,
  resolveMurphDynamicTools,
  stopWarmCodexAppServer,
  type CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import type {
  VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'

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
      allowMessageReactions: input.allowMessageReactions,
      computerToolsAvailable:
        input.hostedToolContext?.computerToolsAvailable === true,
      connectedAppsAvailable: input.hostedToolContext?.connectedApps != null,
      productFeedbackAvailable:
        typeof input.productFeedbackRecorder?.recordProductFeedback === 'function',
      progressUpdatesAvailable: input.progressDelivery != null,
    }),
  })
}

afterEach(async () => {
  await stopWarmCodexAppServer('dynamic-tool-runtime-test-cleanup')
  codexMocks.dynamicToolCalls.splice(0)
  codexMocks.executionOrder.splice(0)
  codexMocks.onDynamicToolCall = null
  codexMocks.spawn.mockReset()
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('Codex dynamic tool runtime routing', () => {
  it('passes voice memo and exact-turn style capabilities only to their tools', async () => {
    const workingDirectory = await createTempDir('assistant-codex-dynamic-runtime-work-')
    const codexHome = await createTempDir('assistant-codex-dynamic-runtime-home-')
    const voiceMemoRuntime: VoiceMemoToolRuntime = {
      elevenLabs: {
        apiKeyAvailable: true,
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice_murph',
      },
      kind: 'telegram',
    }
    const beforeToolExecution = vi.fn(async () => {
      codexMocks.executionOrder.push('checkpoint')
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedDynamicToolTurn(child)
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexCommand: 'codex',
        codexHome,
        env: {
          CODEX_HOME: codexHome,
          PATH: '/usr/bin',
        },
        prompt: 'Use three tools.',
        sandbox: 'workspace-write',
        hostedToolContext: {
          beforeToolExecution,
          computerToolsAvailable: false,
          currentHostedDeliveryContext: () => null,
          currentHostedMailboxItemIds: () => [],
          sendVaultFile: vi.fn(async () => {
            throw new Error('Vault-file sending is unavailable for this turn.')
          }),
          vaultFileSendAvailable: false,
        },
        dynamicTools: resolveMurphDynamicTools({
          assistantStyleSettingsAvailable: true,
          progressUpdatesAvailable: true,
          voiceMemoGenerationAvailable: true,
        }),
        voiceMemoRuntime,
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'done',
      threadId: 'thread-dynamic-runtime',
      turnId: 'turn-dynamic-runtime',
    })

    expect(codexMocks.dynamicToolCalls).toEqual([
      {
        kind: 'send-progress-update',
        voiceMemoRuntime: null,
      },
      {
        kind: 'generate-voice-memo',
        voiceMemoRuntime,
      },
      {
        assistantStyleSettingsAvailable: true,
        kind: 'assistant-style',
        voiceMemoRuntime: null,
      },
    ])
    expect(beforeToolExecution).toHaveBeenCalledTimes(3)
    expect(codexMocks.executionOrder).toEqual([
      'checkpoint',
      'tool:send-progress-update',
      'checkpoint',
      'tool:generate-voice-memo',
      'checkpoint',
      'tool:assistant-style',
    ])
  })

  it('serializes overlapping assistant-style calls in provider command order', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-style-order-work-',
    )
    const codexHome = await createTempDir('assistant-codex-style-order-home-')
    const firstStarted = createDeferred<void>()
    const releaseFirst = createDeferred<void>()
    const executionOrder: number[] = []
    codexMocks.onDynamicToolCall = async ({ kind, styleValue }) => {
      if (kind !== 'assistant-style' || styleValue === null) {
        return
      }
      executionOrder.push(styleValue)
      if (styleValue === 2) {
        firstStarted.resolve()
        await releaseFirst.promise
      }
    }
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedOverlappingStyleTurn(child)
      })
      return child
    })

    const turn = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome,
      dynamicTools: resolveMurphDynamicTools({
        assistantStyleSettingsAvailable: true,
        progressUpdatesAvailable: false,
      }),
      env: {
        CODEX_HOME: codexHome,
        PATH: '/usr/bin',
      },
      prompt: 'Set humor twice.',
      sandbox: 'workspace-write',
      workingDirectory,
    })

    await firstStarted.promise
    await Promise.resolve()
    const orderWhileFirstWasPending = [...executionOrder]
    releaseFirst.resolve()

    await expect(turn).resolves.toMatchObject({
      finalMessage: 'ordered',
      threadId: 'thread-style-order',
      turnId: 'turn-style-order',
    })
    expect(orderWhileFirstWasPending).toEqual([2])
    expect(executionOrder).toEqual([2, 8])
  })
})

async function runScriptedOverlappingStyleTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: { thread: { id: 'thread-style-order' } },
  }))
  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: { turn: { id: 'turn-style-order' } },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: { turn: { id: 'turn-style-order' } },
  }))

  for (const [id, value] of [[11, 2], [12, 8]] as const) {
    child.stdout.write(jsonLine({
      id,
      method: 'item/tool/call',
      params: {
        arguments: { action: 'set', setting: 'humor', value },
        namespace: 'murph',
        tool: 'assistant_style',
        turnId: 'turn-style-order',
      },
    }))
  }
  await child.waitForRpcId(11)
  await child.waitForRpcId(12)
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-style-order',
        message: 'ordered',
        type: 'assistant_message',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: { id: 'turn-style-order', status: 'completed' },
    },
  }))
}

async function runScriptedDynamicToolTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: {
      thread: {
        id: 'thread-dynamic-runtime',
      },
    },
  }))

  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: {
      turn: {
        id: 'turn-dynamic-runtime',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: {
      turn: {
        id: 'turn-dynamic-runtime',
      },
    },
  }))

  child.stdout.write(jsonLine({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: {
        text: 'Checking one thing.',
      },
      namespace: 'murph',
      tool: 'send_progress_update',
      turnId: 'turn-dynamic-runtime',
    },
  }))
  await child.waitForRpcId(1)

  child.stdout.write(jsonLine({
    id: 2,
    method: 'item/tool/call',
    params: {
      arguments: {
        text: 'Short memo.',
      },
      namespace: 'murph',
      tool: 'generate_voice_memo',
      turnId: 'turn-dynamic-runtime',
    },
  }))
  await child.waitForRpcId(2)

  child.stdout.write(jsonLine({
    id: 3,
    method: 'item/tool/call',
    params: {
      arguments: {
        action: 'show',
      },
      namespace: 'murph',
      tool: 'assistant_style',
      turnId: 'turn-dynamic-runtime',
    },
  }))
  await child.waitForRpcId(3)

  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-dynamic-runtime',
        message: 'done',
        type: 'assistant_message',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: {
        id: 'turn-dynamic-runtime',
        status: 'completed',
      },
    },
  }))
}

class MockChildProcess extends EventEmitter {
  exitCode: number | null = null
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly pid = 12345
  signalCode: NodeJS.Signals | null = null
  killed = false

  private pendingMessages: RpcMessage[] = []
  private pendingWaiters: Array<{
    predicate(message: RpcMessage): boolean
    resolve(message: RpcMessage): void
  }> = []
  private stdinBuffer = ''

  constructor() {
    super()
    this.stdin.on('data', (chunk: Buffer | string) => {
      this.readStdinChunk(chunk)
    })
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true
    queueMicrotask(() => {
      if (this.exitCode === null && this.signalCode === null) {
        this.emit('exit', null, signal ?? null)
        this.emit('close', null, signal ?? null)
      }
    })
    return true
  }

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'exit' || eventName === 'close') {
      this.exitCode =
        typeof args[0] === 'number' || args[0] === null
          ? (args[0] as number | null)
          : null
      this.signalCode =
        typeof args[1] === 'string' || args[1] === null
          ? (args[1] as NodeJS.Signals | null)
          : null
    }
    return super.emit(eventName, ...args)
  }

  waitForRpcId(id: number): Promise<RpcMessage> {
    return this.waitForRpcMessage((message) => message.id === id)
  }

  waitForRpcMethod(method: string): Promise<RpcMessage> {
    return this.waitForRpcMessage((message) => message.method === method)
  }

  private waitForRpcMessage(
    predicate: (message: RpcMessage) => boolean,
  ): Promise<RpcMessage> {
    const existingIndex = this.pendingMessages.findIndex(predicate)
    if (existingIndex >= 0) {
      const [message] = this.pendingMessages.splice(existingIndex, 1)
      if (message) {
        return Promise.resolve(message)
      }
    }

    return new Promise((resolve) => {
      this.pendingWaiters.push({ predicate, resolve })
    })
  }

  private readStdinChunk(chunk: Buffer | string): void {
    this.stdinBuffer += chunk.toString()
    let newlineIndex = this.stdinBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdinBuffer.slice(0, newlineIndex).trim()
      this.stdinBuffer = this.stdinBuffer.slice(newlineIndex + 1)
      if (line) {
        const parsed: unknown = JSON.parse(line)
        this.pushRpcMessage(parsed)
      }
      newlineIndex = this.stdinBuffer.indexOf('\n')
    }
  }

  private pushRpcMessage(value: unknown): void {
    if (!isRpcMessage(value)) {
      return
    }

    const waiterIndex = this.pendingWaiters.findIndex((waiter) =>
      waiter.predicate(value)
    )
    if (waiterIndex >= 0) {
      const [waiter] = this.pendingWaiters.splice(waiterIndex, 1)
      waiter?.resolve(value)
      return
    }

    this.pendingMessages.push(value)
  }
}

interface RpcMessage {
  id?: number | string
  method?: string
}

function isRpcMessage(value: unknown): value is RpcMessage {
  return typeof value === 'object' && value !== null
}

async function createTempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function createDeferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise,
  }
}
