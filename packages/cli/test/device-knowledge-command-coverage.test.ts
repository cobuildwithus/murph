import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterEach, test } from 'vitest'
import type {
  DeviceAccountDisconnectResult,
  DeviceAccountListResult,
  DeviceAccountReconcileResult,
  DeviceAccountShowResult,
  DeviceConnectResult,
  DeviceDaemonStartResult,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
  DeviceProviderListResult,
} from '@murphai/operator-config/device-cli-contracts'
import {
  createIntegratedVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'

import { registerDeviceCommands } from '../src/commands/device.js'
import type {
  KnowledgeGetResult as KnowledgeShowResult,
  KnowledgeIndexRebuildResult,
  KnowledgeLintResult,
  KnowledgeListResult,
  KnowledgeLogTailResult,
  KnowledgeSearchResult,
  KnowledgeUpsertResult,
} from '@murphai/query'
import { createVaultCli } from '../src/vault-cli.js'
import {
  createTempVaultContext,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

const deviceBaseUrl = 'http://127.0.0.1:45123'

const connectedAccount: DeviceAccountShowResult['account'] = {
  id: 'acct_oura_01',
  provider: 'oura',
  externalAccountId: 'oura-user-1',
  displayName: 'Oura Test Account',
  status: 'active',
  scopes: ['email', 'personal', 'daily'],
  accessTokenExpiresAt: '2026-04-09T00:00:00.000Z',
  metadata: {
    source: 'coverage-test',
  },
  connectedAt: '2026-04-08T00:00:00.000Z',
  lastWebhookAt: null,
  lastSyncStartedAt: null,
  lastSyncCompletedAt: null,
  lastSyncErrorAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  nextReconcileAt: '2026-04-09T06:00:00.000Z',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
}

function createDeviceCommandServices() {
  const services = createIntegratedVaultServices()
  const calls = {
    connect: null as Parameters<VaultServices['devices']['connect']>[0] | null,
    daemonStart:
      null as Parameters<VaultServices['devices']['daemonStart']>[0] | null,
    daemonStatus:
      null as Parameters<VaultServices['devices']['daemonStatus']>[0] | null,
    daemonStop:
      null as Parameters<VaultServices['devices']['daemonStop']>[0] | null,
    disconnectAccount:
      null as Parameters<VaultServices['devices']['disconnectAccount']>[0] | null,
    listAccounts:
      null as Parameters<VaultServices['devices']['listAccounts']>[0] | null,
    listProviders:
      null as Parameters<VaultServices['devices']['listProviders']>[0] | null,
    reconcileAccount:
      null as Parameters<VaultServices['devices']['reconcileAccount']>[0] | null,
    showAccount:
      null as Parameters<VaultServices['devices']['showAccount']>[0] | null,
  }

  const providerListResult: DeviceProviderListResult = {
    baseUrl: deviceBaseUrl,
    providers: [
      {
        provider: 'oura',
        callbackPath: '/oauth/oura/callback',
        callbackUrl: `${deviceBaseUrl}/oauth/oura/callback`,
        webhookPath: '/webhooks/oura',
        webhookUrl: `${deviceBaseUrl}/webhooks/oura`,
        supportsWebhooks: true,
        defaultScopes: ['email', 'personal', 'daily'],
      },
    ],
  }

  const connectResult: DeviceConnectResult = {
    baseUrl: deviceBaseUrl,
    provider: 'oura',
    state: 'state_oura_01',
    expiresAt: '2026-04-08T01:00:00.000Z',
    authorizationUrl: 'https://cloud.oura.test/oauth?state=state_oura_01',
    openedBrowser: true,
  }

  const accountListResult: DeviceAccountListResult = {
    baseUrl: deviceBaseUrl,
    provider: 'oura',
    accounts: [connectedAccount],
  }

  const accountShowResult: DeviceAccountShowResult = {
    baseUrl: deviceBaseUrl,
    account: connectedAccount,
  }

  const reconcileResult: DeviceAccountReconcileResult = {
    baseUrl: deviceBaseUrl,
    account: connectedAccount,
    job: {
      id: 'job_oura_01',
      provider: 'oura',
      accountId: connectedAccount.id,
      kind: 'reconcile',
      payload: {
        mode: 'manual',
      },
      priority: 100,
      availableAt: '2026-04-08T00:01:00.000Z',
      attempts: 0,
      maxAttempts: 5,
      dedupeKey: `reconcile:${connectedAccount.id}`,
      status: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: '2026-04-08T00:01:00.000Z',
      updatedAt: '2026-04-08T00:01:00.000Z',
      startedAt: null,
      finishedAt: null,
    },
  }

  const disconnectResult: DeviceAccountDisconnectResult = {
    baseUrl: deviceBaseUrl,
    account: {
      ...connectedAccount,
      status: 'disconnected',
      updatedAt: '2026-04-08T00:02:00.000Z',
    },
  }

  const daemonStatusResult: DeviceDaemonStatusResult = {
    baseUrl: deviceBaseUrl,
    statePath: '.runtime/operations/device-sync/state.json',
    stdoutLogPath: '.runtime/operations/device-sync/stdout.log',
    stderrLogPath: '.runtime/operations/device-sync/stderr.log',
    managed: true,
    running: true,
    healthy: true,
    pid: 45123,
    startedAt: '2026-04-08T00:00:00.000Z',
    message: 'Device daemon healthy.',
  }

  const daemonStartResult: DeviceDaemonStartResult = {
    ...daemonStatusResult,
    started: true,
  }

  const daemonStopResult: DeviceDaemonStopResult = {
    ...daemonStatusResult,
    running: false,
    healthy: false,
    pid: null,
    stopped: true,
    message: 'Device daemon stopped.',
  }

  services.devices = {
    ...services.devices,
    async connect(input) {
      calls.connect = input
      return connectResult
    },
    async daemonStart(input) {
      calls.daemonStart = input
      return daemonStartResult
    },
    async daemonStatus(input) {
      calls.daemonStatus = input
      return daemonStatusResult
    },
    async daemonStop(input) {
      calls.daemonStop = input
      return daemonStopResult
    },
    async disconnectAccount(input) {
      calls.disconnectAccount = input
      return disconnectResult
    },
    async listAccounts(input) {
      calls.listAccounts = input
      return accountListResult
    },
    async listProviders(input) {
      calls.listProviders = input
      return providerListResult
    },
    async reconcileAccount(input) {
      calls.reconcileAccount = input
      return reconcileResult
    },
    async showAccount(input) {
      calls.showAccount = input
      return accountShowResult
    },
  }

  return {
    calls,
    services,
  }
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
) {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

test('device commands route every verb through the registered device service group', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-device-command-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const cli = Cli.create('vault-cli', {
    description: 'device coverage cli',
    version: '0.0.0-test',
  })
  const { calls, services } = createDeviceCommandServices()
  registerDeviceCommands(cli, services)

  const providers = await runInProcessJsonCli<DeviceProviderListResult>(cli, [
    'device',
    'provider',
    'list',
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
  ])
  assert.equal(providers.exitCode, null)
  assert.equal(providers.envelope.ok, true)
  assert.equal(providers.envelope.data.providers[0]?.provider, 'oura')
  assert.deepEqual(calls.listProviders, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
  })

  const connect = await runInProcessJsonCli<DeviceConnectResult>(cli, [
    'device',
    'connect',
    'oura',
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
    '--return-to',
    'http://127.0.0.1:3000/devices',
    '--open',
  ])
  assert.equal(connect.exitCode, null)
  assert.equal(connect.envelope.ok, true)
  assert.equal(connect.envelope.data.openedBrowser, true)
  assert.deepEqual(calls.connect, {
    vault: vaultRoot,
    provider: 'oura',
    baseUrl: deviceBaseUrl,
    returnTo: 'http://127.0.0.1:3000/devices',
    open: true,
  })

  const accounts = await runInProcessJsonCli<DeviceAccountListResult>(cli, [
    'device',
    'account',
    'list',
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
    '--provider',
    'oura',
  ])
  assert.equal(accounts.exitCode, null)
  assert.equal(accounts.envelope.ok, true)
  assert.equal(accounts.envelope.data.accounts[0]?.id, connectedAccount.id)
  assert.deepEqual(calls.listAccounts, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
    provider: 'oura',
  })

  const shown = await runInProcessJsonCli<DeviceAccountShowResult>(cli, [
    'device',
    'account',
    'show',
    connectedAccount.id,
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
  ])
  assert.equal(shown.exitCode, null)
  assert.equal(shown.envelope.ok, true)
  assert.equal(shown.envelope.data.account.provider, 'oura')
  assert.deepEqual(calls.showAccount, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
    accountId: connectedAccount.id,
  })

  const reconciled = await runInProcessJsonCli<DeviceAccountReconcileResult>(
    cli,
    [
      'device',
      'account',
      'reconcile',
      connectedAccount.id,
      '--vault',
      vaultRoot,
      '--base-url',
      deviceBaseUrl,
    ],
  )
  assert.equal(reconciled.exitCode, null)
  assert.equal(reconciled.envelope.ok, true)
  assert.equal(reconciled.envelope.data.job.accountId, connectedAccount.id)
  assert.deepEqual(calls.reconcileAccount, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
    accountId: connectedAccount.id,
  })

  const disconnected = await runInProcessJsonCli<DeviceAccountDisconnectResult>(
    cli,
    [
      'device',
      'account',
      'disconnect',
      connectedAccount.id,
      '--vault',
      vaultRoot,
      '--base-url',
      deviceBaseUrl,
    ],
  )
  assert.equal(disconnected.exitCode, null)
  assert.equal(disconnected.envelope.ok, true)
  assert.equal(disconnected.envelope.data.account.status, 'disconnected')
  assert.deepEqual(calls.disconnectAccount, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
    accountId: connectedAccount.id,
  })

  const status = await runInProcessJsonCli<DeviceDaemonStatusResult>(cli, [
    'device',
    'daemon',
    'status',
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
  ])
  assert.equal(status.exitCode, null)
  assert.equal(status.envelope.ok, true)
  assert.equal(status.envelope.data.healthy, true)
  assert.deepEqual(calls.daemonStatus, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
  })

  const started = await runInProcessJsonCli<DeviceDaemonStartResult>(cli, [
    'device',
    'daemon',
    'start',
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
  ])
  assert.equal(started.exitCode, null)
  assert.equal(started.envelope.ok, true)
  assert.equal(started.envelope.data.started, true)
  assert.deepEqual(calls.daemonStart, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
  })

  const stopped = await runInProcessJsonCli<DeviceDaemonStopResult>(cli, [
    'device',
    'daemon',
    'stop',
    '--vault',
    vaultRoot,
    '--base-url',
    deviceBaseUrl,
  ])
  assert.equal(stopped.exitCode, null)
  assert.equal(stopped.envelope.ok, true)
  assert.equal(stopped.envelope.data.stopped, true)
  assert.deepEqual(calls.daemonStop, {
    vault: vaultRoot,
    baseUrl: deviceBaseUrl,
  })
})

