import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as coreRuntime from "@murphai/core"
import { importDeviceProviderSnapshot } from "@murphai/importers"
import {
  JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
  reduceJunctionWorkoutStreamPayload,
} from "@murphai/importers/device-providers/junction-bounded-features"
import { expect, test } from "vitest"

import { createIntegratedVaultServices } from "../src/vault-services.js"

function workoutFeature(input: {
  id: string
  sport: string
  startAt: string
  endAt: string
  averageHeartRate: number
  splits: readonly Record<string, unknown>[]
  version: string
}) {
  return {
    schema: JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
    id: input.id,
    workoutId: input.id,
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "watch-primary",
    version: input.version,
    sport: input.sport,
    startAt: input.startAt,
    endAt: input.endAt,
    durationSeconds: 1_800,
    distanceMeters: 5_000,
    averageHeartRate: input.averageHeartRate,
    maxHeartRate: input.averageHeartRate + 30,
    firstHalfAverageHeartRate: input.averageHeartRate - 5,
    secondHalfAverageHeartRate: input.averageHeartRate + 5,
    averageCadence: 90,
    maxCadence: 105,
    cadenceUnit: input.sport === "cycling" ? "rpm" : "steps-per-minute",
    averagePower: 220,
    maxPower: 300,
    averageSpeed: 5,
    maxSpeed: 8,
    sampleCount: 1_000,
    splits: input.splits,
  }
}

test("wearables activity list associates corrected Junction features with same-day workouts", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "junction-workout-features-query-"))
  const vaultRoot = path.join(parentRoot, "vault")

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-08-15T00:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    })
    const firstSplit = {
      index: 1,
      distanceMeters: 1_000,
      durationSeconds: 300,
      endedAt: "2026-08-15T06:05:00.000Z",
      averageHeartRate: 135,
      averageCadence: 92,
      cadenceUnit: "steps-per-minute",
      averagePower: 225,
    }
    const secondSplit = {
      ...firstSplit,
      endedAt: "2026-08-15T18:05:00.000Z",
      cadenceUnit: "rpm",
    }
    await importDeviceProviderSnapshot(
      {
        provider: "junction",
        sourceKind: "poll",
        deliveryMode: "scheduled_reconcile",
        vaultRoot,
        snapshot: {
          importedAt: "2026-08-15T20:00:00.000Z",
          summaries: {
            workouts: [{
              id: "workout-morning",
              sourceProviderSlug: "garmin",
              sourceType: "watch",
              sourceInstanceId: "watch-primary",
              startAt: "2026-08-15T06:00:00.000Z",
              endAt: "2026-08-15T06:30:00.000Z",
              sport: "running",
            }, {
              id: "workout-evening",
              sourceProviderSlug: "garmin",
              sourceType: "watch",
              sourceInstanceId: "watch-primary",
              startAt: "2026-08-15T18:00:00.000Z",
              endAt: "2026-08-15T18:30:00.000Z",
              sport: "cycling",
            }],
          },
          timeseries: {
            workout_stream: [
              workoutFeature({
                id: "workout-morning",
                sport: "running",
                startAt: "2026-08-15T06:00:00.000Z",
                endAt: "2026-08-15T06:30:00.000Z",
                averageHeartRate: 140,
                splits: [firstSplit],
                version: "2026-08-15T20:00:00.000Z",
              }),
              workoutFeature({
                id: "workout-evening",
                sport: "cycling",
                startAt: "2026-08-15T18:00:00.000Z",
                endAt: "2026-08-15T18:30:00.000Z",
                averageHeartRate: 150,
                splits: [secondSplit],
                version: "2026-08-15T20:00:00.000Z",
              }),
            ],
          },
        },
      },
      { corePort: coreRuntime },
    )

    await importDeviceProviderSnapshot(
      {
        provider: "junction",
        sourceKind: "poll",
        deliveryMode: "scheduled_reconcile",
        vaultRoot,
        snapshot: {
          importedAt: "2026-08-15T21:00:00.000Z",
          timeseries: {
            workout_stream: [workoutFeature({
              id: "workout-morning",
              sport: "running",
              startAt: "2026-08-15T06:00:00.000Z",
              endAt: "2026-08-15T06:30:00.000Z",
              averageHeartRate: 142,
              splits: [],
              version: "2026-08-15T21:00:00.000Z",
            })],
          },
        },
      },
      { corePort: coreRuntime },
    )

    const afterCorrection = await createIntegratedVaultServices().query.listWearableActivity({
      vault: vaultRoot,
      requestId: null,
      date: "2026-08-15",
      limit: 10,
    })
    expect(afterCorrection.items[0]?.workoutFeatures).toEqual([
      expect.objectContaining({
        activityType: "running",
        averageHeartRate: 142,
        provider: "garmin",
        splits: [],
        startedAt: "2026-08-15T06:00:00.000Z",
      }),
      expect.objectContaining({
        activityType: "cycling",
        averageHeartRate: 150,
        averagePowerWatts: 220,
        averageSpeedMps: 5,
        provider: "garmin",
        splits: [expect.objectContaining({
          averagePowerWatts: 225,
          index: 1,
        })],
        startedAt: "2026-08-15T18:00:00.000Z",
      }),
    ])
    expect(JSON.stringify(afterCorrection)).not.toContain("workout-morning")
    expect(JSON.stringify(afterCorrection)).not.toContain("watch-primary")
    expect(JSON.stringify(afterCorrection)).not.toContain("\"averagePower\":")
    expect(JSON.stringify(afterCorrection)).not.toContain("\"averageSpeed\":")
  } finally {
    await rm(parentRoot, { recursive: true, force: true })
  }
})

