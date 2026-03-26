import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
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
  buildCodexArgs,
  executeCodexPrompt,
  extractCodexTraceUpdates,
  resolveCodexDisplayOptions,
} from '../src/assistant-codex.js'

const cleanupPaths: string[] = []

beforeEach(() => {
  codexMocks.spawn.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  return Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

test('buildCodexArgs includes sandbox and approval flags for fresh exec sessions', () => {
  const args = buildCodexArgs({
    prompt: 'Summarize the vault.',
    workingDirectory: '/tmp/vault',
    outputFile: '/tmp/last-message.txt',
    configOverrides: ['mcp_servers.healthybob_memory.command="node"'],
    model: 'o3',
    reasoningEffort: 'xhigh',
    sandbox: 'read-only',
    approvalPolicy: 'never',
    profile: 'primary',
    oss: true,
  })

  assert.deepEqual(args, [
    '--ask-for-approval',
    'never',
    '--config',
    'mcp_servers.healthybob_memory.command="node"',
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--output-last-message',
    '/tmp/last-message.txt',
    '--cd',
    '/tmp/vault',
    '--sandbox',
    'read-only',
    '--oss',
    '--profile',
    'primary',
    '--model',
    'o3',
    '--config',
    'model_reasoning_effort="xhigh"',
    'Summarize the vault.',
  ])
})

test('buildCodexArgs keeps approval as a root flag and omits sandbox when resuming exec sessions', () => {
  const args = buildCodexArgs({
    prompt: 'What changed?',
    workingDirectory: '/tmp/vault',
    outputFile: '/tmp/last-message.txt',
    resumeSessionId: 'thread-123',
    configOverrides: ['mcp_servers.healthybob_memory.required=true'],
    model: 'o3',
    reasoningEffort: 'high',
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    profile: 'primary',
    oss: true,
  })

  assert.deepEqual(args, [
    '--ask-for-approval',
    'on-request',
    '--config',
    'mcp_servers.healthybob_memory.required=true',
    'exec',
    'resume',
    'thread-123',
    '--json',
    '--skip-git-repo-check',
    '--output-last-message',
    '/tmp/last-message.txt',
    '--model',
    'o3',
    '--config',
    'model_reasoning_effort="high"',
    'What changed?',
  ])
})

test('executeCodexPrompt returns parsed events, discovered session id, and file-backed final output', async () => {
  installSpawnMock(async (child, args) => {
    const outputFile = readOutputFilePath(args)

    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' })}\n`,
    )
    child.stdout.emit('data', 'plain stdout line\n')
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'turn.completed', summary: 'done' })}\n`,
    )
    child.stderr.emit('data', 'stderr line\n')
    await writeFile(outputFile, 'final response from file\n', 'utf8')
    child.emit('close', 0, null)
  })

  const result = await executeCodexPrompt({
    prompt: 'Summarize the vault.',
    workingDirectory: '/tmp/vault',
  })

  assert.equal(result.finalMessage, 'final response from file')
  assert.equal(result.sessionId, 'thread-123')
  assert.equal(result.jsonEvents.length, 2)
  assert.match(result.stdout, /plain stdout line/u)
  assert.equal(result.stderr, 'stderr line')
})

test('executeCodexPrompt falls back to non-JSON stdout when the last-message file is missing', async () => {
  installSpawnMock((child) => {
    child.stdout.emit('data', 'first fallback line\n')
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-456' })}\n`,
    )
    child.stdout.emit('data', 'second fallback line')
    child.emit('close', 0, null)
  })

  const result = await executeCodexPrompt({
    prompt: 'What changed?',
    workingDirectory: '/tmp/vault',
  })

  assert.equal(result.finalMessage, 'first fallback line\nsecond fallback line')
  assert.equal(result.sessionId, 'thread-456')
})

