import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionRunnerJobInput,
} from "../src/runner-job-transport.ts";

describe("runner job transport", () => {
  it("preserves and validates workspace invocation processing modes", () => {
    const input = {
      kind: "workspace-invocation",
      request: {
        attemptId: "attempt_system_mailbox",
        leaseGeneration: "1",
        processingMode: "system_mailbox",
        userId: "member_123",
        workspaceVersion: "0",
      },
    } as const;

    expect(parseHostedExecutionRunnerJobInput(input).request.processingMode).toBe(
      "system_mailbox",
    );
    expect(() => parseHostedExecutionRunnerJobInput({
      ...input,
      request: {
        ...input.request,
        processingMode: "assistant",
      },
    })).toThrow(
      "Hosted workspace invocation request processingMode is not supported.",
    );
  });
});
