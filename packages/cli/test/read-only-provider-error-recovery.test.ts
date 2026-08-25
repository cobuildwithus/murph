import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest'

import { registerFoodCommands } from '../src/commands/food.js'
import { registerRouteCommands } from '../src/commands/route.js'
import { registerSupplementCommands } from '../src/commands/supplement.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  binPath,
  ensureCliRuntimeArtifacts,
  runInProcessJsonCli,
  type CliErrorEnvelope,
} from './cli-test-helpers.js'

interface ReadOnlyProviderCase {
  args: string[]
  cancelledCode: string
  httpCode(status: number): string
  name: string
  timeoutCode: string
  transportCode: string
}

const readOnlyProviderCases: ReadOnlyProviderCase[] = [
  {
    args: ['route', 'estimate', '11.1234,22.2345', '33.3456,44.4567'],
    cancelledCode: 'route_mapbox_cancelled',
    httpCode: status => status === 401 || status === 403
      ? 'route_mapbox_auth_invalid'
      : status === 503
        ? 'route_mapbox_unavailable'
        : 'route_mapbox_request_rejected',
    name: 'route estimate',
    timeoutCode: 'route_mapbox_timeout',
    transportCode: 'route_mapbox_unavailable',
  },
  {
    args: ['food', 'search-labels', 'private-food-query'],
    cancelledCode: 'food_labels_api_request_cancelled',
    httpCode: status => status === 401 || status === 403
      ? 'food_labels_api_auth_failed'
      : status === 503
        ? 'food_labels_api_service_unavailable'
        : 'food_labels_api_response_failed',
    name: 'food label search',
    timeoutCode: 'food_labels_api_request_timed_out',
    transportCode: 'food_labels_api_request_failed',
  },
  {
    args: ['supplement', 'search-labels', 'private-supplement-query'],
    cancelledCode: 'supplement_labels_api_request_cancelled',
    httpCode: status => status === 401 || status === 403
      ? 'supplement_labels_api_auth_failed'
      : status === 503
        ? 'supplement_labels_api_service_unavailable'
        : 'supplement_labels_api_response_failed',
    name: 'supplement label search',
    timeoutCode: 'supplement_labels_api_request_timed_out',
    transportCode: 'supplement_labels_api_request_failed',
  },
]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function createReadOnlyProviderCli() {
  const cli = Cli.create('vault-cli', {
    description: 'read-only provider recovery test CLI',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerRouteCommands(cli)
  registerFoodCommands(cli, services)
  registerSupplementCommands(cli, services)
  return cli
}

function configureProviderEnvironment(): void {
  vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'private-mapbox-token')
  vi.stubEnv('MURPH_DATA_API_KEY', 'private-data-api-credential')
  vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
}

async function expectErrorEnvelope(input: {
  args: string[]
  code: string
  retryable: boolean
  stage: 'response' | 'transport'
}): Promise<string> {
  const result = await runInProcessJsonCli(createReadOnlyProviderCli(), input.args)
  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  if (result.envelope.ok) {
    throw new Error('Expected a provider failure envelope.')
  }

  assert.equal(result.envelope.error.code, input.code)
  assert.equal(result.envelope.error.retryable, input.retryable)
  assert.equal(result.envelope.error.stage, input.stage)
  return JSON.stringify(result.envelope)
}

describe('read-only provider recovery envelopes', () => {
  for (const providerCase of readOnlyProviderCases) {
    for (const status of [400, 401, 403, 503]) {
      it(`${providerCase.name} classifies HTTP ${status}`, async () => {
        configureProviderEnvironment()
        const providerBody = `private-provider-body-${status}`
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify({ error: providerBody }), { status }),
        )
        vi.stubGlobal('fetch', fetchMock)

        const serialized = await expectErrorEnvelope({
          args: providerCase.args,
          code: providerCase.httpCode(status),
          retryable: status === 503,
          stage: 'response',
        })

        assert.equal(fetchMock.mock.calls.length, 1)
        assert.equal(serialized.includes(providerBody), false)
        assert.equal(serialized.includes('private-mapbox-token'), false)
        assert.equal(serialized.includes('private-data-api-credential'), false)
      })
    }

    it(`${providerCase.name} classifies an ordinary transport failure as retryable`, async () => {
      configureProviderEnvironment()
      const rawCause = 'private transport failure in /private/provider/request.json'
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(rawCause))
      vi.stubGlobal('fetch', fetchMock)

      const serialized = await expectErrorEnvelope({
        args: providerCase.args,
        code: providerCase.transportCode,
        retryable: true,
        stage: 'transport',
      })

      assert.equal(fetchMock.mock.calls.length, 1)
      assert.equal(serialized.includes(rawCause), false)
    })

    it(`${providerCase.name} classifies a timeout as retryable`, async () => {
      configureProviderEnvironment()
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('private timeout detail', 'TimeoutError'),
      )
      vi.stubGlobal('fetch', fetchMock)

      const serialized = await expectErrorEnvelope({
        args: providerCase.args,
        code: providerCase.timeoutCode,
        retryable: true,
        stage: 'transport',
      })

      assert.equal(fetchMock.mock.calls.length, 1)
      assert.equal(serialized.includes('private timeout detail'), false)
    })

    it(`${providerCase.name} keeps caller cancellation terminal`, async () => {
      configureProviderEnvironment()
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('private cancellation detail', 'AbortError'),
      )
      vi.stubGlobal('fetch', fetchMock)

      const serialized = await expectErrorEnvelope({
        args: providerCase.args,
        code: providerCase.cancelledCode,
        retryable: false,
        stage: 'transport',
      })

      assert.equal(fetchMock.mock.calls.length, 1)
      assert.equal(serialized.includes('private cancellation detail'), false)
    })
  }
})

