import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS,
  HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
  type HostedRuntimeLatencyTraceAssistantMilestoneEvent,
} from "@murphai/hosted-execution/runtime-control";
import { guardHostedRuntimeLatencyTracePort, recordHostedAssistantMilestonesBestEffort, recordHostedRuntimeLatencyMilestoneBestEffort, recordHostedStagedLatencyTraceBestEffort } from "../src/hosted-runtime/assistant-latency-trace.ts";
import { recordHostedDeliveryCommittedBestEffort } from "../src/hosted-runtime/delivery-latency-trace.ts";

const ok = { matchedCount: 1, recorded: true, unmatchedCount: 0 };
const unmatched = { matchedCount: 0, recorded: false, unmatchedCount: 1 };
const context = { assistantInputIds: ["synthetic-input"], runtimeAttemptId: "synthetic-attempt", source: "linq" as const };
const milestones = [
  { at: "2026-09-01T12:00:00.001Z", milestone: "first_codex_output_observed" as const },
  { at: "2026-09-01T12:00:00.002Z", milestone: "first_codex_text_observed" as const },
];
const expectedEvents = milestones.map(milestone => ({ ...context, ...milestone, type: "assistant_milestone" }));
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([true, false])("records the checkpoint deadline for all channels without delaying publication (batch=%s)", async batch => {
  const record = vi.fn().mockResolvedValue(ok);
  const recordBatch = vi.fn().mockResolvedValue({ results: [ok, ok, ok] });
  const at = "2026-01-01T00:00:00.000Z";
  recordHostedRuntimeLatencyMilestoneBestEffort({
    at, milestone: "checkpoint_publication_expected_by", runtimeAttemptId: "synthetic-attempt",
    latencyTracePort: { record, ...(batch ? { recordBatch } : {}) },
  });
  const events = ["email", "linq", "telegram"].map(source => ({
    at, milestone: "checkpoint_publication_expected_by", runtimeAttemptId: "synthetic-attempt", source, type: "runtime_milestone",
  }));
  if (batch) {
    expect(recordBatch).toHaveBeenCalledExactlyOnceWith({ events });
    expect(record).not.toHaveBeenCalled();
  } else {
    expect(record.mock.calls).toEqual(events.map(event => [{ event }]));
  }
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["throw", "reject"])("keeps failed checkpoint telemetry out of runtime control flow (%s)", async failure => {
  const recordBatch = vi.fn(() => {
    if (failure === "throw") throw new Error("synthetic telemetry failure");
    return Promise.reject(new Error("synthetic telemetry failure"));
  });
  expect(() => recordHostedRuntimeLatencyMilestoneBestEffort({
    at: "2026-01-01T00:00:00.000Z", milestone: "checkpoint_publication_expected_by",
    runtimeAttemptId: "synthetic-attempt", latencyTracePort: { record: vi.fn(), recordBatch },
  })).not.toThrow();
  await Promise.resolve();
});

it("sends simultaneous first-output and first-text in one immediate batch with original timestamps", async () => {
  const record = vi.fn().mockResolvedValue(ok);
  const recordBatch = vi.fn().mockResolvedValue({ results: [ok, ok] });
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, latencyTracePort: { record, recordBatch } }, milestones });
  expect(recordBatch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(recordBatch).toHaveBeenCalledExactlyOnceWith({ events: expectedEvents });
  expect(record).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps legacy ports on the deployed singleton contract", async () => {
  const record = vi.fn().mockResolvedValue(ok);
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, latencyTracePort: { record } }, milestones });
  await vi.runAllTimersAsync();
  expect(record.mock.calls).toEqual(expectedEvents.map(event => [{ event }]));
});

it.each([null, unmatched])("retries only the failed sibling at the existing delays: %j", async failure => {
  const record = vi.fn().mockResolvedValueOnce(unmatched).mockResolvedValue(ok);
  const recordBatch = vi.fn().mockResolvedValue({ results: [ok, failure] });
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, latencyTracePort: { record, recordBatch } }, milestones });
  await vi.advanceTimersByTimeAsync(249);
  expect(record).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(record).toHaveBeenCalledExactlyOnceWith({ event: expectedEvents[1] });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[1]).toEqual(record.mock.calls[0]);
  expect(recordBatch).toHaveBeenCalledOnce();
});

it.each(["transport", "malformed", "late-staging"])("preserves the three-attempt budget for %s batches", async failure => {
  const record = vi.fn().mockResolvedValue(ok);
  const recordBatch = vi.fn();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (failure === "transport") recordBatch.mockRejectedValueOnce(new Error("Synthetic failure"));
    else recordBatch.mockResolvedValueOnce({ results: failure === "malformed" ? [] : [unmatched, unmatched] });
  }
  recordBatch.mockResolvedValue({ results: [ok, ok] });
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, latencyTracePort: { record, recordBatch } }, milestones });
  await vi.runAllTimersAsync();
  expect(recordBatch).toHaveBeenCalledTimes(3);
  for (const call of recordBatch.mock.calls) expect(call).toEqual([{ events: expectedEvents }]);
  expect(record).not.toHaveBeenCalled();
});

