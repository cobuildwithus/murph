import { createHmac } from "node:crypto";

import { DeviceSyncError } from "@healthybob/device-syncd";
import { describe, expect, it } from "vitest";

import { assertBrowserMutationOrigin, requireAuthenticatedHostedUser } from "@/src/lib/device-sync/auth";
import type { HostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const BASE_ENVIRONMENT: HostedDeviceSyncEnvironment = {
  allowedMutationOrigins: [],
  allowedReturnOrigins: [],
  encryptionKey: Buffer.alloc(32, 0),
  encryptionKeyVersion: "v1",
  isProduction: false,
  ouraWebhookVerificationToken: null,
  publicBaseUrl: null,
  trustedUserEmailHeader: "x-healthybob-user-email",
  trustedUserIdHeader: "x-healthybob-user-id",
  trustedUserNameHeader: "x-healthybob-user-name",
  trustedUserSignatureHeader: "x-healthybob-user-signature",
  trustedUserSigningSecret: "test-signing-secret",
  devUserEmail: "dev@example.com",
  devUserId: "dev-user",
  devUserName: "Dev User",
  providers: {
    whoop: null,
    oura: null,
  },
};

describe("requireAuthenticatedHostedUser", () => {
  it("accepts cryptographically signed hosted user headers", () => {
    const request = new Request("https://example.test/device-sync", {
      headers: {
        "x-healthybob-user-id": "user-123",
        "x-healthybob-user-email": "person@example.com",
        "x-healthybob-user-name": "Person",
        "x-healthybob-user-signature": createSignature({
          id: "user-123",
          email: "person@example.com",
          name: "Person",
        }),
      },
    });

    expect(requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT)).toEqual({
      id: "user-123",
      email: "person@example.com",
      name: "Person",
      source: "trusted-header",
    });
  });

  it("rejects forged hosted user headers instead of falling back to the development user", () => {
    const request = new Request("https://example.test/device-sync", {
      headers: {
        "x-healthybob-user-id": "user-123",
        "x-healthybob-user-email": "person@example.com",
        "x-healthybob-user-name": "Person",
        "x-healthybob-user-signature": createSignature({
          id: "user-123",
          email: "attacker@example.com",
          name: "Person",
        }),
      },
    });

    expectDeviceSyncError(
      () => requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT),
      "AUTH_HEADER_INVALID",
      401,
    );
  });

  it("rejects unsigned hosted user headers instead of trusting the raw values", () => {
    const request = new Request("https://example.test/device-sync", {
      headers: {
        "x-healthybob-user-id": "user-123",
        "x-healthybob-user-email": "person@example.com",
        "x-healthybob-user-name": "Person",
      },
    });

    expectDeviceSyncError(
      () => requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT),
      "AUTH_HEADER_INVALID",
      401,
    );
  });

  it("falls back to the development user when trusted headers are absent", () => {
    const request = new Request("https://example.test/device-sync");

    expect(requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT)).toEqual({
      id: "dev-user",
      email: "dev@example.com",
      name: "Dev User",
      source: "development-fallback",
    });
  });
});

describe("assertBrowserMutationOrigin", () => {
  it("fails closed when a browser mutation request omits the Origin header", () => {
    expectDeviceSyncError(
      () =>
        assertBrowserMutationOrigin(
          new Request("https://control.example.test/api/device-sync/providers/whoop/connect", {
            method: "POST",
          }),
          BASE_ENVIRONMENT,
        ),
      "CSRF_ORIGIN_REQUIRED",
      403,
    );
  });

  it("rejects cross-origin POST attempts even when the origin is only allowed as a redirect return origin", () => {
    expectDeviceSyncError(
      () =>
        assertBrowserMutationOrigin(
          new Request("https://control.example.test/api/device-sync/providers/whoop/connect", {
            method: "POST",
            headers: {
              origin: "https://return.example.test",
            },
          }),
          {
            ...BASE_ENVIRONMENT,
            allowedReturnOrigins: ["https://return.example.test"],
          },
        ),
      "CSRF_ORIGIN_INVALID",
      403,
    );
  });

  it("allows configured cross-origin POST requests only from the mutation-origin allowlist", () => {
    expect(() =>
      assertBrowserMutationOrigin(
        new Request("https://control.example.test/api/device-sync/providers/whoop/connect", {
          method: "POST",
          headers: {
            origin: "https://operator.example.test",
          },
        }),
        {
          ...BASE_ENVIRONMENT,
          allowedMutationOrigins: ["https://operator.example.test"],
          allowedReturnOrigins: ["https://return.example.test"],
        },
      ),
    ).not.toThrow();
  });
});

function createSignature(claims: { id: string; email: string | null; name: string | null }) {
  return createHmac("sha256", BASE_ENVIRONMENT.trustedUserSigningSecret ?? "")
    .update(JSON.stringify([claims.id, claims.email ?? null, claims.name ?? null]))
    .digest("hex");
}

function expectDeviceSyncError(
  action: () => unknown,
  expectedCode: string,
  expectedStatus: number,
) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DeviceSyncError);
    expect(error).toMatchObject({
      code: expectedCode,
      httpStatus: expectedStatus,
    });
    return;
  }

  throw new Error(`Expected DeviceSyncError ${expectedCode}.`);
}
