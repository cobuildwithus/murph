import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  buildCodexArgs,
  executeCodexPrompt,
  resolveCodexDisplayOptions,
} from '../src/assistant-codex.ts'
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
} from '../src/assistant-codex-events.ts'

const tempRoots: string[] = []

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
  it('builds Codex CLI args for fresh and resumed turns', () => {
    expect(
      buildCodexArgs({
        approvalPolicy: 'on-request',
        configOverrides: ['model="gpt-5"', 'theme="clean"'],
        model: 'gpt-5',
        oss: true,
        outputFile: '/tmp/output.txt',
        profile: 'daily',
        prompt: 'hello',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        workingDirectory: '/workspace/app',
      }),
    ).toEqual([
      '--ask-for-approval',
      'on-request',
      '--config',
      'model="gpt-5"',
      '--config',
      'theme="clean"',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--output-last-message',
      '/tmp/output.txt',
      '--cd',
      '/workspace/app',
      '--sandbox',
      'workspace-write',
      '--oss',
      '--profile',
      'daily',
      '--model',
      'gpt-5',
      '--config',
      'model_reasoning_effort="high"',
      '-',
    ])

    expect(
      buildCodexArgs({
        model: 'gpt-5-mini',
        outputFile: '/tmp/resume.txt',
        prompt: 'resume',
        reasoningEffort: null,
        resumeSessionId: 'session-42',
        workingDirectory: '/workspace/ignored',
      }),
    ).toEqual([
      'exec',
      'resume',
      'session-42',
      '--json',
      '--skip-git-repo-check',
      '--output-last-message',
      '/tmp/resume.txt',
      '--model',
      'gpt-5-mini',
      '-',
    ])
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

  it('executes Codex prompts, sanitizes env, and prefers output-file messages', async () => {
    const workingDirectory = await createTempDir('assistant-codex-workdir-')
    const codexHome = await createTempDir('assistant-codex-home-')
    const onProgress = vi.fn()
    const onTraceEvent = vi.fn()

    codexMocks.spawn.mockImplementation((_command, args, options) => {
      const child = new MockChildProcess()
      const outputFile = readOutputFilePath(args)

      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n`,
        )
        child.stdout.write(
          `${JSON.stringify({
            delta: 'Hello',
            item_id: 'assistant-1',
            type: 'assistant.message.delta',
          })}\n`,
        )
        child.stdout.write(
          `${JSON.stringify({
            item: {
              id: 'assistant-1',
              message: 'Hello from assistant',
              type: 'assistant_message',
            },
            type: 'item.completed',
          })}\n`,
        )
        child.stderr.write('Retrying after timeout\n')

        void (async () => {
          await writeFile(outputFile, 'Final message from output file\n', 'utf8')
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
      executeCodexPrompt({
        codexCommand: '  codex  ',
        codexHome,
        env: {
          NODE_V8_COVERAGE: '/coverage',
          PATH: '/custom/bin',
        },
        onProgress,
        onTraceEvent,
        prompt: 'Explain this',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Final message from output file',
      sessionId: 'thread-1',
      stderr: 'Retrying after timeout',
    })

    expect(codexMocks.spawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--json', '--skip-git-repo-check']),
      expect.any(Object),
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
        text: 'Hello from assistant',
      }),
    )
    expect(onTraceEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerSessionId: 'thread-1',
        updates: [
          {
            kind: 'assistant',
            mode: 'append',
            streamKey: 'assistant:assistant-1',
            text: 'Hello',
          },
        ],
      }),
    )
  })

  it('falls back to streamed assistant text when the output file is missing', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stream-')

    codexMocks.spawn.mockImplementation((_command, args) => {
      const child = new MockChildProcess()
      const outputFile = readOutputFilePath(args)

      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify({
            delta: 'Hello ',
            item_id: 'assistant-2',
            type: 'assistant.message.delta',
          })}\n`,
        )
        child.stdout.write(
          `${JSON.stringify({
            delta: 'world',
            item_id: 'assistant-2',
            type: 'assistant.message.delta',
          })}\n`,
        )
        void (async () => {
          await writeFile(outputFile, '   \n', 'utf8')
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'stream please',
        resumeSessionId: 'resume-1',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Hello world',
      sessionId: 'resume-1',
    })
  })

  it('falls back to the last assistant message when no stream or file output exists', async () => {
    const workingDirectory = await createTempDir('assistant-codex-message-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify({
            item: {
              id: 'assistant-3',
              content: [{ text: 'Message from event' }],
              type: 'assistant_message',
            },
            type: 'item.completed',
          })}\n`,
        )
        child.emit('close', 0, null)
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'message fallback',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'Message from event',
      sessionId: null,
    })
  })

  it('falls back to non-json stdout lines when no structured assistant output exists', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stdout-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        child.stdout.write('plain stdout line\n')
        child.stdout.write('trailing stdout line')
        child.emit('close', 0, null)
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'stdout fallback',
        workingDirectory,
      }),
    ).resolves.toMatchObject({
      finalMessage: 'plain stdout line\ntrailing stdout line',
      stdout: 'plain stdout line\ntrailing stdout line',
    })
  })

  it('rejects invalid Codex homes before spawning the CLI', async () => {
    const workingDirectory = await createTempDir('assistant-codex-invalid-home-')
    const invalidRoot = await createTempDir('assistant-codex-invalid-home-root-')
    const filePath = path.join(invalidRoot, 'not-a-directory')

    await writeFile(filePath, 'content', 'utf8')

    await expect(
      executeCodexPrompt({
        codexHome: filePath,
        prompt: 'invalid home',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_HOME_INVALID',
      message: `Configured Codex home is not accessible: ${filePath}`,
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
      executeCodexPrompt({
        codexHome: missingPath,
        prompt: 'missing home',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_HOME_INVALID',
      message: `Configured Codex home does not exist: ${missingPath}`,
    })

    await expect(
      executeCodexPrompt({
        codexHome: executableFilePath,
        prompt: 'file home',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_HOME_INVALID',
      message: `Configured Codex home is not a directory: ${executableFilePath}`,
    })
  })

  it('maps missing Codex binaries to a not-found CLI error', async () => {
    const workingDirectory = await createTempDir('assistant-codex-not-found-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        const error = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        child.emit('error', error)
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'missing binary',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_NOT_FOUND',
      message:
        'Codex CLI executable "codex" was not found. Install @openai/codex or pass --codexCommand.',
    })
  })

  it('marks connection-loss failures as retryable and preserves the provider session id', async () => {
    const workingDirectory = await createTempDir('assistant-codex-connection-loss-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-77' })}\n`,
        )
        child.stdout.write(
          `${JSON.stringify({
            errorMessage: 'Connection closed before response.completed',
            type: 'turn.failed',
          })}\n`,
        )
        child.stderr.write('connection closed before response.completed\n')
        child.emit('close', 1, null)
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'retry me',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_CONNECTION_LOST',
      context: {
        connectionLost: true,
        providerSessionId: 'thread-77',
        recoverableConnectionLoss: true,
        retryable: true,
      },
      message: expect.stringContaining('Murph preserved the provider session'),
    })
  })

  it('classifies stale resume failures from child close instead of surfacing stdin EPIPE', async () => {
    const workingDirectory = await createTempDir('assistant-codex-stale-resume-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        const error = new Error('write EPIPE') as NodeJS.ErrnoException
        error.code = 'EPIPE'
        child.stdin.emit('error', error)
        child.stderr.write(
          'thread/resume failed: no rollout found for thread id stale-thread\n',
        )
        child.emit('close', 1, null)
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'resume please',
        resumeSessionId: 'stale-thread',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_RESUME_STALE',
      context: {
        providerSessionId: 'stale-thread',
        retryable: true,
        staleResume: true,
      },
      message: expect.stringContaining('no rollout found for thread id stale-thread'),
    })
  })

  it('formats non-connection Codex failures from the trailing stderr context', async () => {
    const workingDirectory = await createTempDir('assistant-codex-failure-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        child.stderr.write('\nfirst line\nsecond line\nthird line\nfourth line\n')
        child.emit('close', 2, null)
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'fail normally',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        connectionLost: false,
        providerSessionId: null,
        recoverableConnectionLoss: false,
        retryable: false,
      },
      message: 'Codex CLI failed. exit code 2. second line third line fourth line',
    })
  })

  it('surfaces signal-only failures and readback errors from the output file path', async () => {
    const signalWorkingDirectory = await createTempDir('assistant-codex-signal-failure-')

    codexMocks.spawn.mockImplementationOnce(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        child.emit('close', null, 'SIGTERM')
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'signal fail',
        workingDirectory: signalWorkingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      message: 'Codex CLI failed. signal SIGTERM.',
    })

    const readbackWorkingDirectory = await createTempDir('assistant-codex-readback-error-')

    codexMocks.spawn.mockImplementationOnce((_command, args) => {
      const child = new MockChildProcess()
      const outputFile = readOutputFilePath(args)

      queueMicrotask(() => {
        void (async () => {
          await rm(outputFile, {
            force: true,
            recursive: true,
          })
          await mkdir(outputFile, {
            recursive: true,
          })
          child.emit('close', 0, null)
        })()
      })

      return child
    })

    await expect(
      executeCodexPrompt({
        prompt: 'readback fail',
        workingDirectory: readbackWorkingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'EISDIR',
    })
  })

  it('treats aborted runs as interrupted and kills the child with SIGINT', async () => {
    const workingDirectory = await createTempDir('assistant-codex-abort-')
    const controller = new AbortController()
    let child: MockChildProcess | null = null

    codexMocks.spawn.mockImplementation(() => {
      child = new MockChildProcess()
      child.kill.mockImplementation((signal?: NodeJS.Signals) => {
        queueMicrotask(() => {
          child?.emit('close', null, signal ?? null)
        })
        return true
      })
      return child
    })

    controller.abort()

    await expect(
      executeCodexPrompt({
        abortSignal: controller.signal,
        prompt: 'abort me',
        workingDirectory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_INTERRUPTED',
      context: {
        interrupted: true,
        providerSessionId: null,
        retryable: false,
      },
    })

    expect(child?.kill).toHaveBeenCalledWith('SIGINT')
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
  readonly stderr = new PassThrough()
  readonly stdin = new MockStdin()
  readonly stdout = new PassThrough()
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true)
}

class MockStdin extends EventEmitter {
  readonly writes: string[] = []

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
  tempRoots.push(rootPath)
  return rootPath
}

function readOutputFilePath(args: readonly unknown[]): string {
  const outputFlagIndex = args.findIndex((value) => value === '--output-last-message')
  if (outputFlagIndex < 0) {
    throw new Error('Expected --output-last-message in Codex args.')
  }

  const outputPath = args[outputFlagIndex + 1]
  if (typeof outputPath !== 'string') {
    throw new TypeError('Expected a string output path after --output-last-message.')
  }

  return outputPath
}
