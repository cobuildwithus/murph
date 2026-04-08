import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { test } from 'vitest'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerSupplementCommands } from '../src/commands/supplement.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

type VaultServices = ReturnType<typeof createUnwiredVaultServices>

const vaultRoot = '/tmp/murph-cli-health-command-coverage'

function createReadEntity(id: string, kind: string) {
  return {
    id,
    kind,
    title: `${kind} title`,
    occurredAt: null,
    path: `bank/${kind}s/${id}.md`,
    markdown: null,
    data: {
      status: 'active',
    },
    links: [],
  }
}

function createSliceCli(configureServices?: (services: VaultServices) => void) {
  const cli = Cli.create('vault-cli', {
    description: 'health/read coverage slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createUnwiredVaultServices()

  configureServices?.(services)
  registerReadCommands(cli, services)
  registerSupplementCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: string[],
  configureServices?: (services: VaultServices) => void,
): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli(configureServices)
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

test('generic show and list forward canonical read filters through the shared query service', async () => {
  const showCalls: Array<{
    id: string
    requestId: string | null
    vault: string
  }> = []
  const listCalls: Array<{
    experiment?: string
    from?: string
    kind?: string
    limit: number
    recordType?: string[]
    requestId: string | null
    status?: string
    stream?: string[]
    tag?: string[]
    to?: string
    vault: string
  }> = []

  const showResult = await runSliceCli<{
    vault: string
    entity: ReturnType<typeof createReadEntity>
  }>([
    'show',
    'goal_sleep_01',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-show-01',
  ], (services) => {
    services.query.show = async (input) => {
      showCalls.push({
        id: input.id,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        entity: createReadEntity('goal_sleep_01', 'goal'),
      }
    }

    services.query.list = async (input) => {
      listCalls.push({
        vault: input.vault,
        requestId: input.requestId,
        recordType: input.recordType,
        kind: input.kind,
        status: input.status,
        stream: input.stream,
        experiment: input.experiment,
        from: input.from,
        to: input.to,
        tag: input.tag,
        limit: input.limit,
      })

      return {
        vault: input.vault,
        filters: {
          recordType: input.recordType,
          kind: input.kind,
          status: input.status,
          stream: input.stream,
          experiment: input.experiment,
          from: input.from,
          to: input.to,
          tag: input.tag,
          limit: input.limit,
        },
        items: [createReadEntity('goal_sleep_01', 'goal')],
        count: 1,
        nextCursor: null,
      }
    }
  })

  const listResult = await runSliceCli<{
    vault: string
    filters: {
      recordType?: string[]
      kind?: string
      status?: string
      stream?: string[]
      experiment?: string
      from?: string
      to?: string
      tag?: string[]
      limit: number
    }
    items: Array<ReturnType<typeof createReadEntity>>
    count: number
    nextCursor: string | null
  }>([
    'list',
    '--record-type',
    'goal',
    '--record-type',
    'protocol',
    '--kind',
    'goal',
    '--status',
    'active',
    '--stream',
    'hrv',
    '--stream',
    'resting_heart_rate',
    '--experiment',
    'sleep-reset',
    '--from',
    '2026-03-01',
    '--to',
    '2026-03-31',
    '--tag',
    'sleep',
    '--tag',
    'focus',
    '--limit',
    '3',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-list-01',
  ], (services) => {
    services.query.show = async (input) => ({
      vault: input.vault,
      entity: createReadEntity('goal_sleep_01', 'goal'),
    })

    services.query.list = async (input) => {
      listCalls.push({
        vault: input.vault,
        requestId: input.requestId,
        recordType: input.recordType,
        kind: input.kind,
        status: input.status,
        stream: input.stream,
        experiment: input.experiment,
        from: input.from,
        to: input.to,
        tag: input.tag,
        limit: input.limit,
      })

      return {
        vault: input.vault,
        filters: {
          recordType: input.recordType,
          kind: input.kind,
          status: input.status,
          stream: input.stream,
          experiment: input.experiment,
          from: input.from,
          to: input.to,
          tag: input.tag,
          limit: input.limit,
        },
        items: [createReadEntity('goal_sleep_01', 'goal')],
        count: 1,
        nextCursor: null,
      }
    }
  })

  assert.equal(showResult.ok, true)
  assert.equal(showResult.meta?.command, 'show')
  assert.equal(requireData(showResult).entity.id, 'goal_sleep_01')
  assert.deepEqual(showCalls, [
    {
      id: 'goal_sleep_01',
      vault: vaultRoot,
      requestId: 'req-show-01',
    },
  ])

  assert.equal(listResult.ok, true)
  assert.equal(listResult.meta?.command, 'list')
  assert.equal(requireData(listResult).count, 1)
  assert.deepEqual(requireData(listResult).filters, {
    recordType: ['goal', 'protocol'],
    kind: 'goal',
    status: 'active',
    stream: ['hrv', 'resting_heart_rate'],
    experiment: 'sleep-reset',
    from: '2026-03-01',
    to: '2026-03-31',
    tag: ['sleep', 'focus'],
    limit: 3,
  })
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: 'req-list-01',
      recordType: ['goal', 'protocol'],
      kind: 'goal',
      status: 'active',
      stream: ['hrv', 'resting_heart_rate'],
      experiment: 'sleep-reset',
      from: '2026-03-01',
      to: '2026-03-31',
      tag: ['sleep', 'focus'],
      limit: 3,
    },
  ])
})

