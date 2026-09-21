import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexRealtimeClosure, CodexRealtimeSession } from "@murphai/assistant-engine/assistant-runtime";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { createHostedRuntimeVoiceCall } from "../src/hosted-runtime/voice-call.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const receipt: CodexRealtimeClosure = {
  providerConfirmed: true, providerSessionId: "rtc_synthetic", seconds: 2,
};
type StartVoice = Parameters<ReturnType<typeof createHostedRuntimeVoiceCall>["connect"]>[1];
const calls: ReturnType<typeof createHostedRuntimeVoiceCall>[] = [];
afterEach(async () => {
  await Promise.allSettled(calls.splice(0).map((call) => call.close()));
  vi.useRealTimers();
});

function fixture() {
  const nativeClosed = deferred<CodexRealtimeClosure>();
  const abort = new AbortController();
  const admitInput = vi.fn(async ({ inputId }: { inputId: string }) => ({ mailboxItemId: `mailbox_${inputId}` }));
  const recordUsage = vi.fn(async (record: AssistantUsageRecord, _target?: unknown) => ({
    recorded: true, platformAiUsageAllowedAfter: true, usageId: record.usageId,
  }));
  const notifyRuntime = vi.fn();
  const native: CodexRealtimeSession = {
    sdp: "synthetic-answer",
    closed: nativeClosed.promise,
    speak: vi.fn(async () => {}),
    close: vi.fn(async () => { nativeClosed.resolve(receipt); return receipt; }),
  };
  const start = vi.fn<StartVoice>(async () => native);
  const call = createHostedRuntimeVoiceCall({
    callId: "call_synthetic", memberId: "member_synthetic", signal: abort.signal,
    admitInput, usagePort: { recordUsage }, notifyRuntime,
  });
  calls.push(call);
  const options = () => start.mock.calls[0]![0];
  return { call, abort, native, nativeClosed, admitInput, recordUsage, start, options, notifyRuntime };
}

