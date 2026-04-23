import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, test, vi } from 'vitest'
import { createSetupAssistantAccountResolver } from '../src/setup-assistant-account.ts'

type MockChildProcess = EventEmitter & {
  exitCode: number | null
  killed: boolean
  kill: () => void
  off: (event: string, listener: (...args: any[]) => void) => MockChildProcess
  once: (event: string, listener: (...args: any[]) => void) => MockChildProcess
  signalCode: NodeJS.Signals | null
  stderr: EventEmitter & {
    setEncoding: (encoding: BufferEncoding) => void
  }
  stdin: MockStdin
  stdout: PassThrough
}

const mockState = vi.hoisted(() => ({
  childFactory: null as null | (() => MockChildProcess),
  onceImpl: null as null | ((emitter: EventEmitter, event: string) => Promise<unknown>),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    if (!mockState.childFactory) {
      throw new Error('missing child factory')
    }
    return mockState.childFactory()
  }),
}))

vi.mock('node:events', async () => {
  const actual = await vi.importActual<typeof import('node:events')>('node:events')
  return {
    ...actual,
    once: vi.fn((emitter: EventEmitter, event: string) => {
      if (mockState.onceImpl) {
        return mockState.onceImpl(emitter, event)
      }

      return Promise.resolve([event])
    }),
  }
})

afterEach(() => {
  mockState.childFactory = null
  mockState.onceImpl = null
  vi.clearAllMocks()
})

class MockStdin extends EventEmitter {
  emitErrorOnEnd: Error | null = null
  emitErrorOnWrite: Error | null = null
  throwOnEnd: Error | null = null
  throwOnWrite: Error | null = null
  readonly writes: string[] = []

  write(chunk: string): void {
    if (this.throwOnWrite) {
      throw this.throwOnWrite
    }

    this.writes.push(chunk)

    if (this.emitErrorOnWrite) {
      queueMicrotask(() => {
        this.emit('error', this.emitErrorOnWrite)
      })
    }
  }

  end(): void {
    if (this.throwOnEnd) {
      throw this.throwOnEnd
    }

    if (this.emitErrorOnEnd) {
      queueMicrotask(() => {
        this.emit('error', this.emitErrorOnEnd)
      })
    }
  }
}

function createMockChild(
  lines: string[],
  options: {
    emitSpawn?: boolean
  } = {},
): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.stdout = new PassThrough()
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding() {},
  })
  child.stdin = new MockStdin()
  child.kill = () => {
    child.killed = true
    child.exitCode = 0
    child.emit('exit', 0, null)
  }
  child.emit = function emit(event: string | symbol, ...args: unknown[]) {
    if (event === 'exit' || event === 'close') {
      child.exitCode =
        typeof args[0] === 'number' || args[0] === null ? (args[0] as number | null) : null
      child.signalCode =
        typeof args[1] === 'string' || args[1] === null
          ? (args[1] as NodeJS.Signals | null)
          : null
    }
    return EventEmitter.prototype.emit.call(this, event, ...args)
  }
  child.once = function once(event: string, listener: (...args: any[]) => void) {
    EventEmitter.prototype.once.call(this, event, listener)
    return this
  }
  child.off = function off(event: string, listener: (...args: any[]) => void) {
    EventEmitter.prototype.off.call(this, event, listener)
    return this
  }

  if (options.emitSpawn !== false) {
    queueMicrotask(() => {
      child.emit('spawn')
      for (const line of lines) {
        child.stdout.write(`${line}\n`)
      }
    })
  }

  return child
}

function createErrnoException(
  code: string,
  message: string,
): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  return error
}

