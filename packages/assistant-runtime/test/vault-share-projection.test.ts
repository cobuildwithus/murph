import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseHostedVaultShareDeliverRequest } from "@murphai/hosted-execution/vault-share";
import { describe, expect, it, vi } from "vitest";

import { importHostedVaultShareDeliveryWake } from "../src/hosted-runtime/vault-share-import.ts";
import {
  HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS,
  offerHostedVaultShareProjectionBestEffort,
  selectProjectableSleepNights,
} from "../src/hosted-runtime/vault-share-projection.ts";

const NIGHT = {
  date: "2026-06-09",
  sleepEndAt: "2026-06-10T06:31:00.000Z",
  sleepStartAt: "2026-06-09T22:04:00.000Z",
};

const RECORD = {
  data: NIGHT,
  occurredAt: `${NIGHT.date}T00:00:00.000Z`,
  recordKey: NIGHT.date,
};

describe("offerHostedVaultShareProjectionBestEffort", () => {
  it("is a no-op without a vault-share port", async () => {
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: null,
    });

    expect(result.outcome).toBe("no-port");
  });

  it("offers projectable records and reports delivery", async () => {
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      readRecords: async () => [RECORD],
      vaultRoot: "/unused",
      vaultSharePort: { deliver },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledWith({
      projectionKind: "sleep-times.v0",
      records: [RECORD],
    });
  });

  it("sends nothing when the vault has no fully timed nights", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      readRecords: async () => [],
      vaultRoot: "/unused",
      vaultSharePort: { deliver },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("never throws when the port fails", async () => {
    const deliver = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await offerHostedVaultShareProjectionBestEffort({
      readRecords: async () => [RECORD],
      vaultRoot: "/unused",
      vaultSharePort: { deliver },
    });

    expect(result.outcome).toBe("error");
  });
});

describe("selectProjectableSleepNights", () => {
  const nowMs = Date.parse("2026-06-10T00:00:00.000Z");

  it("maps recent fully-timed nights to records keyed by night date and drops stale or partial ones", () => {
    const staleDate = "2026-05-01";
    const summaries = [
      { date: NIGHT.date, sleepEndAt: NIGHT.sleepEndAt, sleepStartAt: NIGHT.sleepStartAt },
      { date: "2026-06-08", sleepEndAt: null, sleepStartAt: "2026-06-08T22:00:00.000Z" },
      {
        date: staleDate,
        sleepEndAt: "2026-05-02T06:00:00.000Z",
        sleepStartAt: "2026-05-01T22:00:00.000Z",
      },
    ];

    const selected = selectProjectableSleepNights(summaries, nowMs);

    // recordKey is the night date and occurredAt is the night date at UTC midnight, so the
    // dedupe key, vault path, and plaintext mailbox metadata all reduce to the night itself
    // — the exact sleep timestamps travel only inside the encrypted payload.
    expect(selected).toEqual([RECORD]);
    expect(selected[0]?.recordKey).toBe(NIGHT.date);
    expect(selected[0]?.occurredAt).toBe(`${NIGHT.date}T00:00:00.000Z`);
  });

  it("emits records the hosted-execution deliver-request parser accepts unchanged", () => {
    // Cross-package drift guard: the deliver parser pins occurredAt to the night-date
    // midnight and bounds the sleep window, so a projector that drifts from that contract
    // would make web reject every offer. Pipe real projector output through the real parser.
    const selected = selectProjectableSleepNights([NIGHT], nowMs);

    expect(selected).toHaveLength(1);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("drops nights older than the recency cutoff exactly", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const justInsideMs = nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS * dayMs;
    const justInsideDate = new Date(justInsideMs).toISOString().slice(0, 10);
    const justOutsideDate = new Date(justInsideMs - dayMs).toISOString().slice(0, 10);
    const summaries = [justInsideDate, justOutsideDate].map((date) => ({
      date,
      sleepEndAt: `${date}T06:00:00.000Z`,
      sleepStartAt: `${date}T22:00:00.000Z`,
    }));

    const selected = selectProjectableSleepNights(summaries, nowMs);

    expect(selected.map((record) => record.recordKey)).toEqual([justInsideDate]);
  });
});

describe("importHostedVaultShareDeliveryWake", () => {
  const wake = {
    delivery: {
      grantorMemberId: "member_grantor",
      projectionKind: "sleep-times.v0" as const,
      record: RECORD,
      schema: "murph.vault-share.delivery.v1" as const,
      shareId: "share_1",
    },
    eventId: "vault-share:share_1:2026-06-09",
    kind: "vault-share.delivery" as const,
    occurredAt: "2026-06-10T07:00:00.000Z",
    userId: "member_referee",
  };

  it("lands the shared record as durable vault content, idempotently", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    const first = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    const second = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    expect(first).toEqual({ status: "imported" });
    expect(second).toEqual({ status: "imported" });

    // The recordKey-based path is byte-identical to the previous night-date-based one.
    const stored = JSON.parse(
      await readFile(
        join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor", "2026-06-09.json"),
        "utf8",
      ),
    );
    expect(stored.record).toEqual(RECORD);
    expect(stored.shareId).toBe("share_1");
    expect(stored.receivedEventId).toBe(wake.eventId);
  });

  it("quarantines as a non-retryable block when the vault path is unwritable", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake,
    });

    expect(result).toEqual({
      reasonCode: "vault_share.write_failed",
      retryable: false,
      status: "blocked",
    });
  });

  it("blocks unsafe path segments without touching the filesystem", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/unused",
      wake: {
        ...wake,
        delivery: { ...wake.delivery, grantorMemberId: "../escape" },
      },
    });

    expect(result).toEqual({
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    });
  });
});
