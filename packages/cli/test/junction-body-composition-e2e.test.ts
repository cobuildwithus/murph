import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  eventRevisionFromLifecycle,
} from '@murphai/contracts'
import * as coreRuntime from '@murphai/core'
import {
  createJunctionDeviceSyncProvider,
  type DeviceSyncAccount,
  type DeviceSyncJobRecord,
  type ProviderJobContext,
} from '@murphai/device-syncd'
import {
  importDeviceProviderSnapshot,
} from '@murphai/importers'
import {
  readVault,
} from '@murphai/query'
import {
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  refreshAssistantContextSnapshot,
} from '@murphai/assistant-engine'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

import {
  registerWearablesCommands,
} from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

function createAccount(): DeviceSyncAccount {
  return {
    accessTokenExpiresAt: null,
    connectedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    credential: {
      credentialMetadata: {},
      kind: 'provider_config',
      providerConfigKey: 'junction',
    },
    disconnectGeneration: 0,
    displayName: 'Junction',
    externalAccountId: 'junction-test-user',
    id: 'junction-test-account',
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadata: {},
    nextReconcileAt: null,
    provider: 'junction',
    scopes: [],
    status: 'active',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function createJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    accountId: 'junction-test-account',
    attempts: 0,
    availableAt: '2026-08-11T00:00:00.000Z',
    createdAt: '2026-08-11T00:00:00.000Z',
    dedupeKey: null,
    finishedAt: null,
    id: `junction-body-${kind}`,
    kind,
    lastErrorCode: null,
    lastErrorMessage: null,
    leaseExpiresAt: null,
    leaseOwner: null,
    maxAttempts: 5,
    payload,
    priority: 50,
    provider: 'junction',
    startedAt: null,
    status: 'queued',
    updatedAt: '2026-08-11T00:00:00.000Z',
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
}

test('Junction body data composes from provider jobs through canonical vault reads and CLI output', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'murph-junction-body-e2e-'))
  const vaultRoot = path.join(parentRoot, 'vault')
  let waistValue = 84.6

  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-08-01T00:00:00.000Z',
      timezone: 'UTC',
      vaultRoot,
    })

    const provider = createJunctionDeviceSyncProvider({
      apiKey: 'sk_us_test_123',
      clientUserIdSecret: 'junction-test-client-secret',
      environment: 'sandbox',
      region: 'us',
      summaryResources: ['body'],
      timeseriesResources: [
        'weight',
        'fat',
        'body_mass_index',
        'lean_body_mass',
        'waist_circumference',
      ],
      fetchImpl: async (input) => {
        const url = new URL(typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url)
        if (url.pathname === '/v2/user/providers/junction-test-user') {
          return jsonResponse({ providers: [{
            id: 'withings-test-connection',
            name: 'Withings',
            resource_availability: {
              body: true,
              body_fat: true,
              body_mass_index: true,
              body_weight: true,
              lean_body_mass: true,
              waist_circumference: true,
            },
            slug: 'withings',
            status: 'connected',
          }] })
        }
        if (url.pathname === '/v2/summary/body/junction-test-user') {
          return jsonResponse({ data: [{
            bone_mass_percentage: 4.2,
            date: '2026-08-10T08:00:00.000Z',
            id: 'withings-body-summary',
            muscle_mass_percentage: 63.4,
            source: { provider: 'withings', type: 'scale' },
            visceral_fat_index: 7,
            water_percentage: 51.8,
          }] })
        }
        if (url.pathname.startsWith('/v2/introspect/')) {
          return jsonResponse({ data: [] })
        }

        const endpoint = url.pathname.match(
          /^\/v2\/timeseries\/junction-test-user\/(body_weight|body_fat|body_mass_index|lean_body_mass|waist_circumference)\/grouped$/u,
        )?.[1]
        if (!endpoint) {
          throw new Error(`Unexpected Junction endpoint: ${url.pathname}`)
        }
        const recordByEndpoint: Record<string, Record<string, unknown>> = {
          body_fat: {
            observedAt: '2026-08-09T08:05:00.000Z',
            timestamp: '2026-08-10T08:05:00.000Z',
            unit: '%',
            value: 18.4,
          },
          body_mass_index: {
            end: '2026-08-10T08:07:00.000Z',
            start: '2026-08-10T08:06:00.000Z',
            timestamp: '2026-08-09T08:06:00.000Z',
            unit: 'index',
            value: 23.7,
          },
          body_weight: {
            observedAt: '2026-08-09T08:00:00.000Z',
            timestamp: '2026-08-10T08:00:00.000Z',
            unit: 'kg',
            value: 72.4,
          },
          lean_body_mass: {
            end: '2026-08-10T08:09:00.000Z',
            start: '2026-08-10T08:08:00.000Z',
            timestamp: '2026-08-09T08:08:00.000Z',
            unit: 'kg',
            value: 59.1,
          },
          waist_circumference: {
            end: '2026-08-10T08:11:00.000Z',
            start: '2026-08-10T08:10:00.000Z',
            timestamp: '2026-08-09T08:10:00.000Z',
            unit: 'cm',
            value: waistValue,
          },
        }
        return jsonResponse({ groups: {
          withings: [{
            data: [
              recordByEndpoint[endpoint],
              endpoint === 'body_weight'
                ? {
                    observedAt: '2026-08-10T09:00:00.000Z',
                    timestamp: '2026-08-11T09:00:00.000Z',
                    unit: 'kg',
                    value: 999,
                  }
                : {
                    end: '2026-08-10T09:01:00.000Z',
                    start: '2026-08-09T09:00:00.000Z',
                    timestamp: '2026-08-10T09:00:00.000Z',
                    unit: endpoint === 'body_mass_index' ? 'index' : 'kg',
                    value: 999,
                  },
            ],
            source: { provider: 'withings', type: 'scale' },
          }],
        } })
      },
    })
    const imports: Array<Awaited<ReturnType<typeof importDeviceProviderSnapshot>>> = []
    const account = createAccount()
    const context = (now: string): ProviderJobContext => ({
      account,
      importSnapshot: async (snapshot) => {
        const result = await importDeviceProviderSnapshot(
          { provider: 'junction', snapshot, vaultRoot },
          { corePort: coreRuntime },
        )
        imports.push(result)
        return {
          ...result,
          canonicalEventCount: result.events.length,
          durableDeliveryAccepted: true,
        }
      },
      logger: {},
      now,
      refreshAccountTokens: async () => account,
    })
    const executor = provider.jobExecutor
    assert.ok(executor)

    await executor.executeJob(context('2026-08-11T00:00:00.000Z'), createJob('backfill', {
      windowEnd: '2026-08-11T00:00:00.000Z',
      windowStart: '2026-08-10T00:00:00.000Z',
    }))

    const sparseImport = imports.find((result) =>
      result.events.filter((event) => event.kind === 'observation' && event.observationGrain === 'sample').length === 5
    )
    assert.ok(sparseImport)
    assert.equal(
      imports.flatMap((result) => result.events).filter((event) =>
        event.kind === 'observation'
        && ['body-water-percentage', 'bone-mass-percentage', 'muscle-mass-percentage', 'visceral-fat-index'].includes(event.metric)
      ).length,
      4,
      JSON.stringify(imports.map((result) => result.events.map((event) =>
        event.kind === 'observation' ? event.metric : event.kind
      ))),
    )
    assert.equal(sparseImport.samples.length, 0)
    assert.ok(sparseImport.ingestId)
    const sparseIngest = await coreRuntime.readIntegrationIngestById(vaultRoot, sparseImport.ingestId)
    const sparseRoles = sparseIngest?.record.parts
      .map((part) => part.role)
      .filter((role) => role.startsWith('junction-timeseries-reading-')) ?? []
    assert.equal(sparseRoles.length, 5)
    assert.equal(new Set(sparseRoles.map((role) => role.split(':')[0])).size, 5)
    assert.equal(sparseIngest?.record.parts.some((part) =>
      part.role === 'provider-snapshot'
      || /^junction-timeseries-(?!reading-)/u.test(part.role)
    ), false)

    waistValue = 83.9
    await executor.executeJob(context('2026-08-11T00:05:00.000Z'), createJob('resource', {
      resource: 'waist_circumference',
      resourceCategory: 'timeseries',
      windowEnd: '2026-08-11T00:00:00.000Z',
      windowStart: '2026-08-10T00:00:00.000Z',
    }))
    await executor.executeJob(context('2026-08-11T00:10:00.000Z'), createJob('resource', {
      resource: 'waist_circumference',
      resourceCategory: 'timeseries',
      windowEnd: '2026-08-11T00:00:00.000Z',
      windowStart: '2026-08-10T00:00:00.000Z',
    }))
    const corrected = imports.at(-2)?.events.find((event) =>
      event.kind === 'observation' && event.metric === 'waist-circumference'
    )
    assert.equal(corrected?.kind, 'observation')
    if (corrected?.kind !== 'observation') {
      throw new Error('Expected corrected waist observation')
    }
    assert.equal(corrected.value, 83.9)
    assert.equal(eventRevisionFromLifecycle(corrected.lifecycle), 2)
    assert.equal(imports.at(-1)?.applied, false)

    const services = createIntegratedVaultServices()
    const persistedEvents = (await Promise.all(
      [...new Set(imports.flatMap((result) => result.eventShardPaths))].map((relativePath) =>
        coreRuntime.readJsonlRecords({ relativePath, vaultRoot })
      ),
    )).flat()
    assert.equal(persistedEvents.length > 0, true)
    await readVault(vaultRoot)
    const body = await services.query.listWearableBodyState({
      limit: 30,
      requestId: null,
      vault: vaultRoot,
    })
    assert.equal(body.count, 1, JSON.stringify(persistedEvents.slice(0, 4).map((event) => ({
      dataOrigin: event.dataOrigin,
      externalRef: event.externalRef,
      grain: event.observationGrain,
      kind: event.kind,
      metric: event.kind === 'observation' ? event.metric : null,
    }))))
    assert.equal(body.items[0]?.bodyWaterPercentage.value, 51.8)
    assert.equal(body.items[0]?.boneMassPercentage.value, 4.2)
    assert.equal(body.items[0]?.muscleMassPercentage.value, 63.4)
    assert.equal(body.items[0]?.visceralFatIndex.value, 7)

    const bmiLatest = await services.query.showWearableMetricLatest({
      metric: 'bmi',
      requestId: null,
      vault: vaultRoot,
      windowDays: 7,
    })
    assert.equal(bmiLatest.summary?.provider, 'withings')
    assert.equal(bmiLatest.summary?.unit, 'kg/m^2')
    assert.equal(bmiLatest.summary?.value, 23.7)
    const waistTrend = await services.query.showWearableMetricTrend({
      metric: 'waist-circumference',
      requestId: null,
      vault: vaultRoot,
      windowDays: 7,
    })
    assert.equal(waistTrend.summary?.value, 83.9)
    assert.equal(waistTrend.summary?.points[0]?.value, 83.9)

    await markAssistantContextSnapshotDirty({
      domains: ['health_context'],
      vaultRoot,
    })
    await refreshAssistantContextSnapshot({
      now: () => '2026-08-11T00:15:00.000Z',
      vaultRoot,
    })
    const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
    assert.match(prompt, /Body\/scale measurement history is present/u)
    assert.match(prompt, /wearables metric latest <canonical-body-metric>/u)
    assert.match(prompt, /measurement entry list --metric <canonical-body-metric>/u)

    const cli = Cli.create('vault-cli', {
      description: 'Junction body composition test CLI',
      version: '0.0.0-test',
    })
    cli.use(incurErrorBridge)
    registerWearablesCommands(cli, services)
    const bodyCli = await runInProcessJsonCli<{
      items: Array<Record<string, { value?: number | null }>>
    }>(cli, ['wearables', 'body', 'list', '--vault', vaultRoot])
    const bodyCliItem = requireData(bodyCli.envelope).items[0]
    assert.equal(bodyCliItem?.bodyWaterPercentage?.value, 51.8)
    assert.equal(bodyCliItem?.boneMassPercentage?.value, 4.2)
    assert.equal(bodyCliItem?.muscleMassPercentage?.value, 63.4)
    assert.equal(bodyCliItem?.visceralFatIndex?.value, 7)

    const metricCli = await runInProcessJsonCli<{
      summary: { provider: string | null; unit: string | null; value: number | null } | null
    }>(cli, ['wearables', 'metric', 'latest', 'bmi', '--vault', vaultRoot])
    const metricCliSummary = requireData(metricCli.envelope).summary
    assert.equal(metricCliSummary?.provider, 'withings')
    assert.equal(metricCliSummary?.unit, 'kg/m^2')
    assert.equal(metricCliSummary?.value, 23.7)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})