test('supplement stop, rename, and compound commands forward arguments and keep follow-up CTAs intact', async () => {
  const stopCalls: Array<{
    protocolId: string
    requestId: string | null
    stoppedOn?: string
    vault: string
  }> = []
  const renameCalls: Array<{
    lookup: string
    requestId: string | null
    slug?: string
    title: string
    vault: string
  }> = []
  const compoundListCalls: Array<{
    limit: number
    requestId: string | null
    status?: string
    vault: string
  }> = []
  const compoundShowCalls: Array<{
    compound: string
    requestId: string | null
    status?: string
    vault: string
  }> = []

  const stopResult = await runSliceCli<{
    vault: string
    protocolId: string
    lookupId: string
    stoppedOn: string | null
    status: string
  }>([
    'supplement',
    'stop',
    'supp_magnesium',
    '--stopped-on',
    '2026-03-12',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-stop-01',
  ], (services) => {
    services.core.stopSupplement = async (input) => {
      stopCalls.push({
        protocolId: input.protocolId,
        stoppedOn: input.stoppedOn,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        protocolId: input.protocolId,
        lookupId: input.protocolId,
        stoppedOn: input.stoppedOn ?? null,
        status: 'stopped',
      }
    }

    services.core.renameSupplement = async (input) => {
      renameCalls.push({
        lookup: input.lookup,
        title: input.title,
        slug: input.slug,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        protocolId: 'supp_magnesium',
        lookupId: input.slug ?? 'magnesium-glycinate',
        path: 'bank/protocols/supplements/magnesium-glycinate-200.md',
        created: false,
      }
    }

    services.query.listSupplementCompounds = async (input) => {
      compoundListCalls.push({
        limit: input.limit,
        status: input.status,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        filters: {
          status: input.status ?? 'active',
          limit: input.limit,
        },
        items: [
          {
            compound: 'Magnesium Glycinate',
            lookupId: 'magnesium-glycinate',
            totals: [
              {
                unit: 'mg',
                totalAmount: 240,
                sourceCount: 2,
                incomplete: false,
              },
            ],
            supplementCount: 2,
            supplementIds: ['supp_magnesium', 'supp_evening_stack'],
            sources: [
              {
                supplementId: 'supp_magnesium',
                supplementSlug: 'magnesium-glycinate',
                supplementTitle: 'Magnesium Glycinate',
                brand: null,
                manufacturer: null,
                status: 'active',
                label: 'Magnesium glycinate 120 mg',
                amount: 120,
                unit: 'mg',
                note: null,
              },
            ],
          },
        ],
        count: 1,
        nextCursor: null,
      }
    }

    services.query.showSupplementCompound = async (input) => {
      compoundShowCalls.push({
        compound: input.compound,
        status: input.status,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        filters: {
          status: input.status ?? 'active',
          limit: undefined,
        },
        compound: {
          compound: 'Magnesium Glycinate',
          lookupId: 'magnesium-glycinate',
          totals: [
            {
              unit: 'mg',
              totalAmount: 240,
              sourceCount: 2,
              incomplete: false,
            },
          ],
          supplementCount: 2,
          supplementIds: ['supp_magnesium', 'supp_evening_stack'],
          sources: [
            {
              supplementId: 'supp_magnesium',
              supplementSlug: 'magnesium-glycinate',
              supplementTitle: 'Magnesium Glycinate',
              brand: null,
              manufacturer: null,
              status: 'active',
              label: 'Magnesium glycinate 120 mg',
              amount: 120,
              unit: 'mg',
              note: null,
            },
          ],
        },
      }
    }
  })

  const renameResult = await runSliceCli<{
    vault: string
    protocolId: string
    lookupId: string
    path?: string
    created: boolean
  }>([
    'supplement',
    'rename',
    'supp_magnesium',
    '--title',
    'Magnesium Glycinate 200',
    '--slug',
    'magnesium-glycinate-200',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-rename-01',
  ], (services) => {
    services.core.stopSupplement = async (input) => ({
      vault: input.vault,
      protocolId: input.protocolId,
      lookupId: input.protocolId,
      stoppedOn: input.stoppedOn ?? null,
      status: 'stopped',
    })

    services.core.renameSupplement = async (input) => {
      renameCalls.push({
        lookup: input.lookup,
        title: input.title,
        slug: input.slug,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        protocolId: 'supp_magnesium',
        lookupId: input.slug ?? 'magnesium-glycinate',
        path: 'bank/protocols/supplements/magnesium-glycinate-200.md',
        created: false,
      }
    }

    services.query.listSupplementCompounds = async (input) => ({
      vault: input.vault,
      filters: {
        status: input.status ?? 'active',
        limit: input.limit,
      },
      items: [],
      count: 0,
      nextCursor: null,
    })

    services.query.showSupplementCompound = async (input) => ({
      vault: input.vault,
      filters: {
        status: input.status ?? 'active',
        limit: undefined,
      },
      compound: {
        compound: 'Magnesium Glycinate',
        lookupId: 'magnesium-glycinate',
        totals: [],
        supplementCount: 0,
        supplementIds: [],
        sources: [],
      },
    })
  })

  const compoundListResult = await runSliceCli<{
    vault: string
    filters: {
      status: string
      limit?: number
    }
    items: Array<{
      compound: string
      lookupId: string
      supplementCount: number
    }>
    count: number
    nextCursor: string | null
  }>([
    'supplement',
    'compound',
    'list',
    '--status',
    'stopped',
    '--limit',
    '5',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-compound-list-01',
  ], (services) => {
    services.core.stopSupplement = async (input) => ({
      vault: input.vault,
      protocolId: input.protocolId,
      lookupId: input.protocolId,
      stoppedOn: input.stoppedOn ?? null,
      status: 'stopped',
    })

    services.core.renameSupplement = async (input) => ({
      vault: input.vault,
      protocolId: 'supp_magnesium',
      lookupId: input.slug ?? 'magnesium-glycinate',
      path: 'bank/protocols/supplements/magnesium-glycinate-200.md',
      created: false,
    })

    services.query.listSupplementCompounds = async (input) => {
      compoundListCalls.push({
        limit: input.limit,
        status: input.status,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        filters: {
          status: input.status ?? 'active',
          limit: input.limit,
        },
        items: [
          {
            compound: 'Magnesium Glycinate',
            lookupId: 'magnesium-glycinate',
            totals: [],
            supplementCount: 2,
            supplementIds: ['supp_magnesium', 'supp_evening_stack'],
            sources: [],
          },
        ],
        count: 1,
        nextCursor: null,
      }
    }

    services.query.showSupplementCompound = async (input) => ({
      vault: input.vault,
      filters: {
        status: input.status ?? 'active',
        limit: undefined,
      },
      compound: {
        compound: 'Magnesium Glycinate',
        lookupId: 'magnesium-glycinate',
        totals: [],
        supplementCount: 2,
        supplementIds: ['supp_magnesium', 'supp_evening_stack'],
        sources: [],
      },
    })
  })

  const compoundShowResult = await runSliceCli<{
    vault: string
    filters: {
      status: string
      limit?: number
    }
    compound: {
      compound: string
      lookupId: string
      supplementCount: number
    }
  }>([
    'supplement',
    'compound',
    'show',
    'Magnesium Glycinate',
    '--status',
    'active',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-compound-show-01',
  ], (services) => {
    services.core.stopSupplement = async (input) => ({
      vault: input.vault,
      protocolId: input.protocolId,
      lookupId: input.protocolId,
      stoppedOn: input.stoppedOn ?? null,
      status: 'stopped',
    })

    services.core.renameSupplement = async (input) => ({
      vault: input.vault,
      protocolId: 'supp_magnesium',
      lookupId: input.slug ?? 'magnesium-glycinate',
      path: 'bank/protocols/supplements/magnesium-glycinate-200.md',
      created: false,
    })

    services.query.listSupplementCompounds = async (input) => ({
      vault: input.vault,
      filters: {
        status: input.status ?? 'active',
        limit: input.limit,
      },
      items: [],
      count: 0,
      nextCursor: null,
    })

    services.query.showSupplementCompound = async (input) => {
      compoundShowCalls.push({
        compound: input.compound,
        status: input.status,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        filters: {
          status: input.status ?? 'active',
          limit: undefined,
        },
        compound: {
          compound: 'Magnesium Glycinate',
          lookupId: 'magnesium-glycinate',
          totals: [],
          supplementCount: 2,
          supplementIds: ['supp_magnesium', 'supp_evening_stack'],
          sources: [],
        },
      }
    }
  })

  assert.equal(stopResult.ok, true)
  assert.equal(stopResult.meta?.command, 'supplement stop')
  assert.equal(requireData(stopResult).status, 'stopped')
  assert.deepEqual(stopCalls, [
    {
      protocolId: 'supp_magnesium',
      stoppedOn: '2026-03-12',
      vault: vaultRoot,
      requestId: 'req-stop-01',
    },
  ])
  assert.deepEqual(stopResult.meta?.cta?.commands, [
    {
      command: 'vault-cli supplement show supp_magnesium --vault <vault>',
      description: 'Show the stopped supplement record.',
    },
    {
      command: 'vault-cli supplement list --status stopped --vault <vault>',
      description: 'List stopped supplements.',
    },
  ])

  assert.equal(renameResult.ok, true)
  assert.equal(renameResult.meta?.command, 'supplement rename')
  assert.equal(requireData(renameResult).lookupId, 'magnesium-glycinate-200')
  assert.deepEqual(renameCalls, [
    {
      lookup: 'supp_magnesium',
      title: 'Magnesium Glycinate 200',
      slug: 'magnesium-glycinate-200',
      vault: vaultRoot,
      requestId: 'req-rename-01',
    },
  ])

  assert.equal(compoundListResult.ok, true)
  assert.equal(compoundListResult.meta?.command, 'supplement compound list')
  assert.equal(requireData(compoundListResult).count, 1)
  assert.deepEqual(compoundListCalls, [
    {
      limit: 5,
      status: 'stopped',
      vault: vaultRoot,
      requestId: 'req-compound-list-01',
    },
  ])

  assert.equal(compoundShowResult.ok, true)
  assert.equal(compoundShowResult.meta?.command, 'supplement compound show')
  assert.equal(requireData(compoundShowResult).compound.lookupId, 'magnesium-glycinate')
  assert.deepEqual(compoundShowCalls, [
    {
      compound: 'Magnesium Glycinate',
      status: 'active',
      vault: vaultRoot,
      requestId: 'req-compound-show-01',
    },
  ])
})
