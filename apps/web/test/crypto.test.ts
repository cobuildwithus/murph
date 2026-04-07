import { afterEach, describe, expect, it } from "vitest";

import { createHostedSecretCodec, decodeHostedEncryptionKey } from "@/src/lib/device-sync/crypto";
import {
  encryptHostedWebNullableString,
  isHostedWebConfigurationError,
} from "@/src/lib/hosted-web/encryption";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VITEST = process.env.VITEST;
const ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY = process.env.HOSTED_WEB_ENCRYPTION_KEY;
const ORIGINAL_HOSTED_WEB_ENCRYPTION_KEYRING_JSON = process.env.HOSTED_WEB_ENCRYPTION_KEYRING_JSON;
const ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY_VERSION = process.env.HOSTED_WEB_ENCRYPTION_KEY_VERSION;

afterEach(() => {
  restoreEnvValue("NODE_ENV", ORIGINAL_NODE_ENV);

  if (ORIGINAL_VITEST === undefined) {
    delete process.env.VITEST;
  } else {
    process.env.VITEST = ORIGINAL_VITEST;
  }

  restoreEnvValue("HOSTED_WEB_ENCRYPTION_KEY", ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY);
  restoreEnvValue("HOSTED_WEB_ENCRYPTION_KEYRING_JSON", ORIGINAL_HOSTED_WEB_ENCRYPTION_KEYRING_JSON);
  restoreEnvValue("HOSTED_WEB_ENCRYPTION_KEY_VERSION", ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY_VERSION);
  clearHostedWebEncryptionCodecCache();
});

describe("hosted device-sync secret codec", () => {
  it("round-trips encrypted secrets", () => {
    const codec = createHostedSecretCodec({
      key: Buffer.alloc(32, 7),
      keyVersion: "v1",
    });

    const encrypted = codec.encrypt("top-secret-token");
    expect(encrypted).toContain("hbds:v1:");
    expect(codec.decrypt(encrypted)).toBe("top-secret-token");
  });

  it("accepts base64url key material", () => {
    const key = Buffer.alloc(32, 3);
    expect(decodeHostedEncryptionKey(key.toString("base64url"))).toEqual(key);
  });

  it("surfaces a hosted-web config error when hosted private-field encryption runs without a key outside test mode", () => {
    restoreEnvValue("NODE_ENV", "development");
    delete process.env.VITEST;
    delete process.env.HOSTED_WEB_ENCRYPTION_KEY;
    delete process.env.HOSTED_WEB_ENCRYPTION_KEYRING_JSON;
    delete process.env.HOSTED_WEB_ENCRYPTION_KEY_VERSION;
    clearHostedWebEncryptionCodecCache();

    const error = captureThrownError(() =>
      encryptHostedWebNullableString({
        field: "hosted-member-identity.phone-number",
        memberId: "member_test",
        value: "+15551234567",
      }));

    expect(isHostedWebConfigurationError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "HOSTED_WEB_ENCRYPTION_KEY_REQUIRED",
      httpStatus: 500,
      message: "HOSTED_WEB_ENCRYPTION_KEY must be configured for hosted member private field encryption.",
      name: "HostedWebConfigurationError",
    });
  });

  it("surfaces malformed hosted-web encryption config as a server-side config error", () => {
    restoreEnvValue("NODE_ENV", "development");
    delete process.env.VITEST;
    process.env.HOSTED_WEB_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64url");
    process.env.HOSTED_WEB_ENCRYPTION_KEYRING_JSON = "{";
    delete process.env.HOSTED_WEB_ENCRYPTION_KEY_VERSION;
    clearHostedWebEncryptionCodecCache();

    const error = captureThrownError(() =>
      encryptHostedWebNullableString({
        field: "hosted-member-identity.phone-number",
        memberId: "member_test",
        value: "+15551234567",
      }));

    expect(isHostedWebConfigurationError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "HOSTED_WEB_ENCRYPTION_CONFIG_INVALID",
      httpStatus: 500,
      name: "HostedWebConfigurationError",
    });
    expect(error.message).toContain("HOSTED_WEB_ENCRYPTION_KEYRING_JSON must be valid JSON");
  });
});

function captureThrownError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }

    throw new Error(`Expected Error instance, received ${String(error)}`);
  }

  throw new Error("Expected action to throw.");
}

function clearHostedWebEncryptionCodecCache(): void {
  delete (globalThis as typeof globalThis & {
    __murphHostedWebEncryptionCodec?: unknown;
  }).__murphHostedWebEncryptionCodec;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
