import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

const codexMocks = vi.hoisted(() => ({
  dynamicToolCalls: [] as Array<{
    assistantStyleSettingsAvailable?: boolean
    deliveryContextOrdinal: number | null
    generateSongTurnState?: unknown
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
          deliveryContextOrdinal: input.deliveryContextOrdinal ?? null,
          ...(input.request.kind === 'generate-song'
            ? {
                generateSongTurnState:
                  input.generateSongTurnState ?? null,
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
          ...(input.request.kind === 'finish-without-reply'
            ? {
                finalActionPatch: {
                  kind: 'none' as const,
                },
              }
            : input.request.kind === 'group' &&
                input.request.request.action === 'send_email'
              ? {
                  finalActionPatch: {
                    kind: 'none' as const,
                    owner: 'group-email' as const,
                  },
                }
            : {}),
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
      messageTargetingAvailable:
        input.authorizeAcceptedMessageTarget != null,
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
  it('ends a group-email turn while its accepted send tool request is pending', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-group-email-terminal-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-group-email-terminal-home-',
    )

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedTerminalGroupEmailTurn(child)
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        approvalPolicy: 'never',
        codexCommand: 'codex',
        codexHome,
        dynamicTools: resolveMurphDynamicTools({ groupAvailable: true }),
        env: {
          CODEX_HOME: codexHome,
          PATH: '/usr/bin',
        },
        hostedToolContext: {
          beforeToolExecution: vi.fn(async () => undefined),
          computerToolsAvailable: false,
          currentHostedDeliveryContext: () => null,
          currentHostedMailboxItemIds: () => [],
          sendVaultFile: vi.fn(async () => {
            throw new Error('Vault-file sending is unavailable for this turn.')
          }),
          vaultFileSendAvailable: false,
        },
        prompt: 'Send the prepared group email.',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      finalAction: { kind: 'none' },
      finalMessage: '',
      threadId: 'thread-group-email-terminal',
      turnId: 'turn-group-email-terminal',
    })

    expect(codexMocks.dynamicToolCalls).toEqual([
      {
        deliveryContextOrdinal: 0,
        kind: 'group',
        voiceMemoRuntime: null,
      },
    ])
  })

  it('keeps cold and cached tool requests bound to their request-time delivery contexts', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-request-context-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-request-context-home-',
    )
    const beforeToolExecution = vi.fn(async () => undefined)

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedRequestContextTurn(child)
      })
      return child
    })

    await expect(
      executeCodexAppServerTurn({
        allowFinishWithoutReply: true,
        approvalPolicy: 'never',
        codexCommand: 'codex',
        codexHome,
        dynamicTools: resolveMurphDynamicTools({
          allowFinishWithoutReply: true,
          progressUpdatesAvailable: true,
        }),
        env: {
          CODEX_HOME: codexHome,
          PATH: '/usr/bin',
        },
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
        prompt: 'Handle two tool requests and both live follow ups.',
        sandbox: 'workspace-write',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      finalMessage: 'The latest follow up still receives this reply.',
      threadId: 'thread-request-context',
      turnId: 'turn-request-context',
    })

    expect(beforeToolExecution).toHaveBeenNthCalledWith(1, 0)
    expect(beforeToolExecution).toHaveBeenNthCalledWith(2, 1)
    expect(codexMocks.dynamicToolCalls).toEqual([
      {
        deliveryContextOrdinal: 0,
        kind: 'finish-without-reply',
        voiceMemoRuntime: null,
      },
      {
        deliveryContextOrdinal: 1,
        kind: 'send-progress-update',
        voiceMemoRuntime: null,
      },
    ])
  })

  it('passes voice memo, generated-song policy, and exact-turn style capabilities only to their tools', async () => {
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
        generateSongPolicy: {
          maxAttempts: 1,
          requiredDurationSeconds: 15,
        },
        prompt: 'Use four tools.',
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
        deliveryContextOrdinal: 0,
        kind: 'send-progress-update',
        voiceMemoRuntime: null,
      },
      {
        deliveryContextOrdinal: 0,
        kind: 'generate-voice-memo',
        voiceMemoRuntime,
      },
      {
        deliveryContextOrdinal: 0,
        generateSongTurnState: {
          attemptCount: 0,
          policy: {
            maxAttempts: 1,
            requiredDurationSeconds: 15,
          },
        },
        kind: 'generate-song',
        voiceMemoRuntime,
      },
      {
        assistantStyleSettingsAvailable: true,
        deliveryContextOrdinal: 1,
        kind: 'assistant-style',
        voiceMemoRuntime: null,
      },
    ])
    expect(beforeToolExecution).toHaveBeenCalledTimes(4)
    expect(beforeToolExecution).toHaveBeenNthCalledWith(1, 0)
    expect(beforeToolExecution).toHaveBeenNthCalledWith(2, 0)
    expect(beforeToolExecution).toHaveBeenNthCalledWith(3, 0)
    expect(beforeToolExecution).toHaveBeenNthCalledWith(4, 1)
    expect(codexMocks.executionOrder).toEqual([
      'checkpoint',
      'tool:send-progress-update',
      'checkpoint',
      'tool:generate-voice-memo',
      'checkpoint',
      'tool:generate-song',
      'checkpoint',
      'tool:assistant-style',
    ])
  })

  it('starts overlapping nonserialized tool preflights at the captured ordinal', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-overlapping-preflight-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-overlapping-preflight-home-',
    )
    const firstPreflightStarted = createDeferred<void>()
    const releaseFirstPreflight = createDeferred<void>()
    const beforeToolExecution = vi.fn(async (deliveryContextOrdinal: number) => {
      codexMocks.executionOrder.push(
        `checkpoint:${deliveryContextOrdinal}`,
      )
      if (beforeToolExecution.mock.calls.length === 1) {
        firstPreflightStarted.resolve()
        await releaseFirstPreflight.promise
      }
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedOverlappingProgressTurn(child)
      })
      return child
    })

    const turn = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome,
      dynamicTools: resolveMurphDynamicTools({
        progressUpdatesAvailable: true,
      }),
      env: {
        CODEX_HOME: codexHome,
        PATH: '/usr/bin',
      },
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
      prompt: 'Run both progress tools.',
      sandbox: 'workspace-write',
      workingDirectory,
    })

    await firstPreflightStarted.promise
    try {
      await vi.waitFor(() => {
        expect(beforeToolExecution).toHaveBeenCalledTimes(2)
      })
      await vi.waitFor(() => {
        expect(codexMocks.dynamicToolCalls).toHaveLength(1)
      })
      expect(beforeToolExecution).toHaveBeenNthCalledWith(1, 1)
      expect(beforeToolExecution).toHaveBeenNthCalledWith(2, 1)
    } finally {
      releaseFirstPreflight.resolve()
    }

    await expect(turn).resolves.toMatchObject({
      finalMessage: 'overlapping progress complete',
      threadId: 'thread-overlapping-preflight',
      turnId: 'turn-overlapping-preflight',
    })
    expect(codexMocks.dynamicToolCalls).toEqual([
      {
        deliveryContextOrdinal: 1,
        kind: 'send-progress-update',
        voiceMemoRuntime: null,
      },
      {
        deliveryContextOrdinal: 1,
        kind: 'send-progress-update',
        voiceMemoRuntime: null,
      },
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

  it('serializes pending-file listing and cancellation in provider command order', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-pending-file-order-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-pending-file-order-home-',
    )
    const firstStarted = createDeferred<void>()
    const releaseFirst = createDeferred<void>()
    const executionOrder: string[] = []
    codexMocks.onDynamicToolCall = async ({ kind }) => {
      if (
        kind !== 'pending-vault-files-list'
        && kind !== 'pending-vault-files-cancel'
      ) {
        return
      }
      executionOrder.push(kind)
      if (kind === 'pending-vault-files-list') {
        firstStarted.resolve()
        await releaseFirst.promise
      }
    }
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedOverlappingPendingVaultFilesTurn(child)
      })
      return child
    })

    const turn = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome,
      dynamicTools: resolveMurphDynamicTools({
        pendingVaultFilesAvailable: true,
      }),
      env: {
        CODEX_HOME: codexHome,
        PATH: '/usr/bin',
      },
      prompt: 'List and cancel one pending generated file.',
      sandbox: 'workspace-write',
      workingDirectory,
    })

    await firstStarted.promise
    await Promise.resolve()
    const orderWhileFirstWasPending = [...executionOrder]
    releaseFirst.resolve()

    await expect(turn).resolves.toMatchObject({
      finalMessage: 'pending file ordered',
      threadId: 'thread-pending-file-order',
      turnId: 'turn-pending-file-order',
    })
    expect(orderWhileFirstWasPending).toEqual([
      'pending-vault-files-list',
    ])
    expect(executionOrder).toEqual([
      'pending-vault-files-list',
      'pending-vault-files-cancel',
    ])
  })

  it('keeps invalid computer calls in the serialized provider command order', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-invalid-computer-order-work-',
    )
    const codexHome = await createTempDir(
      'assistant-codex-invalid-computer-order-home-',
    )
    const invalidStarted = createDeferred<void>()
    const releaseInvalid = createDeferred<void>()
    const executionOrder: string[] = []
    codexMocks.onDynamicToolCall = async ({ kind }) => {
      executionOrder.push(kind)
      if (kind === 'invalid-computer-arguments') {
        invalidStarted.resolve()
        await releaseInvalid.promise
      }
    }
    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      queueMicrotask(() => {
        void runScriptedInvalidComputerThenStyleTurn(child)
      })
      return child
    })

    const turn = executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome,
      dynamicTools: resolveMurphDynamicTools({
        assistantStyleSettingsAvailable: true,
        computerToolsAvailable: true,
        progressUpdatesAvailable: false,
      }),
      env: {
        CODEX_HOME: codexHome,
        PATH: '/usr/bin',
      },
      prompt: 'Try the computer, then set humor.',
      sandbox: 'workspace-write',
      workingDirectory,
    })

    await invalidStarted.promise
    await Promise.resolve()
    const orderWhileInvalidWasPending = [...executionOrder]
    releaseInvalid.resolve()

    await expect(turn).resolves.toMatchObject({
      finalMessage: 'invalid computer ordered',
      threadId: 'thread-invalid-computer-order',
      turnId: 'turn-invalid-computer-order',
    })
    expect(orderWhileInvalidWasPending).toEqual([
      'invalid-computer-arguments',
    ])
    expect(executionOrder).toEqual([
      'invalid-computer-arguments',
      'assistant-style',
    ])
  })
})

async function runScriptedTerminalGroupEmailTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: { thread: { id: 'thread-group-email-terminal' } },
  }))
  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: { turn: { id: 'turn-group-email-terminal' } },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: { turn: { id: 'turn-group-email-terminal' } },
  }))
  child.stdout.write(jsonLine({
    id: 41,
    method: 'item/tool/call',
    params: {
      arguments: {
        action: 'send_email',
        html: '<p>Group update</p>',
        subject: 'Group update',
        text: 'Group update',
      },
      callId: 'call-41',
      namespace: 'murph',
      threadId: 'thread-group-email-terminal',
      tool: 'group',
      turnId: 'turn-group-email-terminal',
    },
  }))
  const interrupt = await child.waitForRpcMethod('turn/interrupt')
  child.stdout.write(jsonLine({ id: interrupt.id, result: {} }))
  child.stdout.write(jsonLine({
    method: 'serverRequest/resolved',
    params: {
      requestId: 41,
      threadId: 'thread-group-email-terminal',
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: { id: 'turn-group-email-terminal', status: 'interrupted' },
    },
  }))
}

async function runScriptedOverlappingPendingVaultFilesTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: { thread: { id: 'thread-pending-file-order' } },
  }))
  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: { turn: { id: 'turn-pending-file-order' } },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: { turn: { id: 'turn-pending-file-order' } },
  }))

  child.stdout.write(jsonLine({
    id: 31,
    method: 'item/tool/call',
    params: {
      arguments: { action: 'list' },
      callId: 'call-31',
      namespace: 'murph',
      threadId: 'thread-pending-file-order',
      tool: 'pending_vault_files',
      turnId: 'turn-pending-file-order',
    },
  }))
  child.stdout.write(jsonLine({
    id: 32,
    method: 'item/tool/call',
    params: {
      arguments: {
        action: 'cancel',
        intentIds: [`outbox_${'a'.repeat(32)}`],
      },
      callId: 'call-32',
      namespace: 'murph',
      threadId: 'thread-pending-file-order',
      tool: 'pending_vault_files',
      turnId: 'turn-pending-file-order',
    },
  }))
  await child.waitForRpcId(31)
  await child.waitForRpcId(32)
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-pending-file-order',
        text: 'pending file ordered',
        type: 'agentMessage',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: { id: 'turn-pending-file-order', status: 'completed' },
    },
  }))
}

