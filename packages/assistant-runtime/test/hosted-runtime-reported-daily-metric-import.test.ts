import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getHostedVaultShareDailyMetricProjectionSpec,
} from "@murphai/hosted-execution/vault-share";
import {
  ID_PREFIXES,
  deterministicContractId,
  findEventByExternalRef,
  initializeVault,
  updateVaultSummary,
} from "@murphai/core";
import {
  buildHostedExecutionDailyMetricReportedWake,
} from "@murphai/hosted-execution";

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  importHostedReportedDailyMetricMailboxItem,
} from "../src/hosted-runtime/reported-daily-metric-import.ts";
import {
  readProjectableDailyMetricDays,
} from "../src/hosted-runtime/vault-share-projection.ts";

const REPORTED_AT = "2026-08-13T18:00:00.000Z";
const REPORT_ID = "daily-metric:report:steps";
const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanupPaths.splice(0).map((targetPath) =>
      rm(targetPath, { force: true, recursive: true })
    ),
  );
});

describe("hosted member-reported daily metric import", () => {
  it("writes one idempotent manual daily observation that the share projection preserves", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-13T20:00:00.000Z"));
    const vaultRoot = await createTestVault("Pacific/Kiritimati");
    const item = createMailboxItem();
    const wake = createWake(8_000);

    await expect(importHostedReportedDailyMetricMailboxItem({
      item,
      vaultRoot,
      wake,
    })).resolves.toMatchObject({
      reasonCode: "daily_metric_report.imported",
      status: "imported",
    });
    await expect(importHostedReportedDailyMetricMailboxItem({
      item,
      vaultRoot,
      wake,
    })).resolves.toMatchObject({ status: "imported" });

    const stored = await findEventByExternalRef({
      resourceId: REPORT_ID,
      resourceType: "daily-metric-report",
      system: "manual",
      vaultRoot,
    });
    expect(stored).toMatchObject({
      dayKey: "2026-08-13",
      externalRef: { version: "v1" },
      id: deterministicContractId(
        ID_PREFIXES.event,
        `reported-daily-metric:${REPORT_ID}`,
      ),
      kind: "observation",
      metric: "steps",
      observationGrain: "summary",
      occurredAt: "2026-08-12T22:00:00.000Z",
      queryVisibility: "default",
      recordedAt: REPORTED_AT,
      source: "manual",
      timeZone: "Pacific/Kiritimati",
      unit: "count",
      value: 8_000,
      visibility: "display",
    });

    const stepsSpec = getHostedVaultShareDailyMetricProjectionSpec(
      "steps-days.v0",
    );
    if (!stepsSpec) {
      throw new Error("Expected the steps projection spec.");
    }
    await expect(readProjectableDailyMetricDays(vaultRoot, stepsSpec)).resolves.toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          date: "2026-08-13",
          metricKey: "steps",
          value: 8_000,
        }),
        recordKey: "2026-08-13.manual",
        source: { label: "Manual", source: "manual" },
      }),
    ]);
  });

  it("rejects a replay that changes the reported value", async () => {
    const vaultRoot = await createTestVault("UTC");
    const item = createMailboxItem();
    await importHostedReportedDailyMetricMailboxItem({
      item,
      vaultRoot,
      wake: createWake(8_000),
    });

    await expect(importHostedReportedDailyMetricMailboxItem({
      item,
      vaultRoot,
      wake: createWake(9_000),
    })).resolves.toEqual({
      reasonCode: "daily_metric_report.conflict",
      retryable: false,
      status: "blocked",
    });
  });

  it("replays against the event's original timezone after the vault timezone changes", async () => {
    const vaultRoot = await createTestVault("Pacific/Kiritimati");
    const item = createMailboxItem();
    const wake = createWake(8_000);
    await importHostedReportedDailyMetricMailboxItem({ item, vaultRoot, wake });
    const before = await findEventByExternalRef({
      resourceId: REPORT_ID,
      resourceType: "daily-metric-report",
      system: "manual",
      vaultRoot,
    });

    await updateVaultSummary({ vaultRoot, timezone: "America/Los_Angeles" });

    await expect(importHostedReportedDailyMetricMailboxItem({
      item,
      vaultRoot,
      wake,
    })).resolves.toEqual({
      reasonCode: "daily_metric_report.imported",
      status: "imported",
    });
    const after = await findEventByExternalRef({
      resourceId: REPORT_ID,
      resourceType: "daily-metric-report",
      system: "manual",
      vaultRoot,
    });
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      occurredAt: "2026-08-12T22:00:00.000Z",
      timeZone: "Pacific/Kiritimati",
    });
  });
});

async function createTestVault(timezone: string): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-daily-metric-vault-"));
  cleanupPaths.push(vaultRoot);
  await initializeVault({
    title: "Daily Metric Test Vault",
    timezone,
    vaultRoot,
  });
  return vaultRoot;
}

function createWake(value: number) {
  return buildHostedExecutionDailyMetricReportedWake({
    date: "2026-08-13",
    eventId: REPORT_ID,
    memberId: "member_synthetic_001",
    metric: "steps",
    occurredAt: REPORTED_AT,
    unit: "count",
    value,
  });
}

function createMailboxItem(): HostedMailboxResolvedImportItem {
  return {
    item: {
      createdAt: REPORTED_AT,
      dedupeKey: REPORT_ID,
      expiresAt: null,
      id: REPORT_ID,
      kind: "health.daily-metric.reported",
      lane: "system",
      laneSeq: "1",
      occurredAt: REPORTED_AT,
      payloadBytes: 256,
      payloadInlineCiphertext: "ciphertext_synthetic_inline",
      payloadRef: null,
      payloadSchema: "murph.hosted-mailbox-item.v1",
      updatedAt: REPORTED_AT,
      userId: "member_synthetic_001",
    },
    payload: {
      payloadCiphertext: "ciphertext_synthetic_inline",
      payloadSchema: "murph.hosted-mailbox-item.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "import-reported-daily-metric",
      advanceProgress: true,
      itemRef: {
        id: REPORT_ID,
        kind: "health.daily-metric.reported",
        lane: "system",
        laneSeq: "1",
      },
      state: "route",
    },
  };
}
