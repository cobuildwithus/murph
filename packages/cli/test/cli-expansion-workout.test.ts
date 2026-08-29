import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  initializeVault,
  listWriteOperationMetadataPaths,
  parseFrontmatterDocument,
  readStoredWriteOperation,
  upsertMemory,
} from '@murphai/core'
import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWorkoutCommands } from '../src/commands/workout.js'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { addMeasurementRecord } from '@murphai/vault-usecases/measurements'
import { addWorkoutRecord } from '@murphai/vault-usecases/workouts'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData, runCli } from './cli-test-helpers.js'

const WORKOUT_FORMAT_CANONICAL_EVENT_PATH_TIMEOUT_MS = 90_000
const WORKOUT_CAPTURE_DEFAULTS_TIMEOUT_MS = 300_000

interface SchemaEnvelope {
  args: {
    properties: Record<string, unknown>
    required?: string[]
  }
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
  workout: Record<string, unknown> | null
  note: string
}

interface WorkoutCaptureDefaultsEnvelope {
  captureDefaults: {
    durationMinutes: number | null
  }
  recordedAt: string | null
  updated: boolean
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
    excerpt?: string | null
  }>
  count: number
}

interface DeleteEnvelope {
  entityId: string
  lookupId: string
  kind: string
  deleted: true
  retainedPaths: string[]
}

interface WorkoutManifestEnvelope {
  manifestFile: string
  manifest: {
    rawDirectory: string
  }
}

function summarizeWorkoutExercises(
  workout: Record<string, unknown> | null | undefined,
): Array<{
  exercise: string
  setCount: number
  repsPerSet: number
  load?: number
  loadUnit?: 'lb' | 'kg'
  loadDescription?: string
}> | null {
  const exercises = Array.isArray(workout?.exercises)
    ? workout.exercises.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    : []

  if (exercises.length === 0) {
    return null
  }

  return exercises.map((exercise) => {
    const sets = Array.isArray(exercise.sets)
      ? exercise.sets.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      : []
    const firstSet = sets[0]
    const repsPerSet = typeof firstSet?.reps === 'number' ? firstSet.reps : 0
    const load = typeof firstSet?.weight === 'number' ? firstSet.weight : undefined
    const loadUnit =
      firstSet?.weightUnit === 'lb' || firstSet?.weightUnit === 'kg'
        ? firstSet.weightUnit
        : undefined

    return {
      exercise: typeof exercise.name === 'string' ? exercise.name : '',
      setCount: sets.length,
      repsPerSet,
      ...(load !== undefined ? { load } : {}),
      ...(loadUnit ? { loadUnit } : {}),
      ...(typeof exercise.note === 'string' ? { loadDescription: exercise.note } : {}),
    }
  })
}

