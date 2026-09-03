import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Cli } from 'incur'

import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import { JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA } from '@murphai/importers/device-providers/junction'

import { repoRoot } from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { createVaultCli } from '../src/index.js'

const DEFAULT_AGENT_VISIBLE_OUTPUT_MAX_CHARS = 15_000
const OUTPUT_BUDGET_TIMEOUT_MS = 120_000
const WEARABLE_ACTIVITY_MAX_WORKOUTS_PER_DAY = 32
const WEARABLE_ACTIVITY_MAX_SPLITS_PER_WORKOUT = 64
const WEARABLE_ACTIVITY_COMPACT_MAX_BYTES = 15_000
const WEARABLE_ACTIVITY_OVERSIZED_BASELINE_BYTES = 580_820

function cliBudgetEnv() {
  const env = { ...process.env }
  delete env.VAULT
  return { env }
}

async function runBudgetedRawCli(
  cli: Cli.Cli,
  args: readonly string[],
  vaultRoot: string,
): Promise<string> {
  const output: string[] = []

  await cli.serve(
    [
      ...args,
      '--vault',
      vaultRoot,
      '--format',
      'json',
      '--full-output',
    ],
    {
      ...cliBudgetEnv(),
      exit: () => {},
      stdout(chunk) {
        output.push(chunk)
      },
    },
  )

  return output.join('').trim()
}

function assertWithinBudget(label: string, output: string) {
  assert.ok(
    output.length <= DEFAULT_AGENT_VISIBLE_OUTPUT_MAX_CHARS,
    `${label} emitted ${output.length} chars, expected <= ${DEFAULT_AGENT_VISIBLE_OUTPUT_MAX_CHARS}`,
  )
}

function assertOk(label: string, output: string) {
  const parsed = JSON.parse(output) as {
    error?: {
      code?: string
      message?: string
    }
    ok?: unknown
  }
  assert.equal(
    parsed.ok,
    true,
    `${label} did not return an ok envelope: ${parsed.error?.code ?? 'unknown'} ${
      parsed.error?.message ?? ''
    }`.trim(),
  )
}

function buildSyntheticWorkout(input: {
  date: string
  index: number
  splitCount: number
}) {
  const startMs = Date.parse(`${input.date}T00:00:00.000Z`) + input.index * 30 * 60_000
  const endMs = startMs + 30 * 60_000
  const activityType = input.index % 2 === 0 ? 'running' : 'cycling'
  const cadenceUnit = activityType === 'cycling' ? 'rpm' : 'steps-per-minute'
  const id = `synthetic-${input.date}-${String(input.index).padStart(2, '0')}`
  const startAt = new Date(startMs).toISOString()
  const endAt = new Date(endMs).toISOString()

  return {
    feature: {
      schema: JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
      id,
      workoutId: id,
      sourceProviderSlug: 'garmin',
      sourceType: 'watch',
      sourceInstanceId: 'synthetic-watch',
      version: '2026-09-01T00:00:00.000Z',
      sport: activityType,
      startAt,
      endAt,
      durationSeconds: 1_800,
      distanceMeters: 5_000,
      averageHeartRate: 140 + input.index,
      maxHeartRate: 170 + input.index,
      firstHalfAverageHeartRate: 135 + input.index,
      secondHalfAverageHeartRate: 145 + input.index,
      averageCadence: 90 + input.index,
      maxCadence: 105 + input.index,
      cadenceUnit,
      averagePower: 220 + input.index,
      maxPower: 300 + input.index,
      averageSpeed: 5 + input.index / 100,
      maxSpeed: 8 + input.index / 100,
      sampleCount: 1_000,
      splits: Array.from({ length: input.splitCount }, (_, splitOffset) => ({
        index: splitOffset + 1,
        distanceMeters: (splitOffset + 1) * 100,
        durationSeconds: 20,
        endedAt: new Date(startMs + (splitOffset + 1) * 20_000).toISOString(),
        averageHeartRate: 130 + input.index + splitOffset / 100,
        averageCadence: 88 + input.index + splitOffset / 100,
        cadenceUnit,
        averagePower: 200 + input.index + splitOffset,
      })),
    },
    summary: {
      id,
      sourceProviderSlug: 'garmin',
      sourceType: 'watch',
      sourceInstanceId: 'synthetic-watch',
      startAt,
      endAt,
      sport: activityType,
    },
  }
}

