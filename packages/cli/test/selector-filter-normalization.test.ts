import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  repoRoot,
  requireData,
  runCli,
  runRawCli,
} from './cli-test-helpers.js'

const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)
const runSourceCli = runCli
const runRawSourceCli = runRawCli

test('show help uses id selectors except for journal date keys', async () => {
  const providerShowHelp = await runRawSourceCli(['provider', 'show', '--help'])
  const foodShowHelp = await runRawSourceCli(['food', 'show', '--help'])
  const recipeShowHelp = await runRawSourceCli(['recipe', 'show', '--help'])
  const eventShowHelp = await runRawSourceCli(['event', 'show', '--help'])
  const samplesShowHelp = await runRawSourceCli(['samples', 'show', '--help'])
  const auditShowHelp = await runRawSourceCli(['audit', 'show', '--help'])
  const experimentShowHelp = await runRawSourceCli(['experiment', 'show', '--help'])
  const intakeShowHelp = await runRawSourceCli(['intake', 'show', '--help'])
  const journalShowHelp = await runRawSourceCli(['journal', 'show', '--help'])

  assert.match(providerShowHelp, /Usage: vault-cli provider show <id> \[options\]/u)
  assert.match(foodShowHelp, /Usage: vault-cli food show <id> \[options\]/u)
  assert.match(recipeShowHelp, /Usage: vault-cli recipe show <id> \[options\]/u)
  assert.match(eventShowHelp, /Usage: vault-cli event show <id> \[options\]/u)
  assert.match(samplesShowHelp, /Usage: vault-cli samples show <id> \[options\]/u)
  assert.match(auditShowHelp, /Usage: vault-cli audit show <id> \[options\]/u)
  assert.match(experimentShowHelp, /Usage: vault-cli experiment show <id> \[options\]/u)
  assert.match(intakeShowHelp, /Usage: vault-cli intake show <id> \[options\]/u)
  assert.match(journalShowHelp, /Usage: vault-cli journal show <date> \[options\]/u)
})

