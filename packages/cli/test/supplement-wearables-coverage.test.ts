import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'

import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { registerSupplementCommands } from '../src/commands/supplement.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWearablesCommands } from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

function createCoverageCli() {
  return createCoverageCliAndServices().cli
}

function createCoverageCliAndServices() {
  const cli = Cli.create('vault-cli', {
    description: 'supplement/wearables coverage cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerSupplementCommands(cli, services)
  registerWearablesCommands(cli, services)

  return { cli, services }
}

async function getGroupCommandRun<Context>(
  cli: Cli.Cli,
  groupName: string,
  commandName: string,
) {
  const { toCommands } = await import(
    new URL('./Cli.js', import.meta.resolve('incur')).href
  )
  const group = toCommands.get(cli)?.get(groupName)
  if (!group || !('commands' in group)) {
    throw new Error(`Missing command group: ${groupName}`)
  }

  const command = group.commands.get(commandName)
  if (!command || typeof command !== 'object' || typeof command.run !== 'function') {
    throw new Error(`Missing command handler: ${groupName} ${commandName}`)
  }

  return command.run as (context: Context) => Promise<unknown>
}

test('supplement commands exercise typed save, read, compound, and stop paths in-process', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createCoverageCli()

  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.exitCode, null)
  assert.equal(requireData(initResult.envelope).created, true)

  const upserted = await runInProcessJsonCli<{
    created: boolean
    lookupId: string
    path: string
    regimenId: string
    vault: string
  }>(cli, [
    'supplement',
    'save',
    'Liposomal Vitamin C',
    '--started-on',
    '2026-03-01',
    '--brand',
    'LivOn Labs',
    '--manufacturer',
    'LivOn Laboratories',
    '--serving-size',
    '1 packet',
    '--compound',
    'Vitamin C',
    '--ingredient-label',
    'Ascorbic acid',
    '--amount',
    '500',
    '--unit',
    'mg',
    '--vault',
    vaultRoot,
  ])
  assert.equal(upserted.exitCode, null)
  assert.equal(requireData(upserted.envelope).created, true)

  const shown = await runInProcessJsonCli<{
    entity: {
      id: string
      kind: string
      title: string | null
    }
  }>(cli, [
    'supplement',
    'show',
    requireData(upserted.envelope).lookupId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(shown.exitCode, null)
  assert.equal(requireData(shown.envelope).entity.kind, 'supplement')

  const listed = await runInProcessJsonCli<{
    filters: {
      limit: number
      status: string | null
      text: string | null
    }
    count: number
    items: Array<{
      excerpt?: string | null
      slug: string
      markdown?: string | null
    }>
  }>(cli, [
    'supplement',
    'list',
    '--limit',
    '5',
    '--status',
    'active',
    '--vault',
    vaultRoot,
  ])
  assert.equal(listed.exitCode, null)
  assert.equal(requireData(listed.envelope).count >= 1, true)
  assert.equal('markdown' in (requireData(listed.envelope).items[0] ?? {}), false)
  assert.match(
    requireData(listed.envelope).items[0]?.excerpt ?? '',
    /Liposomal Vitamin C/u,
  )

  const listedDefault = await runInProcessJsonCli<{
    filters: {
      limit: number
      status: string | null
      text: string | null
    }
    count: number
    items: Array<{
      slug: string
    }>
  }>(cli, [
    'supplement',
    'list',
    '--status',
    'active',
    '--vault',
    vaultRoot,
  ])
  assert.equal(listedDefault.exitCode, null)
  assert.equal(requireData(listedDefault.envelope).filters.limit, 50)

  const stopped = await runInProcessJsonCli<{
    regimenId: string
    lookupId: string
    stoppedOn: string | null
    status: string
  }>(cli, [
    'supplement',
    'stop',
    requireData(upserted.envelope).lookupId,
    '--stopped-on',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ])
  assert.equal(stopped.exitCode, null)
  assert.equal(requireData(stopped.envelope).status, 'stopped')

  const compoundList = await runInProcessJsonCli<{
    filters: {
      limit?: number
      status: string
    }
    count: number
    items: Array<{
      compound: string
      lookupId: string
    }>
  }>(cli, [
    'supplement',
    'compound',
    'list',
    '--vault',
    vaultRoot,
  ])
  assert.equal(compoundList.exitCode, null)
  assert.equal(requireData(compoundList.envelope).count >= 0, true)

  const compoundShow = await runInProcessJsonCli<{
    filters: {
      status: string
      limit?: number
    }
    compound: {
      compound: string
      lookupId: string
      supplementCount: number
    }
  }>(cli, [
    'supplement',
    'compound',
    'show',
    'Magnesium Glycinate',
    '--status',
    'active',
    '--vault',
    vaultRoot,
  ])
  if (compoundShow.envelope.ok) {
    assert.equal(requireData(compoundShow.envelope).compound.lookupId.length > 0, true)
  } else {
    assert.equal(compoundShow.envelope.error.code, 'not_found')
  }
})

test('supplement list handler exercises the default limit fallback directly', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-direct-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const { cli, services } = createCoverageCliAndServices()
  const listRun = await getGroupCommandRun<{
    args: Record<string, never>
    options: {
      vault: string
      status?: string
      limit?: number
    }
  }>(cli, 'supplement', 'list')

  const listSpy = vi.spyOn(services.query, 'listSupplements').mockResolvedValue({
    vault: vaultRoot,
    filters: {
      limit: 50,
      status: 'active',
    },
    items: [],
    count: 0,
    nextCursor: null,
  })

  await listRun({
    args: {},
    options: {
      vault: vaultRoot,
      status: 'active',
    },
  })

  assert.equal(listSpy.mock.calls.length, 1)
  assert.equal(listSpy.mock.calls[0]?.[0].vault, vaultRoot)
  assert.equal(listSpy.mock.calls[0]?.[0].requestId, null)
  assert.equal(listSpy.mock.calls[0]?.[0].status, 'active')
  assert.equal(listSpy.mock.calls[0]?.[0].limit, 50)
})

test('supplement search-labels calls the hosted data API without local credentials', async () => {
  const previousHostedRuntimeProcess = process.env.MURPH_HOSTED_RUNTIME_PROCESS
  process.env.MURPH_HOSTED_RUNTIME_PROCESS = '1'
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    items: [
      {
        id: '82118',
        dataOrigin: 'dsld',
        dataOriginId: '82118',
        name: 'Creatine Monohydrate',
        brand: null,
        upc: null,
        offMarket: false,
      },
    ],
  }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    status: 200,
  }))
  vi.stubGlobal('fetch', fetchMock)

  try {
    const cli = createCoverageCli()
    const result = await runInProcessJsonCli<{
      source: string
      items: Array<{ id: string }>
    }>(cli, [
      'supplement',
      'search-labels',
      'creatine',
      '--limit',
      '1',
    ])

    assert.equal(result.exitCode, null)
    assert.equal(requireData(result.envelope).source, 'murph-data-api')
    assert.equal(requireData(result.envelope).items[0]?.id, '82118')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.href, 'http://murph-data-api.worker/api/supplements?q=creatine&limit=1')
    const init = fetchMock.mock.calls[0]?.[1]
    assert.equal(init?.headers && 'authorization' in init.headers, false)
  } finally {
    if (previousHostedRuntimeProcess === undefined) {
      delete process.env.MURPH_HOSTED_RUNTIME_PROCESS
    } else {
      process.env.MURPH_HOSTED_RUNTIME_PROCESS = previousHostedRuntimeProcess
    }
  }
})

