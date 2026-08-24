import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, test, vi } from 'vitest'

const codexMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  )

  return {
    ...actual,
    spawn: codexMocks.spawn,
  }
})

import {
  buildCodexAppServerArgs,
  executeCodexAppServerTurn as executeCodexAppServerTurnUnchecked,
  extractCodexTraceUpdates,
  resolveMurphDynamicTools,
  resolveCodexDisplayOptions,
  stopWarmCodexAppServer,
  type CodexAppServerTurnInput,
} from '@murphai/assistant-engine/assistant-codex'

const cleanupPaths: string[] = []

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
      voiceMemoGenerationAvailable: input.voiceMemoRuntime != null,
    }),
  })
}

beforeEach(() => {
  codexMocks.spawn.mockReset()
})

afterEach(async () => {
  await stopWarmCodexAppServer('test-cleanup')
  vi.restoreAllMocks()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

test('buildCodexAppServerArgs keeps sandbox and approval out of process args', () => {
  const args = buildCodexAppServerArgs({
    approvalPolicy: 'never',
    configOverrides: ['mcp_servers.murph_memory.command="node"'],
    oss: true,
    profile: 'primary',
    sandbox: 'read-only',
  })

  assert.deepEqual(args, [
    '--config',
    'mcp_servers.murph_memory.command="node"',
    '--profile',
    'primary',
    '--oss',
    'app-server',
  ])
})

test('resolveCodexDisplayOptions still honors config defaults and explicit overrides', async () => {
  const configRoot = await createTempDir('assistant-codex-cli-config-')
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
    ].join('\n'),
    'utf8',
  )

  assert.deepEqual(await resolveCodexDisplayOptions({ configPath }), {
    model: 'daily-model',
    reasoningEffort: 'high',
  })
  assert.deepEqual(
    await resolveCodexDisplayOptions({
      configPath,
      model: 'manual-model',
      profile: 'daily',
    }),
    {
      model: 'manual-model',
      reasoningEffort: 'high',
    },
  )
})