async function seedSyntheticWearableActivityFixture(vaultRoot: string): Promise<void> {
  await coreRuntime.initializeVault({
    createdAt: '2026-08-30T00:00:00.000Z',
    timezone: 'UTC',
    vaultRoot,
  })
  const typical = Array.from({ length: 2 }, (_, index) => buildSyntheticWorkout({
    date: '2026-08-30',
    index,
    splitCount: 2,
  }))
  const maximum = Array.from(
    { length: WEARABLE_ACTIVITY_MAX_WORKOUTS_PER_DAY },
    (_, index) => buildSyntheticWorkout({
      date: '2026-08-31',
      index,
      splitCount: WEARABLE_ACTIVITY_MAX_SPLITS_PER_WORKOUT,
    }),
  )

  const fixtures = [{
    activity: {
      id: 'synthetic-activity-2026-08-30',
      sourceProviderSlug: 'garmin',
      sourceType: 'watch',
      sourceInstanceId: 'synthetic-watch',
      observedAt: '2026-08-30T23:00:00.000Z',
      steps: 7_500,
      activeCalories: 350,
      distance: 6_000,
    },
    workouts: typical,
  }, {
    activity: {
      id: 'synthetic-activity-2026-08-31',
      sourceProviderSlug: 'garmin',
      sourceType: 'watch',
      sourceInstanceId: 'synthetic-watch',
      observedAt: '2026-08-31T23:00:00.000Z',
      steps: 12_345,
      activeCalories: 640,
      distance: 10_500,
    },
    workouts: maximum,
  }]

  for (const fixture of fixtures) {
    await importDeviceProviderSnapshot(
      {
        provider: 'junction',
        sourceKind: 'poll',
        deliveryMode: 'scheduled_reconcile',
        vaultRoot,
        snapshot: {
          importedAt: '2026-09-01T00:00:00.000Z',
          summaries: {
            activity: [fixture.activity],
            workouts: fixture.workouts.map((workout) => workout.summary),
          },
          timeseries: {
            workout_stream: fixture.workouts.map((workout) => workout.feature),
          },
        },
      },
      { corePort: coreRuntime },
    )
  }
}

test('representative default read commands stay within the agent-visible output budget', async () => {
  const cli = createVaultCli()
  const demoVaultRoot = path.join(repoRoot, 'fixtures/demo-web-vault')
  const commands: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['root list', ['list']],
    ['event list', ['event', 'list']],
    ['document list', ['document', 'list']],
    ['workout list', ['workout', 'list']],
    ['automation list', ['automation', 'list']],
    ['audit list', ['audit', 'list']],
    ['search query', ['search', 'query', 'sleep']],
    ['knowledge list', ['knowledge', 'list']],
    ['protocol list', ['protocol', 'list']],
    ['wearables latest', ['wearables', 'latest']],
    ['wearables sleep list', ['wearables', 'sleep', 'list']],
    ['wearables activity list', ['wearables', 'activity', 'list']],
    ['wearables recovery list', ['wearables', 'recovery', 'list']],
    ['wearables sources list', ['wearables', 'sources', 'list']],
  ]

  for (const [label, args] of commands) {
    const output = await runBudgetedRawCli(cli, args, demoVaultRoot)
    assertOk(label, output)
    assertWithinBudget(label, output)
  }
}, OUTPUT_BUDGET_TIMEOUT_MS)