async function runScriptedRequestContextTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: { thread: { id: 'thread-request-context' } },
  }))
  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: { turn: { id: 'turn-request-context' } },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: { turn: { id: 'turn-request-context' } },
  }))
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'user-request-context-initial',
        text: 'Handle two tool requests and both live follow ups.',
        type: 'userMessage',
      },
    },
  }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  child.stdout.write(
    jsonLine({
      id: 31,
      method: 'item/tool/call',
      params: {
        arguments: {},
        callId: 'call-31',
        namespace: 'murph',
        threadId: 'thread-request-context',
        tool: 'finish_without_reply',
        turnId: 'turn-request-context',
      },
    }) + jsonLine({
      method: 'item/completed',
      params: {
        item: {
          id: 'user-request-context-first-steer',
          text: 'Actually, please keep going.',
          type: 'userMessage',
        },
      },
    }),
  )
  await child.waitForRpcId(31)

  child.stdout.write(
    jsonLine({
      id: 32,
      method: 'item/tool/call',
      params: {
        arguments: { text: 'Continuing with the update.' },
        callId: 'call-32',
        namespace: 'murph',
        threadId: 'thread-request-context',
        tool: 'send_progress_update',
        turnId: 'turn-request-context',
      },
    }) + jsonLine({
      method: 'item/completed',
      params: {
        item: {
          id: 'user-request-context-second-steer',
          text: 'Please answer this latest follow up too.',
          type: 'userMessage',
        },
      },
    }),
  )
  await child.waitForRpcId(32)
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-request-context',
        text: 'The latest follow up still receives this reply.',
        type: 'agentMessage',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: { id: 'turn-request-context', status: 'completed' },
    },
  }))
}

async function runScriptedOverlappingProgressTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: { thread: { id: 'thread-overlapping-preflight' } },
  }))
  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: { turn: { id: 'turn-overlapping-preflight' } },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: { turn: { id: 'turn-overlapping-preflight' } },
  }))
  for (const [id, message] of [
    ['user-overlapping-initial', 'Run both progress tools.'],
    ['user-overlapping-steered', 'Include this follow up.'],
  ] as const) {
    child.stdout.write(jsonLine({
      method: 'item/completed',
      params: {
        item: {
          id,
          text: message,
          type: 'userMessage',
        },
      },
    }))
  }
  await new Promise((resolve) => setTimeout(resolve, 0))

  for (const [id, text] of [
    [21, 'Checking the first item.'],
    [22, 'Checking the second item.'],
  ] as const) {
    child.stdout.write(jsonLine({
      id,
      method: 'item/tool/call',
      params: {
        arguments: { text },
        callId: `call-${id}`,
        namespace: 'murph',
        threadId: 'thread-overlapping-preflight',
        tool: 'send_progress_update',
        turnId: 'turn-overlapping-preflight',
      },
    }))
  }
  await child.waitForRpcId(21)
  await child.waitForRpcId(22)
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-overlapping-preflight',
        text: 'overlapping progress complete',
        type: 'agentMessage',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: { id: 'turn-overlapping-preflight', status: 'completed' },
    },
  }))
}

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
        callId: `call-${id}`,
        namespace: 'murph',
        threadId: 'thread-style-order',
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
        text: 'ordered',
        type: 'agentMessage',
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