test('executeCodexAppServerTurn runs the JSON-RPC lifecycle and returns streamed assistant output', async () => {
  const workingDirectory = await createTempDir('assistant-codex-cli-runtime-')
  const codexHome = await createTempDir('assistant-codex-cli-home-')
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff])
  const progressEvents: Array<{
    id: string | null
    kind: string
    state: string
    text: string
  }> = []
  const traceUpdates: Array<{
    kind: string
    mode?: string
    streamKey?: string | null
    text: string
  }> = []
  const progressDelivery = {
    send: vi.fn(
      async (
        _text: string,
        options?: { source?: 'model' | 'system' },
      ) => ({
        kind: 'sent' as const,
        source: options?.source ?? 'model',
      }),
    ),
  }
  const voiceMemoRuntime = {
    elevenLabs: {
      apiKeyAvailable: true,
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice_murph',
    },
    kind: 'telegram' as const,
  }

  codexMocks.spawn.mockImplementation((_command, args, options) => {
    const child = new MockChildProcess()
    const expectedWorkingDirectory = path.resolve(workingDirectory)

    assert.deepEqual(args, ['app-server'])
    assert.deepEqual(options, {
      cwd: tmpdir(),
      detached: true,
      env: {
        CODEX_HOME: codexHome,
        PATH: '/custom/bin',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    queueMicrotask(() => {
      void (async () => {
        let messages = await waitForRpcMessages(child, 1)
        assert.deepEqual(messages[0], {
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {
              experimentalApi: true,
            },
            clientInfo: {
              name: 'murph',
              title: 'Murph',
              version: '1.0.0',
            },
          },
        })
        child.stdout.write(jsonLine({ id: 1, result: {} }))

        messages = await waitForRpcMessages(child, 3)
        assert.deepEqual(messages[1], {
          method: 'initialized',
          params: {},
        })
        const threadStart = messages[2]
        const dynamicTools = readDynamicTools(threadStart)
        assert.deepEqual(
          dynamicTools.map((tool) => tool.name).sort(),
          [
            'attach_response_media',
            'finish_without_reply',
            'generate_image',
            'generate_song',
            'generate_voice_memo',
            'send_progress_update',
          ],
        )
        const progressTool = requireDynamicTool(dynamicTools, 'send_progress_update')
        assert.equal(progressTool.namespace, 'murph')
        assertDynamicToolDescription(progressTool)
        assertDynamicToolInputSchema(progressTool)
        const responseMediaTool = requireDynamicTool(
          dynamicTools,
          'attach_response_media',
        )
        assert.equal(responseMediaTool.namespace, 'murph')
        assertDynamicToolDescription(responseMediaTool)
        assertDynamicToolInputSchema(responseMediaTool)
        const generateImageTool = requireDynamicTool(dynamicTools, 'generate_image')
        assert.equal(generateImageTool.namespace, 'murph')
        assertDynamicToolDescription(generateImageTool)
        assertDynamicToolInputSchema(generateImageTool)
        const generateVoiceMemoTool = requireDynamicTool(
          dynamicTools,
          'generate_voice_memo',
        )
        assert.equal(generateVoiceMemoTool.namespace, 'murph')
        assertDynamicToolDescription(generateVoiceMemoTool)
        assertDynamicToolInputSchema(generateVoiceMemoTool)
        const generateSongTool = requireDynamicTool(dynamicTools, 'generate_song')
        assert.equal(generateSongTool.namespace, 'murph')
        assertDynamicToolDescription(generateSongTool)
        assertDynamicToolInputSchema(generateSongTool)
        const finishWithoutReplyTool = requireDynamicTool(
          dynamicTools,
          'finish_without_reply',
        )
        assert.equal(finishWithoutReplyTool.namespace, 'murph')
        assertDynamicToolDescription(finishWithoutReplyTool)
        assertDynamicToolInputSchema(finishWithoutReplyTool)
        assert.deepEqual(threadStart, {
          id: 2,
          method: 'thread/start',
          params: {
            approvalPolicy: 'never',
            cwd: expectedWorkingDirectory,
            dynamicTools,
            model: 'gpt-5',
            sandbox: 'workspace-write',
            serviceName: 'murph',
          },
        })
        child.stdout.write(
          jsonLine({
            id: 2,
            result: {
              thread: {
                id: 'thread-public-1',
              },
            },
          }),
        )

        messages = await waitForRpcMessages(child, 4)
        const turnStart = messages[3]
        assert.deepEqual(turnStart, {
          id: 3,
          method: 'turn/start',
          params: {
            effort: 'high',
            input: [
              {
                type: 'text',
                text: 'Summarize the vault.',
              },
              {
                type: 'localImage',
                path: assertLocalImagePath(readTurnStartInputItems(turnStart)[1]),
              },
            ],
            model: 'gpt-5',
            serviceTier: null,
            threadId: 'thread-public-1',
          },
        })
        assert.equal(asRecord(turnStart.params).approvalPolicy, undefined)
        assert.equal(asRecord(turnStart.params).cwd, undefined)
        assert.equal(asRecord(turnStart.params).sandboxPolicy, undefined)
        const imagePath = assertLocalImagePath(readTurnStartInputItems(turnStart)[1])
        assert.equal(path.extname(imagePath), '.jpg')
        assert.deepEqual(await readFile(imagePath), imageBytes)

        child.stdout.write(
          jsonLine({
            id: 3,
            result: {
              turn: {
                id: 'turn-public-1',
              },
            },
          }),
        )
        child.stdout.write(
          jsonLine({
            method: 'turn/started',
            params: {
              threadId: 'thread-public-1',
              turn: createCodexTurn('turn-public-1', 'inProgress'),
            },
          }),
        )
        child.stderr.write('Retrying after timeout\n')
        child.stdout.write(
          jsonLine({
            method: 'item/started',
            params: {
              item: {
                aggregatedOutput: null,
                command: 'pwd',
                commandActions: [],
                cwd: expectedWorkingDirectory,
                durationMs: null,
                exitCode: null,
                id: 'command-public-1',
                processId: null,
                source: 'agent',
                status: 'inProgress',
                type: 'commandExecution',
              },
              startedAtMs: 1,
              threadId: 'thread-public-1',
              turnId: 'turn-public-1',
            },
          }),
        )
        child.stdout.write(
          jsonLine({
            method: 'item/agentMessage/delta',
            params: {
              delta: 'Hello ',
              itemId: 'assistant-public-1',
              threadId: 'thread-public-1',
              turnId: 'turn-public-1',
            },
          }),
        )
        child.stdout.write(
          jsonLine({
            method: 'item/completed',
            params: {
              completedAtMs: 2,
              item: {
                id: 'assistant-public-1',
                memoryCitation: null,
                phase: 'final_answer',
                text: 'Hello world',
                type: 'agentMessage',
              },
              threadId: 'thread-public-1',
              turnId: 'turn-public-1',
            },
          }),
        )
        child.stdout.write(
          jsonLine({
            method: 'turn/completed',
            params: {
              threadId: 'thread-public-1',
              turn: createCodexTurn('turn-public-1', 'completed'),
            },
          }),
        )
      })()
    })

    return child
  })

  const result = await executeCodexAppServerTurn({
    approvalPolicy: 'never',
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
    model: 'gpt-5',
    onProgress(event) {
      progressEvents.push({
        id: event.id,
        kind: event.kind,
        state: event.state,
        text: event.text,
      })
    },
    onTraceEvent(event) {
      for (const update of event.updates) {
        traceUpdates.push({
          kind: update.kind,
          mode: 'mode' in update ? update.mode : undefined,
          streamKey: 'streamKey' in update ? update.streamKey : undefined,
          text: update.text,
        })
      }
    },
    prompt: 'Summarize the vault.',
    progressDelivery,
    reasoningEffort: 'high',
    sandbox: 'workspace-write',
    voiceMemoRuntime,
    workingDirectory,
  })

  assert.equal(result.finalMessage, 'Hello world')
  assert.equal(result.providerActionCount, 1)
  assert.equal(result.sessionId, 'thread-public-1')
  assert.equal(result.stderr, 'Retrying after timeout')
  assert.ok(progressEvents.some((event) => event.kind === 'status' && event.text === 'Retrying after timeout'))
  assert.ok(
    progressEvents.some(
      (event) =>
        event.id === 'assistant-public-1' &&
        event.kind === 'message' &&
        event.state === 'completed' &&
        event.text === 'Hello world',
    ),
  )
  assert.ok(
    traceUpdates.some(
      (update) =>
        update.kind === 'assistant' &&
        update.mode === 'append' &&
        update.streamKey === 'assistant:assistant-public-1' &&
        update.text === 'Hello ',
    ),
  )
})

