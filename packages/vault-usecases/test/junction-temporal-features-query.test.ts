import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as coreRuntime from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { listMetricPoints, rebuildQueryProjection } from "@murphai/query";
import { expect, test } from "vitest";

const TEMPORAL_METRICS = [
  "spo2-samples-below-90-percent",
  "spo2-below-90-run-count",
  "spo2-longest-below-90-sample-count",
  "stress-above-daily-mean-run-count",
  "stress-mean-absolute-successive-difference",
  "stress-evening-minus-morning-score",
] as const;

function junctionSnapshot(input: {
  importedAt: string;
  timeseries: Record<string, unknown>;
}) {
  return {
    accountId: "junction-account-hash-1",
    importedAt: input.importedAt,
    timeseries: input.timeseries,
  };
}

async function importJunction(
  vaultRoot: string,
  snapshot: unknown,
  completeSourceDay?: {
    dayKey: string;
    resources: readonly string[];
    revisionAt: string;
  },
): Promise<void> {
  await importDeviceProviderSnapshot(
    {
      completeSourceDay: completeSourceDay
        ? {
            ...completeSourceDay,
            connectionId: "junction-connection-1",
            timeZone: "America/Chicago",
          }
        : undefined,
      deliveryMode: "scheduled_reconcile",
      provider: "junction",
      snapshot,
      sourceKind: "poll",
      vaultRoot,
    },
    { corePort: coreRuntime },
  );
}

async function metricPoints(vaultRoot: string) {
  await rebuildQueryProjection(vaultRoot);
  return listMetricPoints(vaultRoot, { limit: null });
}

function offsetStressRows() {
  return [
    { timestamp: "2026-04-22T12:00:00Z", timezone_offset: -18_000, value: 20 },
    { timestamp: "2026-04-22T12:05:00Z", timezone_offset: -18_000, value: 30 },
    { timestamp: "2026-04-23T00:00:00Z", timezone_offset: -18_000, value: 70 },
    { timestamp: "2026-04-23T00:05:00Z", timezone_offset: -18_000, value: 80 },
  ];
}

function groupedTimeseries(resource: string, rows: readonly Record<string, unknown>[]) {
  return {
    [resource]: {
      groups: {
        garmin: [{
          data: rows,
          source: { provider: "garmin", type: "watch" },
        }],
      },
    },
  };
}

