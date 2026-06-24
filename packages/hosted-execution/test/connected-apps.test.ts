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

  it("accepts accountless service execution while preserving account selectors", () => {
    expect(
      hostedConnectedAppsExecuteInputSchema.parse({
        arguments: { query: "pharmacy" },
        toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
      }),
    ).toEqual({
      arguments: { query: "pharmacy" },
      toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
    });

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

    expect(
      hostedConnectedAppsExecuteInputSchema.parse({
        account: "calendar",
        arguments: {
          event_duration_hour: 0,
          event_duration_minutes: 30,
          start_datetime: "2026-07-01T10:00:00-04:00",
          summary: "Annual physical",
          timezone: "America/New_York",
        },
        agentApproved: true,
        toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      }),
    ).toMatchObject({
      account: "calendar",
      agentApproved: true,
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
    });
    expect(
      hostedConnectedAppsExecuteInputSchema.safeParse({
        account: "calendar",
        agentApproved: false,
        arguments: {},
        toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      }).success,
    ).toBe(false);
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