test('executeCodexPrompt emits progress events and can fall back to the last agent-message item', async () => {
  installSpawnMock((child) => {
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'item.started', item: { id: 'reason-1', type: 'reasoning' } })}\n`,
    )
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'item.started', item: { id: 'cmd-1', type: 'command_execution', command: 'bash -lc ls' } })}\n`,
    )
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'agent message fallback' } })}\n`,
    )
    child.emit('close', 0, null)
  })

  const progressEvents: Array<{
    id: string | null
    kind: string
    state: string
    text: string
  }> = []

  const result = await executeCodexPrompt({
    prompt: 'Trace the run.',
    workingDirectory: '/tmp/vault',
    onProgress(event) {
      progressEvents.push({
        id: event.id,
        kind: event.kind,
        state: event.state,
        text: event.text,
      })
    },
  })

  assert.equal(result.finalMessage, 'agent message fallback')
  assert.deepEqual(progressEvents, [
    {
      id: 'reason-1',
      kind: 'reasoning',
      state: 'running',
      text: 'Thinking…',
    },
    {
      id: 'cmd-1',
      kind: 'command',
      state: 'running',
      text: '$ bash -lc ls',
    },
    {
      id: 'msg-1',
      kind: 'message',
      state: 'completed',
      text: 'agent message fallback',
    },
  ])
})

test('executeCodexPrompt ignores a blank last-message file and falls back to assistant output', async () => {
  installSpawnMock(async (child, args) => {
    const outputFile = readOutputFilePath(args)
    await writeFile(outputFile, '  \n', 'utf8')
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'item.completed', item: { id: 'item-blank-1', type: 'agent_message', text: 'assistant reply from blank-file fallback' } })}\n`,
    )
    child.emit('close', 0, null)
  })

  const result = await executeCodexPrompt({
    prompt: 'What changed?',
    workingDirectory: '/tmp/vault',
  })

  assert.equal(result.finalMessage, 'assistant reply from blank-file fallback')
})

test('executeCodexPrompt emits reconnect status events and classifies connection losses as resumable failures', async () => {
  installSpawnMock((child) => {
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-reconnect-1' })}\n`,
    )
    child.stderr.emit(
      'data',
      'Network error while contacting OpenAI.\nRe-connecting...\nExceeded retry limit.\n',
    )
    child.emit('close', 1, null)
  })

  const progressEvents: Array<{
    id: string | null
    kind: string
    state: string
    text: string
  }> = []

  await assert.rejects(
    executeCodexPrompt({
      prompt: 'Reconnect after a network error.',
      workingDirectory: '/tmp/vault',
      onProgress(event) {
        progressEvents.push({
          id: event.id,
          kind: event.kind,
          state: event.state,
          text: event.text,
        })
      },
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_CONNECTION_LOST')
      assert.equal(error.context?.providerSessionId, 'thread-reconnect-1')
      assert.equal(error.context?.retryable, true)
      assert.match(String(error.message), /lost its connection/u)
      return true
    },
  )

  assert.deepEqual(progressEvents, [
    {
      id: 'codex-connection-status',
      kind: 'status',
      state: 'completed',
      text: 'Network error while contacting OpenAI.',
    },
    {
      id: 'codex-connection-status',
      kind: 'status',
      state: 'running',
      text: 'Re-connecting...',
    },
    {
      id: 'codex-connection-status',
      kind: 'status',
      state: 'completed',
      text: 'Exceeded retry limit.',
    },
  ])
})

test('executeCodexPrompt interrupts the spawned Codex process when aborted', async () => {
  const abortController = new AbortController()
  let spawnedChild: MockChildProcess | null = null

  installSpawnMock((child) => {
    spawnedChild = child
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-pause-1' })}\n`,
    )
    abortController.abort()
  })

  await assert.rejects(
    executeCodexPrompt({
      prompt: 'Pause the current turn.',
      workingDirectory: '/tmp/vault',
      abortSignal: abortController.signal,
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_INTERRUPTED')
      assert.equal(error.context?.interrupted, true)
      assert.equal(error.context?.providerSessionId, 'thread-pause-1')
      return true
    },
  )

  const killMock = (spawnedChild as MockChildProcess | null)?.kill as any
  assert.deepEqual(killMock?.mock?.calls, [['SIGINT']])
})

