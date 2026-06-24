import { describe, expect, it, vi } from "vitest";

import type { ComputerUseCrypto } from "../src/lib/computer-use/crypto";
import type {
  ComputerKernelClient,
  KernelManagedAuthConnection,
} from "../src/lib/computer-use/kernel-client";
import { ComputerUseService } from "../src/lib/computer-use/service";
import type {
  ComputerHandoffRecord,
  ComputerRunRecord,
  ComputerUseStore,
} from "../src/lib/computer-use/store";

const NOW = new Date("2026-06-17T12:05:00.000Z");
const CLAIMED_AT = new Date("2026-06-17T12:05:01.000Z");
type MockedFunction = ReturnType<typeof vi.fn>;
type MockComputerKernelClient = ComputerKernelClient & {
  [K in keyof ComputerKernelClient]: MockedFunction;
};
type MockStoreMethod<K extends keyof ComputerUseStore> =
  ComputerUseStore[K] & MockedFunction;
type MockComputerUseStore = ComputerUseStore & {
  claimHandoffForCompletion: MockStoreMethod<"claimHandoffForCompletion">;
  clearRunBrowser: MockStoreMethod<"clearRunBrowser">;
  completeHandoff: MockStoreMethod<"completeHandoff">;
  createHandoff: MockStoreMethod<"createHandoff">;
  findActiveRunForMember: MockStoreMethod<"findActiveRunForMember">;
  listMemberRuns: MockStoreMethod<"listMemberRuns">;
  markHandoffExpired: MockStoreMethod<"markHandoffExpired">;
  markRunRunning: MockStoreMethod<"markRunRunning">;
  releaseHandoffClaim: MockStoreMethod<"releaseHandoffClaim">;
  replaceAwaitingRunHandoff: MockStoreMethod<"replaceAwaitingRunHandoff">;
  replaceRunBrowser: MockStoreMethod<"replaceRunBrowser">;
  requireOwnedRun: MockStoreMethod<"requireOwnedRun">;
};

