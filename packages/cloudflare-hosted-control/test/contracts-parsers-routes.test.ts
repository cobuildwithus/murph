import { describe, expect, it } from "vitest";

import {
  parseCloudflareHostedManagedUserCryptoStatus,
  parseCloudflareHostedUserEnvStatus,
  parseCloudflareHostedUserEnvUpdate,
} from "../src/parsers.ts";
import {
  buildCloudflareHostedControlUserCryptoContextPath,
  buildCloudflareHostedControlUserDispatchPayloadPath,
  buildCloudflareHostedControlUserEnvPath,
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
  buildCloudflareHostedControlUserStoredDispatchPath,
} from "../src/routes.ts";

describe("@murphai/cloudflare-hosted-control contracts, parsers, and routes", () => {
  it("parses hosted control responses and updates with strict validation", () => {
    expect(
      parseCloudflareHostedManagedUserCryptoStatus({
        recipientKinds: ["automation", "recovery"],
        rootKeyId: "root-key-123",
        userId: "user_123",
      }),
    ).toEqual({
      recipientKinds: ["automation", "recovery"],
      rootKeyId: "root-key-123",
      userId: "user_123",
    });

    expect(
      parseCloudflareHostedUserEnvStatus({
        configuredUserEnvKeys: ["HOSTED_API_KEY", "HOSTED_REGION"],
        userId: "user_123",
      }),
    ).toEqual({
      configuredUserEnvKeys: ["HOSTED_API_KEY", "HOSTED_REGION"],
      userId: "user_123",
    });

    expect(
      parseCloudflareHostedUserEnvUpdate({
        env: {
          HOSTED_API_KEY: "api-key-123",
          HOSTED_REGION: null,
        },
        mode: "replace",
      }),
    ).toEqual({
      env: {
        HOSTED_API_KEY: "api-key-123",
        HOSTED_REGION: null,
      },
      mode: "replace",
    });

    expect(() =>
      parseCloudflareHostedManagedUserCryptoStatus({
        recipientKinds: "automation",
        rootKeyId: "root-key-123",
        userId: "user_123",
      }),
    ).toThrow("Managed user crypto status response recipientKinds must be an array.");

    expect(() =>
      parseCloudflareHostedManagedUserCryptoStatus({
        recipientKinds: ["automation"],
        rootKeyId: "",
        userId: "user_123",
      }),
    ).toThrow("Managed user crypto status response rootKeyId must be a non-empty string.");

    expect(() =>
      parseCloudflareHostedUserEnvStatus({
        configuredUserEnvKeys: ["HOSTED_API_KEY"],
        userId: " ",
      }),
    ).toThrow("Hosted execution user env status userId must be a non-empty string.");

    expect(() =>
      parseCloudflareHostedUserEnvUpdate(null),
    ).toThrow("Hosted execution user env update must be an object.");

    expect(() =>
      parseCloudflareHostedUserEnvUpdate({
        env: {
          HOSTED_API_KEY: 123,
        },
        mode: "merge",
      }),
    ).toThrow("Hosted execution user env update env.HOSTED_API_KEY must be a string or null.");

    expect(() =>
      parseCloudflareHostedUserEnvUpdate({
        env: {
          HOSTED_API_KEY: "api-key-123",
        },
        mode: "replace-all",
      }),
    ).toThrow("Hosted execution user env update mode is invalid.");
  });

  it("encodes user ids consistently across the route helpers", () => {
    const userId = "user/with spaces?#%";
    const encodedUserId = encodeURIComponent(userId);

    expect(buildCloudflareHostedControlUserCryptoContextPath(userId)).toBe(
      `/internal/users/${encodedUserId}/crypto-context`,
    );
    expect(buildCloudflareHostedControlUserDispatchPayloadPath(userId)).toBe(
      `/internal/users/${encodedUserId}/dispatch-payload`,
    );
    expect(buildCloudflareHostedControlUserEnvPath(userId)).toBe(
      `/internal/users/${encodedUserId}/env`,
    );
    expect(buildCloudflareHostedControlUserRunPath(userId)).toBe(
      `/internal/users/${encodedUserId}/run`,
    );
    expect(buildCloudflareHostedControlUserStatusPath(userId)).toBe(
      `/internal/users/${encodedUserId}/status`,
    );
    expect(buildCloudflareHostedControlUserStoredDispatchPath(userId)).toBe(
      `/internal/users/${encodedUserId}/dispatch-payload/dispatch`,
    );
  });
});
