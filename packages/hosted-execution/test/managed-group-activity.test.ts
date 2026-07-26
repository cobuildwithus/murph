import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeManagedGroupActivityDecisionRequest,
  parseHostedRuntimeManagedGroupActivityDecisionResponse,
} from "@murphai/hosted-execution/parsers";
import {
  resolveHostedRuntimeManagedGroupActivityWindow,
} from "@murphai/hosted-execution/runtime-control";

const validRequest = {
  occurrenceAt: "2026-07-26T22:00:00.000Z",
  policy: "group-sunday-superlatives-v1",
  route: {
    channel: "telegram",
    target: "group-thread-1",
  },
  timeZone: "America/New_York",
};

describe("managed group activity control contract", () => {
  it("accepts one strict closed request and status-only response", () => {
    expect(parseHostedRuntimeManagedGroupActivityDecisionRequest(validRequest))
      .toEqual(validRequest);
    expect(parseHostedRuntimeManagedGroupActivityDecisionResponse({
      status: "eligible",
    })).toEqual({ status: "eligible" });
    expect(() => parseHostedRuntimeManagedGroupActivityDecisionResponse({
      count: 100,
      status: "eligible",
    })).toThrow(/is not allowed/u);
    expect(() => parseHostedRuntimeManagedGroupActivityDecisionRequest({
      ...validRequest,
      policy: "caller-selected-threshold",
    })).toThrow(/policy is invalid/u);
  });

  it("uses seven local calendar dates across spring-forward DST", () => {
    const window = resolveHostedRuntimeManagedGroupActivityWindow({
      occurrenceAt: "2026-03-08T22:00:00.000Z",
      timeZone: "America/New_York",
    });
    expect(window).toEqual({
      occurrenceAt: "2026-03-08T22:00:00.000Z",
      timeZone: "America/New_York",
      windowStartAt: "2026-03-01T23:00:00.000Z",
    });
    expect(Date.parse(window.occurrenceAt) - Date.parse(window.windowStartAt))
      .toBe(167 * 60 * 60 * 1_000);
  });

  it("uses seven local calendar dates across fall-back DST", () => {
    const window = resolveHostedRuntimeManagedGroupActivityWindow({
      occurrenceAt: "2026-11-01T23:00:00.000Z",
      timeZone: "America/New_York",
    });
    expect(window).toEqual({
      occurrenceAt: "2026-11-01T23:00:00.000Z",
      timeZone: "America/New_York",
      windowStartAt: "2026-10-25T22:00:00.000Z",
    });
    expect(Date.parse(window.occurrenceAt) - Date.parse(window.windowStartAt))
      .toBe(169 * 60 * 60 * 1_000);
  });
});
