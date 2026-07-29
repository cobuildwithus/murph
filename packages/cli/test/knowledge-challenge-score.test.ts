import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'
import type { GroupChallengeScoreResult } from '@murphai/assistant-engine'

import { createVaultCli } from '../src/vault-cli.js'
import { runInProcessJsonCli } from './cli-test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) => rm(target, {
      force: true,
      recursive: true,
    })),
  )
})

test('knowledge score-challenge applies one bounded additive scorecard from JSON', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-challenge-score-'))
  cleanupPaths.push(tempRoot)
  const inputPath = path.join(tempRoot, 'scorecard.json')
  await writeFile(inputPath, JSON.stringify({
    format: {
      aggregation: 'sum',
      kind: 'teams',
      objective: { kind: 'ranking' },
      teams: [
        {
          captainParticipantId: 'participant_alpha',
          id: 'north',
          name: 'North',
          participantIds: ['participant_alpha'],
        },
        {
          id: 'south',
          name: 'South',
          participantIds: ['participant_beta'],
        },
      ],
    },
    participants: [
      {
        participantId: 'participant_alpha',
        components: [
          { componentId: 'steps', quantity: 10_000, status: 'available' },
          { componentId: 'logged-protein', quantity: 100, status: 'available' },
          { componentId: 'late-workouts', quantity: 1, status: 'available' },
        ],
      },
      {
        participantId: 'participant_beta',
        components: [
          { componentId: 'steps', quantity: 8_500, status: 'available' },
          { componentId: 'logged-protein', status: 'missing' },
          { componentId: 'late-workouts', quantity: 2, status: 'available' },
        ],
      },
    ],
    scorecard: {
      components: [
        {
          id: 'steps',
          label: 'Steps',
          perQuantity: 1_000,
          points: 30,
          quantityUnit: 'steps',
        },
        {
          id: 'logged-protein',
          label: 'Logged protein',
          perQuantity: 100,
          points: 1_000,
          quantityUnit: 'grams',
        },
        {
          id: 'late-workouts',
          label: 'Workouts after 9 PM',
          perQuantity: 1,
          points: 100,
          quantityUnit: 'workouts',
        },
      ],
    },
  }), 'utf8')

  const result = await runInProcessJsonCli<GroupChallengeScoreResult>(
    createVaultCli(),
    [
      'knowledge',
      'score-challenge',
      '--input',
      `@${inputPath}`,
    ],
  )

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.deepEqual(result.envelope.data.scoreboard, {
    coverage: {
      completeParticipants: 1,
      partialParticipants: 1,
      totalParticipants: 2,
      unscoredParticipants: 0,
    },
    entries: [
      {
        coverage: {
          completeParticipants: 1,
          partialParticipants: 0,
          totalParticipants: 1,
          unscoredParticipants: 0,
        },
        name: 'North',
        participantIds: ['participant_alpha'],
        teamId: 'north',
        verifiedPoints: 1_400,
        verifiedSubtotalPoints: 1_400,
      },
      {
        coverage: {
          completeParticipants: 0,
          partialParticipants: 1,
          totalParticipants: 1,
          unscoredParticipants: 0,
        },
        name: 'South',
        participantIds: ['participant_beta'],
        teamId: 'south',
        verifiedPoints: 455,
        verifiedSubtotalPoints: 455,
      },
    ],
    kind: 'teams',
    rankingComplete: false,
  })
})

test('knowledge score-challenge rejects unbounded or extra payload fields', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-challenge-score-invalid-'))
  cleanupPaths.push(tempRoot)
  const inputPath = path.join(tempRoot, 'scorecard.json')
  await writeFile(inputPath, JSON.stringify({
    format: { kind: 'individual', objective: { kind: 'ranking' } },
    participants: [{
      participantId: 'participant_1',
      components: Array.from({ length: 6 }, (_, index) => ({
        componentId: `component-${index + 1}`,
        quantity: 1,
        status: 'available',
      })),
    }],
    scorecard: {
      components: Array.from({ length: 6 }, (_, index) => ({
        id: `component-${index + 1}`,
        label: `Component ${index + 1}`,
        perQuantity: 1,
        points: 1,
        quantityUnit: 'units',
      })),
    },
    privateRawRecords: ['must-not-pass-through'],
  }), 'utf8')

  const result = await runInProcessJsonCli(
    createVaultCli(),
    [
      'knowledge',
      'score-challenge',
      '--input',
      `@${inputPath}`,
    ],
  )

  assert.notEqual(result.exitCode, null)
  assert.equal(result.envelope.ok, false)
  assert.doesNotMatch(JSON.stringify(result.envelope), /must-not-pass-through/u)
})
