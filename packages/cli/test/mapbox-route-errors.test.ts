import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { afterEach, describe, it, vi } from 'vitest'

import { registerRouteCommands } from '../src/commands/route.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { runInProcessJsonCli } from './cli-test-helpers.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function createRouteCli() {
  const cli = Cli.create('vault-cli', {
    description: 'Mapbox error envelope coverage CLI',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerRouteCommands(cli)
  return cli
}

describe('Mapbox final error envelopes', () => {
  for (const testCase of [
    { code: 'route_mapbox_auth_invalid', retryable: false, status: 401 },
    { code: 'route_mapbox_auth_invalid', retryable: false, status: 403 },
    { code: 'route_mapbox_timeout', retryable: true, status: 408 },
    { code: 'route_mapbox_rate_limited', retryable: true, status: 429 },
    { code: 'route_mapbox_unavailable', retryable: true, status: 503 },
    { code: 'route_mapbox_request_rejected', retryable: false, status: 422 },
  ] as const) {
    it(`maps HTTP ${testCase.status} without echoing provider or request data`, async () => {
      const providerBody = 'private-provider-response'
      const accessToken = 'private-mapbox-token'
      const origin = '11.1234,22.2345'
      const destination = '33.3456,44.4567'
      vi.stubEnv('MAPBOX_ACCESS_TOKEN', accessToken)
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: providerBody }), {
          status: testCase.status,
          headers: { 'content-type': 'application/json' },
        }),
      ))

      const result = await runInProcessJsonCli(createRouteCli(), [
        'route',
        'estimate',
        origin,
        destination,
      ])
      if (result.envelope.ok) {
        throw new Error('expected a Mapbox error envelope')
      }

      assert.equal(result.envelope.error.code, testCase.code)
      assert.equal(result.envelope.error.retryable, testCase.retryable)
      assert.equal(result.envelope.error.stage, 'directions')
      assert.equal(typeof result.envelope.error.hint, 'string')
      const rendered = JSON.stringify(result.envelope)
      assert.equal(rendered.includes(providerBody), false)
      assert.equal(rendered.includes(accessToken), false)
      assert.equal(rendered.includes(origin), false)
      assert.equal(rendered.includes(destination), false)
    })
  }

  it('maps transport failures without echoing the cause or an absolute path', async () => {
    const rawCause = 'fetch failed in /private/workspace/provider.json'
    vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'private-mapbox-token')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error(rawCause)))

    const result = await runInProcessJsonCli(createRouteCli(), [
      'route',
      'estimate',
      '11.1234,22.2345',
      '33.3456,44.4567',
    ])
    if (result.envelope.ok) {
      throw new Error('expected a Mapbox error envelope')
    }

    assert.equal(result.envelope.error.code, 'route_mapbox_unavailable')
    assert.equal(result.envelope.error.retryable, true)
    assert.equal(result.envelope.error.stage, 'directions')
    assert.equal(JSON.stringify(result.envelope).includes(rawCause), false)
  })

  it('classifies aborted transport as a retryable timeout', async () => {
    vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'private-mapbox-token')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException('private-timeout-detail', 'TimeoutError'),
    ))

    const result = await runInProcessJsonCli(createRouteCli(), [
      'route',
      'estimate',
      '11.1234,22.2345',
      '33.3456,44.4567',
    ])
    if (result.envelope.ok) {
      throw new Error('expected a Mapbox error envelope')
    }

    assert.equal(result.envelope.error.code, 'route_mapbox_timeout')
    assert.equal(result.envelope.error.retryable, true)
    assert.equal(result.envelope.error.stage, 'directions')
    assert.equal(JSON.stringify(result.envelope).includes('private-timeout-detail'), false)
  })

  it('classifies malformed successful JSON as a retryable provider response failure', async () => {
    vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'private-mapbox-token')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))

    const result = await runInProcessJsonCli(createRouteCli(), [
      'route',
      'estimate',
      '11.1234,22.2345',
      '33.3456,44.4567',
    ])
    if (result.envelope.ok) {
      throw new Error('expected a Mapbox error envelope')
    }

    assert.equal(result.envelope.error.code, 'route_mapbox_response_invalid')
    assert.equal(result.envelope.error.retryable, true)
    assert.equal(result.envelope.error.stage, 'directions')
    assert.equal(JSON.stringify(result.envelope).includes('{not-json'), false)
  })
})