test('default codex RPC account probe merges quota windows and auth fallback details', async () => {
  mockState.childFactory = () =>
    createMockChild([
      '',
      '{not-json',
      JSON.stringify({ id: 99, result: {} }),
      JSON.stringify({ id: 1, result: { ok: true } }),
      JSON.stringify({
        id: 2,
        result: {
          account: {
            planType: ' Free Workspace ',
            type: 'chatgpt',
          },
        },
      }),
      JSON.stringify({
        id: 3,
        result: {
          rateLimits: {
            credits: {
              balance: '12.5',
              unlimited: true,
            },
            primary: {
              resetsAt: 1_700_000_000,
              usedPercent: '120',
              windowDurationMins: 0.4,
            },
            secondary: {
              resetsAt: '1700000100',
              usedPercent: '-10',
              windowDurationMins: '14.9',
            },
          },
        },
      }),
    ])
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({
      OPENAI_API_KEY: 'sk-live',
    }),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () =>
      JSON.stringify({
        tokens: {
          id_token:
            'eyJhbGciOiJub25lIn0.eyJjaGF0Z3B0X3BsYW5fdHlwZSI6InRlYW0ifQ.',
        },
      }),
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: 'codex-beta',
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-rpc+codex-auth-json',
    kind: 'account',
    planCode: 'free_workspace',
    planName: 'Free Workspace',
    quota: {
      creditsRemaining: 12.5,
      creditsUnlimited: true,
      primaryWindow: {
        remainingPercent: 0,
        resetsAt: '2023-11-14T22:13:20.000Z',
        usedPercent: 100,
        windowMinutes: 1,
      },
      secondaryWindow: {
        remainingPercent: 100,
        resetsAt: '2023-11-14T22:15:00.000Z',
        usedPercent: 0,
        windowMinutes: 14,
      },
    },
  })
})

test('default codex RPC probe falls back to auth snapshot when the app-server probe fails', async () => {
  mockState.childFactory = () => {
    const child = createMockChild([], {
      emitSpawn: false,
    })
    queueMicrotask(() => {
      child.stderr.emit('data', 'rpc startup failed')
      child.emit('error', new Error('spawn failed'))
    })
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () =>
      JSON.stringify({
        openai_api_key: 'sk-from-auth',
      }),
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-auth-json',
    kind: 'api-key',
    planCode: null,
    planName: null,
    quota: null,
  })
})

test('default codex RPC probe falls back to auth snapshot when the child exits before initialize', async () => {
  let child: MockChildProcess | null = null
  mockState.childFactory = () => {
    child = createMockChild([], {
      emitSpawn: false,
    })
    child.stdin.throwOnWrite = createErrnoException('EPIPE', 'write EPIPE')
    queueMicrotask(() => {
      child?.emit('spawn')
      child?.emit('exit', 0, null)
      child?.stdout.end()
    })
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () =>
      JSON.stringify({
        openai_api_key: 'sk-from-auth',
      }),
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-auth-json',
    kind: 'api-key',
    planCode: null,
    planName: null,
    quota: null,
  })
  assert.equal(child!.killed, false)
})

test('default codex RPC probe falls back to auth snapshot when stdin emits EPIPE during initialize', async () => {
  let child: MockChildProcess | null = null
  mockState.childFactory = () => {
    child = createMockChild([])
    child.stdin.emitErrorOnWrite = createErrnoException('EPIPE', 'write EPIPE')
    child.stdin.once('error', () => {
      child?.stdout.end()
      child?.emit('exit', 0, null)
    })
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () =>
      JSON.stringify({
        openai_api_key: 'sk-from-auth',
      }),
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-auth-json',
    kind: 'api-key',
    planCode: null,
    planName: null,
    quota: null,
  })
  assert.equal(child!.stdin.writes.length, 1)
})

test('default codex RPC probe ignores RPC error responses and returns null when no auth snapshot exists', async () => {
  mockState.childFactory = () =>
    createMockChild([
      JSON.stringify({ id: 1, result: { ok: true } }),
      JSON.stringify({
        id: 2,
        error: {
          message: 'account unavailable',
        },
      }),
    ])
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () => {
      throw new Error('missing')
    },
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.equal(account, null)
})