describe("Kernel managed-login handoffs", () => {
  it("routes managed login without decrypting the task Live View", async () => {
    const run = createRun();
    const handoff = createHandoff();
    const crypto = createCrypto();
    crypto.decryptRunSecret = vi.fn(async () => {
      throw new Error("Live View must not be read");
    });
    const service = new ComputerUseService({
      crypto,
      kernel: {} as ComputerKernelClient,
      now: () => NOW,
      store: createStore({ handoff, run }),
    });

    await expect(service.readHandoffPageState({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "managed_login",
      suggestedReply: "Done",
    });
    expect(crypto.decryptRunSecret).not.toHaveBeenCalled();
  });

  it("rejects the generic Done path for managed login", async () => {
    const run = createRun();
    const handoff = createHandoff();
    const store = createStore({ handoff, run });
    const service = new ComputerUseService({
      kernel: {} as ComputerKernelClient,
      now: () => NOW,
      store,
    });

    await expect(service.completeHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_REQUIRES_VERIFICATION",
    });
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
  });

  it("closes the task browser before starting Kernel Hosted UI", async () => {
    let run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const order: string[] = [];
    const connection = createConnection();
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    store.clearRunBrowser.mockImplementation(async () => {
      order.push("clear-run-browser");
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
      };
      return run;
    });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => null),
      ensureManagedAuthConnection: vi.fn(async () => connection),
      deleteBrowserByIdOrName: vi.fn(async () => {
        order.push("delete-task-browser");
      }),
      startManagedAuthLogin: vi.fn(async () => {
        order.push("start-managed-login");
        return {
          flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
          hostedUrl: "https://auth.onkernel.com/login/test",
        };
      }),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    const result = await service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") {
      throw new Error("Expected Hosted UI redirect.");
    }
    const redirect = new URL(result.url);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(
      "https://auth.onkernel.com/login/test",
    );
    expect(redirect.searchParams.get("success_url")).toBe(
      "https://join.example.test/api/computer/handoff/handoff-token/managed-login",
    );
    expect(redirect.searchParams.get("error_url")).toBe(
      "https://join.example.test/api/computer/handoff/handoff-token/managed-login",
    );
    expect(order).toEqual([
      "delete-task-browser",
      "clear-run-browser",
      "start-managed-login",
    ]);
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: CLAIMED_AT,
      handoffId: handoff.id,
    });
  });

  it("supersedes prior managed auth flows when starting a new handoff", async () => {
    let run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const order: string[] = [];
    const staleFlow = createConnection({
      browserSessionId: "prior-managed-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      hostedUrl: "https://auth.onkernel.com/login/old",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    store.clearRunBrowser.mockImplementation(async () => {
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
      };
      return run;
    });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => staleFlow),
      ensureManagedAuthConnection: vi.fn(async () => staleFlow),
      deleteBrowserByIdOrName: vi.fn(async (browserId) => {
        order.push(`delete:${browserId}`);
      }),
      startManagedAuthLogin: vi.fn(async () => {
        order.push("start-new-flow");
        return {
          flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
          hostedUrl: "https://auth.onkernel.com/login/new",
        };
      }),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    const result = await service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") {
      throw new Error("Expected Hosted UI redirect.");
    }
    expect(new URL(result.url).pathname).toBe("/login/new");
    expect(order).toEqual([
      "delete:kernel-session-1",
      "delete:prior-managed-browser",
      "start-new-flow",
    ]);
    expect(store.completeHandoff).not.toHaveBeenCalled();
  });

  it("restores one task browser and completes a terminal managed flow", async () => {
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockImplementation(async () => run);
    store.replaceRunBrowser.mockImplementation(async (input) => {
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
        kernelSessionId: input.kernelSessionId,
      };
      return run;
    });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => connection),
      deleteBrowserByIdOrName: vi.fn(async () => {}),
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/test",
        sessionId: "kernel-session-2",
      })),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "completed",
    });
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(store.replaceRunBrowser).toHaveBeenCalledWith(expect.objectContaining({
      expectedHandoffUpdatedAt: CLAIMED_AT,
      expectedPendingHandoffId: handoff.id,
      kernelSessionId: "kernel-session-2",
    }));
    expect(store.completeHandoff).toHaveBeenCalledWith({
      expectedUpdatedAt: CLAIMED_AT,
      handoffId: handoff.id,
      now: NOW,
    });
  });

  it("reuses an in-progress Kernel Hosted UI flow for duplicate opens", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff();
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "IN_PROGRESS",
      hostedUrl: "https://auth.onkernel.com/login/test?existing=1",
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => connection),
      startManagedAuthLogin: vi.fn(async () => {
        throw new Error("duplicate open must not start a second login");
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    const result = await service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") {
      throw new Error("Expected Hosted UI redirect.");
    }
    const redirect = new URL(result.url);
    expect(redirect.searchParams.get("existing")).toBe("1");
    expect(redirect.searchParams.get("success_url")).toBe(
      "https://join.example.test/api/computer/handoff/handoff-token/managed-login",
    );
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("rejects non-Kernel Managed Auth Hosted UI redirects", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff();
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "IN_PROGRESS",
      hostedUrl: "https://attacker.example/login",
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => connection),
      startManagedAuthLogin: vi.fn(async () => {
        throw new Error("hosted URL guard must block before starting a login");
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
    });
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("treats completed managed callbacks as idempotent", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: "kernel-session-2",
    });
    const handoff = createHandoff({
      completedAt: new Date("2026-06-17T12:06:00.000Z"),
      status: "completed",
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "completed",
    });
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("redirects failed terminal managed auth to a Live View fallback handoff", async () => {
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const failedConnection = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "FAILED",
      status: "NEEDS_AUTH",
    });
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockImplementation(async () => run);
    store.replaceRunBrowser.mockImplementation(async (input) => {
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
        kernelSessionId: input.kernelSessionId,
      };
      return run;
    });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => failedConnection),
      deleteBrowserByIdOrName: vi.fn(async () => {}),
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/fallback",
        sessionId: "kernel-session-2",
      })),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    const result = await service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") {
      throw new Error("Expected Live View fallback redirect.");
    }
    expect(result.url).toMatch(
      /^https:\/\/join\.example\.test\/computer\/handoff\//u,
    );
    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith(
      "managed-auth-browser",
    );
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(store.createHandoff).toHaveBeenCalledWith(expect.objectContaining({
      memberId: run.memberId,
      purpose: "login",
      runId: run.id,
      suggestedReply: "Done",
    }));
    expect(store.replaceAwaitingRunHandoff).toHaveBeenCalledWith({
      expectedHandoffUpdatedAt: handoff.updatedAt,
      expectedPendingHandoffId: handoff.id,
      newPendingHandoffId: "hch_fallback",
      now: NOW,
      runId: run.id,
    });
    expect(store.markHandoffExpired).toHaveBeenCalledWith({
      expectedStatus: "open",
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      now: NOW,
    });
    expect(store.completeHandoff).not.toHaveBeenCalled();
  });

  it("expires stale managed-login links without touching Kernel", async () => {
    const run = createRun();
    const handoff = createHandoff({
      expiresAt: new Date("2026-06-17T12:04:00.000Z"),
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "expired" });
    expect(store.markHandoffExpired).toHaveBeenCalledWith({
      expectedStatus: "open",
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      now: NOW,
    });
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("restores the task browser when managed login launch falls back", async () => {
    let run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    store.clearRunBrowser.mockImplementation(async (input) => {
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        lastTitle: input.lastTitle,
        lastUrl: input.lastUrl,
      };
      return run;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    store.replaceRunBrowser.mockImplementation(async (input) => {
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
        kernelSessionId: input.kernelSessionId,
      };
      return run;
    });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => null),
      startManagedAuthLogin: vi.fn(async () => {
        throw new Error("Kernel login failed");
      }),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
    });

    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith("kernel-session-1");
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(store.replaceRunBrowser).toHaveBeenCalledWith(expect.objectContaining({
      expectedHandoffUpdatedAt: CLAIMED_AT,
      expectedPendingHandoffId: handoff.id,
      kernelSessionId: "kernel-session-2",
    }));
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: CLAIMED_AT,
      handoffId: handoff.id,
    });
  });

  it("does not resume managed login without fresh successful Kernel proof", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff();
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => null),
    });
    const service = new ComputerUseService({
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.startRun({
      memberId: run.memberId,
      resumeAfterMailboxItemId: "mailbox-item-1",
      startUrl: run.lastUrl,
    })).resolves.toMatchObject({
      reused: true,
      runId: run.id,
      status: "awaiting_user",
    });
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(store.completeHandoff).not.toHaveBeenCalled();
    expect(store.markRunRunning).not.toHaveBeenCalled();
  });

  it("deletes durable connections before deleting a member profile", async () => {
    const order: string[] = [];
    const store = createStore({
      handoff: null,
      run: createRun(),
    });
    store.listMemberRuns.mockResolvedValue([]);
    const kernel = createKernel({
      listManagedAuthConnections: vi.fn(async ({ profileName }) => [
        createConnection({
          id: "managed-auth-1",
          profileName,
        }),
      ]),
      deleteManagedAuthConnection: vi.fn(async () => {
        order.push("delete-connection");
      }),
      deleteProfile: vi.fn(async () => {
        order.push("delete-profile");
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "test",
      },
      kernel,
      now: () => NOW,
      store,
    });

    await service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    });

    expect(order).toEqual(["delete-connection", "delete-profile"]);
  });
});