test("precise Junction partitions never publish temporal facts before the complete vault-local source-day owner", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "junction-temporal-partitions-"));
  const rows = offsetStressRows();
  const chunks = [rows.slice(0, 2), rows.slice(2)];
  const signatures: unknown[] = [];

  try {
    for (const [index, order] of [[0, 1], [1, 0], []].entries()) {
      const vaultRoot = path.join(parentRoot, `vault-${index}`);
      await coreRuntime.initializeVault({
        createdAt: "2026-04-22T00:00:00.000Z",
        timezone: "America/Chicago",
        vaultRoot,
      });

      for (const chunkIndex of order) {
        const chunk = chunks[chunkIndex];
        expect(chunk).toBeDefined();
        await importJunction(vaultRoot, junctionSnapshot({
          importedAt: "2026-04-23T12:00:00.000Z",
          timeseries: groupedTimeseries("stress_level", chunk ?? []),
        }));
      }
      if (order.length > 0) {
        await importJunction(vaultRoot, junctionSnapshot({
          importedAt: "2026-04-23T12:00:00.000Z",
          timeseries: groupedTimeseries("stress_level", chunks[order[0] ?? 0] ?? []),
        }));
      }

      const partialPoints = await metricPoints(vaultRoot);
      expect(partialPoints.some((point) =>
        TEMPORAL_METRICS.includes(point.metricKey as typeof TEMPORAL_METRICS[number])
      )).toBe(false);
      expect(partialPoints.some((point) => point.metricKey === "stress-level"))
        .toBe(order.length > 0);

      await importJunction(vaultRoot, junctionSnapshot({
        importedAt: "2026-04-24T12:00:00.000Z",
        timeseries: groupedTimeseries("stress_level", rows),
      }), {
        dayKey: "2026-04-22",
        resources: ["stress_level"],
        revisionAt: "2026-04-24T12:00:00.000Z",
      });

      const completePoints = await metricPoints(vaultRoot);
      // The complete-source-day import is facet-only, so the ordinary
      // stress-level fact exists only when a preceding ordinary partition
      // published it, and its value stays owned by that ordinary import.
      expect(completePoints.some((point) => point.metricKey === "stress-level"))
        .toBe(order.length > 0);
      const temporal = completePoints
        .filter((point) => TEMPORAL_METRICS.includes(
          point.metricKey as typeof TEMPORAL_METRICS[number],
        ))
        .map((point) => ({
          confidence: point.confidence,
          context: point.context.qualifiers,
          effectiveDate: point.effectiveDate,
          metricKey: point.metricKey,
          value: point.value,
        }))
        .sort((left, right) => left.metricKey.localeCompare(right.metricKey));
      signatures.push(temporal);

      expect(temporal).toHaveLength(3);
      expect(temporal.map((point) => point.effectiveDate)).toEqual([
        "2026-04-22",
        "2026-04-22",
        "2026-04-22",
      ]);
      expect(temporal.find((point) =>
        point.metricKey === "stress-mean-absolute-successive-difference"
      )).toMatchObject({ confidence: "medium", value: 10 });
      expect(temporal.find((point) =>
        point.metricKey === "stress-evening-minus-morning-score"
      )).toMatchObject({ confidence: "medium", value: 50 });
      for (const point of temporal) {
        expect(Object.values(point.context ?? {}).every((value) =>
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        )).toBe(true);
        expect(JSON.stringify(point.context)).not.toMatch(/timestamp|samples|recordedAt|observedAt/iu);
      }
    }

    expect(signatures[1]).toEqual(signatures[0]);
    expect(signatures[2]).toEqual(signatures[0]);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("complete Junction source-day retries retract stale facets after insufficient replacements and reject over-bound days", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "junction-temporal-replacement-"));
  const vaultRoot = path.join(parentRoot, "vault");
  const dayKey = "2026-04-22";
  const bloodOxygenRows = [
    { timestamp: "2026-04-22T07:00:00Z", unit: "percent", value: 88 },
    { timestamp: "2026-04-22T07:01:00Z", unit: "percent", value: 88 },
    { timestamp: "2026-04-22T07:02:00Z", unit: "percent", value: 95 },
  ];
  const completeSnapshot = (
    rows: readonly Record<string, unknown>[],
    revisionAt: string,
  ) => junctionSnapshot({
    importedAt: revisionAt,
    timeseries: groupedTimeseries("blood_oxygen", rows),
  });
  const pointsFor = async (metrics: readonly string[]) => {
    const points = await metricPoints(vaultRoot);
    return points.filter((point) => metrics.includes(point.metricKey));
  };

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "America/Chicago",
      vaultRoot,
    });

    await importJunction(vaultRoot, junctionSnapshot({
      importedAt: "2026-04-24T11:00:00.000Z",
      timeseries: {
        ...groupedTimeseries("blood_oxygen", bloodOxygenRows),
        ...groupedTimeseries("stress_level", offsetStressRows()),
      },
    }));
    expect(await pointsFor(["spo2", "lowest-spo2"])).toHaveLength(2);
    expect(await pointsFor(TEMPORAL_METRICS)).toHaveLength(0);

    await importJunction(
      vaultRoot,
      completeSnapshot(bloodOxygenRows, "2026-04-24T12:00:00.000Z"),
      { dayKey, resources: ["blood_oxygen"], revisionAt: "2026-04-24T12:00:00.000Z" },
    );
    expect(await pointsFor(TEMPORAL_METRICS)).toHaveLength(3);

    const insufficient = completeSnapshot(
      [bloodOxygenRows[0] ?? {}],
      "2026-04-24T13:00:00.000Z",
    );
    await importJunction(vaultRoot, insufficient, {
      dayKey,
      resources: ["blood_oxygen"],
      revisionAt: "2026-04-24T13:00:00.000Z",
    });
    await importJunction(vaultRoot, insufficient, {
      dayKey,
      resources: ["blood_oxygen"],
      revisionAt: "2026-04-24T13:00:00.000Z",
    });
    expect(await pointsFor(TEMPORAL_METRICS)).toHaveLength(0);
    expect(await pointsFor(["spo2", "lowest-spo2"])).toHaveLength(2);

    await importJunction(
      vaultRoot,
      completeSnapshot(bloodOxygenRows, "2026-04-24T14:00:00.000Z"),
      { dayKey, resources: ["blood_oxygen"], revisionAt: "2026-04-24T14:00:00.000Z" },
    );
    expect(await pointsFor(TEMPORAL_METRICS)).toHaveLength(3);

    const overBoundRows = Array.from({ length: 1_441 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 3, 22, 5) + index * 1_000).toISOString(),
      unit: "percent",
      value: index % 2 === 0 ? 88 : 95,
    }));
    const overBound = completeSnapshot(overBoundRows, "2026-04-24T15:00:00.000Z");
    await expect(importJunction(vaultRoot, overBound, {
      dayKey,
      resources: ["blood_oxygen"],
      revisionAt: "2026-04-24T15:00:00.000Z",
    })).rejects.toThrow(/maximum admitted is 1440/u);
    expect(await pointsFor(TEMPORAL_METRICS)).toHaveLength(3);
    expect(await pointsFor(["spo2", "lowest-spo2"])).toHaveLength(2);

    await importJunction(vaultRoot, junctionSnapshot({
      importedAt: "2026-04-24T15:30:00.000Z",
      timeseries: groupedTimeseries("stress_level", offsetStressRows()),
    }), { dayKey, resources: ["stress_level"], revisionAt: "2026-04-24T15:30:00.000Z" });
    expect((await pointsFor(TEMPORAL_METRICS)).filter((point) =>
      point.metricKey.startsWith("stress-")
    )).toHaveLength(3);

    const partialStress = junctionSnapshot({
      importedAt: "2026-04-24T15:45:00.000Z",
      timeseries: groupedTimeseries("stress_level", offsetStressRows().slice(0, 2)),
    });
    await importJunction(
      vaultRoot,
      partialStress,
      { dayKey, resources: ["stress_level"], revisionAt: "2026-04-24T15:45:00.000Z" },
    );
    await importJunction(
      vaultRoot,
      partialStress,
      { dayKey, resources: ["stress_level"], revisionAt: "2026-04-24T15:45:00.000Z" },
    );
    const partialStressPoints = (await pointsFor(TEMPORAL_METRICS)).filter((point) =>
      point.metricKey.startsWith("stress-")
    );
    expect(partialStressPoints.map((point) => point.metricKey).sort()).toEqual([
      "stress-above-daily-mean-run-count",
      "stress-mean-absolute-successive-difference",
    ]);

    await importJunction(vaultRoot, junctionSnapshot({
      importedAt: "2026-04-24T15:50:00.000Z",
      timeseries: groupedTimeseries("stress_level", offsetStressRows()),
    }), { dayKey, resources: ["stress_level"], revisionAt: "2026-04-24T15:50:00.000Z" });
    expect((await pointsFor(TEMPORAL_METRICS)).filter((point) =>
      point.metricKey.startsWith("stress-")
    )).toHaveLength(3);

    await importJunction(vaultRoot, junctionSnapshot({
      importedAt: "2026-04-24T16:00:00.000Z",
      timeseries: {
        blood_oxygen: {
          groups: Object.fromEntries(["fitbit", "oura", "polar"].map((provider) => [
            provider,
            [{
              data: bloodOxygenRows,
              source: { provider, type: "wearable" },
            }],
          ])),
        },
        stress_level: groupedTimeseries("stress_level", offsetStressRows()).stress_level,
      },
    }), {
      dayKey,
      resources: ["blood_oxygen", "stress_level"],
      revisionAt: "2026-04-24T16:00:00.000Z",
    });
    const finalPoints = await metricPoints(vaultRoot);
    const finalTemporalPoints = finalPoints.filter((point) =>
      TEMPORAL_METRICS.includes(point.metricKey as typeof TEMPORAL_METRICS[number])
    );
    expect(finalPoints.some((point) => point.metricKey === "stress-level")).toBe(true);
    expect(finalTemporalPoints.some((point) => point.metricKey.startsWith("stress-"))).toBe(false);
    expect(finalTemporalPoints.filter((point) => point.metricKey.startsWith("spo2-")).length).toBe(9);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("disconnected Junction readings leave canonical continuity facets invariant across authoritative replay", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "junction-temporal-disconnected-"));
  const vaultRoot = path.join(parentRoot, "vault");
  const dayKey = "2026-04-22";
  const connectedRows = {
    blood_oxygen: [
      { timestamp: "2026-04-22T06:00:00Z", unit: "%", value: 88 },
      { timestamp: "2026-04-22T06:01:00Z", unit: "%", value: 88 },
      { timestamp: "2026-04-22T06:04:00Z", unit: "%", value: 88 },
      { timestamp: "2026-04-22T06:05:00Z", unit: "%", value: 88 },
      { timestamp: "2026-04-22T20:00:00Z", unit: "%", value: 95 },
      { timestamp: "2026-04-22T20:01:00Z", unit: "%", value: 95 },
    ],
    stress_level: [
      { timestamp: "2026-04-22T11:00:00Z", value: 20 },
      { timestamp: "2026-04-22T11:01:00Z", value: 30 },
      { timestamp: "2026-04-22T11:02:00Z", value: 30 },
      { timestamp: "2026-04-22T11:03:00Z", value: 20 },
      { timestamp: "2026-04-23T01:00:00Z", value: 20 },
      { timestamp: "2026-04-23T01:01:00Z", value: 20 },
    ],
  };
  const disconnectedRows = {
    blood_oxygen: [
      ...connectedRows.blood_oxygen,
      { timestamp: "2026-04-22T10:00:00Z", unit: "%", value: 80 },
      { timestamp: "2026-04-22T15:00:00Z", unit: "%", value: 99 },
    ],
    stress_level: [
      ...connectedRows.stress_level,
      { timestamp: "2026-04-22T15:00:00Z", value: 0 },
      { timestamp: "2026-04-22T20:00:00Z", value: 100 },
    ],
  };
  const importDay = async (
    rows: typeof connectedRows,
    revisionAt: string,
  ): Promise<void> => {
    await importJunction(vaultRoot, junctionSnapshot({
      importedAt: revisionAt,
      timeseries: {
        ...groupedTimeseries("blood_oxygen", rows.blood_oxygen),
        ...groupedTimeseries("stress_level", rows.stress_level),
      },
    }), {
      dayKey,
      resources: ["blood_oxygen", "stress_level"],
      revisionAt,
    });
  };
  const readTemporalQuerySignature = async () => (await metricPoints(vaultRoot))
    .filter((point) =>
      point.effectiveDate === dayKey
      && TEMPORAL_METRICS.includes(point.metricKey as typeof TEMPORAL_METRICS[number])
    )
    .map((point) => ({
      confidence: point.confidence,
      effectiveDate: point.effectiveDate,
      metricKey: point.metricKey,
      qualifiers: point.context.qualifiers ?? {},
      unit: point.unit,
      value: point.value,
    }))
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey));
  const ledgerPath = path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl");

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "America/Chicago",
      vaultRoot,
    });

    await importDay(connectedRows, "2026-04-24T12:00:00.000Z");
    const connected = await readTemporalQuerySignature();
    const connectedContinuity = connected.filter((point) =>
      point.metricKey !== "spo2-samples-below-90-percent"
    );
    const connectedBurden = connected.find((point) =>
      point.metricKey === "spo2-samples-below-90-percent"
    );
    expect(connected).toHaveLength(6);
    expect(connectedBurden).toMatchObject({
      qualifiers: { sampleCount: 6, thresholdSampleCount: 4 },
      value: 66.6667,
    });
    expect(connected.find((point) =>
      point.metricKey === "spo2-longest-below-90-sample-count"
    )).toMatchObject({ qualifiers: { sampleIntervalSeconds: 60 }, value: 2 });
    expect(connected.find((point) =>
      point.metricKey === "stress-above-daily-mean-run-count"
    )).toMatchObject({ qualifiers: { sampleCount: 6 }, value: 1 });

    await importDay(disconnectedRows, "2026-04-24T13:00:00.000Z");
    const disconnected = await readTemporalQuerySignature();
    const disconnectedContinuity = disconnected.filter((point) =>
      point.metricKey !== "spo2-samples-below-90-percent"
    );
    const disconnectedBurden = disconnected.find((point) =>
      point.metricKey === "spo2-samples-below-90-percent"
    );
    expect(disconnectedContinuity).toEqual(connectedContinuity);
    expect(disconnectedBurden).toMatchObject({
      qualifiers: { sampleCount: 8, thresholdSampleCount: 5 },
      value: 62.5,
    });

    const ledgerBeforeReplay = await readFile(ledgerPath, "utf8");
    await importDay(disconnectedRows, "2026-04-24T14:00:00.000Z");
    expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBeforeReplay);
    expect(await readTemporalQuerySignature()).toEqual(disconnected);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
