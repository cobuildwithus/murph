import { describe, expect, it } from "vitest";

import {
  HOSTED_CONNECTED_APPS_PATH,
  hostedConnectedAppsExecuteInputSchema,
  hostedConnectedAppsRequestSchema,
} from "../src/connected-apps.ts";

describe("hosted connected-app contracts", () => {
  it("keeps one stable internal route", () => {
    expect(HOSTED_CONNECTED_APPS_PATH).toBe("/api/internal/connected-apps");
  });

  it("requires an explicit account for execution", () => {
    expect(
      hostedConnectedAppsExecuteInputSchema.safeParse({
        arguments: {},
        toolSlug: "GMAIL_FETCH_EMAILS",
      }).success,
    ).toBe(false);

    expect(
      hostedConnectedAppsExecuteInputSchema.parse({
        account: "work",
        arguments: { query: "newer_than:7d" },
        toolSlug: "GMAIL_FETCH_EMAILS",
      }),
    ).toEqual({
      account: "work",
      arguments: { query: "newer_than:7d" },
      toolSlug: "GMAIL_FETCH_EMAILS",
    });
  });

  it("accepts the bounded management, search, and execution operations", () => {
    expect(
      hostedConnectedAppsRequestSchema.parse({
        operation: "manage",
        input: { action: "connect", alias: "work", toolkit: "gmail" },
      }).operation,
    ).toBe("manage");
    expect(
      hostedConnectedAppsRequestSchema.parse({
        operation: "search",
        input: { query: "find messages with PDF attachments", toolkits: ["gmail"] },
      }).operation,
    ).toBe("search");
    expect(
      hostedConnectedAppsRequestSchema.parse({
        operation: "execute",
        input: {
          account: "work",
          arguments: { message_id: "m_123" },
          toolSlug: "GMAIL_GET_ATTACHMENT",
        },
      }).operation,
    ).toBe("execute");
  });
});