describe("invocation-bound native voice", () => {
  it("holds an empty reservation, starts once, and refuses a different offer", async () => {
    const f = fixture();
    expect(f.call.isHoldingRuntime()).toBe(true);
    expect(await f.call.connect("offer", f.start)).toBe("synthetic-answer");
    expect(await f.call.connect("offer", f.start)).toBe("synthetic-answer");
    await expect(f.call.connect("changed-offer", f.start)).rejects.toMatchObject({
      code: "ASSISTANT_VOICE_DELIVERY_UNAVAILABLE",
    });
    expect(f.start).toHaveBeenCalledOnce();
    await f.call.close();
    expect(f.call.isHoldingRuntime()).toBe(false);
    await expect(f.call.connect("offer", f.start)).rejects.toThrow();
  });

  it("expires a reservation that never attaches without inventing usage", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.call.isHoldingRuntime()).toBe(false);
    expect(f.recordUsage).not.toHaveBeenCalled();
    expect(f.notifyRuntime).toHaveBeenCalledOnce();
    await expect(f.call.connect("offer", f.start)).rejects.toThrow();
    expect(f.start).not.toHaveBeenCalled();
  });

  it("admits in order, wakes only after persistence, and speaks one selected result for steered inputs", async () => {
    const f = fixture();
    const first = deferred<{ mailboxItemId: string }>();
    f.admitInput.mockImplementationOnce(() => first.promise);
    await f.call.connect("offer", f.start);
    f.options().onInput({ inputId: "one", text: "Synthetic first request" });
    f.options().onInput({ inputId: "two", text: "Synthetic correction" });
    await vi.waitFor(() => expect(f.admitInput).toHaveBeenCalledTimes(1));
    expect(f.notifyRuntime).not.toHaveBeenCalled();
    await expect(f.call.speak({ callId: f.call.callId, message: "Too early", answeredMailboxItemIds: ["mailbox_one"] })).rejects.toThrow();
    first.resolve({ mailboxItemId: "mailbox_one" });
    await vi.waitFor(() => expect(f.notifyRuntime).toHaveBeenCalledTimes(2));
    expect(f.admitInput.mock.calls.map(([value]) => value)).toEqual([
      { callId: "call_synthetic", inputId: "one", text: "Synthetic first request" },
      { callId: "call_synthetic", inputId: "two", text: "Synthetic correction" },
    ]);
    expect(f.native.speak).not.toHaveBeenCalled();
    await f.call.speak({ callId: f.call.callId, message: "Selected result", answeredMailboxItemIds: ["mailbox_one", "mailbox_two"] });
    expect(f.native.speak).toHaveBeenCalledExactlyOnceWith("Selected result");
  });

  it("fences wrong calls and unaccepted inputs and leaves uncertain speech to the outbox", async () => {
    const f = fixture();
    await f.call.connect("offer", f.start);
    f.options().onInput({ inputId: "one", text: "Synthetic request" });
    await vi.waitFor(() => expect(f.notifyRuntime).toHaveBeenCalledOnce());
    for (const request of [
      { callId: "other-call", answeredMailboxItemIds: ["mailbox_one"] },
      { callId: f.call.callId, answeredMailboxItemIds: [] },
      { callId: f.call.callId, answeredMailboxItemIds: ["mailbox_other"] },
    ]) {
      await expect(f.call.speak({ ...request, message: "Private result" })).rejects.toMatchObject({
        deliveryMayHaveSucceeded: false, retryable: false,
      });
    }
    const uncertain = new Error("Synthetic transport loss");
    vi.mocked(f.native.speak).mockRejectedValueOnce(uncertain);
    await expect(f.call.speak({ callId: f.call.callId, message: "Selected result", answeredMailboxItemIds: ["mailbox_one"] })).rejects.toBe(uncertain);
    expect(f.native.speak).toHaveBeenCalledOnce();
  });

  it("joins accepted admission and trusted final accounting before releasing its hold", async () => {
    const f = fixture();
    const admission = deferred<{ mailboxItemId: string }>();
    const settlement = deferred<void>();
    f.admitInput.mockImplementationOnce(() => admission.promise);
    f.recordUsage.mockImplementation(async (record) => {
      await settlement.promise;
      return { recorded: true, platformAiUsageAllowedAfter: true, usageId: record.usageId };
    });
    await f.call.connect("offer", f.start);
    f.options().onInput({ inputId: "one", text: "Synthetic request" });
    const closing = f.call.close();
    expect(f.call.close()).toBe(closing);
    f.options().onInput({ inputId: "late", text: "Must not be admitted" });
    await vi.waitFor(() => expect(f.recordUsage).toHaveBeenCalledOnce());
    expect(f.call.isHoldingRuntime()).toBe(true);
    admission.resolve({ mailboxItemId: "mailbox_one" });
    await vi.waitFor(() => expect(f.notifyRuntime).toHaveBeenCalledOnce());
    expect(f.call.isHoldingRuntime()).toBe(true);
    settlement.resolve();
    expect(await closing).toEqual(receipt);
    expect(f.call.isHoldingRuntime()).toBe(false);
    expect(f.admitInput).toHaveBeenCalledOnce();
    expect(f.recordUsage.mock.calls[0]?.[1]).toBeNull();
    expect(f.recordUsage.mock.calls[0]?.[0].rawUsageJson).toEqual({ startDurationMs: 0, endDurationMs: 2000 });
    await expect(f.call.speak({ callId: f.call.callId, message: "Stale result", answeredMailboxItemIds: ["mailbox_one"] })).rejects.toThrow();
  });

  it("closes on allowance exhaustion and accounts for the final provider total", async () => {
    const f = fixture();
    f.recordUsage.mockImplementation(async (record) => ({ recorded: true, platformAiUsageAllowedAfter: false, usageId: record.usageId }));
    await f.call.connect("offer", f.start);
    f.options().onUsage?.(1);
    await vi.waitFor(() => expect(f.call.isHoldingRuntime()).toBe(false));
    expect(f.native.close).toHaveBeenCalledOnce();
    expect(f.recordUsage.mock.calls.map(([record]) => record.rawUsageJson)).toEqual([
      { startDurationMs: 0, endDurationMs: 1000 },
      { startDurationMs: 1000, endDurationMs: 2000 },
    ]);
  });

  it("stops after admission failure, preserves the failure, and still settles usage", async () => {
    const f = fixture();
    const failure = new Error("Synthetic admission unavailable");
    f.admitInput.mockRejectedValueOnce(failure);
    await f.call.connect("offer", f.start);
    f.options().onInput({ inputId: "one", text: "Synthetic request" });
    f.options().onInput({ inputId: "two", text: "Queued request" });
    await vi.waitFor(() => expect(f.call.isHoldingRuntime()).toBe(false));
    await expect(f.call.close()).rejects.toBe(failure);
    expect(f.admitInput).toHaveBeenCalledOnce();
    expect(f.recordUsage).toHaveBeenCalledOnce();
  });

  it("joins admission and accounting even when native close fails", async () => {
    const f = fixture();
    const failure = new Error("Synthetic native shutdown failure");
    vi.mocked(f.native.close).mockRejectedValueOnce(failure);
    const admission = deferred<{ mailboxItemId: string }>();
    f.admitInput.mockImplementationOnce(() => admission.promise);
    await f.call.connect("offer", f.start);
    f.options().onUsage?.(1);
    f.options().onInput({ inputId: "one", text: "Synthetic request" });
    const closing = f.call.close();
    const failed = expect(closing).rejects.toBe(failure);
    expect(f.call.isHoldingRuntime()).toBe(true);
    admission.resolve({ mailboxItemId: "mailbox_one" });
    await failed;
    expect(f.notifyRuntime).toHaveBeenCalledTimes(2);
    expect(f.recordUsage).toHaveBeenCalledOnce();
    expect(f.call.isHoldingRuntime()).toBe(false);
  });

  it("exposes final accounting failure after closing the provider", async () => {
    const f = fixture();
    const failure = new Error("Synthetic accounting unavailable");
    f.recordUsage.mockRejectedValue(failure);
    await f.call.connect("offer", f.start);
    await expect(f.call.close()).rejects.toBe(failure);
    expect(f.native.close).toHaveBeenCalledOnce();
    expect(f.call.isHoldingRuntime()).toBe(false);
  });

  it("joins canceled native startup and never returns the late SDP answer", async () => {
    const f = fixture();
    const startup = deferred<CodexRealtimeSession>();
    f.start.mockImplementationOnce(() => startup.promise);
    const connecting = f.call.connect("offer", f.start);
    const rejected = expect(connecting).rejects.toMatchObject({ code: "ASSISTANT_VOICE_DELIVERY_UNAVAILABLE" });
    await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
    f.abort.abort();
    expect(f.options().signal?.aborted).toBe(true);
    expect(f.call.isHoldingRuntime()).toBe(true);
    startup.resolve(f.native);
    await rejected;
    expect(f.native.close).toHaveBeenCalledOnce();
    expect(f.call.isHoldingRuntime()).toBe(false);
  });

  it("settles provider-driven closure and retains unconfirmed shutdown honestly", async () => {
    const f = fixture();
    const unconfirmed = { providerConfirmed: false, providerSessionId: null, seconds: null };
    vi.mocked(f.native.close).mockResolvedValueOnce(unconfirmed);
    await f.call.connect("offer", f.start);
    f.options().onUsage?.(1);
    f.nativeClosed.resolve(unconfirmed);
    await vi.waitFor(() => expect(f.call.isHoldingRuntime()).toBe(false));
    expect(await f.call.close()).toEqual(unconfirmed);
    expect(f.recordUsage.mock.calls.map(([record]) => record.rawUsageJson)).toEqual([
      { startDurationMs: 0, endDurationMs: 1000 },
    ]);
  });
});