test('wearables activity list keeps routine reads compact while explicit detail remains lossless', async () => {
  const cli = createVaultCli()
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-wearable-activity-budget-'))

  try {
    await seedSyntheticWearableActivityFixture(vaultRoot)

    const compactRaw = await runBudgetedRawCli(
      cli,
      ['wearables', 'activity', 'list', '--date', '2026-08-31'],
      vaultRoot,
    )
    const compact = JSON.parse(compactRaw) as {
      ok: true
      data: {
        count: number
        filters: {
          date: string | null
          from: string | null
          to: string | null
          providers: string[]
          limit: number
        }
        items: Array<Record<string, unknown> & {
          activityTypes?: string[]
          activeCalories?: { confidence: string; metric: string; provider?: string; unit?: string; value: number | null }
          date: string
          distanceKm?: { confidence: string; metric: string; provider?: string; unit?: string; value: number | null }
          sessionCount?: { confidence: string; metric: string; provider?: string; unit?: string; value: number | null }
          sessionMinutes?: { confidence: string; metric: string; provider?: string; unit?: string; value: number | null }
          steps?: { confidence: string; metric: string; provider?: string; unit?: string; value: number | null }
          summaryConfidence?: { selectedProviders?: string[] }
        }>
      }
    }
    assert.equal(compact.ok, true)
    assert.equal(compact.data.count, 1)
    assert.deepEqual(compact.data.filters, {
      date: '2026-08-31',
      from: '2026-08-31',
      to: '2026-08-31',
      providers: [],
      limit: 3,
    })
    const compactDay = compact.data.items[0]
    assert.ok(compactDay)
    assert.equal(compactDay.date, '2026-08-31')
    assert.deepEqual([...(compactDay.activityTypes ?? [])].sort(), ['cycling', 'running'])
    assert.deepEqual(compactDay.sessionCount, {
      confidence: 'high',
      metric: 'sessionCount',
      provider: 'garmin',
      unit: 'count',
      value: 32,
    })
    assert.deepEqual(compactDay.sessionMinutes, {
      confidence: 'high',
      metric: 'sessionMinutes',
      provider: 'garmin',
      unit: 'minutes',
      value: 960,
    })
    assert.deepEqual(compactDay.steps, {
      confidence: 'high',
      metric: 'steps',
      provider: 'garmin',
      unit: 'count',
      value: 12_345,
    })
    assert.deepEqual(compactDay.activeCalories, {
      confidence: 'high',
      metric: 'activeCalories',
      provider: 'garmin',
      unit: 'kcal',
      value: 640,
    })
    assert.deepEqual(compactDay.distanceKm, {
      confidence: 'high',
      metric: 'distanceKm',
      provider: 'garmin',
      unit: 'km',
      value: 10.5,
    })
    assert.deepEqual(compactDay.summaryConfidence?.selectedProviders, ['garmin'])
    assert.equal(Object.hasOwn(compactDay, 'workoutFeatures'), false)

    const detailedRaw = await runBudgetedRawCli(
      cli,
      [
        'wearables',
        'activity',
        'list',
        '--date',
        '2026-08-31',
        '--include-workout-details',
      ],
      vaultRoot,
    )
    const detailed = JSON.parse(detailedRaw) as {
      ok: true
      data: {
        count: number
        filters: typeof compact.data.filters
        items: Array<Record<string, unknown> & {
          date: string
          workoutFeatures?: Array<{
            activityType?: string
            averageCadence?: number
            averageHeartRate?: number
            averagePowerWatts?: number
            averageSpeedMps?: number
            cadenceUnit?: string
            provider: string
            splits: Array<{
              averageCadence?: number
              averageHeartRate?: number
              averagePowerWatts?: number
              cadenceUnit?: string
              distanceMeters?: number
              durationSeconds?: number
              endedAt: string
              index: number
            }>
            startedAt: string
          }>
        }>
      }
    }
    assert.equal(detailed.ok, true)
    assert.deepEqual(detailed.data.filters, compact.data.filters)
    assert.equal(detailed.data.count, compact.data.count)
    assert.deepEqual(
      detailed.data.items.map((item) => item.date),
      compact.data.items.map((item) => item.date),
    )
    const detailedFeatures = detailed.data.items[0]?.workoutFeatures
    assert.equal(detailedFeatures?.length, WEARABLE_ACTIVITY_MAX_WORKOUTS_PER_DAY)
    assert.ok(detailedFeatures)
    assert.equal(
      detailedFeatures.every(
        (feature) => feature.splits.length === WEARABLE_ACTIVITY_MAX_SPLITS_PER_WORKOUT,
      ),
      true,
    )
    assert.deepEqual(
      detailedFeatures.map((feature) => feature.startedAt),
      Array.from(
        { length: WEARABLE_ACTIVITY_MAX_WORKOUTS_PER_DAY },
        (_, index) => new Date(
          Date.parse('2026-08-31T00:00:00.000Z') + index * 30 * 60_000,
        ).toISOString(),
      ),
    )
    assert.deepEqual(detailedFeatures[0], {
      activityType: 'running',
      averageCadence: 90,
      averageHeartRate: 140,
      averagePowerWatts: 220,
      averageSpeedMps: 5,
      cadenceUnit: 'steps-per-minute',
      distanceKm: 5,
      durationMinutes: 30,
      firstHalfAverageHeartRate: 135,
      maxCadence: 105,
      maxHeartRate: 170,
      maxPowerWatts: 300,
      maxSpeedMps: 8,
      provider: 'garmin',
      secondHalfAverageHeartRate: 145,
      splits: detailedFeatures[0]?.splits,
      startedAt: '2026-08-31T00:00:00.000Z',
    })
    assert.deepEqual(detailedFeatures[0]?.splits[0], {
      averageCadence: 88,
      averageHeartRate: 130,
      averagePowerWatts: 200,
      cadenceUnit: 'steps-per-minute',
      distanceMeters: 100,
      durationSeconds: 20,
      endedAt: '2026-08-31T00:00:20.000Z',
      index: 1,
    })
    assert.deepEqual(
      detailedFeatures[0]?.splits.map((split) => split.index),
      Array.from(
        { length: WEARABLE_ACTIVITY_MAX_SPLITS_PER_WORKOUT },
        (_, index) => index + 1,
      ),
    )

    const typicalCompactRaw = await runBudgetedRawCli(
      cli,
      ['wearables', 'activity', 'list', '--date', '2026-08-30'],
      vaultRoot,
    )
    const typicalDetailedRaw = await runBudgetedRawCli(
      cli,
      [
        'wearables',
        'activity',
        'list',
        '--date',
        '2026-08-30',
        '--include-workout-details',
      ],
      vaultRoot,
    )
    const typicalCompact = JSON.parse(typicalCompactRaw) as typeof compact
    const typicalDetailed = JSON.parse(typicalDetailedRaw) as typeof detailed
    assert.equal(typicalCompact.data.items[0]?.sessionCount?.value, 2)
    assert.equal(Object.hasOwn(typicalCompact.data.items[0] ?? {}, 'workoutFeatures'), false)
    assert.equal(typicalDetailed.data.items[0]?.workoutFeatures?.length, 2)
    assert.equal(
      typicalDetailed.data.items[0]?.workoutFeatures?.every(
        (feature) => feature.splits.length === 2,
      ),
      true,
    )

    const emptyRaw = await runBudgetedRawCli(
      cli,
      ['wearables', 'activity', 'list', '--date', '2026-08-29'],
      vaultRoot,
    )
    const empty = JSON.parse(emptyRaw) as typeof compact
    assert.equal(empty.data.count, 0)
    assert.deepEqual(empty.data.items, [])

    const rangeCompactRaw = await runBudgetedRawCli(
      cli,
      [
        'wearables',
        'activity',
        'list',
        '--from',
        '2026-08-30',
        '--to',
        '2026-08-31',
        '--limit',
        '2',
      ],
      vaultRoot,
    )
    const rangeDetailedRaw = await runBudgetedRawCli(
      cli,
      [
        'wearables',
        'activity',
        'list',
        '--from',
        '2026-08-30',
        '--to',
        '2026-08-31',
        '--limit',
        '2',
        '--include-workout-details',
      ],
      vaultRoot,
    )
    const rangeCompact = JSON.parse(rangeCompactRaw) as typeof compact
    const rangeDetailed = JSON.parse(rangeDetailedRaw) as typeof detailed
    assert.deepEqual(rangeCompact.data.filters, {
      date: null,
      from: '2026-08-30',
      to: '2026-08-31',
      providers: [],
      limit: 2,
    })
    assert.equal(rangeCompact.data.count, 2)
    assert.deepEqual(
      rangeDetailed.data.items.map((item) => item.date),
      rangeCompact.data.items.map((item) => item.date),
    )
    assert.equal(
      rangeCompact.data.items.every((item) => !Object.hasOwn(item, 'workoutFeatures')),
      true,
    )
    assert.equal(
      rangeDetailed.data.items.every((item) => Object.hasOwn(item, 'workoutFeatures')),
      true,
    )
    const limitOneRaw = await runBudgetedRawCli(
      cli,
      [
        'wearables',
        'activity',
        'list',
        '--from',
        '2026-08-30',
        '--to',
        '2026-08-31',
        '--limit',
        '1',
      ],
      vaultRoot,
    )
    const limitOne = JSON.parse(limitOneRaw) as typeof compact
    assert.equal(limitOne.data.count, 1)
    assert.equal(limitOne.data.filters.limit, 1)
    assert.equal(limitOne.data.items[0]?.date, rangeCompact.data.items[0]?.date)

    const compactBytes = Buffer.byteLength(compactRaw, 'utf8')
    const detailedBytes = Buffer.byteLength(detailedRaw, 'utf8')
    assert.ok(
      compactBytes <= WEARABLE_ACTIVITY_COMPACT_MAX_BYTES,
      `wearables activity compact result emitted ${compactBytes} bytes, expected <= ${WEARABLE_ACTIVITY_COMPACT_MAX_BYTES}`,
    )
    assert.ok(
      compactBytes < WEARABLE_ACTIVITY_OVERSIZED_BASELINE_BYTES,
      `wearables activity compact result emitted ${compactBytes} bytes, expected < ${WEARABLE_ACTIVITY_OVERSIZED_BASELINE_BYTES}`,
    )
    assert.ok(
      detailedBytes > compactBytes * 20,
      `explicit workout detail emitted ${detailedBytes} bytes versus ${compactBytes} compact bytes`,
    )
    process.stdout.write(
      `[wearables-activity-result-bytes] ${JSON.stringify({
        baselineBytes: WEARABLE_ACTIVITY_OVERSIZED_BASELINE_BYTES,
        compactBytes,
        detailedBytes,
        savedBytesVsBaseline: WEARABLE_ACTIVITY_OVERSIZED_BASELINE_BYTES - compactBytes,
      })}\n`,
    )
  } finally {
    await rm(vaultRoot, {
      force: true,
      recursive: true,
    })
  }
}, OUTPUT_BUDGET_TIMEOUT_MS)