function createRun(
  overrides: Partial<ComputerRunRecord> = {},
): ComputerRunRecord {
  return {
    awaitingMessage: null,
    awaitingReason: "login_needed",
    checkpointContext: null,
    completedAt: null,
    expiresAt: new Date("2026-06-17T13:00:00.000Z"),
    id: "hcr_run123",
    kernelLiveViewUrlEncrypted: "encrypted-live-view",
    kernelProfileName: "murph-test-profile",
    kernelSessionId: "kernel-session-1",
    lastTitle: "Amazon sign in",
    lastUrl: "https://www.amazon.com/ap/signin",
    memberId: "member_123",
    pausedAt: new Date("2026-06-17T12:00:00.000Z"),
    pendingHandoffId: "hch_handoff123",
    status: "awaiting_user",
    suggestedReply: "Done",
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

function createHandoff(
  overrides: Partial<ComputerHandoffRecord> = {},
): ComputerHandoffRecord {
  return {
    completedAt: null,
    expiresAt: new Date("2026-06-17T12:20:00.000Z"),
    id: "hch_handoff123",
    memberId: "member_123",
    purpose: "managed_login",
    runId: "hcr_run123",
    status: "open",
    suggestedReply: "Done",
    tokenHash: "token-hash",
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

function createConnection(
  overrides: Partial<KernelManagedAuthConnection> = {},
): KernelManagedAuthConnection {
  return {
    browserSessionId: null,
    domain: "www.amazon.com",
    flowExpiresAt: null,
    flowStatus: null,
    hostedUrl: null,
    id: "managed-auth-1",
    profileName: "murph-test-profile",
    status: "NEEDS_AUTH",
    ...overrides,
  };
}

function createCrypto(): ComputerUseCrypto & {
  decryptRunSecret: ReturnType<typeof vi.fn>;
} {
  return {
    decryptRunSecret: vi.fn(async () => "https://browser.onkernel.com:8443/live/test"),
    encryptRunSecret: vi.fn(async (input) => input.value ?? null),
  };
}

function createKernel(
  overrides: Partial<MockComputerKernelClient> = {},
): MockComputerKernelClient {
  const kernel = {
    createBrowser: vi.fn(async () => ({
      liveViewUrl: "https://browser.onkernel.com:8443/live/test",
      sessionId: "kernel-session-2",
    })),
    deleteBrowserByIdOrName: vi.fn(async () => {}),
    deleteManagedAuthConnection: vi.fn(async () => {}),
    deleteProfile: vi.fn(async () => {}),
    ensureBrowserViewport: vi.fn(async () => {}),
    ensureManagedAuthConnection: vi.fn(
      async (
        input: Parameters<
          ComputerKernelClient["ensureManagedAuthConnection"]
        >[0],
      ) => createConnection({
        domain: input.domain,
        profileName: input.profileName,
      }),
    ),
    ensureProfile: vi.fn(async () => {}),
    executePlaywright: vi.fn(async () => ({
      result: {
        title: "Amazon sign in",
        url: "https://www.amazon.com/ap/signin",
        visibleText: "Sign in",
      },
    })),
    findManagedAuthConnection: vi.fn(async () => null),
    listManagedAuthConnections: vi.fn(async () => []),
    osControl: vi.fn(async () => {}),
    startManagedAuthLogin: vi.fn(async () => ({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      hostedUrl: "https://auth.onkernel.com/login/test",
    })),
    ...overrides,
  } satisfies MockComputerKernelClient;
  return kernel;
}

function createStore(input: {
  handoff: ComputerHandoffRecord | null;
  run: ComputerRunRecord;
}): MockComputerUseStore {
  const claimed = input.handoff
    ? {
        ...input.handoff,
        status: "checkpointing" as const,
        updatedAt: CLAIMED_AT,
      }
    : null;
  return {
    attachAwaitingRunHandoff: vi.fn(async (attachInput) => ({
      ...input.run,
      pausedAt: attachInput.now,
      pendingHandoffId: attachInput.newPendingHandoffId,
    })),
    async attachRunBrowser() {
      throw new Error("attachRunBrowser should not be called.");
    },
    claimHandoffForCompletion: vi.fn(
      async () => claimed,
    ),
    clearRunBrowser: vi.fn(async () => ({
      ...input.run,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    })),
    async clearTerminalRunBrowser() {
      throw new Error("clearTerminalRunBrowser should not be called.");
    },
    completeHandoff: vi.fn(async () => ({
      ...claimed!,
      completedAt: NOW,
      status: "completed" as const,
    })),
    createHandoff: vi.fn(async (handoffInput) => createHandoff({
      expiresAt: handoffInput.expiresAt,
      id: "hch_fallback",
      memberId: handoffInput.memberId,
      purpose: handoffInput.purpose,
      runId: handoffInput.runId,
      suggestedReply: handoffInput.suggestedReply,
      tokenHash: handoffInput.tokenHash,
    })),
    async createRun() {
      throw new Error("createRun should not be called.");
    },
    findActiveRunForMember: vi.fn(async () => null),
    async findHandoffByRun() {
      return input.handoff;
    },
    async finishRun() {
      throw new Error("finishRun should not be called.");
    },
    async hasConversationMailboxItemAfter() {
      return true;
    },
    listMemberRuns: vi.fn(async () => [input.run]),
    async listStaleActiveRuns() {
      return [];
    },
    async listStaleActiveRunsForMember() {
      return [];
    },
    markHandoffExpired: vi.fn(async () => ({
      ...input.handoff!,
      status: "expired" as const,
    })),
    async markRunAwaitingUser() {
      throw new Error("markRunAwaitingUser should not be called.");
    },
    async markRunCleanupPending() {
      throw new Error("markRunCleanupPending should not be called.");
    },
    async markRunExpired() {
      throw new Error("markRunExpired should not be called.");
    },
    markRunRunning: vi.fn(async () => ({
      ...input.run,
      pausedAt: null,
      status: "running" as const,
    })),
    releaseHandoffClaim: vi.fn(async () => {}),
    replaceAwaitingRunHandoff: vi.fn(async (replaceInput) => ({
      ...input.run,
      pausedAt: replaceInput.now,
      pendingHandoffId: replaceInput.newPendingHandoffId,
    })),
    replaceRunBrowser: vi.fn(async () => input.run),
    requireHandoffByTokenHash: vi.fn(async () => {
      if (!input.handoff) {
        throw new Error("Handoff missing.");
      }
      return input.handoff;
    }),
    requireMemberComputerUseAvailable: vi.fn(async () => {}),
    requireOwnedRun: vi.fn(async () => input.run),
    async updateRunBrowserState() {},
  } satisfies MockComputerUseStore;
}
