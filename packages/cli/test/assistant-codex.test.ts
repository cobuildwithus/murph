import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

test('resolveCodexDisplayOptions falls back to config defaults when no explicit model is set', async () => {
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
  stderr: EventEmitter
  stdout: EventEmitter
}
