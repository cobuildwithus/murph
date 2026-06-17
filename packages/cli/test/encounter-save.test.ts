import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { afterEach, test as vitestTest } from 'vitest'

import { registerEncounterCommands } from '../src/commands/encounter.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'

interface EncounterSaveResult {
  vault: string
  encounterId: string
  lookupId: string
  eventIds: string[]
  childEventIds: string[]
  ledgerFiles: string[]
  auditPath: string
}

interface StoredEventRow {
  id: string
  kind: string
  links?: Array<{ type: string; targetId: string }>
  rawRefs?: string[]
  status?: string
  measurements?: Array<{
    metric: string
    value: number
    unit: string
  }>
}

const cleanupPaths: string[] = []
const originalStdin = process.stdin
const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')

afterEach(async () => {
  if (stdinDescriptor) {
    Object.defineProperty(process, 'stdin', stdinDescriptor)
  } else {
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      get: () => originalStdin,
    })
  }

  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

function setMockStdin(input: string) {
  const mockStdin = {
    isTTY: false,
    async *[Symbol.asyncIterator]() {
      yield input
    },
  }

  Object.defineProperty(process, 'stdin', {
    configurable: true,
    get: () => mockStdin,
  })
}

function createEncounterCli() {
  const cli = Cli.create('vault-cli', {
    description: 'encounter save test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerEncounterCommands(cli)

  return cli
}

async function initVault(cli: Cli.Cli, vaultRoot: string) {
  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/New_York',
  ])

  assert.equal(initResult.exitCode, null)
  assert.equal(requireData(initResult.envelope).created, true)
}

async function readStoredEvents(vaultRoot: string, relativePath: string): Promise<StoredEventRow[]> {
  const raw = await readFile(path.join(vaultRoot, relativePath), 'utf8')
  return raw
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StoredEventRow)
}

test('encounter save persists one encounter bundle with linked visit facts', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-save-')
  cleanupPaths.push(parentRoot)
  const cli = createEncounterCli()
  await initVault(cli, vaultRoot)

  const payloadPath = path.join(parentRoot, 'encounter.json')
  await writeFile(
    payloadPath,
    JSON.stringify({
      encounter: {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0',
        occurredAt: '2026-03-05T16:00:00.000Z',
        source: 'import',
        title: 'Primary care visit',
        encounterType: 'office_visit',
        assessmentText: 'Visit-scoped assessment text.',
        planText: 'Visit-scoped plan text.',
        rawRefs: ['raw/documents/2026/03/visit-summary.pdf'],
      },
      measurements: [
        {
          eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
          title: 'Visit vitals',
          measurements: [
            {
              metric: 'systolic-blood-pressure',
              value: 118,
              unit: 'mmHg',
            },
          ],
        },
      ],
      procedures: [
        {
          eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
          procedure: 'Screening colonoscopy',
          rawRefs: [],
          status: 'ordered',
        },
      ],
    }),
    'utf8',
  )

  const saveResult = await runInProcessJsonCli<EncounterSaveResult>(cli, [
    'encounter',
    'save',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
  ])
  const saved = requireData(saveResult.envelope)

  assert.equal(saveResult.exitCode, null)
  assert.equal(JSON.stringify(saved).includes('Visit-scoped'), false)
  assert.equal(saved.encounterId, 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0')
  assert.deepEqual(saved.eventIds, [
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
  ])
  assert.deepEqual(saved.childEventIds, [
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
  ])
  assert.deepEqual(saved.ledgerFiles, ['ledger/events/2026/2026-03.jsonl'])

  const storedRows = await readStoredEvents(vaultRoot, saved.ledgerFiles[0]!)
  const storedById = new Map(storedRows.map((row) => [row.id, row]))
  const measurement = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1F1')
  const procedure = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1F2')

  assert.equal(measurement?.kind, 'measurement')
  assert.deepEqual(measurement?.links, [
    { type: 'related_to', targetId: saved.encounterId },
  ])
  assert.deepEqual(measurement?.rawRefs, ['raw/documents/2026/03/visit-summary.pdf'])
  assert.deepEqual(measurement?.measurements, [
    {
      metric: 'systolic-blood-pressure',
      value: 118,
      unit: 'mmHg',
    },
  ])
  assert.equal(procedure?.kind, 'procedure')
  assert.equal(procedure?.status, 'ordered')
  assert.deepEqual(procedure?.links, [
    { type: 'related_to', targetId: saved.encounterId },
  ])
  assert.equal(procedure?.rawRefs, undefined)

  const retried = await runInProcessJsonCli<EncounterSaveResult>(cli, [
    'encounter',
    'save',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
  ])
  assert.equal(retried.exitCode, 1)
  assert.equal(retried.envelope.ok, false)
  if (!retried.envelope.ok) {
    assert.equal(retried.envelope.error.code, 'already_exists')
  }
  assert.deepEqual(await readStoredEvents(vaultRoot, saved.ledgerFiles[0]!), storedRows)
})

