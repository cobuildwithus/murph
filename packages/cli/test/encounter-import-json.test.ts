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

interface EncounterImportResult {
  vault: string
  encounterId: string
  lookupId: string
  eventIds: string[]
  childEventIds: string[]
  ledgerFiles: string[]
  auditPath: string
}

interface EncounterScaffoldResult {
  vault: string
  noun: 'encounter'
  payload: {
    encounter: {
      eventId: string
      encounterType: string
      assessmentText?: string
      planText?: string
    }
    measurements?: Array<{ eventId: string }>
    procedures?: Array<{ eventId: string; status?: string }>
    tests?: Array<{ eventId: string; resultStatus?: string }>
  }
}

interface StoredEventRow {
  id: string
  kind: string
  assessmentText?: string
  dayKey?: string
  diagnoses?: unknown[]
  links?: Array<{ type: string; targetId: string }>
  media?: unknown[]
  rawRefs?: string[]
  results?: unknown[]
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
    description: 'encounter import-json test cli',
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

test('encounter scaffold emits the canonical starter payload', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-scaffold-')
  cleanupPaths.push(parentRoot)
  const cli = createEncounterCli()
  await initVault(cli, vaultRoot)

  const scaffoldResult = await runInProcessJsonCli<EncounterScaffoldResult>(cli, [
    'encounter',
    'scaffold',
    '--vault',
    vaultRoot,
  ])
  const scaffold = requireData(scaffoldResult.envelope)

  assert.equal(scaffoldResult.exitCode, null)
  assert.equal(scaffold.vault, vaultRoot)
  assert.equal(scaffold.noun, 'encounter')
  assert.equal(scaffold.payload.encounter.eventId, 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0')
  assert.equal(scaffold.payload.encounter.encounterType, 'office_visit')
  assert.equal(scaffold.payload.measurements?.[0]?.eventId, 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1')
  assert.equal(scaffold.payload.procedures?.[0]?.status, 'ordered')
  assert.equal(scaffold.payload.tests?.[0]?.resultStatus, 'pending')
})

test('encounter import-json persists one encounter bundle with linked visit facts', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-import-json-')
  cleanupPaths.push(parentRoot)
  const cli = createEncounterCli()
  await initVault(cli, vaultRoot)

  const payloadPath = path.join(parentRoot, 'encounter.json')
  await writeFile(
    payloadPath,
    JSON.stringify({
      encounter: {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0',
        occurredAt: '2026-03-05',
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
      tests: [
        {
          eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F3',
          testName: 'CBC',
        },
      ],
    }),
    'utf8',
  )

  const importResult = await runInProcessJsonCli<EncounterImportResult>(cli, [
    'encounter',
    'import-json',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
  ])
  const saved = requireData(importResult.envelope)

  assert.equal(importResult.exitCode, null)
  assert.equal(JSON.stringify(saved).includes('Visit-scoped'), false)
  assert.equal(saved.encounterId, 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0')
  assert.deepEqual(saved.eventIds, [
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F3',
  ])
  assert.deepEqual(saved.childEventIds, [
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
    'evt_01JQ9R7WF97M1WAB2B4QF2Q1F3',
  ])
  assert.deepEqual(saved.ledgerFiles, ['ledger/events/2026/2026-03.jsonl'])

  const storedRows = await readStoredEvents(vaultRoot, saved.ledgerFiles[0]!)
  const storedById = new Map(storedRows.map((row) => [row.id, row]))
  const encounter = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1F0')
  const measurement = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1F1')
  const procedure = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1F2')
  const test = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1F3')

  assert.equal(encounter?.dayKey, '2026-03-05')
  assert.equal(measurement?.kind, 'measurement')
  assert.equal(measurement?.dayKey, '2026-03-05')
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
  assert.equal(procedure?.dayKey, '2026-03-05')
  assert.equal(procedure?.status, 'ordered')
  assert.deepEqual(procedure?.links, [
    { type: 'related_to', targetId: saved.encounterId },
  ])
  assert.equal(procedure?.rawRefs, undefined)
  assert.equal(test?.kind, 'test')
  assert.equal(test?.dayKey, '2026-03-05')

  const retried = await runInProcessJsonCli<EncounterImportResult>(cli, [
    'encounter',
    'import-json',
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

test('encounter import-json writes schema-max bundle boundaries accepted by core', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-import-json-limits-')
  cleanupPaths.push(parentRoot)
  const cli = createEncounterCli()
  await initVault(cli, vaultRoot)

  const payloadPath = path.join(parentRoot, 'encounter-limits.json')
  await writeFile(
    payloadPath,
    JSON.stringify({
      encounter: {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1H0',
        occurredAt: '2026-03-07T16:00:00.123456Z',
        source: 'import',
        title: 'Primary care limit visit',
        encounterType: 'office_visit',
        assessmentText: 'a'.repeat(4000),
        planText: 'p'.repeat(4000),
        diagnoses: Array.from({ length: 50 }, (_value, index) => ({
          text: `Diagnosis ${index + 1}`,
        })),
      },
      measurements: [
        {
          eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1H1',
          title: 'Visit vitals',
          measurements: Array.from({ length: 25 }, (_value, index) => ({
            metric: `metric-${index + 1}`,
            value: index + 1,
            unit: 'count',
          })),
          media: Array.from({ length: 10 }, (_value, index) => ({
            kind: 'image',
            relativePath: `raw/imports/vitals-${index + 1}.png`,
            mediaType: 'image/png',
          })),
        },
      ],
      tests: [
        {
          eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1H2',
          testName: 'Large lab panel',
          resultStatus: 'normal',
          results: Array.from({ length: 500 }, (_value, index) => ({
            analyte: `Analyte ${index + 1}`,
            value: index + 1,
            unit: 'mg/dL',
          })),
        },
      ],
    }),
    'utf8',
  )

  const importResult = await runInProcessJsonCli<EncounterImportResult>(cli, [
    'encounter',
    'import-json',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
  ])
  const saved = requireData(importResult.envelope)

  assert.equal(importResult.exitCode, null, JSON.stringify(importResult.envelope))
  assert.deepEqual(saved.ledgerFiles, ['ledger/events/2026/2026-03.jsonl'])

  const storedRows = await readStoredEvents(vaultRoot, saved.ledgerFiles[0]!)
  const storedById = new Map(storedRows.map((row) => [row.id, row]))
  const encounter = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1H0')
  const measurement = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1H1')
  const test = storedById.get('evt_01JQ9R7WF97M1WAB2B4QF2Q1H2')

  assert.equal(encounter?.assessmentText?.length, 4000)
  assert.equal(encounter?.diagnoses?.length, 50)
  assert.equal(measurement?.measurements?.length, 25)
  assert.equal(measurement?.media?.length, 10)
  assert.equal(test?.results?.length, 500)
})

vitestTest.sequential('encounter import-json accepts a stdin JSON payload', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-import-json-stdin-')
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

  const importResult = await runInProcessJsonCli<EncounterImportResult>(cli, [
    'encounter',
    'import-json',
    '--vault',
    vaultRoot,
    '--input',
    '-',
  ])
  const saved = requireData(importResult.envelope)

  assert.equal(importResult.exitCode, null)
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

test('encounter import-json rejects child facts without stable event ids', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-encounter-import-json-missing-id-')
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

  const importResult = await runInProcessJsonCli<EncounterImportResult>(cli, [
    'encounter',
    'import-json',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
  ])

  assert.equal(importResult.exitCode, 1)
  assert.equal(importResult.envelope.ok, false)
  if (!importResult.envelope.ok) {
    assert.equal(importResult.envelope.error.code, 'invalid_payload')
    assert.equal(importResult.envelope.error.message, 'encounter payload failed validation.')
  }
})
