import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, test, vi } from 'vitest'

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
  stdin: {
    end: () => void
    writes: string[]
    write: (chunk: string) => void
  }
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
  vi.resetModules()
  vi.clearAllMocks()
})

function createMockChild(lines: string[]): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.stdout = new PassThrough()
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding() {},
  })
  child.stdin = {
    writes: [],
    write(chunk: string) {
      this.writes.push(chunk)
    },
    end() {},
  }
  child.kill = () => {
    child.killed = true
    child.exitCode = 0
    child.emit('exit', 0, null)
  }
  child.once = function once(event: string, listener: (...args: any[]) => void) {
    EventEmitter.prototype.once.call(this, event, listener)
    return this
  }
  child.off = function off(event: string, listener: (...args: any[]) => void) {
    EventEmitter.prototype.off.call(this, event, listener)
    return this
  }

  queueMicrotask(() => {
    child.emit('spawn')
    for (const line of lines) {
      child.stdout.write(`${line}\n`)
    }
  })

  return child
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

  const { createSetupAssistantAccountResolver } = await import(
    '../src/setup-assistant-account.ts'
  )
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
    const child = new EventEmitter() as MockChildProcess
    child.exitCode = null
    child.signalCode = null
    child.killed = false
    child.stdout = new PassThrough()
    child.stderr = Object.assign(new EventEmitter(), {
      setEncoding() {},
    })
    child.stdin = {
      writes: [],
      write(chunk: string) {
        this.writes.push(chunk)
      },
      end() {},
    }
    child.kill = () => {
      child.killed = true
      child.exitCode = 0
      child.emit('exit', 0, null)
    }
    child.once = function once(event: string, listener: (...args: any[]) => void) {
      EventEmitter.prototype.once.call(this, event, listener)
      return this
    }
    child.off = function off(event: string, listener: (...args: any[]) => void) {
      EventEmitter.prototype.off.call(this, event, listener)
      return this
    }
    queueMicrotask(() => {
      child.stderr.emit('data', 'rpc startup failed')
      child.emit('error', new Error('spawn failed'))
    })
    return child
  }
  mockState.onceImpl = async (_emitter, event) => [event]

  const { createSetupAssistantAccountResolver } = await import(
    '../src/setup-assistant-account.ts'
  )
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

  const { createSetupAssistantAccountResolver } = await import(
    '../src/setup-assistant-account.ts'
  )
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

  const { createSetupAssistantAccountResolver } = await import(
    '../src/setup-assistant-account.ts'
  )
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
