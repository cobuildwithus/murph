import { expect, it, vi } from "vitest";
import { parseHostedRuntimeLatencyTraceBatchRequest, parseHostedRuntimeLatencyTraceRequest } from "@murphai/hosted-execution/parsers";
import type { HostedRuntimeLatencyTraceAssistantMilestoneEvent } from "@murphai/hosted-execution/runtime-control";
import { createHostedWebRuntimeLatencyTracePort } from "../src/runtime-platform/latency-trace-port.ts";

const events: HostedRuntimeLatencyTraceAssistantMilestoneEvent[] = ["first_codex_output_observed", "first_codex_text_observed"].map((milestone, index) => ({
  type: "assistant_milestone", assistantInputIds: ["synthetic-input"], source: "linq", runtimeAttemptId: "synthetic-attempt",
  at: `2026-09-01T12:00:00.00${index}Z`, milestone: milestone as HostedRuntimeLatencyTraceAssistantMilestoneEvent["milestone"],
}));
const ok = { matchedCount: 1, recorded: true, unmatchedCount: 0 };
const lease = { userId: "synthetic-member", attemptId: "synthetic-attempt", leaseGeneration: "7", workspaceVersion: "2" };

it("serializes two milestones into one fenced HTTP request while legacy singles stay unchanged", async () => {
  const received: unknown[] = [];
  const readCurrentLease = vi.fn(() => lease);
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe("/api/internal/hosted-runtime/latency");
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe(lease.attemptId);
    const payload = await request.json();
    if (payload && typeof payload === "object" && "events" in payload) {
      // The still-supported singleton parser is the deployed old-reader wire contract.
      expect(() => parseHostedRuntimeLatencyTraceRequest(payload)).toThrow();
      received.push(parseHostedRuntimeLatencyTraceBatchRequest(payload));
      return Response.json({ results: [ok, null] });
    }
    received.push(parseHostedRuntimeLatencyTraceRequest(payload));
    return Response.json(ok);
  });
  const port = createHostedWebRuntimeLatencyTracePort({ boundUserId: "synthetic-member", fetchImpl, timeoutMs: 1_000, transport: { mode: "proxy" }, workspaceCheckpointBridge: { readCurrentLease } });
  expect(await port.recordBatch({ events })).toEqual({ results: [ok, null] });
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(readCurrentLease).toHaveBeenCalledOnce();
  expect(received).toEqual([{ events }]);
  expect(await port.record({ event: events[0]! })).toEqual(ok);
  expect(received[1]).toEqual({ event: events[0] });
});

it("suppresses a stale batch and rejects mixed attempts before sending", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const port = createHostedWebRuntimeLatencyTracePort({ boundUserId: "synthetic-member", fetchImpl, timeoutMs: 1_000, transport: { mode: "proxy" }, workspaceCheckpointBridge: { readCurrentLease: () => ({ ...lease, attemptId: "synthetic-successor" }) } });
  expect(await port.recordBatch({ events })).toEqual({ results: events.map(() => ({ matchedCount: 0, recorded: false, unmatchedCount: 0 })) });
  await expect(port.recordBatch({ events: [events[0]!, { ...events[1]!, runtimeAttemptId: "other" }] })).rejects.toThrow("attempts do not match");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([{ results: [] }, { results: [ok] }, { results: [ok, { recorded: true }] }])("rejects malformed batch results: %j", async payload => {
  const port = createHostedWebRuntimeLatencyTracePort({ boundUserId: "synthetic-member", fetchImpl: vi.fn<typeof fetch>(async () => Response.json(payload)), timeoutMs: 1_000, transport: { mode: "proxy" }, workspaceCheckpointBridge: { readCurrentLease: () => lease } });
  await expect(port.recordBatch({ events })).rejects.toThrow();
});