const BUILT_PROVIDER_FETCH_HOOK = [
  "const mode = process.env.MURPH_PROVIDER_RECOVERY_TEST_MODE",
  "globalThis.fetch = async () => {",
  "  if (mode === 'transport') throw new TypeError('private built transport detail')",
  "  if (mode === 'timeout') throw new DOMException('private built timeout detail', 'TimeoutError')",
  "  if (mode === 'cancel') throw new DOMException('private built cancellation detail', 'AbortError')",
  "  const status = Number.parseInt(mode ?? '', 10)",
  "  return new Response(JSON.stringify({ error: 'private-built-provider-body' }), { status })",
  "}",
  '',
].join('\n')

const preparedRuntime = process.env.MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS === '1'

describe.skipIf(!preparedRuntime)('prepared built read-only provider recovery', () => {
  let hookPath = ''
  let probeHome = ''
  let probeRoot = ''

  beforeAll(async () => {
    await ensureCliRuntimeArtifacts()
    probeRoot = await mkdtemp(path.join(tmpdir(), 'murph-provider-recovery-'))
    probeHome = path.join(probeRoot, 'home')
    hookPath = path.join(probeRoot, 'fetch-hook.mjs')
    await mkdir(probeHome, { recursive: true })
    await writeFile(hookPath, BUILT_PROVIDER_FETCH_HOOK, 'utf8')
  })

  afterAll(async () => {
    try {
      assert.deepEqual(await readdir(probeHome, { recursive: true }), [])
    } finally {
      await rm(probeRoot, { force: true, recursive: true })
    }
  })

  for (const providerCase of readOnlyProviderCases) {
    for (const failure of [
      {
        code: providerCase.transportCode,
        mode: 'transport',
        retryable: true,
        stage: 'transport',
      },
      {
        code: providerCase.timeoutCode,
        mode: 'timeout',
        retryable: true,
        stage: 'transport',
      },
      {
        code: providerCase.cancelledCode,
        mode: 'cancel',
        retryable: false,
        stage: 'transport',
      },
      ...[400, 401, 403, 503].map(status => ({
        code: providerCase.httpCode(status),
        mode: String(status),
        retryable: status === 503,
        stage: 'response',
      })),
    ] as const) {
      it(`${providerCase.name} exposes ${failure.mode} from the built CLI without writing`, async () => {
        const envelope = await runBuiltProviderCommand({
          args: providerCase.args,
          hookPath,
          mode: failure.mode,
          probeHome,
        })

        assert.equal(envelope.error.code, failure.code)
        assert.equal(envelope.error.retryable, failure.retryable)
        assert.equal(envelope.error.stage, failure.stage)
        assert.doesNotMatch(
          JSON.stringify(envelope),
          /private built|private-built|private-mapbox-token|private-data-api-credential/u,
        )
      })
    }
  }
})

async function runBuiltProviderCommand(input: {
  args: string[]
  hookPath: string
  mode: string
  probeHome: string
}): Promise<CliErrorEnvelope> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [
        '--import',
        pathToFileURL(input.hookPath).href,
        binPath,
        ...input.args,
        '--format',
        'json',
        '--full-output',
      ],
      {
        cwd: input.probeHome,
        encoding: 'utf8',
        env: {
          HOME: input.probeHome,
          MAPBOX_ACCESS_TOKEN: 'private-mapbox-token',
          MURPH_DATA_API_KEY: 'private-data-api-credential',
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          MURPH_PROVIDER_RECOVERY_TEST_MODE: input.mode,
          PATH: process.env.PATH,
          VAULT: '',
        },
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error || error.code !== 1) {
          reject(
            new Error(
              `Built provider probe returned an unexpected status: ${error?.code ?? 'success'}; ${stderr.slice(0, 240)}`,
            ),
          )
          return
        }
        resolve(stdout.trim())
      },
    )
  })

  const envelope = JSON.parse(output) as CliErrorEnvelope
  assert.equal(envelope.ok, false)
  return envelope
}
