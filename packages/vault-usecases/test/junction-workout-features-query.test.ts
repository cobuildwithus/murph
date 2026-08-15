import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as coreRuntime from "@murphai/core"
import { importDeviceProviderSnapshot } from "@murphai/importers"
import { JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA } from "@murphai/importers/device-providers/junction-bounded-features"
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
        provider: "garmin",
        splits: [expect.objectContaining({ index: 1 })],
        startedAt: "2026-08-15T18:00:00.000Z",
      }),
    ])
    expect(JSON.stringify(afterCorrection)).not.toContain("workout-morning")
    expect(JSON.stringify(afterCorrection)).not.toContain("watch-primary")
  } finally {
    await rm(parentRoot, { recursive: true, force: true })
  }
})
