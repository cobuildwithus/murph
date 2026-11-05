import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { initializeVault } from "@murphai/core";
import { getHostedVaultShareDailyMetricProjectionSpec } from "@murphai/hosted-execution/vault-share";
import { listMetricPoints, readVault } from "@murphai/query";
import { createBrowserVaultQueryClient, createBrowserVaultReplica, parseBrowserVaultReplica } from "@murphai/query/browser";
import { expect, it, vi } from "vitest";

import { readProjectableDailyMetricDays } from "../src/hosted-runtime/vault-share-projection.ts";

it("projects a vault-cli member-reported VO2 write into metric points, shares and private Numbers", async () => {
  const root = await mkdtemp(join(tmpdir(), "murph-reported-vo2-"));
  const vaultRoot = join(root, "vault");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T18:00:00.000Z"));
  try {
    await initializeVault({ vaultRoot, timezone: "America/New_York" });
    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url)),
      "measurement", "add", "--vault", vaultRoot,
      "--metric", "estimated-vo2-max", "--value", "52", "--unit", "ml/kg/min",
      "--source", "manual", "--occurred-at", "2026-11-04",
      "--note", "Member-reported VO2 max from WHOOP", "--format", "json",
    ], { encoding: "utf8" });
    const receipt = JSON.parse(stdout);
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
