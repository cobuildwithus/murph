import { describe, expect, it } from "vitest";

import {
  buildLinqHostedRuntimeRequest,
  LINQ_HOSTED_RUNTIME_ROUTE_DEFINITIONS,
  matchLinqHostedRuntimeRoute,
} from "../src/linq-hosted-runtime-routes.ts";

function examplePathParameters(
  pathSegments: readonly (string | null)[],
): string[] {
  return pathSegments
    .filter((segment) => segment === null)
    .map((_, index) => `resource ${index + 1}`);
}

describe("Linq hosted runtime route contract", () => {
  it("builds and matches every declared runtime route", () => {
    const operations = new Set<string>();
    const signatures = new Set<string>();

    for (const route of LINQ_HOSTED_RUNTIME_ROUTE_DEFINITIONS) {
      const pathParameters = examplePathParameters(route.pathSegments);
      const request = buildLinqHostedRuntimeRequest(
        route.operation,
        pathParameters,
      );

      expect(request.method).toBe(route.method);
      expect(request.path).not.toContain(" ");
      expect(matchLinqHostedRuntimeRoute(request.method, request.path)).toBe(
        route.operation,
      );

      expect(operations.has(route.operation)).toBe(false);
      operations.add(route.operation);
      const signature = `${request.method} ${request.path}`;
      expect(signatures.has(signature)).toBe(false);
      signatures.add(signature);
    }
  });

  it("keeps the iMessage capability probe in the hosted egress contract", () => {
    expect(buildLinqHostedRuntimeRequest("imessage_capability_check")).toEqual({
      method: "POST",
      path: "/capability/check_imessage",
    });
    expect(
      matchLinqHostedRuntimeRoute("POST", "/capability/check_imessage"),
    ).toBe("imessage_capability_check");
  });

  it("encodes dynamic path parameters before matching them", () => {
    expect(buildLinqHostedRuntimeRequest("message_send", ["chat/one two"])).toEqual({
      method: "POST",
      path: "/chats/chat%2Fone%20two/messages",
    });
  });

  it("fails closed for unsupported methods and path shapes", () => {
    expect(matchLinqHostedRuntimeRoute("GET", "/capability/check_imessage")).toBeNull();
    expect(matchLinqHostedRuntimeRoute("POST", "/capability/check_imessage/")).toBeNull();
    expect(matchLinqHostedRuntimeRoute("POST", "/capability//check_imessage")).toBeNull();
    expect(matchLinqHostedRuntimeRoute("POST", "/webhook-subscriptions")).toBeNull();
  });

  it("rejects missing, extra, or empty dynamic path parameters", () => {
    expect(() => buildLinqHostedRuntimeRequest("message_send")).toThrow(
      /requires 1 path parameter/u,
    );
    expect(() =>
      buildLinqHostedRuntimeRequest("message_send", ["chat_1", "extra"])
    ).toThrow(/requires 1 path parameter/u);
    expect(() => buildLinqHostedRuntimeRequest("message_send", [""])).toThrow(
      /empty path parameter/u,
    );
  });
});
