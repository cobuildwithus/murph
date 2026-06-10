import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { importHostedVaultShareDeliveryWake } from "../src/hosted-runtime/vault-share-import.ts";
import {
  offerHostedVaultShareProjectionBestEffort,
} from "../src/hosted-runtime/vault-share-projection.ts";

const NIGHT = {
  date: "2026-06-09",
  sleepEndAt: "2026-06-10T06:31:00.000Z",
  sleepStartAt: "2026-06-09T22:04:00.000Z",
};

describe("offerHostedVaultShareProjectionBestEffort", () => {
  it("is a no-op without a vault-share port", async () => {
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: null,
    });

    expect(result.outcome).toBe("no-port");
  });

  it("offers projectable nights and reports delivery", async () => {
    const deliver = vi.fn().mockResolvedValue({
      appendedCount: 1,
      duplicateCount: 0,
      status: "delivered",
    });
    const result = await offerHostedVaultShareProjectionBestEffort({
      readNights: async () => [NIGHT],
      vaultRoot: "/unused",
      vaultSharePort: { deliver },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledWith({
      nights: [NIGHT],
      projectionKind: "sleep-times.v0",
    });
  });

  it("sends nothing when the vault has no fully timed nights", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      readNights: async () => [],
      vaultRoot: "/unused",
      vaultSharePort: { deliver },
    });

    expect(result.outcome).toBe("no-projectable-nights");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("never throws when the port fails", async () => {
    const deliver = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await offerHostedVaultShareProjectionBestEffort({
      readNights: async () => [NIGHT],
      vaultRoot: "/unused",
      vaultSharePort: { deliver },
    });

    expect(result.outcome).toBe("error");
  });
});

describe("importHostedVaultShareDeliveryWake", () => {
  const wake = {
    delivery: {
      grantorMemberId: "member_grantor",
      night: NIGHT,
      projectionKind: "sleep-times.v0" as const,
      schema: "murph.vault-share.delivery.v1" as const,
      shareId: "share_1",
    },
    eventId: "vault-share:share_1:2026-06-09",
    kind: "vault-share.delivery" as const,
    occurredAt: "2026-06-10T07:00:00.000Z",
    userId: "member_referee",
  };

  it("lands the shared night as durable vault content, idempotently", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    const first = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    const second = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    expect(first).toEqual({ status: "imported" });
    expect(second).toEqual({ status: "imported" });

    const stored = JSON.parse(
      await readFile(
        join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor", "2026-06-09.json"),
        "utf8",
      ),
    );
    expect(stored.night).toEqual(NIGHT);
    expect(stored.shareId).toBe("share_1");
    expect(stored.receivedEventId).toBe(wake.eventId);
  });

  it("fails open as a retryable block when the vault path is unwritable", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake,
    });

    expect(result).toEqual({
      reasonCode: "vault_share.write_failed",
      retryable: true,
      status: "blocked",
    });
  });
});
