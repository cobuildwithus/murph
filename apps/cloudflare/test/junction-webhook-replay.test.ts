import { describe, expect, it } from "vitest";

import {
  buildSignedWebhookDataRecord,
} from "./helpers/junction-webhook-replay.js";

describe("Junction webhook replay helpers", () => {
  it("normalizes fixture identity fields so signed webhook payloads cannot conflict", () => {
    const data = buildSignedWebhookDataRecord(
      {
        client_user_id: "fixture-client-user-1",
        event: {
          clientUserId: "fixture-client-user-2",
          user_id: "fixture-user-3",
        },
        nested: [
          {
            userId: "fixture-user-4",
          },
        ],
        source: {
          provider: "fixture-provider",
        },
        user: {
          id: "fixture-user-2",
        },
        user_id: "fixture-user-1",
        value: 42,
      },
      {
        externalAccountId: "junction-user-1",
        objectId: "fixture-object-1",
        resource: "sleep",
        sourceProviderSlug: "oura",
      },
    );

    expect(data).toEqual({
      event: {},
      id: "fixture-object-1",
      nested: [{}],
      resource: "sleep",
      source: {
        provider: "oura",
      },
      user_id: "junction-user-1",
      value: 42,
    });
  });
});
