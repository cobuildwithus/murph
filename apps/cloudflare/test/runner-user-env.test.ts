import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHostedVerifiedEmailUserEnv } from "@murphai/runtime-state";

import {
  decodeHostedUserEnvPayload,
  encodeHostedUserEnvPayload,
} from "../src/user-env.ts";
import type {
  HostedEmailConfig,
} from "../src/hosted-email.ts";
import type {
  HostedUserEnvStore,
  R2BucketLike,
} from "../src/bundle-store.ts";

const mockedModules = vi.hoisted(() => {
  let storedPayload: Uint8Array | null = null;

  const store = {
    clearUserEnv: vi.fn(async () => {
      storedPayload = null;
    }),
    readUserEnv: vi.fn(async () => storedPayload),
    writeUserEnv: vi.fn(async (_userId: string, plaintext: Uint8Array) => {
      storedPayload = plaintext;
    }),
  };

  return {
    ensureHostedEmailVerifiedSenderRouteAvailable: vi.fn(async () => undefined),
    getStoredPayload: () => storedPayload,
    reconcileHostedEmailVerifiedSenderRoute: vi.fn(async () => undefined),
    setStoredPayload: (nextPayload: Uint8Array | null) => {
      storedPayload = nextPayload;
    },
    store,
  };
});

vi.mock("../src/bundle-store.js", () => ({
  createHostedUserEnvStore: vi.fn(() => mockedModules.store as HostedUserEnvStore),
}));

vi.mock("../src/hosted-email.js", () => ({
  ensureHostedEmailVerifiedSenderRouteAvailable:
    mockedModules.ensureHostedEmailVerifiedSenderRouteAvailable,
  reconcileHostedEmailVerifiedSenderRoute:
    mockedModules.reconcileHostedEmailVerifiedSenderRoute,
}));

const { RunnerUserEnvService } = await import("../src/user-runner/runner-user-env.ts");

const hostedEmailConfig: HostedEmailConfig = {
  apiBaseUrl: "https://api.cloudflare.com/client/v4",
  cloudflareAccountId: null,
  cloudflareApiToken: null,
  defaultSubject: "Murph update",
  domain: "example.com",
  fromAddress: "assistant@example.com",
  localPart: "assistant",
  signingSecret: "test-signing-secret",
};

const unusedBucket: R2BucketLike = {
  async get() {
    return null;
  },
  async put() {
    throw new Error("Unexpected bucket write in runner-user-env.test.ts");
  },
};

function createService() {
  return new RunnerUserEnvService(
    unusedBucket,
    new Uint8Array([1]),
    "user-env-key-id",
    {},
    new Uint8Array([2]),
    "email-route-key-id",
    {},
    {},
    hostedEmailConfig,
  );
}

function setStoredEnv(env: Record<string, string>): void {
  mockedModules.setStoredPayload(encodeHostedUserEnvPayload({ env }));
}

function readStoredEnv(): Record<string, string> {
  return decodeHostedUserEnvPayload(mockedModules.getStoredPayload(), {});
}

describe("RunnerUserEnvService.updateUserEnv", () => {
  beforeEach(() => {
    mockedModules.setStoredPayload(null);
    mockedModules.ensureHostedEmailVerifiedSenderRouteAvailable.mockReset().mockResolvedValue(undefined);
    mockedModules.reconcileHostedEmailVerifiedSenderRoute.mockReset().mockResolvedValue(undefined);
    mockedModules.store.clearUserEnv.mockReset().mockImplementation(async () => {
      mockedModules.setStoredPayload(null);
    });
    mockedModules.store.readUserEnv.mockReset().mockImplementation(async () => mockedModules.getStoredPayload());
    mockedModules.store.writeUserEnv.mockReset().mockImplementation(async (_userId: string, plaintext: Uint8Array) => {
      mockedModules.setStoredPayload(plaintext);
    });
  });

  it("rolls back the persisted user env when verified email route reconciliation fails", async () => {
    const currentEnv = createHostedVerifiedEmailUserEnv({
      address: "old@example.com",
      verifiedAt: "2026-04-01T00:00:00.000Z",
    });
    const nextEnv = createHostedVerifiedEmailUserEnv({
      address: "new@example.com",
      verifiedAt: "2026-04-02T00:00:00.000Z",
    });

    setStoredEnv(currentEnv);
    mockedModules.reconcileHostedEmailVerifiedSenderRoute
      .mockRejectedValueOnce(new Error("route update failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      createService().updateUserEnv("user_123", {
        env: nextEnv,
        mode: "merge",
      }),
    ).rejects.toThrow("route update failed");

    expect(readStoredEnv()).toEqual(currentEnv);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nextVerifiedEmailAddress: "new@example.com",
        previousVerifiedEmailAddress: "old@example.com",
        userId: "user_123",
      }),
    );
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nextVerifiedEmailAddress: "old@example.com",
        previousVerifiedEmailAddress: "new@example.com",
        userId: "user_123",
      }),
    );
  });

  it("restores the previous verified email route when clearing the last hosted env value fails", async () => {
    const currentEnv = createHostedVerifiedEmailUserEnv({
      address: "old@example.com",
      verifiedAt: "2026-04-01T00:00:00.000Z",
    });

    setStoredEnv(currentEnv);
    mockedModules.store.clearUserEnv.mockRejectedValueOnce(new Error("env clear failed"));

    await expect(
      createService().updateUserEnv("user_123", {
        env: {
          HOSTED_USER_VERIFIED_EMAIL: null,
          HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: null,
        },
        mode: "merge",
      }),
    ).rejects.toThrow("env clear failed");

    expect(readStoredEnv()).toEqual(currentEnv);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nextVerifiedEmailAddress: null,
        previousVerifiedEmailAddress: "old@example.com",
        userId: "user_123",
      }),
    );
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nextVerifiedEmailAddress: "old@example.com",
        previousVerifiedEmailAddress: null,
        userId: "user_123",
      }),
    );
  });

  it("restores the previous verified email route when removing a verified email fails after route release", async () => {
    const currentEnv = {
      OPENAI_API_KEY: "sk-test",
      ...createHostedVerifiedEmailUserEnv({
        address: "old@example.com",
        verifiedAt: "2026-04-01T00:00:00.000Z",
      }),
    };

    setStoredEnv(currentEnv);
    mockedModules.store.writeUserEnv
      .mockRejectedValueOnce(new Error("env write failed"))
      .mockImplementationOnce(async (_userId: string, plaintext: Uint8Array) => {
        mockedModules.setStoredPayload(plaintext);
      });

    await expect(
      createService().updateUserEnv("user_123", {
        env: {
          HOSTED_USER_VERIFIED_EMAIL: null,
          HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: null,
        },
        mode: "merge",
      }),
    ).rejects.toThrow("env write failed");

    expect(readStoredEnv()).toEqual(currentEnv);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nextVerifiedEmailAddress: null,
        previousVerifiedEmailAddress: "old@example.com",
        userId: "user_123",
      }),
    );
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nextVerifiedEmailAddress: "old@example.com",
        previousVerifiedEmailAddress: null,
        userId: "user_123",
      }),
    );
  });
});