it("splits at both the event and encoded-body bounds without adding a timer", async () => {
  const record = vi.fn().mockResolvedValue(ok);
  const recordBatch = vi.fn(async ({ events }: { events: HostedRuntimeLatencyTraceAssistantMilestoneEvent[] }) => ({ results: events.map(() => ok) }));
  const port = { record, recordBatch };
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, latencyTracePort: port }, milestones: Array.from({ length: 17 }, () => milestones[0]!) });
  await vi.runAllTimersAsync();
  expect(recordBatch.mock.calls.map(([request]) => request.events.length)).toEqual([HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS, HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS]);
  expect(record).toHaveBeenCalledOnce();
  record.mockClear(); recordBatch.mockClear();
  const assistantInputIds = Array.from({ length: 64 }, (_, index) => `${index}-${"x".repeat(300)}`);
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, assistantInputIds, latencyTracePort: port }, milestones });
  await vi.runAllTimersAsync();
  expect(recordBatch).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledTimes(2);
  for (const [request] of record.mock.calls) expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES);
});

it("reports exhausted typing once without delaying or retrying its successful sibling", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const record = vi.fn().mockRejectedValue(new Error("Synthetic private prose"));
  const recordBatch = vi.fn().mockResolvedValue({ results: [null, ok] });
  recordHostedAssistantMilestonesBestEffort({ context: { ...context, latencyTracePort: { record, recordBatch } }, milestones: [
    { at: milestones[0]!.at, milestone: "linq_typing_accepted" }, milestones[1]!,
  ] });
  await vi.runAllTimersAsync();
  expect(recordBatch).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledExactlyOnceWith("Hosted typing acceptance telemetry exhausted its retry budget.", { source: "linq", inputCount: 1 });
});


it("retains the invocation abort guard for batches and legacy singleton ports", async () => {
  const record = vi.fn().mockResolvedValue(ok);
  const recordBatch = vi.fn().mockResolvedValue({ results: [ok, ok] });
  const guard = async <T>(_run: () => Promise<T>): Promise<T> => {
    throw new Error("Synthetic invocation aborted");
  };
  const legacy = guardHostedRuntimeLatencyTracePort({ record }, guard);
  expect(legacy.recordBatch).toBeUndefined();
  await expect(legacy.record({ event: { ...context, ...milestones[0]!, type: "assistant_milestone" } })).rejects.toThrow("invocation aborted");
  const batch = guardHostedRuntimeLatencyTracePort({ record, recordBatch }, guard);
  await expect(batch.recordBatch!({ events: milestones.map(milestone => ({ ...context, ...milestone, type: "assistant_milestone" })) })).rejects.toThrow("invocation aborted");
  expect(record).not.toHaveBeenCalled();
  expect(recordBatch).not.toHaveBeenCalled();
});

describe("staged-write ordering", () => {
  const stagedEvent = {
    assistantInputId: "synthetic-input", at: "2026-09-01T12:00:00.000Z", mailboxItemId: "synthetic-mailbox-item",
    runtimeAttemptId: "synthetic-attempt", source: "telegram", type: "assistant_input_staged",
  } as const;
  const sentAt = "2026-09-01T12:00:30.000Z";
  const recordDependentWrites = (port: { record: (request: { event: { type: string } }) => Promise<typeof ok> }) => {
    recordHostedAssistantMilestonesBestEffort({
      context: { ...context, source: "telegram", latencyTracePort: port },
      milestones: [{ at: "2026-09-01T12:00:04.900Z", milestone: "telegram_typing_accepted" }],
    });
    recordHostedDeliveryCommittedBestEffort({
      context: { latencyTracePort: port, runtimeAttemptId: "synthetic-attempt" },
      intent: {
        answeredMailboxItemIds: ["synthetic-mailbox-item"],
        delivery: {
          channel: "telegram", idempotencyKey: null, messageLength: 1, providerMessageId: null,
          providerThreadId: null, sentAt, target: "synthetic-chat", targetKind: "thread",
        },
        sentAt,
        status: "sent",
      },
    });
  };

  it("holds dependent writes until a slow staged write lands so their retries cannot expire first", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let staged = false;
    let landStaged = () => {};
    // Web matches milestone and delivery rows only after staging tags the trace.
    const record = vi.fn(({ event }: { event: { type: string } }) => event.type === "assistant_input_staged"
      ? new Promise<typeof ok>((resolve) => { landStaged = () => { staged = true; resolve(ok); }; })
      : Promise.resolve(staged ? ok : unmatched));
    recordHostedStagedLatencyTraceBestEffort({ record }, { event: stagedEvent });
    recordDependentWrites({ record });
    // Longer than the 0/250/1000 ms budget that dropped production typing.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(record).toHaveBeenCalledExactlyOnceWith({ event: stagedEvent });
    landStaged();
    await vi.runAllTimersAsync();
    expect(record.mock.calls.slice(1).map(([request]) => request.event.type).sort()).toEqual([
      "assistant_milestone", "delivery_committed",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("releases dependent writes when the staged write fails", async () => {
    const record = vi.fn(({ event }: { event: { type: string } }) => event.type === "assistant_input_staged"
      ? Promise.reject(new Error("Synthetic staged failure"))
      : Promise.resolve(ok));
    recordHostedStagedLatencyTraceBestEffort({ record }, { event: stagedEvent });
    recordDependentWrites({ record });
    await vi.advanceTimersByTimeAsync(0);
    expect(record).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