test("wearables activity list preserves provider and vault-local workout days", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "junction-workout-local-days-"))
  const vaultRoot = path.join(parentRoot, "vault")

  const offsetSummary = {
    id: "workout-offset",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "watch-private",
    sport: "running",
    startAt: "2026-08-15T23:30:00-05:00",
    endAt: "2026-08-16T00:00:00-05:00",
    updated_at: "2026-08-16T06:00:00.000Z",
  }
  const explicitCalendarSummary = {
    id: "workout-explicit-calendar",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "watch-private",
    sport: "cycling",
    calendar_date: "2026-08-14",
    startAt: "2026-08-15T04:30:00.000Z",
    endAt: "2026-08-15T05:00:00.000Z",
    updated_at: "2026-08-15T06:00:00.000Z",
  }
  const vaultLocalSummary = {
    id: "workout-vault-local",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "watch-private",
    sport: "running",
    startAt: "2026-08-16T02:30:00.000Z",
    endAt: "2026-08-16T03:00:00.000Z",
    updated_at: "2026-08-16T04:00:00.000Z",
  }
  const reduce = (
    summary: Record<string, unknown>,
    endAt: string,
    finalDistance: number,
  ) => reduceJunctionWorkoutStreamPayload({
    maxSamples: 10,
    summary,
    stream: {
      time: [summary.startAt, endAt],
      heart_rate: [130, 150],
      cadence: [88, 92],
      power: [200, 240],
      velocity_smooth: [4, 6],
      distance: [0, finalDistance],
    },
  })
  const offsetFeature = reduce(offsetSummary, offsetSummary.endAt, 1_000)
  const explicitCalendarFeature = reduce(
    explicitCalendarSummary,
    explicitCalendarSummary.endAt,
    1_000,
  )
  const vaultLocalFeature = reduce(vaultLocalSummary, vaultLocalSummary.endAt, 1_000)

  expect(offsetFeature.workoutDayKey).toBe("2026-08-15")
  expect(explicitCalendarFeature.workoutDayKey).toBe("2026-08-14")
  expect(vaultLocalFeature).not.toHaveProperty("workoutDayKey")

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-08-14T00:00:00.000Z",
      timezone: "America/Chicago",
      vaultRoot,
    })
    await importDeviceProviderSnapshot(
      {
        provider: "junction",
        sourceKind: "poll",
        deliveryMode: "scheduled_reconcile",
        vaultRoot,
        snapshot: {
          importedAt: "2026-08-16T07:00:00.000Z",
          summaries: {
            workouts: [
              offsetSummary,
              explicitCalendarSummary,
              vaultLocalSummary,
            ],
          },
          timeseries: {
            workout_stream: [
              offsetFeature,
              explicitCalendarFeature,
              vaultLocalFeature,
            ],
          },
        },
      },
      { corePort: coreRuntime },
    )

    await importDeviceProviderSnapshot(
      {
        provider: "junction",
        sourceKind: "poll",
        deliveryMode: "scheduled_reconcile",
        vaultRoot,
        snapshot: {
          importedAt: "2026-08-16T08:00:00.000Z",
          timeseries: {
            workout_stream: [reduce(
              {
                ...offsetSummary,
                updated_at: "2026-08-16T08:00:00.000Z",
              },
              offsetSummary.endAt,
              500,
            )],
          },
        },
      },
      { corePort: coreRuntime },
    )

    const services = createIntegratedVaultServices().query
    const explicitDay = await services.listWearableActivity({
      vault: vaultRoot,
      requestId: null,
      date: "2026-08-14",
      limit: 10,
    })
    const localDay = await services.listWearableActivity({
      vault: vaultRoot,
      requestId: null,
      date: "2026-08-15",
      limit: 10,
    })
    const adjacentUtcDay = await services.listWearableActivity({
      vault: vaultRoot,
      requestId: null,
      date: "2026-08-16",
      limit: 10,
    })

    expect(explicitDay.items[0]?.sessionCount).toEqual(
      expect.objectContaining({ value: 1 }),
    )
    expect(explicitDay.items[0]?.workoutFeatures).toEqual([
      expect.objectContaining({
        activityType: "cycling",
        averagePowerWatts: 220,
        averageSpeedMps: 5,
        startedAt: "2026-08-15T04:30:00.000Z",
      }),
    ])
    expect(localDay.items[0]?.sessionCount).toEqual(
      expect.objectContaining({ value: 2 }),
    )
    expect(localDay.items[0]?.workoutFeatures).toEqual([
      expect.objectContaining({
        activityType: "running",
        splits: [expect.objectContaining({
          averagePowerWatts: 220,
          index: 1,
        })],
        startedAt: "2026-08-16T02:30:00.000Z",
      }),
      expect.objectContaining({
        activityType: "running",
        splits: [],
        startedAt: "2026-08-16T04:30:00.000Z",
      }),
    ])
    expect(adjacentUtcDay.items).toEqual([])
    const output = JSON.stringify([explicitDay, localDay, adjacentUtcDay])
    expect(output).not.toContain("workout-offset")
    expect(output).not.toContain("workout-explicit-calendar")
    expect(output).not.toContain("workout-vault-local")
    expect(output).not.toContain("watch-private")
  } finally {
    await rm(parentRoot, { recursive: true, force: true })
  }
})