test('knowledge commands round-trip the registered CLI against a temp vault', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-knowledge-command-coverage-',
  )
  cleanupPaths.push(parentRoot)

  await writeVaultFile(
    vaultRoot,
    'bank/library/sleep-architecture.md',
    [
      '---',
      'title: Sleep architecture',
      'slug: sleep-architecture',
      'entityType: biomarker',
      '---',
      '',
      '# Sleep architecture',
      '',
      'Reference page.',
      '',
    ].join('\n'),
  )
  await writeVaultFile(
    vaultRoot,
    'research/2026/04/magnesium-and-sleep.md',
    [
      '# Magnesium and sleep',
      '',
      'Repeated notes linked magnesium to better sleep continuity.',
      '',
    ].join('\n'),
  )

  const cli = createVaultCli()

  const initialized = await runInProcessJsonCli(cli, [
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initialized.exitCode, null)
  assert.equal(initialized.envelope.ok, true)

  const upserted = await runInProcessJsonCli<KnowledgeUpsertResult>(cli, [
    'knowledge',
    'upsert',
    '--vault',
    vaultRoot,
    '--title',
    'Magnesium and sleep continuity',
    '--body',
    [
      '# Magnesium and sleep continuity',
      '',
      'Magnesium improved sleep continuity in repeated notes.',
      '',
      '## Related',
      '',
      '- [[sleep-continuity]]',
      '',
    ].join('\n'),
    '--page-type',
    'pattern',
    '--status',
    'draft',
    '--related-slug',
    'sleep-continuity',
    '--library-slug',
    'sleep-architecture',
    '--source-path',
    'research/2026/04/magnesium-and-sleep.md',
  ])
  assert.equal(upserted.exitCode, null)
  assert.equal(upserted.envelope.ok, true)
  assert.equal(
    upserted.envelope.data.page.slug,
    'magnesium-and-sleep-continuity',
  )
  assert.equal(upserted.envelope.data.page.pageType, 'pattern')
  assert.equal(upserted.envelope.data.page.status, 'draft')
  assert.deepEqual(upserted.envelope.data.page.librarySlugs, [
    'sleep-architecture',
  ])
  assert.deepEqual(upserted.envelope.data.page.relatedSlugs, [
    'sleep-continuity',
  ])

  const listed = await runInProcessJsonCli<KnowledgeListResult>(cli, [
    'knowledge',
    'list',
    '--vault',
    vaultRoot,
    '--page-type',
    'pattern',
    '--status',
    'draft',
  ])
  assert.equal(listed.exitCode, null)
  assert.equal(listed.envelope.ok, true)
  assert.equal(listed.envelope.data.pageCount, 1)
  assert.equal(listed.envelope.data.pages[0]?.slug, upserted.envelope.data.page.slug)

  const searched = await runInProcessJsonCli<KnowledgeSearchResult>(cli, [
    'knowledge',
    'search',
    'magnesium sleep',
    '--vault',
    vaultRoot,
    '--page-type',
    'pattern',
    '--status',
    'draft',
    '--limit',
    '1',
  ])
  assert.equal(searched.exitCode, null)
  assert.equal(searched.envelope.ok, true)
  assert.equal(searched.envelope.data.total, 1)
  assert.equal(searched.envelope.data.hits[0]?.slug, upserted.envelope.data.page.slug)
  assert.equal(searched.envelope.data.query, 'magnesium sleep')

  const shown = await runInProcessJsonCli<KnowledgeShowResult>(cli, [
    'knowledge',
    'show',
    upserted.envelope.data.page.slug,
    '--vault',
    vaultRoot,
  ])
  assert.equal(shown.exitCode, null)
  assert.equal(shown.envelope.ok, true)
  assert.match(shown.envelope.data.page.markdown, /# Magnesium and sleep continuity/u)

  const linted = await runInProcessJsonCli<KnowledgeLintResult>(cli, [
    'knowledge',
    'lint',
    '--vault',
    vaultRoot,
  ])
  assert.equal(linted.exitCode, null)
  assert.equal(linted.envelope.ok, true)
  assert.equal(linted.envelope.data.ok, true)
  assert.equal(linted.envelope.data.problemCount, 1)
  assert.equal(linted.envelope.data.problems[0]?.severity, 'warning')

  const tailed = await runInProcessJsonCli<KnowledgeLogTailResult>(cli, [
    'knowledge',
    'log',
    'tail',
    '--vault',
    vaultRoot,
    '--limit',
    '1',
  ])
  assert.equal(tailed.exitCode, null)
  assert.equal(tailed.envelope.ok, true)
  assert.equal(tailed.envelope.data.count, 1)
  assert.equal(tailed.envelope.data.entries[0]?.action, 'upsert')

  const rebuilt = await runInProcessJsonCli<KnowledgeIndexRebuildResult>(cli, [
    'knowledge',
    'index',
    'rebuild',
    '--vault',
    vaultRoot,
  ])
  assert.equal(rebuilt.exitCode, null)
  assert.equal(rebuilt.envelope.ok, true)
  assert.equal(rebuilt.envelope.data.rebuilt, true)
  assert.deepEqual(rebuilt.envelope.data.pageTypes, ['pattern'])

  const indexMarkdown = await readFile(
    path.join(vaultRoot, rebuilt.envelope.data.indexPath),
    'utf8',
  )
  assert.match(indexMarkdown, /Magnesium and sleep continuity/u)
})