test('supplement search-labels-batch calls the hosted data API without local credentials', async () => {
  const previousHostedRuntimeProcess = process.env.MURPH_HOSTED_RUNTIME_PROCESS
  process.env.MURPH_HOSTED_RUNTIME_PROCESS = '1'
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    results: [
      {
        query: 'creatine',
        items: [
          {
            id: '82118',
            dataOrigin: 'dsld',
            dataOriginId: '82118',
            name: 'Creatine Monohydrate',
            brand: null,
            upc: null,
            offMarket: false,
          },
        ],
      },
      {
        query: 'magnesium',
        items: [],
      },
    ],
  }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    status: 200,
  }))
  vi.stubGlobal('fetch', fetchMock)

  try {
    const cli = createCoverageCli()
    const result = await runInProcessJsonCli<{
      source: string
      results: Array<{ query: string; items: Array<{ id: string }> }>
    }>(cli, [
      'supplement',
      'search-labels-batch',
      '--query',
      'creatine',
      '--query',
      'magnesium',
      '--limit',
      '1',
    ])

    assert.equal(result.exitCode, null)
    assert.equal(requireData(result.envelope).source, 'murph-data-api')
    assert.equal(requireData(result.envelope).results[0]?.items[0]?.id, '82118')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.href, 'http://murph-data-api.worker/api/supplements')
    const init = fetchMock.mock.calls[0]?.[1]
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      queries: ['creatine', 'magnesium'],
      limit: 1,
      includeOffMarket: false,
    })
    assert.equal(init?.headers && 'authorization' in init.headers, false)
  } finally {
    if (previousHostedRuntimeProcess === undefined) {
      delete process.env.MURPH_HOSTED_RUNTIME_PROCESS
    } else {
      process.env.MURPH_HOSTED_RUNTIME_PROCESS = previousHostedRuntimeProcess
    }
  }
})

