import { createHostedVerifiedEmailUserEnv } from "@murphai/runtime-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeHostedUserEnvPayload,
  encodeHostedUserEnvPayload,
} from "../src/user-env.ts";

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
  createHostedUserEnvStore: vi.fn(() => mockedModules.store),
}));

vi.mock("../src/hosted-email.js", () => ({
  ensureHostedEmailVerifiedSenderRouteAvailable:
    mockedModules.ensureHostedEmailVerifiedSenderRouteAvailable,
  reconcileHostedEmailVerifiedSenderRoute:
    mockedModules.reconcileHostedEmailVerifiedSenderRoute,
}));

const { RunnerUserEnvService } = await import("../src/user-runner/runner-user-env.ts");

function createService() {
  return new RunnerUserEnvService(
    {} as never,
    new Uint8Array([1]),
    "user-env-key-id",
    {},
    new Uint8Array([2]),
    "email-route-key-id",
    {},
    {},
    {
      apiBaseUrl: "https://api.cloudflare.com/client/v4",
      cloudflareAccountId: null,
      cloudflareApiToken: null,
      defaultSubject: "Murph update",
      domain: "example.com",
      fromAddress: "assistant@example.com",
      localPart: "assistant",
      signingSecret: "test-signing-secret",
    },
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

  it("avoids rewriting an unchanged hosted env while still reconciling the verified sender route", async () => {
    const currentEnv = {
      OPENAI_API_KEY: "sk-test",
      ...createHostedVerifiedEmailUserEnv({
        address: "old@example.com",
        verifiedAt: "2026-04-01T00:00:00.000Z",
      }),
    };

    setStoredEnv(currentEnv);

    await expect(
      createService().updateUserEnv("user_123", {
        env: {
          HOSTED_USER_VERIFIED_EMAIL: "old@example.com",
          HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: "2026-04-01T00:00:00.000Z",
        },
        mode: "merge",
      }),
    ).resolves.toEqual({
      configuredUserEnvKeys: Object.keys(currentEnv).sort(),
      userId: "user_123",
    });

    expect(mockedModules.store.writeUserEnv).not.toHaveBeenCalled();
    expect(mockedModules.store.clearUserEnv).not.toHaveBeenCalled();
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenCalledTimes(1);
    expect(readStoredEnv()).toEqual(currentEnv);
  });

  it("does not roll back verified sender routes when env persistence fails before any route mutation", async () => {
    const currentEnv = createHostedVerifiedEmailUserEnv({
      address: "old@example.com",
      verifiedAt: "2026-04-01T00:00:00.000Z",
    });
    const nextEnv = createHostedVerifiedEmailUserEnv({
      address: "new@example.com",
      verifiedAt: "2026-04-02T00:00:00.000Z",
    });

    setStoredEnv(currentEnv);
    mockedModules.store.writeUserEnv.mockRejectedValueOnce(new Error("env write failed"));

    await expect(
      createService().updateUserEnv("user_123", {
        env: nextEnv,
        mode: "merge",
      }),
    ).rejects.toThrow("env write failed");

    expect(readStoredEnv()).toEqual(currentEnv);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).not.toHaveBeenCalled();
    expect(mockedModules.store.writeUserEnv).toHaveBeenCalledTimes(2);
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
    expect(mockedModules.store.writeUserEnv).toHaveBeenCalledTimes(2);
    expect(
      mockedModules.store.writeUserEnv.mock.invocationCallOrder[1],
    ).toBeLessThan(mockedModules.reconcileHostedEmailVerifiedSenderRoute.mock.invocationCallOrder[1]);
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

  it("does not recreate the previous verified email route after a partial clear when canonical rollback fails", async () => {
    const currentEnv = createHostedVerifiedEmailUserEnv({
      address: "old@example.com",
      verifiedAt: "2026-04-01T00:00:00.000Z",
    });

    setStoredEnv(currentEnv);
    mockedModules.store.clearUserEnv.mockImplementationOnce(async () => {
      mockedModules.setStoredPayload(null);
      throw new Error("env clear failed");
    });
    mockedModules.store.writeUserEnv.mockRejectedValueOnce(new Error("env rollback failed"));

    await expect(
      createService().updateUserEnv("user_123", {
        env: {
          HOSTED_USER_VERIFIED_EMAIL: null,
          HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: null,
        },
        mode: "merge",
      }),
    ).rejects.toThrow("Hosted user env update failed and rollback also failed for user_123.");

    expect(readStoredEnv()).toEqual({});
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenCalledTimes(1);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        nextVerifiedEmailAddress: null,
        previousVerifiedEmailAddress: "old@example.com",
        userId: "user_123",
      }),
    );
  });

  it("restores the previous user env even when route rollback fails after a later reconcile error", async () => {
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
      .mockRejectedValueOnce(new Error("route rollback failed"));

    await expect(
      createService().updateUserEnv("user_123", {
        env: nextEnv,
        mode: "merge",
      }),
    ).rejects.toThrow("Hosted user env update failed and rollback also failed for user_123.");

    expect(readStoredEnv()).toEqual(currentEnv);
    expect(mockedModules.store.writeUserEnv).toHaveBeenCalledTimes(2);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nextVerifiedEmailAddress: "old@example.com",
        previousVerifiedEmailAddress: "new@example.com",
        userId: "user_123",
      }),
    );
  });

  it("does not recreate the previous verified email route when canonical rollback fails after a route-first mutation", async () => {
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
      .mockRejectedValueOnce(new Error("env rollback failed"));

    await expect(
      createService().updateUserEnv("user_123", {
        env: {
          HOSTED_USER_VERIFIED_EMAIL: null,
          HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: null,
        },
        mode: "merge",
      }),
    ).rejects.toThrow("Hosted user env update failed and rollback also failed for user_123.");

    expect(readStoredEnv()).toEqual(currentEnv);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenCalledTimes(1);
    expect(mockedModules.reconcileHostedEmailVerifiedSenderRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        nextVerifiedEmailAddress: null,
        previousVerifiedEmailAddress: "old@example.com",
        userId: "user_123",
      }),
    );
  });
});