test('executeCodexAppServerTurn rejects unreadable image paths before spawn', async () => {
  const workingDirectory = await createTempDir('assistant-codex-cli-image-')
  const imagePath = path.join(workingDirectory, 'private.png')

  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await chmod(imagePath, 0o000)

  await assert.rejects(
    executeCodexAppServerTurn({
      images: [
        {
          path: imagePath,
          mimeType: 'image/png',
        },
      ],
      prompt: 'Use the image.',
      workingDirectory,
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ASSISTANT_CODEX_IMAGE_INVALID')
      assert.equal(
        (error as { message?: string }).message,
        'Codex app-server image input path is not readable.',
      )
      return true
    },
  )

  assert.equal(codexMocks.spawn.mock.calls.length, 0)
})

test('executeCodexAppServerTurn fails closed on unsupported approval policies before spawn', async () => {
  await assert.rejects(
    executeCodexAppServerTurn({
      approvalPolicy: 'on-request',
      prompt: 'Require approval.',
      workingDirectory: '/tmp/vault',
    }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        'ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED',
      )
      assert.match(
        String((error as { message?: string }).message),
        /approvalPolicy=never/u,
      )
      return true
    },
  )

  assert.equal(codexMocks.spawn.mock.calls.length, 0)
})

test('executeCodexAppServerTurn classifies resume RPC failures as stale provider threads', async () => {
  const workingDirectory = await createTempDir('assistant-codex-cli-stale-')

  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()

    queueMicrotask(() => {
      void (async () => {
        await waitForRpcMethod(child, 'initialize')
        child.stdout.write(jsonLine({ id: 1, result: {} }))
        const threadResume = await waitForRpcMethod(child, 'thread/resume')
        assert.deepEqual(asRecord(threadResume.params), {
          approvalPolicy: 'never',
          cwd: path.resolve(workingDirectory),
          excludeTurns: true,
          threadId: 'stale-thread',
        })
        child.stdout.write(
          jsonLine({
            id: 2,
            error: {
              code: -32_000,
              message: 'thread/resume failed: no rollout found for thread id stale-thread',
            },
          }),
        )
      })()
    })

    return child
  })

  await assert.rejects(
    executeCodexAppServerTurn({
      prompt: 'Resume the previous turn.',
      resumeSessionId: 'stale-thread',
      workingDirectory,
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ASSISTANT_CODEX_RESUME_STALE')
      assert.match(
        String((error as { message?: string }).message),
        /no rollout found for thread id stale-thread/u,
      )
      return true
    },
  )
})

