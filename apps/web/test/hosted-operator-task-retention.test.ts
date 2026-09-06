import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostedExecutionAssistantAskResult } from "@murphai/hosted-execution";

import * as secureBox from "@/src/lib/hosted-crypto/secure-box";
import { listHostedOperatorTasks } from "@/src/lib/hosted-ops/operator-task";

const now = new Date("2026-09-05T12:00:00.000Z");
const cutoff = new Date("2026-09-03T12:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("operator task result read retention", () => {
  it("reads recent results but never decrypts expired or cleared results", async () => {
    const result: HostedExecutionAssistantAskResult = {
      answer: "Synthetic diagnostic result.",
      outcome: "answered",
    };
    const decrypt = vi.spyOn(secureBox, "openHostedUserSecureBoxString")
      .mockResolvedValue(JSON.stringify(result));
    const rows = [
      { id: "recent", completedAt: new Date(cutoff.getTime() + 1), resultEncrypted: "recent-ciphertext" },
      { id: "boundary", completedAt: cutoff, resultEncrypted: "expired-ciphertext" },
      { id: "older", completedAt: new Date(cutoff.getTime() - 1), resultEncrypted: "older-ciphertext" },
      { id: "cleared", completedAt: cutoff, resultEncrypted: null },
      { id: "running", completedAt: null, resultEncrypted: null },
    ].map((row) => ({
      createdAt: new Date("2026-09-03T11:59:00.000Z"),
      expiresAt: new Date("2026-09-03T12:09:00.000Z"),
      kind: "diagnostic",
      memberId: "member_synthetic",
      source: "ops",
      status: row.completedAt ? "completed" : "running",
      ...row,
    }));
    const findMany = vi.fn().mockResolvedValue(rows);
    const views = await listHostedOperatorTasks({
      now,
      prisma: { hostedOperatorTask: { findMany } } as never,
      requestedByMemberId: "operator_synthetic",
    });

    expect(views.map(({ id, result }) => ({ id, result }))).toEqual([
      { id: "recent", result },
      { id: "boundary", result: null },
      { id: "older", result: null },
      { id: "cleared", result: null },
      { id: "running", result: null },
    ]);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledWith(expect.objectContaining({
      userId: "member_synthetic",
      value: "recent-ciphertext",
    }));
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 20,
      where: { requestedByMemberId: "operator_synthetic" },
    });
    expect(views[1]).toMatchObject({ completedAt: cutoff.toISOString(), status: "completed" });
    expect(views[4]).toMatchObject({ completedAt: null, status: "running" });
  });
});