test('executeCodexPrompt does not misclassify MCP initialize failures as provider connection loss', async () => {
  installSpawnMock((child) => {
    child.stderr.emit(
      'data',
      '2026-03-24T03:30:58.077933Z ERROR codex_core::codex: Failed to create session: required MCP servers failed to initialize: healthybob_cron: handshaking with MCP server failed: connection closed: initialize response; healthybob_memory: handshaking with MCP server failed: connection closed: initialize response\n',
    )
    child.stderr.emit(
      'data',
      'Error: thread/resume: thread/resume failed: error resuming thread: Fatal error: Failed to initialize session: required MCP servers failed to initialize: healthybob_cron: handshaking with MCP server failed: connection closed: initialize response; healthybob_memory: handshaking with MCP server failed: connection closed: initialize response\n',
    )
    child.emit('close', 1, null)
  })

  await assert.rejects(
    executeCodexPrompt({
      prompt: 'Retry the resumed turn.',
      workingDirectory: '/tmp/vault',
      resumeSessionId: 'thread-existing',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_FAILED')
      assert.match(
        String(error.message),
        /required MCP servers failed to initialize/u,
      )
      assert.doesNotMatch(String(error.message), /lost its connection/u)
      assert.equal(error.context?.connectionLost, false)
      assert.equal(error.context?.recoverableConnectionLoss, false)
      assert.equal(error.context?.providerSessionId, null)
      return true
    },
  )
})

test('executeCodexPrompt translates missing codex executables into ASSISTANT_CODEX_NOT_FOUND', async () => {
  installSpawnMock((child) => {
    const error = Object.assign(new Error('spawn codex ENOENT'), {
      code: 'ENOENT',
    })
    child.emit('error', error)
  })

  await assert.rejects(
    executeCodexPrompt({
      prompt: 'Summarize the vault.',
      workingDirectory: '/tmp/vault',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_NOT_FOUND')
      assert.match(String(error.message), /was not found/u)
      return true
    },
  )
})

test('executeCodexPrompt prefers JSON error events when codex exits non-zero', async () => {
  installSpawnMock((child) => {
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'turn.error', error_message: 'provider auth failed' })}\n`,
    )
    child.stderr.emit('data', 'stderr tail that should not win\n')
    child.emit('close', 2, null)
  })

  await assert.rejects(
    executeCodexPrompt({
      prompt: 'Summarize the vault.',
      workingDirectory: '/tmp/vault',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_FAILED')
      assert.match(String(error.message), /provider auth failed/u)
      return true
    },
  )
})

test('resolveCodexDisplayOptions uses explicit model overrides but keeps reasoning from the active profile', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-codex-config-'))
  cleanupPaths.push(tempRoot)
  const configPath = path.join(tempRoot, 'config.toml')
  await writeFile(
    configPath,
    [
      'model = "gpt-5.4"',
      'model_reasoning_effort = "high"',
      'profile = "full_access"',
      '',
      '[profiles.full_access]',
      'model = "gpt-5.3-codex"',
      'model_reasoning_effort = "xhigh"',
      '',
      '[profiles.safe]',
      'model = "gpt-5.2"',
      'model_reasoning_effort = "medium"',
    ].join('\n'),
    'utf8',
  )

  await assert.doesNotReject(async () => {
    assert.deepEqual(
      await resolveCodexDisplayOptions({
        configPath,
        model: 'gpt-5.4-mini',
        profile: 'full_access',
      }),
      {
        model: 'gpt-5.4-mini',
        reasoningEffort: 'xhigh',
      },
    )
  })
})

test('resolveCodexDisplayOptions uses the configured default profile when no explicit profile is set', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-codex-config-'))
  cleanupPaths.push(tempRoot)
  const configPath = path.join(tempRoot, 'config.toml')
  await writeFile(
    configPath,
    [
      'model = "gpt-5.4"',
      'model_reasoning_effort = "xhigh"',
      'profile = "full_access"',
      '',
      '[profiles.full_access]',
      'model = "gpt-5.3-codex"',
      'model_reasoning_effort = "xhigh"',
    ].join('\n'),
    'utf8',
  )

  assert.deepEqual(
    await resolveCodexDisplayOptions({
      configPath,
    }),
    {
      model: 'gpt-5.3-codex',
      reasoningEffort: 'xhigh',
    },
  )
})

test('resolveCodexDisplayOptions falls back to top-level config defaults when no profile is configured', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-codex-config-'))
  cleanupPaths.push(tempRoot)
  const configPath = path.join(tempRoot, 'config.toml')
  await writeFile(
    configPath,
    [
      'model = "gpt-5.4"',
      'model_reasoning_effort = "xhigh"',
    ].join('\n'),
    'utf8',
  )

  assert.deepEqual(
    await resolveCodexDisplayOptions({
      configPath,
    }),
    {
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    },
  )
})

function installSpawnMock(
  runner: (child: MockChildProcess, args: string[]) => Promise<void> | void,
): void {
  codexMocks.spawn.mockImplementation((_command, args) => {
    const child = createMockChildProcess()
    queueMicrotask(() => {
      void Promise.resolve(runner(child, args as string[])).catch((error) => {
        child.emit('error', error)
      })
    })
    return child as any
  })
}

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    queueMicrotask(() => {
      child.emit('close', null, signal ?? 'SIGTERM')
    })
    return true
  })
  return child
}

function readOutputFilePath(args: string[]): string {
  const outputFlagIndex = args.indexOf('--output-last-message')
  assert.notEqual(outputFlagIndex, -1)
  const outputFile = args[outputFlagIndex + 1]
  assert.equal(typeof outputFile, 'string')
  return outputFile
}

interface MockChildProcess extends EventEmitter {
  kill: any
  stderr: EventEmitter
  stdout: EventEmitter
}


test('executeCodexPrompt falls back to the final assistant JSON item when the last-message file is missing', async () => {
  installSpawnMock((child) => {
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'assistant reply from json' } })}
`,
    )
    child.emit('close', 0, null)
  })

  const result = await executeCodexPrompt({
    prompt: 'What changed?',
    workingDirectory: '/tmp/vault',
  })

  assert.equal(result.finalMessage, 'assistant reply from json')
})

