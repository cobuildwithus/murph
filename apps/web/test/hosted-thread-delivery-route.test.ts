import { describe, expect, it } from "vitest";

import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
  openHostedThreadDeliveryRoute,
  parseHostedThreadDeliveryRouteV1,
  sealHostedThreadDeliveryRoute,
  serializeHostedThreadDeliveryRouteV1,
} from "../src/lib/hosted-routing/thread-delivery-route";

describe("hosted thread delivery route codec", () => {
  it("round-trips a versioned Linq route under the container crypto owner", async () => {
    const route = buildHostedThreadDeliveryRoute({
      accountLookupKey: "linq-account-key",
      channel: "linq",
      threadId: "linq-group-chat",
    });

    const encrypted = await sealHostedThreadDeliveryRoute({
      containerMemberId: "container-member",
      route,
    });

    expect(encrypted).toMatch(/^hsb-test:/u);
    expect(encrypted).not.toContain("linq-group-chat");
    await expect(openHostedThreadDeliveryRoute({
      channel: "linq",
      containerMemberId: "container-member",
      encrypted,
    })).resolves.toEqual(route);
    await expect(openHostedThreadDeliveryRoute({
      channel: "linq",
      containerMemberId: "another-container",
      encrypted,
    })).rejects.toThrow("metadata mismatch");
  });

  it("stores only the reconstructible Telegram thread target", async () => {
    const route = buildHostedThreadDeliveryRoute({
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram",
      threadId: -1001234567890,
    });

    expect(route).toEqual({
      channel: "telegram",
      schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
      threadId: "-1001234567890",
    });
    expect(serializeHostedThreadDeliveryRouteV1(route)).not.toContain(
      "accountLookupKey",
    );

    const encrypted = await sealHostedThreadDeliveryRoute({
      containerMemberId: "telegram-container",
      route,
    });
    await expect(openHostedThreadDeliveryRoute({
      channel: "telegram",
      containerMemberId: "telegram-container",
      encrypted,
    })).resolves.toEqual(route);
  });

  it("requires the Linq account identity and canonical Telegram identity", () => {
    expect(() => buildHostedThreadDeliveryRoute({
      accountLookupKey: null,
      channel: "linq",
      threadId: "chat",
    })).toThrow("value is invalid");
    expect(() => buildHostedThreadDeliveryRoute({
      accountLookupKey: "telegram:another-bot",
      channel: "telegram",
      threadId: "chat",
    })).toThrow("canonical account lookup key");
  });

  it("strictly rejects unknown schemas, channels, and extra fields", () => {
    expect(() => parseHostedThreadDeliveryRouteV1(JSON.stringify({
      channel: "linq",
      schema: "murph.hosted-thread-delivery-route.v2",
      threadId: "chat",
    }))).toThrow("schema is invalid");
    expect(() => parseHostedThreadDeliveryRouteV1(JSON.stringify({
      channel: "email",
      schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
      threadId: "chat",
    }))).toThrow("channel is invalid");
    expect(() => parseHostedThreadDeliveryRouteV1(JSON.stringify({
      accountLookupKey: "account",
      channel: "linq",
      extra: true,
      schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
      threadId: "chat",
    }))).toThrow("fields are invalid");
  });
});
