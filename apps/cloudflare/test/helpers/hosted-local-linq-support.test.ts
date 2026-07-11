import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startHostedLocalLinqStub,
  type HostedLocalLinqWaitScenario,
} from "./hosted-local-linq-support.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted local Linq provider stub", () => {
  it("serves canonical direct-chat summaries through its shared runtime URL", async () => {
    const stub = await startHostedLocalLinqStub();

    try {
      expect(new URL(stub.runnerBaseUrl).hostname).toBe("host.docker.internal");
      const response = await fetch(`${stub.baseUrl}/chats/chat_direct`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        handles: [],
        id: "chat_direct",
        is_group: false,
      });
    } finally {
      await stub.stop();
    }
  });
});

it("times out passively without access to runtime recovery controls", async () => {
  const stub = await startHostedLocalLinqStub();
  const scenario = {
    buildFailureMessage: async (_userId: string, summaryLines: readonly string[]) =>
      summaryLines.join("\n"),
  } satisfies HostedLocalLinqWaitScenario;

  vi.useFakeTimers();
  try {
    const waitPromise = stub.waitForSend({
      expectedPath: "/chats/passive/messages",
      scenario,
      userId: "member_passive_linq_wait",
    });
    const rejection = expect(waitPromise).rejects.toThrow(
      /Timed out waiting for 1 Linq request/u,
    );

    await vi.advanceTimersByTimeAsync(180_250);
    await rejection;
  } finally {
    vi.useRealTimers();
    await stub.stop();
  }
});
