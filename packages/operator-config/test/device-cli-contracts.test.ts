import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  deviceAccountDisconnectResultSchema,
  deviceAccountListResultSchema,
  deviceAccountReconcileResultSchema,
  deviceAccountShowResultSchema,
  deviceConnectResultSchema,
  deviceProviderListResultSchema,
  deviceSyncConnectTargetSchema,
  deviceSyncProviderKeySchema,
  deviceSyncProviderKeyValues,
  formatDeviceSyncProviderKeyList,
  normalizeDeviceSyncConnectTargetKey,
  normalizeDeviceSyncProviderKey,
} from '../src/device-cli-contracts.ts'

test('device CLI contracts normalize provider keys and parse result payloads', () => {
  const provider = deviceSyncProviderKeyValues[0]

  assert.equal(typeof provider, 'string')
  assert.equal(normalizeDeviceSyncProviderKey(`  ${provider.toUpperCase()}  `), provider)
  assert.equal(normalizeDeviceSyncProviderKey(' unsupported-provider '), null)
  assert.equal(deviceSyncProviderKeySchema.parse(provider.toUpperCase()), provider.toUpperCase())
  assert.throws(
    () => deviceSyncProviderKeySchema.parse('unsupported-provider'),
    /Unsupported device-sync provider/u,
  )
  assert.equal(normalizeDeviceSyncConnectTargetKey('  Fitbit Alta  '), 'fitbit_alta')
  assert.equal(deviceSyncConnectTargetSchema.parse('Fitbit Alta'), 'Fitbit Alta')
  assert.throws(
    () => deviceSyncConnectTargetSchema.parse('junction'),
    /Expected a device connect target/u,
  )
  assert.ok(formatDeviceSyncProviderKeyList().includes(provider))

  const now = '2026-04-23T00:00:00.000Z'
  const baseUrl = 'http://127.0.0.1:4318'
  const providerRecord = {
    provider,
    callbackPath: '/oauth/callback',
    callbackUrl: `${baseUrl}/oauth/callback`,
    webhookPath: '/webhook',
    webhookUrl: `${baseUrl}/webhook`,
    supportsWebhooks: true,
    defaultScopes: ['profile'],
  }
  const account = {
    id: 'account_123',
    provider,
    externalAccountId: 'external_123',
    displayName: null,
    status: 'active',
    scopes: ['profile'],
    accessTokenExpiresAt: null,
    metadata: { source: 'test' },
    connectedAt: now,
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const job = {
    id: 'job_123',
    provider,
    accountId: account.id,
    kind: 'manual-sync',
    payload: { reason: 'test' },
    priority: 0,
    availableAt: now,
    attempts: 0,
    maxAttempts: 3,
    dedupeKey: null,
    status: 'queued',
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  }

  assert.deepEqual(deviceProviderListResultSchema.parse({
    baseUrl,
    providers: [providerRecord],
  }).providers[0], providerRecord)
  assert.deepEqual(deviceProviderListResultSchema.parse({
    providers: [
      {
        ...providerRecord,
        source: 'catalog',
        displayName: 'Test provider',
        callbackUrl: null,
        webhookUrl: null,
        localConfigured: false,
      },
    ],
  }).providers[0]?.callbackUrl, null)
  assert.equal(deviceConnectResultSchema.parse({
    status: 'ok',
    kind: 'device_connect_link',
    backend: 'hosted',
    provider,
    connectUrl: `${baseUrl}/connect`,
    expiresAt: now,
    authorizationUrl: `${baseUrl}/authorize`,
  }).provider, provider)
  assert.equal(deviceAccountListResultSchema.parse({
    baseUrl,
    provider: null,
    accounts: [account],
  }).accounts[0]?.id, account.id)
  assert.deepEqual(deviceAccountListResultSchema.parse({
    baseUrl,
    provider: null,
    accounts: [],
  }).accounts, [])
  assert.equal(deviceAccountShowResultSchema.parse({ baseUrl, account }).account.id, account.id)
  const reconcile = deviceAccountReconcileResultSchema.parse({ baseUrl, account, job })
  assert.ok('job' in reconcile)
  assert.equal(reconcile.job.id, job.id)
  assert.equal(
    deviceAccountDisconnectResultSchema.parse({ baseUrl, account }).account.id,
    account.id,
  )
})