test('executeCodexPrompt marks recoverable connection loss failures with the recovered provider session id', async () => {
  installSpawnMock((child) => {
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-resume-1' })}
`,
    )
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'error', message: 'stream disconnected before completion: stream closed before response.completed' })}
`,
    )
    child.emit('close', 2, null)
  })

  await assert.rejects(
    executeCodexPrompt({
      prompt: 'Summarize the vault.',
      workingDirectory: '/tmp/vault',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_CONNECTION_LOST')
      assert.match(String(error.message), /lost its connection/u)
      assert.equal(error.context?.providerSessionId, 'thread-resume-1')
      assert.equal(error.context?.connectionLost, true)
      assert.equal(error.context?.recoverableConnectionLoss, true)
      return true
    },
  )
})

test('extractCodexTraceUpdates normalizes assistant, thinking, and reconnect status events', () => {
  assert.deepEqual(
    extractCodexTraceUpdates({
      type: 'item.completed',
      item: {
        id: 'reasoning-1',
        type: 'reasoning',
        summary: [
          {
            text: 'Checking the vault state before answering.',
          },
        ],
      },
    }),
    [
      {
        kind: 'thinking',
        mode: 'replace',
        streamKey: 'thinking:reasoning-1',
        text: 'Checking the vault state before answering.',
      },
    ],
  )

  assert.deepEqual(
    extractCodexTraceUpdates({
      type: 'item/agentMessage/delta',
      item_id: 'assistant-1',
      delta: 'Hello',
    }),
    [
      {
        kind: 'assistant',
        mode: 'append',
        streamKey: 'assistant:assistant-1',
        text: 'Hello',
      },
    ],
  )

  assert.deepEqual(
    extractCodexTraceUpdates({
      type: 'error',
      message: 'Reconnecting... 1/100 (stream disconnected before completion: stream closed before response.completed)',
    }),
    [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:connection',
        text: 'Reconnecting... 1/100 (stream disconnected before completion: stream closed before response.completed)',
      },
    ],
  )

  assert.deepEqual(
    extractCodexTraceUpdates({
      type: 'item.completed',
      item: {
        id: 'change-1',
        type: 'file.change',
        path: path.join(homedir(), 'repo', 'secret.ts'),
      },
    }),
    [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:change-1',
        text: 'Updated ~/repo/secret.ts.',
      },
    ],
  )
})