test('executeCodexAppServerTurn interrupts the child and records the provider thread when aborted', async () => {
  const workingDirectory = await createTempDir('assistant-codex-cli-abort-')
  const controller = new AbortController()
  let spawnedChild: MockChildProcess | null = null
  const processGroupKill = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('mock process group not found'), {
      code: 'ESRCH',
    })
  })

  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()
    spawnedChild = child

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
                id: 'thread-abort-public',
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
                id: 'turn-abort-public',
              },
            },
          }),
        )
        child.stdout.write(
          jsonLine({
            method: 'turn/started',
            params: {
              threadId: 'thread-abort-public',
              turn: createCodexTurn('turn-abort-public', 'inProgress'),
            },
          }),
        )
        controller.abort()
      })()
    })

    return child
  })

  await assert.rejects(
    executeCodexAppServerTurn({
      abortSignal: controller.signal,
      prompt: 'Abort the turn.',
      workingDirectory,
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ASSISTANT_CODEX_INTERRUPTED')
      const context = (error as { context?: Record<string, unknown> }).context ?? {}
      assert.equal(context.codexThreadIdPresent, true)
      assert.equal('codexThreadId' in context, false)
      assert.equal('providerSessionId' in context, false)
      return true
    },
  )

  const child = requireMockChildProcess(spawnedChild)
  const messages = await waitForRpcMessages(child, 5)
  assert.deepEqual(messages[4], {
    id: 4,
    method: 'turn/interrupt',
    params: {
      threadId: 'thread-abort-public',
      turnId: 'turn-abort-public',
    },
  })
  assert.deepEqual(child.kill.mock.calls, [
    ['SIGINT'],
    ['SIGKILL'],
    ['SIGKILL'],
  ])
  assert.deepEqual(processGroupKill.mock.calls, [
    [-1234, 'SIGINT'],
    [-1234, 'SIGKILL'],
    [-1234, 'SIGKILL'],
  ])
})

test('extractCodexTraceUpdates stays usable through the public assistant-engine codex export', () => {
  assert.deepEqual(
    extractCodexTraceUpdates({
      method: 'item/agentMessage/delta',
      params: {
        delta: 'token',
        itemId: 'assistant-export-1',
        threadId: 'thread-export-1',
        turnId: 'turn-export-1',
      },
    }),
    [
      {
        kind: 'assistant',
        mode: 'append',
        streamKey: 'assistant:assistant-export-1',
        text: 'token',
      },
    ],
  )
})

function createCodexTurn(
  id: string,
  status: 'completed' | 'inProgress',
): Record<string, unknown> {
  const completed = status === 'completed'
  return {
    completedAt: completed ? 1 : null,
    durationMs: completed ? 1 : null,
    error: null,
    id,
    items: [],
    itemsView: 'full',
    startedAt: 0,
    status,
  }
}

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
  readonly writes: string[] = []

  write(chunk: string | Uint8Array): boolean {
    this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  }

  end(chunk?: string | Uint8Array): void {
    if (typeof chunk === 'string') {
      this.writes.push(chunk)
    } else if (chunk) {
      this.writes.push(Buffer.from(chunk).toString('utf8'))
    }
    this.emit('finish')
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.push(rootPath)
  return rootPath
}

function jsonLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify(payload)}\n`
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

function readDynamicTools(
  message: Record<string, unknown>,
): Record<string, unknown>[] {
  const params = asRecord(message.params)
  const dynamicTools = params.dynamicTools
  if (!Array.isArray(dynamicTools)) {
    throw new TypeError('Expected thread/start params.dynamicTools to be an array.')
  }
  return dynamicTools.map((tool) => asRecord(tool))
}

function requireDynamicTool(
  dynamicTools: readonly Record<string, unknown>[],
  name: string,
): Record<string, unknown> {
  const tool = dynamicTools.find((candidate) => candidate.name === name)
  if (!tool) {
    throw new TypeError(`Expected Murph dynamic tool ${name}.`)
  }
  return tool
}

function assertDynamicToolDescription(tool: Record<string, unknown>): string {
  const description = tool.description
  assert.equal(typeof description, 'string')
  if (typeof description !== 'string') {
    throw new TypeError('Expected dynamic tool description to be a string.')
  }
  return description
}

function assertDynamicToolInputSchema(tool: Record<string, unknown>): unknown {
  const inputSchema = tool.inputSchema
  assert.ok(inputSchema)
  return inputSchema
}

function assertLocalImagePath(item: Record<string, unknown>): string {
  const localImagePath = item.path
  assert.equal(typeof localImagePath, 'string')
  if (typeof localImagePath !== 'string') {
    throw new TypeError('Expected a localImage path string.')
  }
  return localImagePath
}

function requireMockChildProcess(
  child: MockChildProcess | null,
): MockChildProcess {
  assert.ok(child)
  return child
}

test('resolveCodexDisplayOptions defaults to nulls when the config file is missing', async () => {
  const configPath = path.join(homedir(), '.codex', 'definitely-missing-config.toml')
  assert.deepEqual(await resolveCodexDisplayOptions({ configPath }), {
    model: null,
    reasoningEffort: null,
  })
})