test('default codex RPC probe tolerates blank rate-limit fields and API key account responses', async () => {
  mockState.childFactory = () =>
    createMockChild([
      JSON.stringify({ id: 1, result: { ok: true } }),
      JSON.stringify({
        id: 2,
        result: {
          account: {
            planType: '   ',
            type: 'apikey',
          },
        },
      }),
      JSON.stringify({
        id: 3,
        result: {
          rateLimits: {
            credits: {
              balance: '   ',
              unlimited: 'yes',
            },
            primary: {
              resetsAt: null,
              usedPercent: '   ',
              windowDurationMins: 'abc',
            },
          },
        },
      }),
    ])
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () => {
      throw new Error('missing')
    },
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-rpc',
    kind: 'api-key',
    planCode: null,
    planName: null,
    quota: {
      creditsRemaining: null,
      creditsUnlimited: null,
      primaryWindow: null,
      secondaryWindow: null,
    },
  })
})

test('default codex RPC probe ignores cleanup-time stdin EPIPE after a successful probe', async () => {
  let child: MockChildProcess | null = null
  mockState.childFactory = () => {
    child = createMockChild([
      JSON.stringify({ id: 1, result: { ok: true } }),
      JSON.stringify({
        id: 2,
        result: {
          account: {
            planType: 'pro',
            type: 'chatgpt',
          },
        },
      }),
      JSON.stringify({
        id: 3,
        result: {
          rateLimits: {},
        },
      }),
    ])
    child.stdin.emitErrorOnEnd = createErrnoException('EPIPE', 'write EPIPE')
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () => {
      throw new Error('missing')
    },
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-rpc',
    kind: 'account',
    planCode: 'pro',
    planName: 'Pro',
    quota: null,
  })
  assert.equal(child!.stdin.writes.length, 4)
})

test('default codex RPC probe falls back to auth snapshot when cleanup-time stdin errors are non-ignorable', async () => {
  let child: MockChildProcess | null = null
  mockState.childFactory = () => {
    child = createMockChild([
      JSON.stringify({ id: 1, result: { ok: true } }),
      JSON.stringify({
        id: 2,
        result: {
          account: {
            planType: 'pro',
            type: 'chatgpt',
          },
        },
      }),
      JSON.stringify({
        id: 3,
        result: {
          rateLimits: {},
        },
      }),
    ])
    child.stdin.emitErrorOnEnd = createErrnoException(
      'ERR_STREAM_DESTROYED',
      'stream destroyed',
    )
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () =>
      JSON.stringify({
        openai_api_key: 'sk-from-auth',
      }),
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-auth-json',
    kind: 'api-key',
    planCode: null,
    planName: null,
    quota: null,
  })
  assert.equal(child!.stdin.writes.length, 4)
})

test('default codex RPC probe ignores cleanup-time stdin ERR_STREAM_WRITE_AFTER_END after a successful probe', async () => {
  let child: MockChildProcess | null = null
  mockState.childFactory = () => {
    child = createMockChild([
      JSON.stringify({ id: 1, result: { ok: true } }),
      JSON.stringify({
        id: 2,
        result: {
          account: {
            planType: 'pro',
            type: 'chatgpt',
          },
        },
      }),
      JSON.stringify({
        id: 3,
        result: {
          rateLimits: {},
        },
      }),
    ])
    child.stdin.emitErrorOnEnd = createErrnoException(
      'ERR_STREAM_WRITE_AFTER_END',
      'write after end',
    )
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const resolver = createSetupAssistantAccountResolver({
    env: () => ({}),
    getHomeDirectory: () => '/tmp/home',
    readTextFile: async () => {
      throw new Error('missing')
    },
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-rpc',
    kind: 'account',
    planCode: 'pro',
    planName: 'Pro',
    quota: null,
  })
  assert.equal(child!.stdin.writes.length, 4)
})
