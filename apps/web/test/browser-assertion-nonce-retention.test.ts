import { describe, expect, it, vi } from "vitest";

import { HOSTED_USER_ASSERTION_FIRST_INVALID_OFFSET_SECONDS } from "@/src/lib/device-sync/auth";
import {
  deleteExpiredHostedBrowserAssertionNonces,
} from "@/src/lib/hosted-retention/browser-assertion-nonces";
import {
  HOSTED_RETENTION_BATCH_SIZE,
  HOSTED_RETENTION_MAX_BATCHES,
} from "@/src/lib/hosted-retention/cleanup";

function sqlOf(call: readonly unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

describe("hosted browser assertion nonce retention", () => {
  it("uses the conservative mixed-version cutoff in one skip-locked batch", async () => {
    const now = new Date("2026-03-25T12:04:01.000Z");
    const executeRaw = vi.fn().mockResolvedValue(3);

    await expect(deleteExpiredHostedBrowserAssertionNonces({
      now,
      prisma: {
        $executeRaw: executeRaw,
      } as never,
    })).resolves.toBe(3);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const call = executeRaw.mock.calls[0]!;
    expect(sqlOf(call)).toContain("WITH doomed AS MATERIALIZED");
    expect(sqlOf(call)).toContain(
      'WHERE browser_nonce."expires_at" <= ?',
    );
    expect(sqlOf(call)).toContain(
      'browser_nonce."expires_at" ASC',
    );
    expect(sqlOf(call)).toContain(
      'browser_nonce."nonce_hash" ASC',
    );
    expect(sqlOf(call)).toContain("LIMIT ?");
    expect(sqlOf(call)).toContain(
      "FOR UPDATE OF browser_nonce SKIP LOCKED",
    );
    expect(sqlOf(call)).toContain(
      'WHERE browser_nonce."nonce_hash" = doomed."nonce_hash"',
    );
    expect(call.slice(1)).toEqual([
      new Date(
        now.getTime()
          - HOSTED_USER_ASSERTION_FIRST_INVALID_OFFSET_SECONDS * 1000,
      ),
      HOSTED_RETENTION_BATCH_SIZE,
    ]);
  });

  it("drains full batches serially and stops after the first short batch", async () => {
    const executeRaw = vi.fn()
      .mockResolvedValueOnce(HOSTED_RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(2);

    await expect(deleteExpiredHostedBrowserAssertionNonces({
      now: new Date("2026-03-25T12:04:01.000Z"),
      prisma: {
        $executeRaw: executeRaw,
      } as never,
    })).resolves.toBe(HOSTED_RETENTION_BATCH_SIZE + 2);

    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("caps a persistent backlog at the shared per-run batch ceiling", async () => {
    const executeRaw = vi.fn().mockResolvedValue(HOSTED_RETENTION_BATCH_SIZE);

    await expect(deleteExpiredHostedBrowserAssertionNonces({
      now: new Date("2026-03-25T12:04:01.000Z"),
      prisma: {
        $executeRaw: executeRaw,
      } as never,
    })).resolves.toBe(
      HOSTED_RETENTION_BATCH_SIZE * HOSTED_RETENTION_MAX_BATCHES,
    );

    expect(executeRaw).toHaveBeenCalledTimes(HOSTED_RETENTION_MAX_BATCHES);
  });
});
