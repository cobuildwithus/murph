import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWorkoutCommands } from '../src/commands/workout.js'
import { createIntegratedVaultCliServices } from '../src/vault-cli-services.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData, runCli } from './cli-test-helpers.js'

interface SchemaEnvelope {
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface WorkoutAddEnvelope {
  eventId: string
  lookupId: string
  ledgerFile: string
  created: boolean
  occurredAt: string
  kind: 'activity_session'
  title: string
  activityType: string
  durationMinutes: number
  distanceKm: number | null
  strengthExercises: Array<{
    exercise: string
    setCount: number
    repsPerSet: number
    load?: number
    loadUnit?: 'lb' | 'kg'
    loadDescription?: string
  }> | null
  note: string
}

interface ShowEnvelope {
  entity: {
    id: string
    kind: string
    title: string | null
    occurredAt: string | null
    data: Record<string, unknown>
    path?: string | null
    markdown?: string | null
  }
}

interface WorkoutFormatSaveEnvelope {
  name: string
  slug: string
  path: string
  created: boolean
}

interface WorkoutFormatListEnvelope {
  items: Array<{
    id: string
    kind: string
    title: string | null
    path: string | null
    data: Record<string, unknown>
    markdown: string | null
  }>
  count: number
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'workout slice test cli',
    version: '0.0.0-test',
  })
  const services = createIntegratedVaultCliServices()

  registerVaultCommands(cli, services)
  registerWorkoutCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
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