vitestTest.sequential('encounter save accepts a stdin JSON payload', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-save-stdin-')
  cleanupPaths.push(parentRoot)
  const cli = createEncounterCli()
  await initVault(cli, vaultRoot)

  setMockStdin(JSON.stringify({
    encounter: {
      eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1G0',
      occurredAt: '2026-03-06T16:00:00.000Z',
      source: 'import',
      title: 'Primary care follow-up',
      encounterType: 'office_visit',
    },
    tests: [
      {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1G1',
        testName: 'Basic metabolic panel',
        resultStatus: 'pending',
      },
    ],
  }))

  const saveResult = await runInProcessJsonCli<EncounterSaveResult>(cli, [
    'encounter',
    'save',
    '--vault',
    vaultRoot,
    '--input',
    '-',
  ])
  const saved = requireData(saveResult.envelope)

  assert.equal(saveResult.exitCode, null)
  assert.equal(saved.encounterId, 'evt_01JQ9R7WF97M1WAB2B4QF2Q1G0')
  assert.deepEqual(saved.eventIds, [
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1G0',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1G1',
  ])
  assert.deepEqual(saved.childEventIds, ['evt_01JQ9R7WF97M1WAB2B4QF2Q1G1'])

  const storedRows = await readStoredEvents(vaultRoot, saved.ledgerFiles[0]!)
  const testRecord = storedRows.find((row) => row.id === 'evt_01JQ9R7WF97M1WAB2B4QF2Q1G1')

  assert.equal(testRecord?.kind, 'test')
  assert.deepEqual(testRecord?.links, [
    { type: 'related_to', targetId: saved.encounterId },
  ])
})

test('encounter save rejects child facts without stable event ids', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-save-missing-id-')
  cleanupPaths.push(parentRoot)
  const cli = createEncounterCli()
  await initVault(cli, vaultRoot)

  const payloadPath = path.join(parentRoot, 'encounter.json')
  await writeFile(
    payloadPath,
    JSON.stringify({
      encounter: {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1H0',
        occurredAt: '2026-03-07T16:00:00.000Z',
        source: 'import',
        title: 'Primary care visit',
        encounterType: 'office_visit',
      },
      measurements: [
        {
          title: 'Visit vitals',
          measurements: [
            {
              metric: 'systolic-blood-pressure',
              value: 118,
              unit: 'mmHg',
            },
          ],
        },
      ],
    }),
    'utf8',
  )

  const saveResult = await runInProcessJsonCli<EncounterSaveResult>(cli, [
    'encounter',
    'save',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
  ])

  assert.equal(saveResult.exitCode, 1)
  assert.equal(saveResult.envelope.ok, false)
  if (!saveResult.envelope.ok) {
    assert.equal(saveResult.envelope.error.code, 'invalid_payload')
    assert.equal(saveResult.envelope.error.message, 'measurements[0].eventId is required.')
  }
})
