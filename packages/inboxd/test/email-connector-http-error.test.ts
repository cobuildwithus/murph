import assert from "node:assert/strict";

import { test } from "vitest";

import type { AgentmailFetchResponse } from "../src/connectors/email/connector.ts";
import { createAgentmailApiPollDriver } from "../src/connectors/email/connector.ts";

function createSingleUseErrorResponse(input: {
  body: string;
  status?: number;
}): AgentmailFetchResponse {
  let consumed = false;

  const consume = (): string => {
    if (consumed) {
      throw new TypeError("Body already consumed.");
    }

    consumed = true;
    return input.body;
  };

  return {
    ok: false,
    status: input.status ?? 502,
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
    async json() {
      return JSON.parse(consume()) as unknown;
    },
    async text() {
      return consume();
    },
  };
}

test("createAgentmailApiPollDriver surfaces plain-text AgentMail errors", async () => {
  const driver = createAgentmailApiPollDriver({
    apiKey: "test-key",
    inboxId: "inbox-1",
    fetchImplementation: async () =>
      createSingleUseErrorResponse({
        body: "gateway unavailable",
      }),
  });

  await assert.rejects(
    () => driver.listUnreadMessages(),
    /gateway unavailable/,
  );
});
