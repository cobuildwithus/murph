import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

type ReviewGptThreadCliModule = {
  shouldReturnWakeToCallingSession: (input: {
    currentSessionId?: string;
    detachedWake?: boolean;
    sessionId?: string;
  }) => boolean;
};

async function loadReviewGptThreadCliModule(): Promise<ReviewGptThreadCliModule> {
  const modulePath = path.resolve(
    "node_modules/@cobuild/review-gpt/dist/thread-cli.mjs",
  );
  return import(pathToFileURL(modulePath).href) as Promise<ReviewGptThreadCliModule>;
}

describe("ReviewGPT wake owner delivery", () => {
  it("returns a synchronous wake to the exact calling Codex session", async () => {
    const reviewGpt = await loadReviewGptThreadCliModule();

    expect(
      reviewGpt.shouldReturnWakeToCallingSession({
        currentSessionId: "session-current",
        sessionId: "session-current",
      }),
    ).toBe(true);
  });

  it("does not return another session's wake to the caller", async () => {
    const reviewGpt = await loadReviewGptThreadCliModule();

    expect(
      reviewGpt.shouldReturnWakeToCallingSession({
        currentSessionId: "session-current",
        sessionId: "session-other",
      }),
    ).toBe(false);
    expect(
      reviewGpt.shouldReturnWakeToCallingSession({
        currentSessionId: "",
        sessionId: "session-current",
      }),
    ).toBe(false);
  });

  it("retains child handoff for detached wakes even when session metadata is inherited", async () => {
    const reviewGpt = await loadReviewGptThreadCliModule();

    expect(
      reviewGpt.shouldReturnWakeToCallingSession({
        currentSessionId: "session-current",
        detachedWake: true,
        sessionId: "session-current",
      }),
    ).toBe(false);
  });
});
