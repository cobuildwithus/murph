import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deterministicContractId, ID_PREFIXES, initializeVault } from "@murphai/core";
import { addMeasurementDraftRecord, buildMeasurementEventDraft } from "@murphai/vault-usecases/measurements";
import { getHostedVaultShareDailyMetricProjectionSpec } from "@murphai/hosted-execution/vault-share";
import { listMetricPoints, readVault } from "@murphai/query";
import { createBrowserVaultQueryClient, createBrowserVaultReplica, parseBrowserVaultReplica } from "@murphai/query/browser";
import { expect, it, vi } from "vitest";

import { executeHostedMemberActionWake } from "../src/hosted-runtime/events/member-action.ts";
import { readProjectableDailyMetricDays } from "../src/hosted-runtime/vault-share-projection.ts";

it("projects a vault-cli member-reported VO2 write into metric points, shares and private Numbers", async () => {
  const root = await mkdtemp(join(tmpdir(), "murph-reported-vo2-"));
  const vaultRoot = join(root, "vault");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T18:00:00.000Z"));
  try {
    await initializeVault({ vaultRoot, timezone: "America/New_York" });
    // The same draft and write `vault-cli measurement add --metric estimated-vo2-max
    // --value 52 --unit ml/kg/min --source manual --occurred-at 2026-11-04 --note ...`
    // runs (packages/cli/src/commands/measurement.ts), without the built CLI binary.
    const note = "Member-reported VO2 max from WHOOP";
    const receipt = await addMeasurementDraftRecord({
      vault: vaultRoot,
      draft: buildMeasurementEventDraft({
        occurredAt: "2026-11-04T17:00:00.000Z",
        note,
        source: "manual",
        measurements: [{ metric: "estimated-vo2-max", value: 52, unit: "ml/kg/min", note }],
      }),
    });
    expect(receipt).toMatchObject({
      created: true, kind: "measurement", occurredAt: "2026-11-04T17:00:00.000Z",
      note: "Member-reported VO2 max from WHOOP",
      measurements: [{ metric: "estimated-vo2-max", value: 52, unit: "ml/kg/min" }],
    });

    const points = await listMetricPoints(vaultRoot, { metricKey: "estimated-vo2-max", limit: null });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      metricKey: "estimated-vo2-max", effectiveDate: "2026-11-04", grain: "day",
      canonicalValue: 52, canonicalUnit: "mL/kg/min",
      source: { family: "event", kind: "measurement", recordId: receipt.eventId },
      provenance: { provider: null, sourceLabel: "Manual" },
    });
    const spec = getHostedVaultShareDailyMetricProjectionSpec("vo2-max-days.v0")!;
    const records = await readProjectableDailyMetricDays(vaultRoot, spec);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      data: { date: "2026-11-04", metricKey: "estimated-vo2-max", unit: "mL/kg/min", value: 52 },
      recordKey: "2026-11-04.manual", source: { source: "manual", label: "Manual" },
    });
    // Notes and device claims remain private; the share honestly identifies a manual report.
    expect(JSON.stringify(records)).not.toMatch(/WHOOP|Member-reported/);
    const replica = await createBrowserVaultReplica({ vault: await readVault(vaultRoot), metricPoints: points,
      generatedAt: new Date().toISOString(), sourceBundleHash: "f".repeat(64) });
    const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
    expect(client.metrics.series({ metricKey: "estimated-vo2-max", grain: "day",
      from: "2026-08-08", to: "2026-11-05" })).toMatchObject([
      { date: "2026-11-04", value: 52, unit: "mL/kg/min", sourceLabel: "Manual" },
    ]);
  } finally {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  }
});


it.each([
  { reverseIds: false, reverseInput: false }, { reverseIds: true, reverseInput: false },
  { reverseIds: false, reverseInput: true }, { reverseIds: true, reverseInput: true },
])("selects the same newest typed reading for Numbers rows and shared projection %j", async ({ reverseIds, reverseInput }) => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "typed-vo2-order-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T18:00:00.000Z"));
  const ids = ["d8653d1f-fb8d-400b-8efe-d3fbdc9f9830", "2f1c1fdc-c7b0-4d90-b902-8e6295959243"]
    .sort((left, right) => deterministicContractId(ID_PREFIXES.event, `member-action:${left}`)
      .localeCompare(deterministicContractId(ID_PREFIXES.event, `member-action:${right}`)));
  if (reverseIds) ids.reverse();
  const readings = [
    { actionId: ids[0]!, requestedAt: "2026-11-04T12:00:00.000Z", value: 42.5 },
    { actionId: ids[1]!, requestedAt: "2026-11-04T15:00:00.000Z", value: 47.5 },
  ];
  if (reverseInput) readings.reverse();
  try {
    await initializeVault({ vaultRoot, timezone: "America/New_York" });
    for (const { actionId, requestedAt, value } of readings) {
      const result = await executeHostedMemberActionWake({ vaultRoot, wake: {
        eventId: `member.action.requested:${actionId}`, kind: "member.action.requested",
        userId: "member_synthetic", occurredAt: "2026-11-05T17:00:00.000Z",
        request: { actionId, requestedAt, schemaVersion: 1,
          action: { kind: "measurement.add", version: 1, metric: "estimated-vo2-max", value } },
      } });
      expect(result.postCheckpointRecord).toMatchObject({ outcome: { status: "applied" } });
    }
    const points = await listMetricPoints(vaultRoot, { metricKey: "estimated-vo2-max", limit: null });
    expect(points).toHaveLength(2);
    if (reverseInput) points.reverse();
    const replica = await createBrowserVaultReplica({ vault: await readVault(vaultRoot), metricPoints: points,
      generatedAt: new Date().toISOString(), sourceBundleHash: "f".repeat(64) });
    const rows = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica)).metrics.series({
      metricKey: "estimated-vo2-max", grain: "day", from: "2026-11-04", to: "2026-11-04",
    });
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)).toMatchObject({ value: 47.5, observedAt: "2026-11-04T15:00:00.000Z" });
    const shared = await readProjectableDailyMetricDays(vaultRoot, getHostedVaultShareDailyMetricProjectionSpec("vo2-max-days.v0")!);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ source: { source: "manual" }, data: { date: "2026-11-04", value: rows.at(-1)!.value } });
  } finally {
    vi.useRealTimers();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