async function runScriptedInvalidComputerThenStyleTurn(
  child: MockChildProcess,
): Promise<void> {
  const initialize = await child.waitForRpcMethod('initialize')
  child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
  const threadStart = await child.waitForRpcMethod('thread/start')
  child.stdout.write(jsonLine({
    id: threadStart.id,
    result: { thread: { id: 'thread-invalid-computer-order' } },
  }))
  const turnStart = await child.waitForRpcMethod('turn/start')
  child.stdout.write(jsonLine({
    id: turnStart.id,
    result: { turn: { id: 'turn-invalid-computer-order' } },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/started',
    params: { turn: { id: 'turn-invalid-computer-order' } },
  }))

  child.stdout.write(jsonLine({
    id: 13,
    method: 'item/tool/call',
    params: {
      arguments: { runId: 'run_123' },
      callId: 'call-13',
      namespace: 'murph',
      threadId: 'thread-invalid-computer-order',
      tool: 'computer_act',
      turnId: 'turn-invalid-computer-order',
    },
  }))
  child.stdout.write(jsonLine({
    id: 14,
    method: 'item/tool/call',
    params: {
      arguments: { action: 'set', setting: 'humor', value: 6 },
      callId: 'call-14',
      namespace: 'murph',
      threadId: 'thread-invalid-computer-order',
      tool: 'assistant_style',
      turnId: 'turn-invalid-computer-order',
    },
  }))
  await child.waitForRpcId(13)
  await child.waitForRpcId(14)
  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-invalid-computer-order',
        text: 'invalid computer ordered',
        type: 'agentMessage',
      },
    },
  }))
  child.stdout.write(jsonLine({
    method: 'turn/completed',
    params: {
      turn: { id: 'turn-invalid-computer-order', status: 'completed' },
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
    method: 'item/completed',
    params: {
      item: {
        id: 'user-dynamic-runtime-initial',
        text: 'Use four tools.',
        type: 'userMessage',
      },
    },
  }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  child.stdout.write(jsonLine({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: {
        text: 'Checking one thing.',
      },
      callId: 'call-1',
      namespace: 'murph',
      threadId: 'thread-dynamic-runtime',
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
      callId: 'call-2',
      namespace: 'murph',
      threadId: 'thread-dynamic-runtime',
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
        durationSeconds: 30,
        instrumental: false,
        prompt: 'An original group theme.',
      },
      callId: 'call-3',
      namespace: 'murph',
      threadId: 'thread-dynamic-runtime',
      tool: 'generate_song',
      turnId: 'turn-dynamic-runtime',
    },
  }))
  await child.waitForRpcId(3)

  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'user-dynamic-runtime-steered',
        text: 'Show my current style too.',
        type: 'userMessage',
      },
    },
  }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  child.stdout.write(jsonLine({
    id: 4,
    method: 'item/tool/call',
    params: {
      arguments: {
        action: 'show',
      },
      callId: 'call-4',
      namespace: 'murph',
      threadId: 'thread-dynamic-runtime',
      tool: 'assistant_style',
      turnId: 'turn-dynamic-runtime',
    },
  }))
  await child.waitForRpcId(4)

  child.stdout.write(jsonLine({
    method: 'item/completed',
    params: {
      item: {
        id: 'assistant-dynamic-runtime',
        text: 'done',
        type: 'agentMessage',
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