test('workout list uses the compact default page size for oversized records', async () => {
  const cli = createVaultCli()
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-output-budget-'))
  const longSummary = `Easy run ${'with detailed notes '.repeat(120)}`

  try {
    assertOk('init', await runBudgetedRawCli(cli, ['init'], vaultRoot))
    for (let index = 0; index < 6; index += 1) {
      assertOk(
        `workout add ${index}`,
        await runBudgetedRawCli(
          cli,
          [
            'workout',
            'add',
            `${longSummary}${index}`,
            '--duration',
            '30',
            '--occurred-at',
            `2026-04-${String(index + 1).padStart(2, '0')}T07:00:00.000Z`,
          ],
          vaultRoot,
        ),
      )
    }

    const rawList = await runBudgetedRawCli(cli, ['workout', 'list'], vaultRoot)
    const list = JSON.parse(rawList) as {
      ok: true
      data: {
        filters: {
          limit: number
        }
        items: unknown[]
      }
    }

    assert.equal(list.ok, true)
    assertWithinBudget('workout list', rawList)
    assert.equal(list.data.filters.limit, 5)
    assert.equal(list.data.items.length, 5)
  } finally {
    await rm(vaultRoot, {
      force: true,
      recursive: true,
    })
  }
}, OUTPUT_BUDGET_TIMEOUT_MS)