test('wearables commands exercise day and list surfaces with provider normalization in-process', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-wearables-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createCoverageCli()

  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.exitCode, null)
  assert.equal(requireData(initResult.envelope).created, true)

  const dayWithoutProvider = await runInProcessJsonCli<{
    date: string
    filters: {
      providers: string[]
    }
    summary: unknown | null
  }>(cli, [
    'wearables',
    'day',
    '2026-04-05',
    '--vault',
    vaultRoot,
  ])
  assert.equal(dayWithoutProvider.exitCode, null)
  const dayWithoutProviderData = requireData(dayWithoutProvider.envelope)
  assert.equal('vault' in dayWithoutProviderData, false)
  assert.equal(dayWithoutProviderData.filters.providers.length, 0)

  const dayWithProviders = await runInProcessJsonCli<{
    date: string
    filters: {
      providers: string[]
    }
    summary: unknown | null
  }>(cli, [
    'wearables',
    'day',
    '2026-04-05',
    '--provider',
    'oura',
    '--provider',
    'whoop',
    '--vault',
    vaultRoot,
  ])
  assert.equal(dayWithProviders.exitCode, null)
  const dayWithProvidersData = requireData(dayWithProviders.envelope)
  assert.equal('vault' in dayWithProvidersData, false)
  assert.deepEqual(dayWithProvidersData.filters.providers, [
    'oura',
    'whoop',
  ])

  const sleepList = await runInProcessJsonCli<{
    filters: {
      date: string | null
      from: string | null
      to: string | null
      providers: string[]
      limit: number
    }
    count: number
    items: Array<Record<string, unknown>>
  }>(cli, [
    'wearables',
    'sleep',
    'list',
    '--from',
    '2026-04-01',
    '--to',
    '2026-04-07',
    '--provider',
    'oura',
    '--vault',
    vaultRoot,
  ])
  assert.equal(sleepList.exitCode, null)
  assert.deepEqual(requireData(sleepList.envelope).filters.providers, ['oura'])

  const activityList = await runInProcessJsonCli<{
    filters: {
      date: string | null
      from: string | null
      to: string | null
      providers: string[]
      limit: number
    }
    count: number
    items: Array<Record<string, unknown>>
  }>(cli, [
    'wearables',
    'activity',
    'list',
    '--vault',
    vaultRoot,
  ])
  assert.equal(activityList.exitCode, null)
  assert.equal(requireData(activityList.envelope).filters.providers.length, 0)

  const bodyList = await runInProcessJsonCli<{
    filters: {
      date: string | null
      from: string | null
      to: string | null
      providers: string[]
      limit: number
    }
    count: number
    items: Array<Record<string, unknown>>
  }>(cli, [
    'wearables',
    'body',
    'list',
    '--provider',
    'oura',
    '--provider',
    'whoop',
    '--vault',
    vaultRoot,
  ])
  assert.equal(bodyList.exitCode, null)
  assert.deepEqual(requireData(bodyList.envelope).filters.providers, [
    'oura',
    'whoop',
  ])

  const recoveryList = await runInProcessJsonCli<{
    filters: {
      date: string | null
      from: string | null
      to: string | null
      providers: string[]
      limit: number
    }
    count: number
    items: Array<Record<string, unknown>>
  }>(cli, [
    'wearables',
    'recovery',
    'list',
    '--vault',
    vaultRoot,
  ])
  assert.equal(recoveryList.exitCode, null)
  assert.equal(requireData(recoveryList.envelope).filters.providers.length, 0)

  const sourcesList = await runInProcessJsonCli<{
    filters: {
      date: string | null
      from: string | null
      to: string | null
      providers: string[]
      limit: number
    }
    count: number
    items: Array<Record<string, unknown>>
  }>(cli, [
    'wearables',
    'sources',
    'list',
    '--vault',
    vaultRoot,
  ])
  assert.equal(sourcesList.exitCode, null)
  assert.equal(requireData(sourcesList.envelope).count >= 0, true)
})

test('wearables provider filters reject unsupported provider names in-process', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-wearables-provider-guard-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createCoverageCli()
  const result = await runInProcessJsonCli(cli, [
    'wearables',
    'day',
    '2026-04-05',
    '--provider',
    'ottoai',
    '--vault',
    vaultRoot,
  ])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  if (!result.envelope.ok) {
    assert.match(
      result.envelope.error.message ?? '',
      /Unsupported value for --provider: "ottoai"/u,
    )
    assert.match(result.envelope.error.message ?? '', /garmin, oura, strava, whoop/u)
  }
})