async function runSliceCliRaw(args: string[]) {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('workout add schema exposes the freeform workout capture surface', async () => {
  const schema = JSON.parse(
    await runSliceCliRaw(['workout', 'add', '--schema']),
  ) as SchemaEnvelope

  assert.equal('duration' in schema.options.properties, true)
  assert.equal('type' in schema.options.properties, true)
  assert.equal('distanceKm' in schema.options.properties, true)
  assert.equal('occurredAt' in schema.options.properties, true)
  assert.equal('source' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('workout add help uses a positional text argument', async () => {
  const help = await runSliceCliRaw(['workout', 'add', '--help'])

  assert.match(help, /Usage: vault-cli workout add <text> \[options\]/u)
})

test('workout format save help uses positional name and text arguments', async () => {
  const help = await runSliceCliRaw(['workout', 'format', 'save', '--help'])

  assert.match(
    help,
    /Usage: vault-cli workout format save <name> <text> \[options\]/u,
  )
})

test.sequential(
  'workout format save, show, list, and log stay thin while feeding the same canonical event path',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const saveFormat = await runCli<WorkoutFormatSaveEnvelope>([
        'workout',
        'format',
        'save',
        'Push Day A',
        '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(saveFormat.ok, true)
      assert.equal(saveFormat.meta?.command, 'workout format save')
      assert.equal(requireData(saveFormat).name, 'Push Day A')
      assert.equal(requireData(saveFormat).slug, 'push-day-a')
      assert.equal(
        requireData(saveFormat).path,
        'bank/workout-formats/push-day-a.md',
      )
      assert.equal(requireData(saveFormat).created, true)

      const savedMarkdownPath = path.join(vaultRoot, requireData(saveFormat).path)
      const savedMarkdown = await readFile(savedMarkdownPath, 'utf8')
      assert.match(savedMarkdown, /schemaVersion: hb\.frontmatter\.workout-format\.v1/u)
      assert.match(savedMarkdown, /docType: workout_format/u)
      assert.match(savedMarkdown, /slug: push-day-a/u)
      assert.match(savedMarkdown, /## Saved workout text/u)

      const showFormat = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        'push-day-a',
        '--vault',
        vaultRoot,
      ])
      assert.equal(showFormat.ok, true)
      assert.equal(requireData(showFormat).entity.kind, 'workout_format')
      assert.equal(requireData(showFormat).entity.title, 'Push Day A')
      assert.equal(
        requireData(showFormat).entity.path,
        'bank/workout-formats/push-day-a.md',
      )
      assert.equal(
        requireData(showFormat).entity.data.text,
        '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
      )

      const listFormats = await runCli<WorkoutFormatListEnvelope>([
        'workout',
        'format',
        'list',
        '--vault',
        vaultRoot,
      ])
      assert.equal(listFormats.ok, true)
      assert.equal(requireData(listFormats).count, 1)
      assert.equal(requireData(listFormats).items[0]?.kind, 'workout_format')
      assert.equal(requireData(listFormats).items[0]?.title, 'Push Day A')
      assert.equal(requireData(listFormats).items[0]?.markdown, null)

      const logFormat = await runCli<WorkoutAddEnvelope>([
        'workout',
        'format',
        'log',
        'Push Day A',
        '--occurred-at',
        '2026-03-12T17:30:00Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(logFormat.ok, true)
      assert.equal(logFormat.meta?.command, 'workout format log')
      assert.equal(requireData(logFormat).kind, 'activity_session')
      assert.equal(requireData(logFormat).activityType, 'strength-training')
      assert.equal(requireData(logFormat).durationMinutes, 20)
      assert.equal(requireData(logFormat).title, '20-minute strength training')
      assert.deepEqual(requireData(logFormat).strengthExercises, [
        {
          exercise: 'pushups',
          setCount: 4,
          repsPerSet: 20,
        },
        {
          exercise: 'incline bench',
          setCount: 4,
          repsPerSet: 12,
          load: 65,
          loadUnit: 'lb',
          loadDescription: '45 lb bar plus 10 lb plates on both sides',
        },
      ])

      const showLoggedWorkout = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(logFormat).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showLoggedWorkout.ok, true)
      assert.equal(requireData(showLoggedWorkout).entity.kind, 'activity_session')
      assert.equal(
        requireData(showLoggedWorkout).entity.data.note,
        '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'workout format save validates future loggability up front',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const invalidSavedFormat = await runCli([
        'workout',
        'format',
        'save',
        'Ambiguous Lift',
        'Strength training for the last 20 or 30 minutes. Did like 80 push-ups and incline bench at 115 lb.',
        '--vault',
        vaultRoot,
      ])

      assert.equal(invalidSavedFormat.ok, false)
      assert.equal(invalidSavedFormat.error.code, 'invalid_option')
      assert.match(
        invalidSavedFormat.error.message ?? '',
        /Pass --duration <minutes> to record it explicitly/u,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'workout add captures activity_session events and fails fast on ambiguous durations',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-workout-'))

    try {
      const initResult = await runSliceCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const runWorkout = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        'Went for a 30-minute run around the neighborhood.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(runWorkout.ok, true)
      assert.equal(runWorkout.meta?.command, 'workout add')
      assert.match(requireData(runWorkout).eventId, /^evt_/u)
      assert.equal(
        requireData(runWorkout).lookupId,
        requireData(runWorkout).eventId,
      )
      assert.equal(requireData(runWorkout).kind, 'activity_session')
      assert.equal(requireData(runWorkout).activityType, 'running')
      assert.equal(requireData(runWorkout).durationMinutes, 30)
      assert.equal(requireData(runWorkout).distanceKm, null)
      assert.equal(requireData(runWorkout).strengthExercises, null)
      assert.equal(requireData(runWorkout).title, '30-minute run')
      assert.equal(
        requireData(runWorkout).note,
        'Went for a 30-minute run around the neighborhood.',
      )

      const showWorkout = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(runWorkout).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showWorkout.ok, true)
      assert.equal(
        requireData(showWorkout).entity.id,
        requireData(runWorkout).lookupId,
      )
      assert.equal(requireData(showWorkout).entity.kind, 'activity_session')
      assert.equal(requireData(showWorkout).entity.title, '30-minute run')
      assert.equal(requireData(showWorkout).entity.data.activityType, 'running')
      assert.equal(requireData(showWorkout).entity.data.durationMinutes, 30)
      assert.equal(
        requireData(showWorkout).entity.data.note,
        'Went for a 30-minute run around the neighborhood.',
      )

      const structuredStrengthWorkout = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(structuredStrengthWorkout.ok, true)
      assert.equal(
        requireData(structuredStrengthWorkout).activityType,
        'strength-training',
      )
      assert.equal(requireData(structuredStrengthWorkout).durationMinutes, 20)
      assert.deepEqual(requireData(structuredStrengthWorkout).strengthExercises, [
        {
          exercise: 'pushups',
          setCount: 4,
          repsPerSet: 20,
        },
        {
          exercise: 'incline bench',
          setCount: 4,
          repsPerSet: 12,
          load: 65,
          loadUnit: 'lb',
          loadDescription: '45 lb bar plus 10 lb plates on both sides',
        },
      ])

      const showStructuredStrengthWorkout = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(structuredStrengthWorkout).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showStructuredStrengthWorkout.ok, true)
      assert.deepEqual(
        requireData(showStructuredStrengthWorkout).entity.data.strengthExercises,
        [
          {
            exercise: 'pushups',
            setCount: 4,
            repsPerSet: 20,
          },
          {
            exercise: 'incline bench',
            setCount: 4,
            repsPerSet: 12,
            load: 65,
            loadUnit: 'lb',
            loadDescription: '45 lb bar plus 10 lb plates on both sides',
          },
        ],
      )

      const ambiguous = await runCli([
        'workout',
        'add',
        'Strength training for the last 20 or 30 minutes. Did like 80 push-ups and incline bench at 115 lb.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(ambiguous.ok, false)
      assert.equal(ambiguous.error.code, 'invalid_option')
      assert.match(
        ambiguous.error.message ?? '',
        /Pass --duration <minutes> to record it explicitly/u,
      )

      const strengthWorkout = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        'Strength training for the last 20 or 30 minutes. Did like 80 push-ups and incline bench at 115 lb.',
        '--duration',
        '30',
        '--type',
        'strength training',
        '--vault',
        vaultRoot,
      ])
      assert.equal(strengthWorkout.ok, true)
      assert.equal(
        requireData(strengthWorkout).activityType,
        'strength-training',
      )
      assert.equal(requireData(strengthWorkout).durationMinutes, 30)
      assert.equal(requireData(strengthWorkout).strengthExercises, null)
      assert.equal(
        requireData(strengthWorkout).title,
        '30-minute strength training',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'workout add surfaces invalid timestamps without needing a custom workout read surface',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-workout-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const invalidTimestamp = await runCli([
        'workout',
        'add',
        'Went for a 30-minute run.',
        '--occurred-at',
        'not-a-timestamp',
        '--vault',
        vaultRoot,
      ])

      assert.equal(invalidTimestamp.ok, false)
      assert.equal(invalidTimestamp.error.code, 'VALIDATION_ERROR')
      assert.match(invalidTimestamp.error.message ?? '', /Invalid ISO datetime/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
