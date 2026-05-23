import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA } from "../scripts/trigger-legacy-wearable-compaction";

const mocks = vi.hoisted(() => ({
  createHostedLegacyWearableCompactionStore: vi.fn(),
  getPrisma: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  runHostedLegacyWearableCompactionTrigger: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/scripts/trigger-legacy-wearable-compaction", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../scripts/trigger-legacy-wearable-compaction")>();
  return {
    ...actual,
    createHostedLegacyWearableCompactionStore:
      mocks.createHostedLegacyWearableCompactionStore,
    runHostedLegacyWearableCompactionTrigger:
      mocks.runHostedLegacyWearableCompactionTrigger,
  };
});

type LegacyWearableCompactionCronRouteModule = typeof import(
  "../app/api/internal/hosted-workspace/legacy-wearable-compaction/cron/route"
);

let route: LegacyWearableCompactionCronRouteModule;

describe("legacy wearable compaction cron route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-workspace/legacy-wearable-compaction/cron/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.createHostedLegacyWearableCompactionStore.mockReturnValue({
      marker: "store",
    });
    mocks.runHostedLegacyWearableCompactionTrigger.mockResolvedValue(
      buildReport(),
    );
    mocks.getPrisma.mockReturnValue({
      hostedWebInternalRequestNonce: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
  });

  it("requires Vercel cron auth and schedules the one-shot trigger", async () => {
    const response = await route.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace/legacy-wearable-compaction/cron",
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.createHostedLegacyWearableCompactionStore).toHaveBeenCalledWith(
      mocks.getPrisma.mock.results[0]?.value,
    );
    expect(mocks.runHostedLegacyWearableCompactionTrigger).toHaveBeenCalledWith({
      options: expect.objectContaining({
        forceExistingWake: true,
        mode: "execute",
        wait: false,
      }),
      store: {
        marker: "store",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      alreadyRan: false,
      report: {
        totals: {
          scheduledCount: 1,
        },
      },
      runId: "hosted-legacy-wearable-compaction-2026-05-23",
      schema: `${LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA}.cron.v1`,
    });
  });

  it("does not trigger again after the one-shot marker exists", async () => {
    const prisma = {
      hostedWebInternalRequestNonce: {
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
        deleteMany: vi.fn(),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace/legacy-wearable-compaction/cron",
    ));

    expect(response.status).toBe(200);
    expect(mocks.runHostedLegacyWearableCompactionTrigger).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      alreadyRan: true,
      runId: "hosted-legacy-wearable-compaction-2026-05-23",
    });
  });

  it("releases the one-shot marker when scheduling fails before completion", async () => {
    const prisma = {
      hostedWebInternalRequestNonce: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runHostedLegacyWearableCompactionTrigger.mockRejectedValue(
      new Error("Temporal unavailable"),
    );

    const response = await route.GET(new Request(
      "https://join.example.test/api/internal/hosted-workspace/legacy-wearable-compaction/cron",
    ));

    expect(response.status).toBe(500);
    expect(prisma.hostedWebInternalRequestNonce.deleteMany).toHaveBeenCalledWith({
      where: {
        nonceHash: "hosted_legacy_wearable_compaction_2026_05_23_once",
      },
    });
  });
});

function buildReport() {
  return {
    completedAt: "2026-05-23T00:00:01.000Z",
    mode: "execute",
    schema: LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA,
    startedAt: "2026-05-23T00:00:00.000Z",
    targets: [{
      after: null,
      before: {
        encryptedBytes: 1024,
        encryptedMiB: 0,
        fileCount: 1,
        kind: "v2",
        plainBytes: 2048,
        plainMiB: 0,
      },
      compaction: null,
      dryRun: false,
      scheduledWakeReason: "legacy-wearable-receipt-compaction-v1",
      signalAccepted: true,
      status: "scheduled",
      target: 1,
      versionAfterSchedule: "5",
      versionBefore: "4",
    }],
    totals: {
      afterEncryptedBytes: 0,
      afterKnownCount: 0,
      afterPlainBytes: 0,
      beforeEncryptedBytes: 1024,
      beforeKnownCount: 1,
      beforePlainBytes: 2048,
      completedCount: 0,
      encryptedDeltaBytes: null,
      scheduledCount: 1,
      skippedCount: 0,
      targetCount: 1,
      timeoutCount: 0,
    },
    wakeReason: "legacy-wearable-receipt-compaction-v1",
    wait: false,
  };
}
