import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handleClose = vi.fn(async () => undefined)
  return {
    createAssistantLocalService: vi.fn(() => ({ kind: 'service' })),
    handleClose,
    loadAssistantdEnvFiles: vi.fn(),
    loadAssistantdEnvironment: vi.fn(() => ({
      controlToken: 'secret-token',
      host: '127.0.0.1',
      port: 50241,
      vaultRoot: '/tmp/bin-vault',
    })),
    startAssistantHttpServer: vi.fn(async () => ({
      address: {
        baseUrl: 'http://127.0.0.1:50241',
        host: '127.0.0.1',
        port: 50241,
      },
      close: handleClose,
    })),
  }
})

vi.mock('../src/config.js', () => ({
  loadAssistantdEnvFiles: mocks.loadAssistantdEnvFiles,
  loadAssistantdEnvironment: mocks.loadAssistantdEnvironment,
}))

vi.mock('../src/service.js', () => ({
  createAssistantLocalService: mocks.createAssistantLocalService,
}))

vi.mock('../src/http.js', () => ({
  startAssistantHttpServer: mocks.startAssistantHttpServer,
}))

const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'
const ORIGINAL_DISABLE_CLIENT = process.env[ASSISTANTD_DISABLE_CLIENT_ENV]

async function loadAssistantdBin(modulePath: string): Promise<void> {
  await import(modulePath)
  await waitForImmediate()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ORIGINAL_DISABLE_CLIENT === undefined) {
    delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
    return
  }
  process.env[ASSISTANTD_DISABLE_CLIENT_ENV] = ORIGINAL_DISABLE_CLIENT
})

test('assistantd bin loads env, starts the server, and announces the bound address', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never)
  const signalHandlers = new Map<string, () => void>()
  const onceSpy = vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    signalHandlers.set(String(event), listener as () => void)
    return process
  })

  await loadAssistantdBin('../src/bin.ts?success')

  assert.equal(process.env[ASSISTANTD_DISABLE_CLIENT_ENV], '1')
  assert.deepEqual(mocks.loadAssistantdEnvFiles.mock.calls, [[]])
  assert.deepEqual(mocks.createAssistantLocalService.mock.calls, [['/tmp/bin-vault']])
  assert.deepEqual(mocks.startAssistantHttpServer.mock.calls, [[
    {
      controlToken: 'secret-token',
      host: '127.0.0.1',
      port: 50241,
      service: { kind: 'service' },
    },
  ]])
  assert.equal(onceSpy.mock.calls[0]?.[0], 'SIGINT')
  assert.equal(onceSpy.mock.calls[1]?.[0], 'SIGTERM')

  const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
    assistantd: {
      baseUrl: string
      host: string
      port: number
      vaultBound: boolean
    }
  }
  assert.deepEqual(payload, {
    assistantd: {
      baseUrl: 'http://127.0.0.1:50241',
      host: '127.0.0.1',
      port: 50241,
      vaultBound: true,
    },
  })

  mocks.handleClose.mockRejectedValueOnce(new Error('close failed'))
  signalHandlers.get('SIGINT')?.()
  await waitForImmediate()
  signalHandlers.get('SIGTERM')?.()
  await waitForImmediate()

  assert.equal(mocks.handleClose.mock.calls.length, 2)
  assert.deepEqual(exitSpy.mock.calls, [[0], [0]])
})

test('assistantd bin prints the startup error and exits non-zero on failure', async () => {
  const startupError = new Error('startup failed')
  startupError.stack = undefined
  mocks.loadAssistantdEnvironment.mockImplementationOnce(() => {
    throw startupError
  })

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never)

  await loadAssistantdBin('../src/bin.ts?failure')

  assert.match(String(errorSpy.mock.calls[0]?.[0]), /startup failed/u)
  assert.deepEqual(exitSpy.mock.calls, [[1]])
})

test('assistantd bin stringifies non-Error startup failures before exiting', async () => {
  mocks.loadAssistantdEnvironment.mockImplementationOnce(() => {
    throw 'plain failure'
  })

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never)

  await loadAssistantdBin('../src/bin.ts?failure-string')

  assert.equal(errorSpy.mock.calls[0]?.[0], 'plain failure')
  assert.deepEqual(exitSpy.mock.calls, [[1]])
})
