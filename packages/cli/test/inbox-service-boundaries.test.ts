import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { resolveRuntimePaths } from '@healthybob/runtime-state'
import { test } from 'vitest'

import { instantiateConnector } from '../src/inbox-services/connectors.js'
import { normalizeDaemonState } from '../src/inbox-services/daemon.js'
import { readPromotionsByCapture } from '../src/inbox-services/promotions.js'

test('instantiateConnector delegates iMessage defaults through the connector factory', async () => {
  let received: {
    accountId?: string | null
    backfillLimit?: number
    id?: string
    includeOwnMessages?: boolean
  } | null = null

  const connector = await instantiateConnector({
    connector: {
      id: 'imessage:self',
      source: 'imessage',
      enabled: true,
      accountId: null,
      options: {
        includeOwnMessages: false,
        backfillLimit: 42,
      },
    },
    inputLimit: 7,
    async loadInbox() {
      return {
        createImessageConnector(options: {
          accountId?: string | null
          backfillLimit?: number
          id?: string
          includeOwnMessages?: boolean
        }) {
          received = options
          return {
            id: options.id ?? 'imessage:self',
            source: 'imessage',
            kind: 'poll',
            capabilities: {
              attachments: true,
              backfill: true,
              watch: true,
              webhooks: false,
            },
          }
        },
      } as any
    },
    async loadImessageDriver() {
      return {} as any
    },
    async loadTelegramDriver() {
      throw new Error('unreachable')
    },
  })

  assert.equal(connector.id, 'imessage:self')
  if (!received) {
    throw new Error('expected connector options to be captured')
  }
  const captured: {
    accountId?: string | null
    backfillLimit?: number
    includeOwnMessages?: boolean
  } = received
  assert.equal(captured.accountId, 'self')
  assert.equal(captured.includeOwnMessages, false)
  assert.equal(captured.backfillLimit, 7)
})

test.sequential('normalizeDaemonState rewrites stale daemon state records', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-inbox-daemon-'))

  try {
    const paths = resolveRuntimePaths(vaultRoot)
    await mkdir(path.dirname(paths.inboxStatePath), { recursive: true })
    await writeFile(
      paths.inboxStatePath,
      `${JSON.stringify({
        running: true,
        stale: false,
        pid: 4242,
        startedAt: '2026-03-18T12:00:00.000Z',
        stoppedAt: null,
        status: 'running',
        connectorIds: ['imessage:self'],
        message: null,
        statePath: '.runtime/inboxd/state.json',
        configPath: '.runtime/inboxd/config.json',
        databasePath: '.runtime/inboxd.sqlite',
      }, null, 2)}\n`,
      'utf8',
    )

    const state = await normalizeDaemonState(paths, {
      clock: () => new Date('2026-03-18T12:34:56.000Z'),
      getPid: () => 9999,
      killProcess() {
        const error = Object.assign(new Error('missing'), { code: 'ESRCH' })
        throw error
      },
    })

    assert.equal(state.running, false)
    assert.equal(state.stale, true)
    assert.equal(state.status, 'stale')
    assert.equal(
      state.message,
      'Stale daemon state found; recorded PID is no longer running.',
    )

    const persisted = JSON.parse(await readFile(paths.inboxStatePath, 'utf8')) as {
      stale: boolean
      status: string
    }
    assert.equal(persisted.stale, true)
    assert.equal(persisted.status, 'stale')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('readPromotionsByCapture groups promotion entries by capture id', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-inbox-promo-'))

  try {
    const paths = resolveRuntimePaths(vaultRoot)
    await mkdir(path.dirname(paths.inboxPromotionsPath), { recursive: true })
    await writeFile(
      paths.inboxPromotionsPath,
      `${JSON.stringify({
        version: 1,
        entries: [
          {
            captureId: 'cap-1',
            target: 'meal',
            status: 'applied',
            promotedAt: '2026-03-18T12:00:00.000Z',
            lookupId: 'evt-1',
            relatedId: 'meal-1',
            note: 'Breakfast',
          },
          {
            captureId: 'cap-1',
            target: 'journal',
            status: 'applied',
            promotedAt: '2026-03-18T12:05:00.000Z',
            lookupId: 'journal:2026-03-18',
            relatedId: 'evt-1',
            note: 'Breakfast',
          },
          {
            captureId: 'cap-2',
            target: 'document',
            status: 'applied',
            promotedAt: '2026-03-18T13:00:00.000Z',
            lookupId: 'evt-2',
            relatedId: 'doc-2',
            note: null,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    )

    const grouped = await readPromotionsByCapture(paths)

    assert.deepEqual(
      grouped.get('cap-1')?.map((entry) => entry.target),
      ['meal', 'journal'],
    )
    assert.deepEqual(
      grouped.get('cap-2')?.map((entry) => entry.relatedId),
      ['doc-2'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
