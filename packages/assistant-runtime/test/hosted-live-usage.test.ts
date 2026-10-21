import { describe, expect, it, vi } from "vitest";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { createHostedLiveUsageRecorder } from "../src/hosted-runtime/live-usage.ts";

const accepted = (record: AssistantUsageRecord) => ({
  platformAiUsageAllowedAfter: true, recorded: true, usageId: record.usageId,
});

describe("trusted native cumulative usage recording", () => {
  it("coalesces updates into non-overlapping records with one request in flight", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const records: AssistantUsageRecord[] = [];
    const recordUsage = vi.fn(async (record: AssistantUsageRecord, noticeDeliveryTarget?: unknown) => {
      expect(noticeDeliveryTarget).toBeNull();
      records.push(record);
      if (records.length === 1) await barrier;
      return accepted(record);
    });
    const stopVoice = vi.fn();
    const usage = createHostedLiveUsageRecorder({
      memberId: "member_synthetic", sessionId: "call_synthetic", port: { recordUsage }, stopVoice,
    });
    usage.observe(1);
    for (const seconds of [2, 3, 3, 2, 4, 5]) usage.observe(seconds);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    release();
    await usage.flush();
    expect(records.map((record) => record.rawUsageJson)).toEqual([
      { startDurationMs: 0, endDurationMs: 1000 },
      { startDurationMs: 1000, endDurationMs: 5000 },
    ]);
    usage.observe(5);
    usage.observe(4);
    await usage.flush();
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(stopVoice).not.toHaveBeenCalled();
  });

  it("stops on an ambiguous response and replays the exact charge before recording final usage", async () => {
    const stopVoice = vi.fn();
    const records: AssistantUsageRecord[] = [];
    const recordUsage = vi.fn(async (record: AssistantUsageRecord) => {
      records.push(record);
      if (records.length === 1) throw new Error("Synthetic acknowledgement lost");
      return accepted(record);
    });
    const usage = createHostedLiveUsageRecorder({
      memberId: "member_synthetic", sessionId: "call_synthetic", port: { recordUsage }, stopVoice,
    });
    usage.observe(3);
    await expect(usage.flush()).rejects.toThrow("Synthetic acknowledgement lost");
    expect(stopVoice).toHaveBeenCalledOnce();
    usage.observe(4);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    await usage.flush();
    expect(records[1]).toEqual(records[0]);
    expect(records[2]?.rawUsageJson).toEqual({ startDurationMs: 3000, endDurationMs: 4000 });
  });

  it.each([false, true])("joins final usage arriving during write completion (failure=%s)", async (failFinal) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const failure = new Error("Synthetic final settlement failure");
    const records: AssistantUsageRecord[] = [];
    const recordUsage = vi.fn(async (record: AssistantUsageRecord) => {
      records.push(record);
      if (records.length === 2) {
        await barrier;
        if (failFinal) throw failure;
      }
      return accepted(record);
    });
    const usage = createHostedLiveUsageRecorder({
      memberId: "member_synthetic", sessionId: "call_synthetic", port: { recordUsage }, stopVoice: vi.fn(),
    });
    usage.observe(1);
    // The first ledger acknowledgement is complete, but its promise cleanup
    // has not run when the provider supplies the final cumulative receipt.
    await Promise.resolve();
    usage.observe(2);
    let settled = false;
    const flushed = usage.flush().then(
      () => { settled = true; return null; },
      (error: unknown) => { settled = true; return error; },
    );
    try {
      await vi.waitFor(() => expect(recordUsage).toHaveBeenCalledTimes(2));
      expect(settled, "shutdown must retain its hold until final settlement").toBe(false);
    } finally {
      release();
    }
    expect(await flushed).toBe(failFinal ? failure : null);
    expect(records.map((record) => record.rawUsageJson)).toEqual([
      { startDurationMs: 0, endDurationMs: 1000 },
      { startDurationMs: 1000, endDurationMs: 2000 },
    ]);
  });

  it("closes at the usage limit and settles the remaining trusted final duration", async () => {
    const stopVoice = vi.fn();
    const recordUsage = vi.fn(async (record: AssistantUsageRecord) => ({
      ...accepted(record), platformAiUsageAllowedAfter: false,
    }));
    const usage = createHostedLiveUsageRecorder({
      memberId: "member_synthetic", sessionId: "call_synthetic", port: { recordUsage }, stopVoice,
    });
    usage.observe(1);
    await usage.flush();
    expect(stopVoice).toHaveBeenCalledOnce();
    usage.observe(1.1);
    await usage.flush();
    expect(recordUsage.mock.calls[1]?.[0].rawUsageJson)
      .toEqual({ startDurationMs: 1000, endDurationMs: 1100 });
  });

  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER])(
    "stops without fabricated usage for invalid native evidence (%s)", async (seconds) => {
      const stopVoice = vi.fn();
      const recordUsage = vi.fn(async (record: AssistantUsageRecord) => accepted(record));
      const usage = createHostedLiveUsageRecorder({
        memberId: "member_synthetic", sessionId: "call_synthetic", port: { recordUsage }, stopVoice,
      });
      usage.observe(seconds);
      await usage.flush();
      expect(stopVoice).toHaveBeenCalledOnce();
      expect(recordUsage).not.toHaveBeenCalled();
    },
  );
});
