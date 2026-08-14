import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER } from "@murphai/contracts";
import {
  getHostedVaultShareDailyMetricProjectionSpec,
} from "@murphai/hosted-execution/vault-share";
import {
  ID_PREFIXES,
  deterministicContractId,
  findEventByExternalRef,
  initializeVault,
  upsertEvent,
  updateVaultSummary,
} from "@murphai/core";
import {
  buildHostedExecutionDailyMetricReportedWake,
} from "@murphai/hosted-execution";
import {
  listMetricPointsBatch,
  rebuildQueryProjection,
  selectAuthoritativeMetricPoint,
} from "@murphai/query";

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
      qualifiers: { [HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER]: "1" },
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

  it.each([
    {
      firstObservedAt: "2026-08-13T19:00:00.000Z",
      firstReportedAt: REPORTED_AT,
      firstTimeZone: "America/Los_Angeles",
      label: "equal report times from west to east",
      secondObservedAt: "2026-08-13T16:00:00.000Z",
      secondReportedAt: REPORTED_AT,
      secondTimeZone: "America/New_York",
    },
    {
      firstObservedAt: "2026-08-13T16:00:00.000Z",
      firstReportedAt: REPORTED_AT,
      firstTimeZone: "America/New_York",
      label: "unequal report times from east to west",
      secondObservedAt: "2026-08-13T19:00:00.000Z",
      secondReportedAt: "2026-08-13T18:00:01.000Z",
      secondTimeZone: "America/Los_Angeles",
    },
  ])("uses mailbox causal order across $label while preserving device evidence", async ({
    firstObservedAt,
    firstReportedAt,
    firstTimeZone,
    secondObservedAt,
    secondReportedAt,
    secondTimeZone,
  }) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-13T20:00:00.000Z"));
    const vaultRoot = await createTestVault(firstTimeZone);
    await upsertEvent({
      payload: {
        dayKey: "2026-08-13",
        externalRef: {
          resourceId: "garmin-steps-2026-08-13",
          resourceType: "daily-summary",
          system: "garmin",
        },
        id: deterministicContractId(
          ID_PREFIXES.event,
          "device-steps-equal-time-corrections",
        ),
        kind: "observation",
        metric: "steps",
        observationGrain: "summary",
        occurredAt: "2026-08-13T12:00:00.000Z",
        recordedAt: "2026-08-13T17:00:00.000Z",
        source: "device",
        title: "Garmin steps",
        unit: "count",
        value: 7_500,
      },
      vaultRoot,
    });

    const olderReportId = "daily-metric:report:steps:older-0";
    const newerReportId = "daily-metric:report:steps:newer-8";
    const olderItem = createMailboxItem({
      causalSeq: "41",
      occurredAt: firstReportedAt,
      reportId: olderReportId,
    });
    await expect(importHostedReportedDailyMetricMailboxItem({
      item: olderItem,
      vaultRoot,
      wake: createWake(8_000, olderReportId, firstReportedAt),
    })).resolves.toMatchObject({ status: "imported" });

    await updateVaultSummary({ vaultRoot, timezone: secondTimeZone });
    const newerItem = createMailboxItem({
      causalSeq: "42",
      occurredAt: secondReportedAt,
      reportId: newerReportId,
    });
    await expect(importHostedReportedDailyMetricMailboxItem({
      item: newerItem,
      vaultRoot,
      wake: createWake(9_000, newerReportId, secondReportedAt),
    })).resolves.toMatchObject({ status: "imported" });

    await expect(findEventByExternalRef({
      resourceId: olderReportId,
      resourceType: "daily-metric-report",
      system: "manual",
      vaultRoot,
    })).resolves.toMatchObject({
      occurredAt: firstObservedAt,
      qualifiers: { [HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER]: "41" },
      recordedAt: firstReportedAt,
      value: 8_000,
    });
    await expect(findEventByExternalRef({
      resourceId: newerReportId,
      resourceType: "daily-metric-report",
      system: "manual",
      vaultRoot,
    })).resolves.toMatchObject({
      occurredAt: secondObservedAt,
      qualifiers: { [HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER]: "42" },
      recordedAt: secondReportedAt,
      value: 9_000,
    });

    const points = await listMetricPointsBatch(vaultRoot, [{
      from: "2026-08-13",
      limit: null,
      metricKey: "steps",
    }]);
    const olderPoint = points.find((point) => point.context.causalSeq === "41");
    const newerPoint = points.find((point) => point.context.causalSeq === "42");
    expect(olderPoint).toBeDefined();
    expect(newerPoint).toBeDefined();
    expect(olderPoint?.context.causalSeq).toBe("41");
    expect(olderPoint?.observedAt).toBe(firstObservedAt);
    expect(olderPoint?.recordedAt).toBe(firstReportedAt);
    expect(newerPoint?.context.causalSeq).toBe("42");
    expect(newerPoint?.observedAt).toBe(secondObservedAt);
    expect(newerPoint?.recordedAt).toBe(secondReportedAt);
    expect(selectAuthoritativeMetricPoint(
      points.filter((point) => point.context.causalSeq),
    )?.value).toBe(9_000);

    const stepsSpec = getHostedVaultShareDailyMetricProjectionSpec("steps-days.v0");
    if (!stepsSpec) {
      throw new Error("Expected the steps projection spec.");
    }
    const expectedProjection = expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ value: 9_000 }),
        recordKey: "2026-08-13.manual",
        source: { label: "Manual", source: "manual" },
      }),
      expect.objectContaining({
        data: expect.objectContaining({ value: 7_500 }),
        recordKey: "2026-08-13.garmin",
        source: { label: "Garmin", source: "garmin" },
      }),
    ]);
    await expect(readProjectableDailyMetricDays(vaultRoot, stepsSpec))
      .resolves.toEqual(expectedProjection);

    await rebuildQueryProjection(vaultRoot);
    await expect(readProjectableDailyMetricDays(vaultRoot, stepsSpec))
      .resolves.toEqual(expectedProjection);
    await expect(importHostedReportedDailyMetricMailboxItem({
      item: olderItem,
      vaultRoot,
      wake: createWake(8_000, olderReportId, firstReportedAt),
    })).resolves.toMatchObject({ status: "imported" });
    const replayedPoints = await listMetricPointsBatch(vaultRoot, [{
      from: "2026-08-13",
      limit: null,
      metricKey: "steps",
    }]);
    expect(replayedPoints.filter((point) => point.context.causalSeq)).toHaveLength(2);
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

  it("rejects a report without its owned mailbox causal sequence", async () => {
    const vaultRoot = await createTestVault("UTC");
    const item = createMailboxItem();
    delete item.item.causalSeq;

    await expect(importHostedReportedDailyMetricMailboxItem({
      item,
      vaultRoot,
      wake: createWake(8_000),
    })).resolves.toEqual({
      reasonCode: "daily_metric_report.causal_seq_invalid",
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

function createWake(
  value: number,
  eventId = REPORT_ID,
  occurredAt = REPORTED_AT,
) {
  return buildHostedExecutionDailyMetricReportedWake({
    date: "2026-08-13",
    eventId,
    memberId: "member_synthetic_001",
    metric: "steps",
    occurredAt,
    unit: "count",
    value,
  });
}

function createMailboxItem(input: {
  causalSeq?: string;
  occurredAt?: string;
  reportId?: string;
} = {}): HostedMailboxResolvedImportItem {
  const causalSeq = input.causalSeq ?? "1";
  const occurredAt = input.occurredAt ?? REPORTED_AT;
  const reportId = input.reportId ?? REPORT_ID;
  return {
    item: {
      causalSeq,
      createdAt: occurredAt,
      dedupeKey: reportId,
      expiresAt: null,
      id: reportId,
      kind: "health.daily-metric.reported",
      lane: "system",
      laneSeq: causalSeq,
      occurredAt,
      payloadBytes: 256,
      payloadInlineCiphertext: "ciphertext_synthetic_inline",
      payloadRef: null,
      payloadSchema: "murph.hosted-mailbox-item.v1",
      updatedAt: occurredAt,
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
        id: reportId,
        kind: "health.daily-metric.reported",
        lane: "system",
        laneSeq: causalSeq,
      },
      state: "route",
    },
  };
}
