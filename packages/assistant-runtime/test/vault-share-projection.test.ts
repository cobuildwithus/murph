import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  parseHostedVaultShareDeliverRequest,
} from "@murphai/hosted-execution/vault-share";
import { describe, expect, it, vi } from "vitest";

import {
  applyHostedVaultShareRevokeWake,
  importHostedVaultShareDeliveryWake,
} from "../src/hosted-runtime/vault-share-import.ts";
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
  const storePath = (vaultRoot: string) =>
    join(vaultRoot, "raw", "shared", "vault-share-projections.json");

  it("lands the shared record as durable vault content, idempotently", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    const first = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    const second = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    expect(first).toEqual({ status: "imported" });
    expect(second).toEqual({ status: "imported" });

    const stored = JSON.parse(
      await readFile(
        storePath(vaultRoot),
        "utf8",
      ),
    );
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(RECORD);
    expect(grantor.records[0].shareId).toBe("share_1");
    expect(grantor.records[0].receivedEventId).toBe(wake.eventId);
  });

  it("keeps one compact file with only the latest bounded records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    for (let day = 1; day <= HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS + 1; day += 1) {
      const date = `2026-06-${String(day).padStart(2, "0")}`;
      const nextDate = `2026-06-${String(day + 1).padStart(2, "0")}`;
      const record = {
        data: {
          date,
          sleepEndAt: `${nextDate}T06:31:00.000Z`,
          sleepStartAt: `${date}T22:04:00.000Z`,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      };

      await expect(importHostedVaultShareDeliveryWake({
        vaultRoot,
        wake: {
          ...wake,
          delivery: { ...wake.delivery, record },
          eventId: `vault-share:share_1:${date}`,
          occurredAt: record.occurredAt,
        },
      })).resolves.toEqual({ status: "imported" });
    }

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const records = stored.projections["sleep-times.v0"].grantors.member_grantor.records;
    expect(records).toHaveLength(HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS);
    expect(records.map((entry: { record: { recordKey: string } }) => entry.record.recordKey))
      .not.toContain("2026-06-01");
    await expect(readFile(
      join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor", "2026-06-09.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies revoke wakes by removing the grantor projection entry", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let a stale revoke remove a newer grant epoch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: { ...wake.delivery, shareId: "share_2" },
        eventId: "vault-share:share_2:2026-06-09",
      },
    });

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.shareId).toBe("share_2");
    expect(grantor.records).toHaveLength(1);
  });

  it("starts a fresh record list when a delivery arrives for a new grant epoch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    const nextRecord = {
      data: {
        date: "2026-06-10",
        sleepEndAt: "2026-06-11T06:31:00.000Z",
        sleepStartAt: "2026-06-10T22:04:00.000Z",
      },
      occurredAt: "2026-06-10T00:00:00.000Z",
      recordKey: "2026-06-10",
    };
    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          record: nextRecord,
          shareId: "share_2",
        },
        eventId: "vault-share:share_2:2026-06-10",
        occurredAt: "2026-06-10T00:00:00.000Z",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.shareId).toBe("share_2");
    expect(grantor.records.map((entry: { record: { recordKey: string } }) =>
      entry.record.recordKey,
    )).toEqual(["2026-06-10"]);
  });

  it("quarantines as a non-retryable block when the vault path is unreadable", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake,
    });

    expect(result).toEqual({
      reasonCode: "vault_share.read_failed",
      retryable: false,
      status: "blocked",
    });
  });

  it("keeps revoke import read failures retryable so stale shared data is not consumed", async () => {
    const result = await applyHostedVaultShareRevokeWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    });

    expect(result).toEqual({
      reasonCode: "vault_share.read_failed",
      retryable: true,
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