test.sequential('generic list applies date bounds and echoes renamed filter keys', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-normalization-'))

  try {
    const initResult = await runSourceCli<{ created: boolean }>([
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    await mkdir(path.join(vaultRoot, 'ledger/events/2026'), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'ledger/events/2026/2026-03.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'murph.event.v1',
          id: 'evt_selector_range_out',
          kind: 'note',
          occurredAt: '2026-03-10T08:00:00Z',
          recordedAt: '2026-03-10T08:05:00Z',
          source: 'manual',
          title: 'Outside the requested range',
        }),
        JSON.stringify({
          schemaVersion: 'murph.event.v1',
          id: 'evt_selector_range_in',
          kind: 'note',
          occurredAt: '2026-03-12T09:00:00Z',
          recordedAt: '2026-03-12T09:05:00Z',
          source: 'manual',
          title: 'Inside the requested range',
        }),
        '',
      ].join('\n'),
      'utf8',
    )

    const result = await runSourceCli<{
      count: number
      filters: Record<string, unknown>
      items: Array<{
        id: string
      }>
    }>([
      'list',
      '--record-type',
      'event',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(requireData(result).filters.from, '2026-03-12')
    assert.equal(requireData(result).filters.to, '2026-03-12')
    assert.equal('dateFrom' in requireData(result).filters, false)
    assert.equal('dateTo' in requireData(result).filters, false)
    assert.equal(requireData(result).count, 1)
    assert.deepEqual(
      requireData(result).items.map((item) => item.id),
      ['evt_selector_range_in'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('intake list applies date bounds and echoes renamed filter keys', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-normalization-'))

  try {
    const initResult = await runSourceCli<{ created: boolean }>([
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    await mkdir(path.join(vaultRoot, 'ledger/assessments/2026'), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'ledger/assessments/2026/2026-03.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'murph.assessment-response.v1',
          id: 'asmt_selector_range_out',
          assessmentType: 'full-intake',
          recordedAt: '2026-03-10T13:00:00Z',
          source: 'import',
          rawPath: 'raw/assessments/2026/03/asmt_selector_range_out/source.json',
          title: 'Outside the requested range',
          responses: {
            sleep: {
              averageHours: 5,
            },
          },
        }),
        JSON.stringify({
          schemaVersion: 'murph.assessment-response.v1',
          id: 'asmt_selector_range_in',
          assessmentType: 'full-intake',
          recordedAt: '2026-03-12T13:00:00Z',
          source: 'import',
          rawPath: 'raw/assessments/2026/03/asmt_selector_range_in/source.json',
          title: 'Inside the requested range',
          responses: {
            sleep: {
              averageHours: 7,
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    )

    const result = await runSourceCli<{
      count: number
      filters: Record<string, unknown>
      items: Array<{
        id: string
      }>
    }>([
      'intake',
      'list',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(requireData(result).filters.from, '2026-03-12')
    assert.equal(requireData(result).filters.to, '2026-03-12')
    assert.equal('dateFrom' in requireData(result).filters, false)
    assert.equal('dateTo' in requireData(result).filters, false)
    assert.equal(requireData(result).count, 1)
    assert.deepEqual(
      requireData(result).items.map((item) => item.id),
      ['asmt_selector_range_in'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search applies date bounds and echoes renamed filter keys', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-normalization-'))

  try {
    const initResult = await runSourceCli<{ created: boolean }>([
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    const currentJournal = await runSourceCli<{ journalPath: string }>([
      'journal',
      'ensure',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])
    assert.equal(currentJournal.ok, true)

    await writeFile(
      path.join(vaultRoot, requireData(currentJournal).journalPath),
      `---
dayKey: 2026-03-12
title: March 12
tags:
  - focus
---
# March 12

Afternoon crash after pasta lunch and coffee.
`,
      'utf8',
    )

    const priorJournal = await runSourceCli<{ journalPath: string }>([
      'journal',
      'ensure',
      '2026-03-10',
      '--vault',
      vaultRoot,
    ])
    assert.equal(priorJournal.ok, true)

    await writeFile(
      path.join(vaultRoot, requireData(priorJournal).journalPath),
      `---
dayKey: 2026-03-10
title: March 10
tags:
  - focus
---
# March 10

Afternoon crash after pasta lunch returned.
`,
      'utf8',
    )

    const mealResult = await runSourceCli<{ mealId: string }>([
      'meal',
      'add',
      '--photo',
      sampleDocumentPath,
      '--note',
      'Pasta lunch and coffee. Afternoon crash afterward.',
      '--occurred-at',
      '2026-03-12T12:15:00Z',
      '--vault',
      vaultRoot,
    ])
    assert.equal(mealResult.ok, true)

    const bounded = await runSourceCli<{
      filters: Record<string, unknown>
      hits: Array<{
        recordId: string
      }>
      total: number
    }>([
      'search',
      'query',
      '--text',
      'afternoon crash pasta',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])
    const unbounded = await runSourceCli<{
      hits: Array<{
        recordId: string
      }>
      total: number
    }>([
      'search',
      'query',
      '--text',
      'afternoon crash pasta',
      '--vault',
      vaultRoot,
    ])

    assert.equal(bounded.ok, true)
    assert.equal(requireData(bounded).filters.from, '2026-03-12')
    assert.equal(requireData(bounded).filters.to, '2026-03-12')
    assert.equal('dateFrom' in requireData(bounded).filters, false)
    assert.equal('dateTo' in requireData(bounded).filters, false)
    assert.equal(requireData(bounded).total, 2)
    assert.deepEqual(
      new Set(requireData(bounded).hits.map((hit) => hit.recordId)),
      new Set(['journal:2026-03-12', requireData(mealResult).mealId]),
    )
    assert.equal(unbounded.ok, true)
    assert.equal(requireData(unbounded).total, 3)
    assert.equal(
      requireData(unbounded).hits.some(
        (hit) => hit.recordId === 'journal:2026-03-10',
      ),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