function summarizeTemplateExercises(
  template: unknown,
): Array<{
  exercise: string
  setCount: number
  repsPerSet: number
  load?: number
  loadUnit?: 'lb' | 'kg'
  loadDescription?: string
}> | null {
  if (typeof template !== 'object' || template === null || !Array.isArray((template as { exercises?: unknown }).exercises)) {
    return null
  }

  const exercises = (template as { exercises: unknown[] }).exercises.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  )

  if (exercises.length === 0) {
    return null
  }

  return exercises.map((exercise) => {
    const sets = Array.isArray(exercise.plannedSets)
      ? exercise.plannedSets.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      : []
    const firstSet = sets[0]
    const repsPerSet = typeof firstSet?.targetReps === 'number' ? firstSet.targetReps : 0
    const load = typeof firstSet?.targetWeight === 'number' ? firstSet.targetWeight : undefined
    const loadUnit =
      firstSet?.targetWeightUnit === 'lb' || firstSet?.targetWeightUnit === 'kg'
        ? firstSet.targetWeightUnit
        : undefined

    return {
      exercise: typeof exercise.name === 'string' ? exercise.name : '',
      setCount: sets.length,
      repsPerSet,
      ...(load !== undefined ? { load } : {}),
      ...(loadUnit ? { loadUnit } : {}),
      ...(typeof exercise.note === 'string' ? { loadDescription: exercise.note } : {}),
    }
  })
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'workout slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerWorkoutCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
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

  assert.equal('text' in schema.args.properties, true)
  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('duration' in schema.options.properties, true)
  assert.equal('type' in schema.options.properties, true)
  assert.equal('distanceKm' in schema.options.properties, true)
  assert.equal('occurredAt' in schema.options.properties, true)
  assert.equal('source' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('workout edit/delete schemas expose typed mutation options', async () => {
  const editSchema = JSON.parse(
    await runSliceCliRaw(['workout', 'edit', '--schema']),
  ) as SchemaEnvelope
  const deleteSchema = JSON.parse(
    await runSliceCliRaw(['workout', 'delete', '--schema']),
  ) as SchemaEnvelope

  assert.equal('input' in editSchema.options.properties, false)
  assert.equal('set' in editSchema.options.properties, false)
  assert.equal('clear' in editSchema.options.properties, false)
  assert.equal('note' in editSchema.options.properties, true)
  assert.equal('duration' in editSchema.options.properties, true)
  assert.equal('type' in editSchema.options.properties, true)
  assert.equal('dayKeyPolicy' in editSchema.options.properties, true)
  assert.deepEqual(editSchema.options.required, ['vault'])
  assert.deepEqual(deleteSchema.options.required, ['vault', 'expectedRevision'])
})

test('workout add help keeps the positional text optional for typed captures', async () => {
  const help = await runSliceCliRaw(['workout', 'add', '--help'])

  assert.match(help, /Usage: vault-cli workout add \[text\] \[options\]/u)
  assert.match(
    help,
    /Optional freeform workout text such as "Went for a 30-minute run\."/u,
  )
  assert.doesNotMatch(help, /^\s+--input\s+/mu)
  assert.match(help, /workout import-json --input @workout\.json/u)
})

test('workout format save help keeps name and text optional when using structured input', async () => {
  const help = await runSliceCliRaw(['workout', 'format', 'save', '--help'])

  assert.match(
    help,
    /Usage: vault-cli workout format save \[name\] \[text\] \[options\]/u,
  )
})

test(
  'workout format save, show, list, and log stay thin while feeding the same canonical event path',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

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

      const workoutFormatOperation = (
        await Promise.all(
          (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
            readStoredWriteOperation(vaultRoot, relativePath),
          ),
        )
      ).find((operation) => operation.operationType === 'workout_format_save')
      assert.ok(workoutFormatOperation)
      assert.equal(workoutFormatOperation.status, 'committed')
      const firstAction = workoutFormatOperation.actions[0]
      assert.ok(firstAction)
      assert.deepEqual(
        workoutFormatOperation.actions.map((action) => ({
          kind: action.kind,
          targetRelativePath: action.targetRelativePath,
        })),
        [
          {
            kind: 'text_write',
            targetRelativePath: 'bank/workout-formats/push-day-a.md',
          },
          {
            kind: 'jsonl_append',
            targetRelativePath: workoutFormatOperation.actions[1]?.targetRelativePath ?? '',
          },
        ],
      )
      assert.match(
        workoutFormatOperation.actions[1]?.targetRelativePath ?? '',
        /^audit\/\d{4}\/\d{4}-\d{2}\.jsonl$/u,
      )
      if (firstAction.kind !== 'text_write') {
        throw new Error('Expected workout_format_save to stage a text_write action.')
      }
      assert.equal(typeof firstAction.committedPayloadReceipt?.sha256, 'string')
      assert.equal(typeof firstAction.committedPayloadReceipt?.byteLength, 'number')

      const savedMarkdownPath = path.join(vaultRoot, requireData(saveFormat).path)
      const savedMarkdown = await readFile(savedMarkdownPath, 'utf8')
      assert.match(savedMarkdown, /schemaVersion: murph\.frontmatter\.workout-format\.v1/u)
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
      assert.match(requireData(showFormat).entity.id, /^wfmt_/u)
      assert.equal(
        requireData(showFormat).entity.path,
        'bank/workout-formats/push-day-a.md',
      )
      assert.equal(
        requireData(showFormat).entity.data.workoutFormatId,
        requireData(showFormat).entity.id,
      )
      assert.equal(
        requireData(showFormat).entity.data.text,
        '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
      )

      const showFormatById = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        requireData(showFormat).entity.id,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showFormatById.ok, true)
      assert.equal(
        requireData(showFormatById).entity.id,
        requireData(showFormat).entity.id,
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
      assert.equal(requireData(listFormats).items[0]?.id, requireData(showFormat).entity.id)
      assert.equal(requireData(listFormats).items[0]?.title, 'Push Day A')
      assert.match(requireData(listFormats).items[0]?.excerpt ?? '', /strength training/i)
      assert.equal('markdown' in (requireData(listFormats).items[0] ?? {}), false)

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
      assert.deepEqual(summarizeWorkoutExercises(requireData(logFormat).workout), [
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

      const editedMediaOnly = await runCli<ShowEnvelope>([
        'workout',
        'edit',
        requireData(logFormat).eventId,
        '--workout-media',
        'kind=photo;relativePath=raw/workouts/2026/03/push-day-a/photo.jpg;mediaType=image/jpeg',
        '--vault',
        vaultRoot,
      ])
      assert.equal(editedMediaOnly.ok, true)
      const editedWorkout = requireData(editedMediaOnly).entity.data.workout
      assert.deepEqual(
        summarizeWorkoutExercises(
          typeof editedWorkout === 'object' && editedWorkout !== null
            ? (editedWorkout as Record<string, unknown>)
            : null,
        ),
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
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
  WORKOUT_FORMAT_CANONICAL_EVENT_PATH_TIMEOUT_MS,
)

test(
  'workout format save preserves first-class metadata and canonical workout-format ids',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const workoutFormatId = 'wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1'
      await mkdir(path.join(vaultRoot, 'bank/workout-formats'), { recursive: true })
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/garage-day.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
workoutFormatId: ${workoutFormatId}
slug: garage-day
title: Garage Day
status: active
summary: Default garage session.
activityType: strength-training
durationMinutes: 40
template:
  routineNote: Garage day template.
  exercises: []
tags:
  - garage
  - strength
note: Keep one kettlebell near the rack.
templateText: Garage day template.
---
# Garage Day
`,
        'utf8',
      )

      const saved = await runCli<WorkoutFormatSaveEnvelope>([
        'workout',
        'format',
        'save',
        'Garage Day',
        '40 min strength training. 5 sets of 15 kettlebell swings.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(saved.ok, true)
      assert.equal(requireData(saved).created, false)

      const shown = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        workoutFormatId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.id, workoutFormatId)
      assert.equal(requireData(shown).entity.data.summary, 'Default garage session.')
      assert.deepEqual(requireData(shown).entity.data.tags, ['garage', 'strength'])
      assert.equal(
        requireData(shown).entity.data.note,
        'Keep one kettlebell near the rack.',
      )

      const savedMarkdown = await readFile(
        path.join(vaultRoot, 'bank/workout-formats/garage-day.md'),
        'utf8',
      )
      const parsed = parseFrontmatterDocument(savedMarkdown)
      assert.equal(parsed.attributes.summary, 'Default garage session.')
      assert.deepEqual(parsed.attributes.tags, ['garage', 'strength'])
      assert.equal(parsed.attributes.note, 'Keep one kettlebell near the rack.')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout format save validates future loggability up front',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

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

test(
  'workout format save rejects structured payloads that omit canonical template detail',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))
    const payloadPath = path.join(vaultRoot, 'workout-format.json')

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await writeFile(
        payloadPath,
        JSON.stringify({
          title: 'Push Day A',
          activityType: 'strength-training',
          durationMinutes: 20,
          templateText: '20 min strength training. 4 sets of 20 pushups.',
        }),
        'utf8',
      )

      const saved = await runSliceCli([
        'workout',
        'format',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(saved.ok, false)
      assert.equal(saved.error.code, 'invalid_payload')
      assert.match(saved.error.message ?? '', /template/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout format save updates an existing saved format through the audited write path',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const firstSave = await runCli<WorkoutFormatSaveEnvelope>([
        'workout',
        'format',
        'save',
        'Push Day A',
        '20 min strength training. 4 sets of 20 pushups.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(firstSave.ok, true)
      assert.equal(requireData(firstSave).created, true)

      const secondSave = await runCli<WorkoutFormatSaveEnvelope>([
        'workout',
        'format',
        'save',
        'Push Day A',
        '25 min strength training. 5 sets of 10 pushups.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(secondSave.ok, true)
      assert.equal(requireData(secondSave).created, false)
      assert.equal(requireData(secondSave).path, 'bank/workout-formats/push-day-a.md')

      const savedMarkdown = await readFile(
        path.join(vaultRoot, 'bank/workout-formats/push-day-a.md'),
        'utf8',
      )
      assert.match(savedMarkdown, /25 min strength training/u)
      assert.doesNotMatch(savedMarkdown, /20 min strength training/u)

      const operations = await Promise.all(
        (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
          readStoredWriteOperation(vaultRoot, relativePath),
        ),
      )
      const workoutFormatOperations = operations.filter(
        (operation) => operation.operationType === 'workout_format_save',
      )
      assert.equal(workoutFormatOperations.length, 2)
      assert.equal(
        workoutFormatOperations.every(
          (operation) =>
            operation.status === 'committed' &&
            operation.actions.length === 2 &&
            operation.actions[0]?.kind === 'text_write' &&
            operation.actions[0]?.targetRelativePath === 'bank/workout-formats/push-day-a.md' &&
            operation.actions[1]?.kind === 'jsonl_append' &&
            /^audit\/\d{4}\/\d{4}-\d{2}\.jsonl$/u.test(
              operation.actions[1]?.targetRelativePath ?? '',
            ),
        ),
        true,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'first-class workout format docs keep explicit bank frontmatter authoritative and stable',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await mkdir(path.join(vaultRoot, 'bank/workout-formats'), { recursive: true })
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/garage-day.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
workoutFormatId: wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: garage-day
title: Garage Day
status: active
activityType: strength-training
durationMinutes: 40
templateText: Garage day template.
template:
  routineNote: Garage day template.
  exercises:
    -
      name: kettlebell swing
      order: 1
      mode: bodyweight
      plannedSets:
        -
          order: 1
          targetReps: 15
        -
          order: 2
          targetReps: 15
        -
          order: 3
          targetReps: 15
        -
          order: 4
          targetReps: 15
        -
          order: 5
          targetReps: 15
---
# Garage Day
`,
        'utf8',
      )

      const firstShow = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        'garage-day',
        '--vault',
        vaultRoot,
      ])
      const secondShow = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        'garage-day',
        '--vault',
        vaultRoot,
      ])
      assert.equal(firstShow.ok, true)
      assert.equal(secondShow.ok, true)
      assert.equal(
        requireData(firstShow).entity.data.workoutFormatId,
        requireData(secondShow).entity.data.workoutFormatId,
      )
      assert.equal(
        requireData(firstShow).entity.data.workoutFormatId,
        'wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1',
      )
      assert.deepEqual(summarizeTemplateExercises(requireData(firstShow).entity.data.template), [
        {
          exercise: 'kettlebell swing',
          setCount: 5,
          repsPerSet: 15,
        },
      ])

      const loggedWorkout = await runCli<WorkoutAddEnvelope>([
        'workout',
        'format',
        'log',
        'garage-day',
        '--occurred-at',
        '2026-03-12T17:30:00Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(loggedWorkout.ok, true)
      assert.deepEqual(summarizeWorkoutExercises(requireData(loggedWorkout).workout), [
        {
          exercise: 'kettlebell swing',
          setCount: 5,
          repsPerSet: 15,
        },
      ])

      const upgradedFormat = await runCli<WorkoutFormatSaveEnvelope>([
        'workout',
        'format',
        'save',
        'Garage Day',
        '40 min strength training. 5 sets of 15 kettlebell swings.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(upgradedFormat.ok, true)
      assert.equal(requireData(upgradedFormat).created, false)

      const upgradedShow = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        'garage-day',
        '--vault',
        vaultRoot,
      ])
      assert.equal(upgradedShow.ok, true)
      assert.equal(
        requireData(upgradedShow).entity.data.workoutFormatId,
        'wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout format show and log work from the canonical template payload without templateText',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await mkdir(path.join(vaultRoot, 'bank/workout-formats'), { recursive: true })
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/no-template.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
workoutFormatId: wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: no-template
title: No Template
status: active
activityType: strength-training
durationMinutes: 30
template:
  exercises: []
---
# No Template
`,
        'utf8',
      )

      const shown = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        'no-template',
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.title, 'No Template')
      assert.equal(requireData(shown).entity.data.templateText, undefined)

      const logged = await runCli<WorkoutAddEnvelope>([
        'workout',
        'format',
        'log',
        'no-template',
        '--vault',
        vaultRoot,
      ])
      assert.equal(logged.ok, true)
      assert.equal(requireData(logged).title, '30-minute strength training')
      assert.equal(requireData(logged).note, 'No Template')
      assert.equal(summarizeWorkoutExercises(requireData(logged).workout), null)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout format log prefers saved workout text over format metadata notes for first-class docs',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await mkdir(path.join(vaultRoot, 'bank/workout-formats'), { recursive: true })
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/garage-day.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
workoutFormatId: wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: garage-day
title: Garage Day
status: active
activityType: strength-training
durationMinutes: 40
note: Keep one kettlebell near the rack.
templateText: Garage day template.
template:
  routineNote: Garage day template.
  exercises:
    -
      name: kettlebell swing
      order: 1
      mode: weight_reps
      plannedSets:
        -
          order: 1
          targetReps: 15
        -
          order: 2
          targetReps: 15
        -
          order: 3
          targetReps: 15
        -
          order: 4
          targetReps: 15
        -
          order: 5
          targetReps: 15
---
# Garage Day
`,
        'utf8',
      )

      const logged = await runCli<WorkoutAddEnvelope>([
        'workout',
        'format',
        'log',
        'garage-day',
        '--vault',
        vaultRoot,
      ])
      assert.equal(logged.ok, true)
      assert.equal(requireData(logged).note, 'Garage day template.')

      const shown = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(logged).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.data.note, 'Garage day template.')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout format commands reject legacy docs without first-class workout ids',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await mkdir(path.join(vaultRoot, 'bank/workout-formats'), { recursive: true })
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/legacy-gym-day.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
slug: legacy-gym-day
title: Legacy Gym Day
status: active
type: strength-training
durationMinutes: 35
text: Legacy gym day template.
---
# Legacy Gym Day
`,
        'utf8',
      )

      const shown = await runCli([
        'workout',
        'format',
        'show',
        'legacy-gym-day',
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, false)
      assert.equal(shown.error.code, 'contract_invalid')
      assert.match(shown.error.message ?? '', /missing workoutFormatId/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout format scans hard-fail on stale legacy docs after the cutover',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-format-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await mkdir(path.join(vaultRoot, 'bank/workout-formats'), { recursive: true })
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/good-day.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
workoutFormatId: wfmt_01JNV422Y2M5ZBV64ZP4N1DRB2
slug: good-day
title: Good Day
status: active
activityType: strength-training
durationMinutes: 30
template:
  routineNote: Good day template.
  exercises: []
templateText: Good day template.
---
# Good Day
`,
        'utf8',
      )
      await writeFile(
        path.join(vaultRoot, 'bank/workout-formats/legacy-gym-day.md'),
        `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
slug: legacy-gym-day
title: Legacy Gym Day
status: active
type: strength-training
durationMinutes: 35
text: Legacy gym day template.
---
# Legacy Gym Day
`,
        'utf8',
      )

      const shown = await runCli<ShowEnvelope>([
        'workout',
        'format',
        'show',
        'good-day',
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, false)
      assert.equal(shown.error.code, 'contract_invalid')
      assert.match(shown.error.message ?? '', /missing workoutFormatId/u)

      const listed = await runCli<WorkoutFormatListEnvelope>([
        'workout',
        'format',
        'list',
        '--vault',
        vaultRoot,
      ])
      assert.equal(listed.ok, false)
      assert.equal(listed.error.code, 'contract_invalid')
      assert.match(listed.error.message ?? '', /missing workoutFormatId/u)

      const logged = await runCli<WorkoutAddEnvelope>([
        'workout',
        'format',
        'log',
        'good-day',
        '--occurred-at',
        '2026-03-12T17:30:00Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(logged.ok, false)
      assert.equal(logged.error.code, 'contract_invalid')
      assert.match(logged.error.message ?? '', /missing workoutFormatId/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout add captures activity_session events and fails fast on ambiguous, mixed, or missing durations',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-'))

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
      assert.equal(summarizeWorkoutExercises(requireData(runWorkout).workout), null)
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
        summarizeWorkoutExercises(
          requireData(showWorkout).entity.data.workout as Record<string, unknown> | null | undefined,
        ),
        null,
      )
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
      assert.deepEqual(summarizeWorkoutExercises(requireData(structuredStrengthWorkout).workout), [
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
        summarizeWorkoutExercises(
          requireData(showStructuredStrengthWorkout).entity.data.workout as Record<string, unknown> | null | undefined,
        ),
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

      const mixedActivities = await runCli([
        'workout',
        'add',
        'Morning run to the beach, followed by a quick 10-minute swim, then back home. Approx 8.56 km total.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(mixedActivities.ok, false)
      assert.equal(mixedActivities.error.code, 'invalid_option')
      assert.match(
        mixedActivities.error.message ?? '',
        /Workout note includes multiple activities or segments/u,
      )

      const missingDuration = await runCli([
        'workout',
        'add',
        'Easy run around the neighborhood.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(missingDuration.ok, false)
      assert.equal(missingDuration.error.code, 'invalid_option')
      assert.match(
        missingDuration.error.message ?? '',
        /Workout duration is missing/u,
      )

      const segmentedSameSport = await runCli([
        'workout',
        'add',
        '10-minute warmup jog then easy run home.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(segmentedSameSport.ok, false)
      assert.equal(segmentedSameSport.error.code, 'invalid_option')
      assert.match(
        segmentedSameSport.error.message ?? '',
        /Workout note includes multiple activities or segments/u,
      )

      const mixedWithExplicitDuration = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        'Morning run to the beach, followed by a quick 10-minute swim, then back home. Approx 8.56 km total.',
        '--duration',
        '70',
        '--vault',
        vaultRoot,
      ])
      assert.equal(mixedWithExplicitDuration.ok, true)
      assert.equal(requireData(mixedWithExplicitDuration).activityType, 'running')
      assert.equal(requireData(mixedWithExplicitDuration).durationMinutes, 70)
      assert.equal(requireData(mixedWithExplicitDuration).title, '70-minute run')
      assert.equal(requireData(mixedWithExplicitDuration).distanceKm, 8.56)

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
      assert.equal(summarizeWorkoutExercises(requireData(strengthWorkout).workout), null)
      assert.equal(
        requireData(strengthWorkout).title,
        '30-minute strength training',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test('workout capture defaults apply only when a reported workout omits duration', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-defaults-'))

  try {
    await initializeVault({
      title: 'Synthetic workout defaults',
      timezone: 'UTC',
      vaultRoot,
    })

    const initial = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'show',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initial.ok, true)
    assert.deepEqual(requireData(initial).captureDefaults, {
      durationMinutes: null,
    })

    const missingSelection = await runCli([
      'workout',
      'defaults',
      'set',
      '--vault',
      vaultRoot,
    ])
    assert.equal(missingSelection.ok, false)
    assert.equal(missingSelection.error.code, 'invalid_option')

    const conflictingSelection = await runCli([
      'workout',
      'defaults',
      'set',
      '--duration',
      '60',
      '--clear-duration',
      '--vault',
      vaultRoot,
    ])
    assert.equal(conflictingSelection.ok, false)
    assert.equal(conflictingSelection.error.code, 'invalid_option')

    const initiallyMissing = await runCli([
      'workout',
      'add',
      'Easy ride.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initiallyMissing.ok, false)
    assert.match(
      initiallyMissing.error.message ?? '',
      /Workout duration is missing/u,
    )

    const saved = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'set',
      '--duration',
      '60',
      '--vault',
      vaultRoot,
    ])
    assert.equal(saved.ok, true)
    assert.equal(requireData(saved).updated, true)
    assert.deepEqual(requireData(saved).captureDefaults, {
      durationMinutes: 60,
    })

    const defaulted = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Evening yoga session.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(defaulted.ok, true)
    assert.equal(requireData(defaulted).durationMinutes, 60)

    const textOverride = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      '20-minute walk.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(textOverride.ok, true)
    assert.equal(requireData(textOverride).durationMinutes, 20)

    const flagOverride = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Morning row.',
      '--duration',
      '35',
      '--vault',
      vaultRoot,
    ])
    assert.equal(flagOverride.ok, true)
    assert.equal(requireData(flagOverride).durationMinutes, 35)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, WORKOUT_CAPTURE_DEFAULTS_TIMEOUT_MS)

test('workout capture fails closed for ambiguous, imported, and cleared duration', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-defaults-'))

  try {
    await initializeVault({
      title: 'Synthetic workout default exclusions',
      timezone: 'UTC',
      vaultRoot,
    })
    const saved = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'set',
      '--duration',
      '60',
      '--vault',
      vaultRoot,
    ])
    assert.equal(saved.ok, true)

    const ambiguous = await runCli([
      'workout',
      'add',
      'Run for 20 or 30 minutes.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(ambiguous.ok, false)
    assert.match(ambiguous.error.message ?? '', /duration is ambiguous/iu)

    const segmented = await runCli([
      'workout',
      'add',
      'Morning run followed by a swim.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(segmented.ok, false)
    assert.match(segmented.error.message ?? '', /multiple activities or segments/iu)

    const importPayloadPath = path.join(vaultRoot, 'missing-duration.json')
    await writeFile(
      importPayloadPath,
      JSON.stringify({
        activityType: 'strength-training',
        note: 'Imported strength session.',
        title: 'Imported strength session',
      }),
      'utf8',
    )
    const importedWithoutDuration = await runCli([
      'workout',
      'import-json',
      '--input',
      `@${importPayloadPath}`,
      '--vault',
      vaultRoot,
    ])
    assert.equal(importedWithoutDuration.ok, false)
    assert.match(
      importedWithoutDuration.error.message ?? '',
      /Workout duration is missing/u,
    )

    const cleared = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'set',
      '--clear-duration',
      '--vault',
      vaultRoot,
    ])
    assert.equal(cleared.ok, true)
    assert.deepEqual(requireData(cleared).captureDefaults, {
      durationMinutes: null,
    })

    const missing = await runCli([
      'workout',
      'add',
      'Easy ride.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(missing.ok, false)
    assert.match(missing.error.message ?? '', /Workout duration is missing/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, WORKOUT_CAPTURE_DEFAULTS_TIMEOUT_MS)

test('workout capture preserves explicit hours and the manual source boundary', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-defaults-'))

  try {
    await initializeVault({
      title: 'Synthetic workout default precedence',
      timezone: 'UTC',
      vaultRoot,
    })
    const saved = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'set',
      '--duration',
      '25',
      '--vault',
      vaultRoot,
    ])
    assert.equal(saved.ok, true)

    for (const report of ['Yoga for an hour.', 'Yoga for one hour.']) {
      const explicitHour = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        report,
        '--vault',
        vaultRoot,
      ])
      assert.equal(explicitHour.ok, true)
      assert.equal(requireData(explicitHour).durationMinutes, 60)
    }

    const compoundHour = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'I did yoga for an hour and a half.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(compoundHour.ok, true)
    assert.equal(requireData(compoundHour).durationMinutes, 90)

    const ambiguousWordHours = await runCli([
      'workout',
      'add',
      'I worked out for an hour or two.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(ambiguousWordHours.ok, false)
    assert.match(
      ambiguousWordHours.error.message ?? '',
      /duration is ambiguous/iu,
    )

    const temporalHour = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'I did yoga an hour ago.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(temporalHour.ok, true)
    assert.equal(requireData(temporalHour).durationMinutes, 25)

    const definiteBeforeTemporalHour = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'I ran 30 minutes one hour ago.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(definiteBeforeTemporalHour.ok, true)
    assert.equal(requireData(definiteBeforeTemporalHour).durationMinutes, 30)

    const numericDurationBeforeSchedule = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Yoga for 30 minutes after lunch.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(numericDurationBeforeSchedule.ok, true)
    assert.equal(requireData(numericDurationBeforeSchedule).durationMinutes, 30)

    const wordDurationBeforeSchedule = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Yoga for one hour before breakfast.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(wordDurationBeforeSchedule.ok, true)
    assert.equal(requireData(wordDurationBeforeSchedule).durationMinutes, 60)

    const unframedBeforeSchedule = await runCli([
      'workout',
      'add',
      'Yoga an hour before breakfast.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(unframedBeforeSchedule.ok, false)
    assert.match(
      unframedBeforeSchedule.error.message ?? '',
      /duration is ambiguous/iu,
    )

    for (const report of [
      'I worked out for one hour or maybe two.',
      'I worked out for one hour, maybe two.',
      'I worked out for an hour and a half, maybe two.',
      'I worked out for one hour and 20 minutes, maybe two hours.',
    ]) {
      const hedgedWordHours = await runCli([
        'workout',
        'add',
        report,
        '--vault',
        vaultRoot,
      ])
      assert.equal(hedgedWordHours.ok, false)
      assert.match(
        hedgedWordHours.error.message ?? '',
        /duration is ambiguous/iu,
      )
    }

    const competingDurationEvidence = await runCli([
      'workout',
      'add',
      'I did yoga for 30 minutes, an hour and a half after lunch.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(competingDurationEvidence.ok, false)
    assert.match(
      competingDurationEvidence.error.message ?? '',
      /duration is ambiguous/iu,
    )

    const explicitManual = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Manual elliptical session.',
      '--source',
      'manual',
      '--vault',
      vaultRoot,
    ])
    assert.equal(explicitManual.ok, true)
    assert.equal(requireData(explicitManual).durationMinutes, 25)

    for (const source of ['import', 'device', 'derived']) {
      const nonManual = await runCli([
        'workout',
        'add',
        `${source} ride.`,
        '--source',
        source,
        '--vault',
        vaultRoot,
      ])
      assert.equal(nonManual.ok, false)
      assert.match(nonManual.error.message ?? '', /Workout duration is missing/u)
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, WORKOUT_CAPTURE_DEFAULTS_TIMEOUT_MS)

test('workout capture promotes one explicit legacy default and rejects conflicts', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-defaults-'))

  try {
    await initializeVault({
      title: 'Synthetic legacy workout defaults',
      timezone: 'UTC',
      vaultRoot,
    })
    await upsertMemory(vaultRoot, {
      section: 'Preferences',
      text: 'Workouts reported here default to 45 minutes unless another duration is stated.',
    })
    const conflictingPreference = await upsertMemory(vaultRoot, {
      section: 'Preferences',
      text: 'When workout duration is omitted, the default is 30 minutes.',
    })

    const conflicting = await runCli([
      'workout',
      'add',
      'Easy ride.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(conflicting.ok, false)
    assert.match(conflicting.error.message ?? '', /Workout duration is missing/u)

    await upsertMemory(vaultRoot, {
      recordId: conflictingPreference.record.id,
      section: 'Preferences',
      text: 'When workout duration is omitted, the default is 45 minutes.',
    })

    const migrated = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Afternoon Pilates session.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(migrated.ok, true)
    assert.equal(requireData(migrated).durationMinutes, 45)

    const migratedPreferences = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'show',
      '--vault',
      vaultRoot,
    ])
    assert.equal(migratedPreferences.ok, true)
    assert.deepEqual(requireData(migratedPreferences).captureDefaults, {
      durationMinutes: 45,
    })

    const cleared = await runCli<WorkoutCaptureDefaultsEnvelope>([
      'workout',
      'defaults',
      'set',
      '--clear-duration',
      '--vault',
      vaultRoot,
    ])
    assert.equal(cleared.ok, true)
    assert.deepEqual(requireData(cleared).captureDefaults, {
      durationMinutes: null,
    })

    const afterClear = await runCli([
      'workout',
      'add',
      'Easy ride.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(afterClear.ok, false)
    assert.match(afterClear.error.message ?? '', /Workout duration is missing/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, WORKOUT_CAPTURE_DEFAULTS_TIMEOUT_MS)

test('workout capture ignores unsupported legacy prose and non-manual migration', async () => {
  const unsupportedPreferences = [
    'Do not default workouts to 60 minutes when duration is omitted.',
    'No longer default workouts to 60 minutes when duration is omitted.',
    'I used to default workouts to 60 minutes when duration was omitted.',
    'Default breakfast is oatmeal when I have a 30-minute workout.',
    'I prefer 60-minute workouts when possible, and default reminders to off unless I ask.',
    'My workouts are usually 45 minutes when I do them; default to kilograms unless specified.',
    'Workouts default to 60 minutes unless specified otherwise, but not anymore.',
    'I no longer use the rule "workouts default to 60 minutes unless specified otherwise."',
    'When workout duration is omitted, the default is 45 minutes, but that preference was removed.',
  ]

  const unsupportedVaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-cli-workout-defaults-'),
  )
  try {
    await initializeVault({
      title: 'Synthetic unsupported workout default',
      timezone: 'UTC',
      vaultRoot: unsupportedVaultRoot,
    })
    let preferenceRecordId: string | undefined
    for (const preference of unsupportedPreferences) {
      const updated = await upsertMemory(unsupportedVaultRoot, {
        ...(preferenceRecordId === undefined ? {} : { recordId: preferenceRecordId }),
        section: 'Preferences',
        text: preference,
      })
      preferenceRecordId = updated.record.id

      const result = await runCli([
        'workout',
        'add',
        'Easy ride.',
        '--vault',
        unsupportedVaultRoot,
      ])
      assert.equal(result.ok, false)
      assert.match(result.error.message ?? '', /Workout duration is missing/u)
      await assert.rejects(
        access(path.join(unsupportedVaultRoot, 'bank/preferences.json')),
      )
    }
  } finally {
    await rm(unsupportedVaultRoot, { recursive: true, force: true })
  }

  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-defaults-'))
  try {
    await initializeVault({
      title: 'Synthetic manual-only workout default',
      timezone: 'UTC',
      vaultRoot,
    })
    await upsertMemory(vaultRoot, {
      section: 'Preferences',
      text: 'Workouts reported here default to one hour unless stated otherwise.',
    })

    for (const source of ['import', 'device', 'derived']) {
      const result = await runCli([
        'workout',
        'add',
        `${source} ride.`,
        '--source',
        source,
        '--vault',
        vaultRoot,
      ])
      assert.equal(result.ok, false)
      assert.match(result.error.message ?? '', /Workout duration is missing/u)
    }
    await assert.rejects(access(path.join(vaultRoot, 'bank/preferences.json')))

    const manual = await runCli<WorkoutAddEnvelope>([
      'workout',
      'add',
      'Easy ride.',
      '--source',
      'manual',
      '--vault',
      vaultRoot,
    ])
    assert.equal(manual.ok, true)
    assert.equal(requireData(manual).durationMinutes, 60)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, WORKOUT_CAPTURE_DEFAULTS_TIMEOUT_MS)

test(
  'workout add surfaces invalid timestamps without needing a custom workout read surface',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-'))

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
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout add rejects structured payloads that omit duration, timestamps, and freeform note text',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-'))
    const payloadPath = path.join(vaultRoot, 'workout.json')

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await writeFile(
        payloadPath,
        JSON.stringify({
          exercises: [
            {
              name: 'pushups',
              order: 1,
              mode: 'weight_reps',
              sets: [
                {
                  order: 1,
                  reps: 20,
                },
              ],
            },
          ],
        }),
        'utf8',
      )

      await assert.rejects(
        () =>
          addWorkoutRecord({
            vault: vaultRoot,
            inputFile: payloadPath,
          }),
        (error: unknown) =>
          error instanceof Error
          && 'code' in error
          && error.code === 'invalid_option'
          && /Pass --duration <minutes> to record it explicitly/u.test(error.message),
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout add rejects structured payload attachments that bypass canonical staging',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-attachments-'))
    const payloadPath = path.join(vaultRoot, 'workout.json')

    try {
      await initializeVault({ vaultRoot, title: 'Workout attachment rejection vault' })
      await writeFile(
        payloadPath,
        JSON.stringify({
          title: 'Lift session',
          durationMinutes: 35,
          attachments: [{
            role: 'media_1',
            kind: 'photo',
            relativePath: 'raw/workouts/2026/04/evt_demo/photo.jpg',
            mediaType: 'image/jpeg',
            sha256: '0'.repeat(64),
            originalFileName: 'photo.jpg',
          }],
          workout: {
            exercises: [{
              name: 'squat',
              order: 1,
              sets: [{
                order: 1,
                reps: 5,
                weight: 225,
                weightUnit: 'lb',
              }],
            }],
          },
        }),
        'utf8',
      )

      await assert.rejects(
        () =>
          addWorkoutRecord({
            vault: vaultRoot,
            inputFile: payloadPath,
          }),
        (error: unknown) =>
          error instanceof Error
          && 'code' in error
          && error.code === 'invalid_payload'
          && /cannot set attachments\[\]/u.test(error.message),
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'measurement payloads reject structured attachments that bypass canonical staging',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-measurement-attachments-'))
    const payloadPath = path.join(vaultRoot, 'measurement.json')

    try {
      await initializeVault({ vaultRoot, title: 'Measurement attachment rejection vault' })
      await writeFile(
        payloadPath,
        JSON.stringify({
          title: 'Weight check-in',
          measurements: [{
            metric: 'weight',
            value: 180,
            unit: 'lb',
          }],
          attachments: [{
            role: 'media_1',
            kind: 'audio',
            relativePath: 'raw/measurements/2026/04/evt_demo/note.m4a',
            mediaType: 'audio/mp4',
            sha256: '1'.repeat(64),
            originalFileName: 'note.m4a',
          }],
        }),
        'utf8',
      )

      await assert.rejects(
        () =>
          addMeasurementRecord({
            vault: vaultRoot,
            inputFile: payloadPath,
          }),
        (error: unknown) =>
          error instanceof Error
          && 'code' in error
          && error.code === 'invalid_payload'
          && /cannot set attachments\[\]/u.test(error.message),
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout edit/delete mutate and remove the saved activity_session event',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-edit-'))

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const created = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        'Went for a 45-minute ride.',
        '--distance-km',
        '15',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const edited = await runCli<ShowEnvelope>([
        'workout',
        'edit',
        requireData(created).eventId,
        '--note',
        'Easy recovery ride.',
        '--duration',
        '50',
        '--title',
        '50-minute ride',
        '--clear-distance',
        '--vault',
        vaultRoot,
      ])
      assert.equal(edited.ok, true)
      assert.equal(edited.meta?.command, 'workout edit')
      assert.equal(requireData(edited).entity.kind, 'activity_session')
      assert.equal(requireData(edited).entity.data.note, 'Easy recovery ride.')
      assert.equal(requireData(edited).entity.data.durationMinutes, 50)
      assert.equal(requireData(edited).entity.data.distanceKm, undefined)
      assert.equal(requireData(edited).entity.title, '50-minute ride')
      const editedRevision = (
        requireData(edited).entity.data.lifecycle as { revision?: unknown } | undefined
      )?.revision
      assert.equal(typeof editedRevision, 'number')

      const deleted = await runCli<DeleteEnvelope>([
        'workout',
        'delete',
        requireData(created).eventId,
        '--expected-revision',
        String(editedRevision),
        '--vault',
        vaultRoot,
      ])
      assert.equal(deleted.ok, true)
      assert.equal(deleted.meta?.command, 'workout delete')
      assert.equal(requireData(deleted).entityId, requireData(created).eventId)
      assert.equal(requireData(deleted).kind, 'activity_session')
      assert.equal(requireData(deleted).deleted, true)

      const missing = await runCli([
        'event',
        'show',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(missing.ok, false)
      assert.equal(missing.error?.code, 'not_found')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout manifest resolves from workout media paths after typed edits',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-manifest-'))
    const mediaPath = path.join(vaultRoot, 'workout-photo.jpg')

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await writeFile(mediaPath, 'workout-photo', 'utf8')

      const created = await runCli<WorkoutAddEnvelope>([
        'workout',
        'add',
        'Went for a 45-minute walk.',
        '--media',
        mediaPath,
        '--occurred-at',
        '2026-03-12T18:00:00Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const cleared = await runCli<ShowEnvelope>([
        'workout',
        'edit',
        requireData(created).eventId,
        '--note',
        'Edited walk with attached media.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(cleared.ok, true)
      const rawRefsValue = requireData(cleared).entity.data.rawRefs
      const rawRefs = Array.isArray(rawRefsValue)
        ? rawRefsValue.filter((entry): entry is string => typeof entry === 'string')
        : []
      assert.equal(rawRefs.length > 0, true)
      assert.match(
        rawRefs[0] ?? '',
        /^raw\/workouts\/2026\/03\/evt[-_].+\/workout-photo\.jpg$/u,
      )

      const manifest = await runCli<WorkoutManifestEnvelope>([
        'workout',
        'manifest',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(manifest.ok, true)
      assert.match(requireData(manifest).manifestFile, /^raw\/workouts\/2026\/03\/evt[-_]/u)
      assert.match(requireData(manifest).manifest.rawDirectory, /^raw\/workouts\/2026\/03\/evt[-_]/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'workout media staging is cleaned up when the later event write fails',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-workout-stage-cleanup-'))
    const mediaPath = path.join(vaultRoot, 'workout-photo.jpg')

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await writeFile(mediaPath, 'workout-photo', 'utf8')

      await assert.rejects(
        () =>
          addWorkoutRecord({
            vault: vaultRoot,
            text: 'Went for a 45-minute walk.',
            occurredAt: 'not-a-timestamp',
            mediaPaths: [mediaPath],
          }),
      )

      await assert.rejects(() => access(path.join(vaultRoot, 'raw/workouts/2026/03')))
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test(
  'measurement media staging is cleaned up when the later event write fails',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-measurement-stage-cleanup-'))
    const mediaPath = path.join(vaultRoot, 'measurement-photo.jpg')

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      await writeFile(mediaPath, 'measurement-photo', 'utf8')

      await assert.rejects(
        () =>
          addMeasurementRecord({
            vault: vaultRoot,
            metric: 'waist',
            value: 33.5,
            unit: 'in',
            occurredAt: 'not-a-timestamp',
            mediaPaths: [mediaPath],
          }),
      )

      await assert.rejects(() => access(path.join(vaultRoot, 'raw/measurements/2026/03')))
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
