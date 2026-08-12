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
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../src/lib/hosted-onboarding/errors";

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
  claimLoginHandoffForCheckpoint: MockStoreMethod<"claimLoginHandoffForCheckpoint">;
  clearRunBrowser: MockStoreMethod<"clearRunBrowser">;
  completeHandoff: MockStoreMethod<"completeHandoff">;
  completeManagedLoginHandoff: MockStoreMethod<"completeManagedLoginHandoff">;
  convertManagedLoginHandoffToLogin: MockStoreMethod<"convertManagedLoginHandoffToLogin">;
  createHandoff: MockStoreMethod<"createHandoff">;
  findActiveRunForMember: MockStoreMethod<"findActiveRunForMember">;
  findHandoffByRun: MockStoreMethod<"findHandoffByRun">;
  listMemberRuns: MockStoreMethod<"listMemberRuns">;
  markHandoffExpired: MockStoreMethod<"markHandoffExpired">;
  markRunRunning: MockStoreMethod<"markRunRunning">;
  reclaimHandoffForCompletion: MockStoreMethod<"reclaimHandoffForCompletion">;
  releaseHandoffClaim: MockStoreMethod<"releaseHandoffClaim">;
  replaceAwaitingRunHandoff: MockStoreMethod<"replaceAwaitingRunHandoff">;
  replaceRunBrowser: MockStoreMethod<"replaceRunBrowser">;
  resumeRunAfterLoginCheckpoint: MockStoreMethod<"resumeRunAfterLoginCheckpoint">;
  rotateManagedLoginHandoffCapability: MockStoreMethod<"rotateManagedLoginHandoffCapability">;
  requireComputerHandoffAccess: MockStoreMethod<"requireComputerHandoffAccess">;
  requireHandoffByTokenHash: MockStoreMethod<"requireHandoffByTokenHash">;
  requireMemberComputerUseAvailable: MockStoreMethod<"requireMemberComputerUseAvailable">;
  requireMemberOwnedProviderSetupRun: MockStoreMethod<"requireMemberOwnedProviderSetupRun">;
  requireMemberOwnedProviderSetupRunAcquisition: MockStoreMethod<"requireMemberOwnedProviderSetupRunAcquisition">;
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

  it("keeps stale managed-login checkpoints on the managed recovery path", async () => {
    const run = createRun();
    const handoff = createHandoff({
      status: "checkpointing",
    });
    const store = createStore({ handoff, run });
    const service = new ComputerUseService({
      kernel: createKernel(),
      now: () => NOW,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "managed_login",
      suggestedReply: "Done",
    });
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
  });

  it("keeps the exact Connect return path on a setup-owned login checkpoint", async () => {
    const run = createRun({
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    });
    const handoff = createHandoff({
      status: "checkpointing",
      updatedAt: CLAIMED_AT,
    });
    const store = createStore({ handoff, run });
    const service = new ComputerUseService({
      kernel: createKernel(),
      now: () => NOW,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "checkpointing",
      purpose: "managed_login",
      returnContactKind: null,
      returnTo: "/connect",
      suggestedReply: "Done",
    });
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

  it("rejects generic completion for stale managed-login checkpoints without mutating them", async () => {
    const run = createRun();
    const handoff = createHandoff({
      status: "checkpointing",
    });
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
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
    expect(store.reclaimHandoffForCompletion).not.toHaveBeenCalled();
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
  });

  it("yields a reclaimed claim after a nonterminal provider redirect", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff({ status: "checkpointing" });
    const claimed = { ...handoff, updatedAt: NOW };
    const store = createStore({ handoff, run });
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => createConnection({
        flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/recovered",
      })),
    });
    const service = new ComputerUseService({
      env: { HOSTED_WEB_BASE_URL: "https://join.example.test" },
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toMatchObject({ kind: "redirect" });
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: NOW,
      handoffId: handoff.id,
    });
  });

  it("yields a reclaimed claim when the provider read fails before an effect", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff({ status: "checkpointing" });
    const claimed = { ...handoff, updatedAt: NOW };
    const store = createStore({ handoff, run });
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => {
        throw new Error("provider read failed");
      }),
    });
    const service = new ComputerUseService({
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).rejects.toThrow("provider read failed");
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: NOW,
      handoffId: handoff.id,
    });
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

  it("falls back on the existing task browser when connection setup fails", async () => {
    const run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const order: string[] = [];
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    const kernel = createKernel({
      ensureManagedAuthConnection: vi.fn(async () => {
        order.push("ensure");
        throw new Error("Kernel connection setup failed");
      }),
      findManagedAuthConnection: vi.fn(async () => {
        order.push("find");
        return null;
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
    expect(order).toEqual(["ensure", "find"]);
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalled();
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.clearRunBrowser).not.toHaveBeenCalled();
    expect(store.replaceRunBrowser).not.toHaveBeenCalled();
    expect(store.convertManagedLoginHandoffToLogin).toHaveBeenCalledWith({
      browser: null,
      expectedHandoffUpdatedAt: CLAIMED_AT,
      handoffId: handoff.id,
      memberId: run.memberId,
      now: NOW,
      runId: run.id,
    });
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
  });

  it("keeps checkpointing when reconciliation cannot exclude a prior writer", async () => {
    let run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const connection = createConnection({
      browserSessionId: "prior-managed-browser",
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
      ensureManagedAuthConnection: vi.fn(async () => connection),
      findManagedAuthConnection: vi.fn(async () => {
        throw new Error("Kernel reconciliation unavailable");
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

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });
    expect(kernel.findManagedAuthConnection).toHaveBeenCalledTimes(2);
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.createHandoff).not.toHaveBeenCalled();
    expect(store.replaceAwaitingRunHandoff).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
  });

  it("keeps checkpointing when the terminal managed browser cannot be deleted", async () => {
    const run = createRun({
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
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    const kernel = createKernel({
      ensureManagedAuthConnection: vi.fn(async () => connection),
      findManagedAuthConnection: vi.fn(async () => connection),
      deleteBrowserByIdOrName: vi.fn(async () => {
        throw new Error("Kernel browser delete failed");
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

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
    expect(store.completeManagedLoginHandoff).not.toHaveBeenCalled();
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("keeps checkpointing after an ambiguous managed login start", async () => {
    let run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
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
    let findCalls = 0;
    const findManagedAuthConnection = vi.fn(async () => {
      findCalls += 1;
      if (findCalls === 1) {
        return null;
      }
      throw new Error("Kernel recovery lookup failed");
    });
    const kernel = createKernel({
      findManagedAuthConnection,
      startManagedAuthLogin: vi.fn(async () => {
        throw new Error("Kernel start outcome unknown");
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

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });
    expect(kernel.startManagedAuthLogin).toHaveBeenCalledTimes(1);
    expect(findManagedAuthConnection).toHaveBeenCalledTimes(2);
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.createHandoff).not.toHaveBeenCalled();
    expect(store.replaceAwaitingRunHandoff).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
  });

  it("does not publish a stale browser after a partial detach", async () => {
    const run = createRun();
    const handoff = createHandoff();
    const claimed = {
      ...handoff,
      status: "checkpointing" as const,
      updatedAt: CLAIMED_AT,
    };
    const store = createStore({ handoff, run });
    store.claimHandoffForCompletion.mockResolvedValue(claimed);
    store.clearRunBrowser.mockRejectedValueOnce(
      new Error("Database clear failed"),
    );
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => null),
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
    })).resolves.toEqual({ kind: "checkpointing" });
    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith(
      "kernel-session-1",
    );
    expect(store.clearRunBrowser).toHaveBeenCalledTimes(1);
    expect(store.requireOwnedRun).toHaveBeenCalledTimes(2);
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.createHandoff).not.toHaveBeenCalled();
    expect(store.replaceAwaitingRunHandoff).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
  });

  it("reconciles a partial detach before a stale retry can publish fallback", async () => {
    let now = NOW;
    let run = createRun();
    let handoff = createHandoff();
    const store = createStore({ handoff, run });
    store.requireHandoffByTokenHash.mockImplementation(async () => handoff);
    store.claimHandoffForCompletion.mockImplementation(async () => {
      handoff = {
        ...handoff,
        status: "checkpointing",
        updatedAt: CLAIMED_AT,
      };
      return handoff;
    });
    store.reclaimHandoffForCompletion.mockImplementation(async (input) => {
      handoff = {
        ...handoff,
        updatedAt: input.now,
      };
      return handoff;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    store.clearRunBrowser
      .mockRejectedValueOnce(new Error("Database clear failed"))
      .mockImplementation(async (input) => {
        run = {
          ...run,
          kernelLiveViewUrlEncrypted: null,
          kernelSessionId: null,
          lastTitle: input.lastTitle,
          lastUrl: input.lastUrl,
        };
        return run;
      });
    const connection = createConnection();
    const ensureManagedAuthConnection = vi.fn()
      .mockResolvedValueOnce(connection)
      .mockRejectedValueOnce(new Error("Kernel connection setup failed"));
    const kernel = createKernel({
      ensureManagedAuthConnection,
      findManagedAuthConnection: vi.fn(async () => null),
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/recovered",
        sessionId: "kernel-session-recovered",
      })),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });

    now = new Date("2026-06-17T12:11:00.000Z");
    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "redirect",
      url: "https://join.example.test/computer/handoff/handoff-token",
    });

    expect(store.clearRunBrowser).toHaveBeenCalledTimes(2);
    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith(
      "kernel-session-1",
    );
    expect(store.convertManagedLoginHandoffToLogin).toHaveBeenCalledWith({
      browser: {
        kernelLiveViewUrlEncrypted:
          "https://browser.onkernel.com:8443/live/recovered",
        kernelSessionId: "kernel-session-recovered",
      },
      expectedHandoffUpdatedAt: now,
      handoffId: handoff.id,
      memberId: run.memberId,
      now,
      runId: run.id,
    });
    expect(JSON.stringify(
      store.convertManagedLoginHandoffToLogin.mock.calls,
    )).not.toContain("encrypted-live-view");
  });

  it("does not replace a canonical task browser after an ambiguous committed completion", async () => {
    const now = NOW;
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    let handoff = createHandoff();
    const connection = createConnection({
      browserSessionId: null,
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.requireHandoffByTokenHash.mockImplementation(async () => handoff);
    store.claimHandoffForCompletion.mockImplementation(async () => {
      handoff = {
        ...handoff,
        status: "checkpointing",
        updatedAt: new Date(now.getTime() + 1_000),
      };
      return handoff;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    let terminalWriteCalls = 0;
    store.completeManagedLoginHandoff.mockImplementation(async (input) => {
      terminalWriteCalls += 1;
      if (terminalWriteCalls === 1 && input.browser) {
        run = {
          ...run,
          kernelLiveViewUrlEncrypted: input.browser.kernelLiveViewUrlEncrypted,
          kernelSessionId: input.browser.kernelSessionId,
          updatedAt: input.now,
        };
        handoff = {
          ...handoff,
          completedAt: input.now,
          status: "completed",
        };
      }
      throw new Error("completion response lost");
    });
    const kernel = createKernel({
      ensureManagedAuthConnection: vi.fn(async () => connection),
      findManagedAuthConnection: vi.fn(async () => connection),
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/restored",
        sessionId: "kernel-session-restored",
      })),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });
    expect(run.kernelSessionId).toBe("kernel-session-restored");

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "completed" });

    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(kernel.deleteBrowserByIdOrName.mock.calls.filter(
      ([idOrName]) => String(idOrName).startsWith("murph-browser-"),
    )).toHaveLength(1);
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalledWith("kernel-session-restored");
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("replaces one orphaned task browser after an ambiguous rolled-back completion becomes stale", async () => {
    let now = NOW;
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    let handoff = createHandoff();
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.requireHandoffByTokenHash.mockImplementation(async () => handoff);
    store.findHandoffByRun.mockImplementation(async () => handoff);
    store.claimHandoffForCompletion.mockImplementation(async () => {
      handoff = {
        ...handoff,
        status: "checkpointing",
        updatedAt: CLAIMED_AT,
      };
      return handoff;
    });
    store.reclaimHandoffForCompletion.mockImplementation(async (input) => {
      handoff = {
        ...handoff,
        updatedAt: input.now,
      };
      return handoff;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    let terminalWriteCalls = 0;
    store.completeManagedLoginHandoff.mockImplementation(async (input) => {
      terminalWriteCalls += 1;
      if (terminalWriteCalls <= 2) {
        throw new Error("completion transaction rolled back");
      }
      if (input.browser) {
        run = {
          ...run,
          kernelLiveViewUrlEncrypted: input.browser.kernelLiveViewUrlEncrypted,
          kernelSessionId: input.browser.kernelSessionId,
          updatedAt: input.now,
        };
      }
      handoff = {
        ...handoff,
        completedAt: input.now,
        status: "completed",
      };
      return { handoff, run };
    });
    let browserNumber = 0;
    const kernel = createKernel({
      ensureManagedAuthConnection: vi.fn(async () => connection),
      findManagedAuthConnection: vi.fn(async () => connection),
      createBrowser: vi.fn(async () => {
        browserNumber += 1;
        return {
          liveViewUrl: `https://browser.onkernel.com:8443/live/restored-${browserNumber}`,
          sessionId: `kernel-session-restored-${browserNumber}`,
        };
      }),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);

    now = new Date("2026-06-17T12:11:00.000Z");
    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "completed" });

    expect(kernel.createBrowser).toHaveBeenCalledTimes(2);
    expect(kernel.deleteBrowserByIdOrName.mock.calls.filter(
      ([idOrName]) => String(idOrName).startsWith("murph-browser-"),
    )).toHaveLength(2);
    expect(run.kernelSessionId).toBe("kernel-session-restored-2");
  });

  it("keeps a committed fallback checkpointing when its retry has a typed boundary failure", async () => {
    const now = new Date("2026-06-17T12:05:02.000Z");
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    let handoff = createHandoff();
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "FAILED",
      status: "NEEDS_AUTH",
    });
    const store = createStore({ handoff, run });
    store.requireHandoffByTokenHash.mockImplementation(async () => handoff);
    store.claimHandoffForCompletion.mockImplementation(async () => {
      handoff = {
        ...handoff,
        status: "checkpointing",
        updatedAt: CLAIMED_AT,
      };
      return handoff;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    let terminalWriteCalls = 0;
    store.convertManagedLoginHandoffToLogin.mockImplementation(async (input) => {
      terminalWriteCalls += 1;
      if (terminalWriteCalls === 1 && input.browser) {
        run = {
          ...run,
          kernelLiveViewUrlEncrypted: input.browser.kernelLiveViewUrlEncrypted,
          kernelSessionId: input.browser.kernelSessionId,
          updatedAt: input.now,
        };
        handoff = {
          ...handoff,
          purpose: "login",
          status: "open",
          updatedAt: input.now,
        };
        throw new Error("conversion response lost");
      }
      throw hostedOnboardingError({
        code: "HOSTED_COMPUTER_REPLY_BOUNDARY_UNAVAILABLE",
        httpStatus: 409,
        message: "Computer reply boundary is temporarily unavailable.",
        retryable: true,
      });
    });
    const kernel = createKernel({
      ensureManagedAuthConnection: vi.fn(async () => connection),
      findManagedAuthConnection: vi.fn(async () => connection),
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/fallback",
        sessionId: "kernel-session-fallback",
      })),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "checkpointing" });
    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "redirect",
      url: "https://join.example.test/computer/handoff/handoff-token",
    });

    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(kernel.deleteBrowserByIdOrName.mock.calls.filter(
      ([idOrName]) => String(idOrName).startsWith("murph-browser-"),
    )).toHaveLength(1);
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalledWith("kernel-session-fallback");
    expect(run.kernelSessionId).toBe("kernel-session-fallback");
  });

  it("surfaces repeated pre-write reply-boundary failures to the retry route", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff();
    const failedConnection = createConnection({
      browserSessionId: null,
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "FAILED",
      status: "NEEDS_AUTH",
    });
    const store = createStore({ handoff, run });
    const boundaryError = hostedOnboardingError({
      code: "HOSTED_COMPUTER_REPLY_BOUNDARY_UNAVAILABLE",
      httpStatus: 409,
      message: "Computer reply boundary is temporarily unavailable.",
      retryable: true,
    });
    store.convertManagedLoginHandoffToLogin.mockRejectedValue(boundaryError);
    const kernel = createKernel({
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/fallback",
        sessionId: "kernel-session-fallback",
      })),
      findManagedAuthConnection: vi.fn(async () => failedConnection),
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

    const error = await service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
      details: {
        managedLoginCauseCode: "HOSTED_COMPUTER_REPLY_BOUNDARY_UNAVAILABLE",
        managedLoginStage: "live_view_fallback",
      },
      retryable: true,
    });
    expect(store.convertManagedLoginHandoffToLogin).toHaveBeenCalledTimes(2);
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
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
    expect(store.completeManagedLoginHandoff).toHaveBeenCalledWith({
      browser: {
        kernelLiveViewUrlEncrypted:
          "https://browser.onkernel.com:8443/live/test",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: CLAIMED_AT,
      handoffId: handoff.id,
      memberId: run.memberId,
      now: NOW,
      runId: run.id,
    });
    expect(store.replaceRunBrowser).not.toHaveBeenCalled();
    expect(store.completeHandoff).not.toHaveBeenCalled();
  });

  it("verifies managed login before resuming the exact setup-owned run to Connect", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    });
    const handoff = createHandoff();
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel({
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/setup",
        sessionId: "kernel-session-setup",
      })),
      findManagedAuthConnection: vi.fn(async () => connection),
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

    await expect(service.completeHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_REQUIRES_VERIFICATION",
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "redirect",
      url: "/connect",
    });
    expect(store.requireMemberOwnedProviderSetupRun).toHaveBeenCalledWith({
      memberId: run.memberId,
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      runId: run.id,
    });
    expect(store.completeManagedLoginHandoff).toHaveBeenCalledTimes(1);
    expect(store.markRunRunning).toHaveBeenCalledWith(expect.objectContaining({
      expectedHandoffStatus: "completed",
      expectedKernelSessionId: "kernel-session-setup",
      expectedPendingHandoffId: handoff.id,
      runId: run.id,
    }));
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

  it("replays an atomically converted fallback on the same handoff token", async () => {
    const run = createRun();
    const handoff = createHandoff({
      purpose: "login",
      status: "open",
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel();
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
    })).resolves.toEqual({
      kind: "redirect",
      url: "https://join.example.test/computer/handoff/handoff-token",
    });
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(store.convertManagedLoginHandoffToLogin).not.toHaveBeenCalled();
    expect(kernel.ensureManagedAuthConnection).not.toHaveBeenCalled();
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
    expect(result.url).toBe(
      "https://join.example.test/computer/handoff/handoff-token",
    );
    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith(
      "managed-auth-browser",
    );
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(store.convertManagedLoginHandoffToLogin).toHaveBeenCalledWith({
      browser: {
        kernelLiveViewUrlEncrypted:
          "https://browser.onkernel.com:8443/live/fallback",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: CLAIMED_AT,
      handoffId: handoff.id,
      memberId: run.memberId,
      now: NOW,
      runId: run.id,
    });
    expect(store.createHandoff).not.toHaveBeenCalled();
    expect(store.replaceAwaitingRunHandoff).not.toHaveBeenCalled();
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
    expect(store.completeHandoff).not.toHaveBeenCalled();
  });

  it("denies an expired managed-login capability without terminating provider-owned state", async () => {
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
    await expect(service.readHandoffPageState({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "expired",
      returnContactKind: null,
      suggestedReply: "Done",
    });
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(kernel.startManagedAuthLogin).not.toHaveBeenCalled();
  });

  it("does not let an obsolete managed-login token disturb the current handoff writer", async () => {
    const run = createRun({
      pendingHandoffId: "hch_new_handoff",
    });
    const handoff = createHandoff({
      status: "checkpointing",
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => createConnection({
        browserSessionId: "current-managed-browser",
        flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/current",
      })),
    });
    const service = new ComputerUseService({
      kernel,
      now: () => NOW,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "expired" });

    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalled();
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    expect(store.claimHandoffForCompletion).not.toHaveBeenCalled();
    expect(store.reclaimHandoffForCompletion).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
  });

  it("revokes an expired managed-login link without expiring its fresh checkpoint", async () => {
    const now = new Date("2026-06-17T12:20:00.001Z");
    const run = createRun();
    const handoff = createHandoff({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:19:59.999Z"),
    });
    const store = createStore({ handoff, run });
    const kernel = createKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({ kind: "expired" });
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    expect(store.reclaimHandoffForCompletion).not.toHaveBeenCalled();
    expect(kernel.findManagedAuthConnection).not.toHaveBeenCalled();
  });

  it("revokes a duplicate link request without expiring active work at the TTL boundary", async () => {
    let now = new Date("2026-06-17T12:19:59.999Z");
    const run = createRun();
    let handoff = createHandoff({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
    });
    const connection = createConnection({
      flowExpiresAt: new Date("2026-06-17T12:30:00.000Z"),
      flowStatus: "IN_PROGRESS",
      hostedUrl: "https://auth.onkernel.com/login/test",
    });
    const store = createStore({ handoff, run });
    store.requireHandoffByTokenHash.mockImplementation(async () => handoff);
    store.claimHandoffForCompletion.mockImplementation(async () => {
      handoff = {
        ...handoff,
        status: "checkpointing",
        updatedAt: now,
      };
      return handoff;
    });
    let releaseEnsure = () => {};
    let signalEnsureStarted = () => {};
    const ensureStarted = new Promise<void>((resolve) => {
      signalEnsureStarted = resolve;
    });
    const ensureGate = new Promise<void>((resolve) => {
      releaseEnsure = resolve;
    });
    const kernel = createKernel({
      ensureManagedAuthConnection: vi.fn(async () => {
        signalEnsureStarted();
        await ensureGate;
        return connection;
      }),
      findManagedAuthConnection: vi.fn(async () => connection),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://join.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    const firstRequest = service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    });
    await ensureStarted;
    now = new Date("2026-06-17T12:20:00.001Z");
    try {
      await expect(service.continueManagedLoginHandoff({
        memberId: run.memberId,
        token: "handoff-token",
      })).resolves.toEqual({ kind: "expired" });
      expect(store.markHandoffExpired).not.toHaveBeenCalled();
    } finally {
      releaseEnsure();
    }
    await expect(firstRequest).resolves.toMatchObject({ kind: "redirect" });
  });

  it("keeps an ambiguous managed login launch checkpointing after an empty current-flow read", async () => {
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

    expect(result).toEqual({ kind: "checkpointing" });
    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith("kernel-session-1");
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.convertManagedLoginHandoffToLogin).not.toHaveBeenCalled();
    expect(store.replaceRunBrowser).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
    expect(store.createHandoff).not.toHaveBeenCalled();
    expect(store.replaceAwaitingRunHandoff).not.toHaveBeenCalled();
  });

  it("reports only safe validation dimensions when the Live View fallback fails", async () => {
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    let handoff = createHandoff();
    const failedConnection = createConnection({
      browserSessionId: null,
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "FAILED",
      status: "NEEDS_AUTH",
    });
    const store = createStore({ handoff, run });
    store.requireHandoffByTokenHash.mockImplementation(async () => handoff);
    store.claimHandoffForCompletion.mockImplementation(async () => {
      handoff = {
        ...handoff,
        status: "checkpointing",
        updatedAt: CLAIMED_AT,
      };
      return handoff;
    });
    store.clearRunBrowser.mockImplementation(async () => {
      run = {
        ...run,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
      };
      return run;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    const kernel = createKernel({
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://api.onkernel.com/browser/live/private-capability",
        sessionId: "kernel-session-2",
      })),
      findManagedAuthConnection: vi.fn(async () => failedConnection),
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

    const error = await service.continueManagedLoginHandoff({
      memberId: run.memberId,
      token: "handoff-token",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
      retryable: true,
    });
    if (!isHostedOnboardingError(error)) {
      throw new Error("Expected a hosted computer domain error.");
    }
    expect(error.details).toEqual({
      liveViewHostnameAllowed: true,
      liveViewParsed: true,
      liveViewPortAllowed: false,
      liveViewProtocolAllowed: true,
      managedLoginCauseCode: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
      managedLoginStage: "live_view_fallback",
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("private-capability");
    expect(serialized).not.toContain("private provider failure");
    expect(serialized).not.toContain("handoff-token");
    expect(store.releaseHandoffClaim).not.toHaveBeenCalled();
    expect(store.reclaimHandoffForCompletion).not.toHaveBeenCalled();
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    await expect(service.readHandoffPageState({
      memberId: run.memberId,
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "checkpointing",
      purpose: "managed_login",
      returnContactKind: null,
      suggestedReply: "Done",
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

  it("converts a missed terminal provider failure to the existing fallback handoff on resume", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff({ status: "checkpointing" });
    const claimed = { ...handoff, updatedAt: NOW };
    const failedConnection = createConnection({
      browserSessionId: null,
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "FAILED",
      status: "NEEDS_AUTH",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockResolvedValue(run);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => failedConnection),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
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
    expect(store.convertManagedLoginHandoffToLogin).toHaveBeenCalledWith({
      browser: expect.objectContaining({ kernelSessionId: "kernel-session-2" }),
      expectedHandoffUpdatedAt: NOW,
      handoffId: handoff.id,
      memberId: run.memberId,
      now: NOW,
      runId: run.id,
    });
    expect(store.markRunRunning).not.toHaveBeenCalled();
  });

  it("yields a reclaimed resume claim when confirming provider state turns nonterminal", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff({ status: "checkpointing" });
    const claimed = { ...handoff, updatedAt: NOW };
    const success = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockResolvedValue(run);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(null),
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
    })).resolves.toMatchObject({ status: "awaiting_user" });
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: NOW,
      handoffId: handoff.id,
    });
    expect(store.completeManagedLoginHandoff).not.toHaveBeenCalled();
  });

  it("yields a reclaimed resume claim when the owned-run reread fails", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff({ status: "checkpointing" });
    const claimed = { ...handoff, updatedAt: NOW };
    const success = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun
      .mockResolvedValueOnce(run)
      .mockRejectedValueOnce(new Error("owned run reread failed"));
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => success),
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
    })).rejects.toThrow("owned run reread failed");
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: NOW,
      handoffId: handoff.id,
    });
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalled();
  });

  it("resumes a browserless stale managed checkpoint after fresh successful provider proof", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    const handoff = createHandoff({
      status: "checkpointing",
    });
    const claimed = {
      ...handoff,
      updatedAt: NOW,
    };
    const connection = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockResolvedValue(run);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => connection),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
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
      status: "running",
    });
    expect(store.reclaimHandoffForCompletion).toHaveBeenCalledWith({
      expectedUpdatedAt: handoff.updatedAt,
      handoffId: handoff.id,
      memberId: run.memberId,
      now: NOW,
    });
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(store.completeManagedLoginHandoff).toHaveBeenCalledTimes(1);
    expect(store.markRunRunning).toHaveBeenCalledTimes(1);
  });

  it("resumes from durable state after an ambiguous committed resume completion", async () => {
    let run = createRun({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
    });
    let handoff = createHandoff({
      status: "checkpointing",
    });
    const connection = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockImplementation(async () => run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockImplementation(async (input) => {
      handoff = {
        ...handoff,
        updatedAt: input.now,
      };
      return handoff;
    });
    store.requireOwnedRun.mockImplementation(async () => run);
    let terminalWriteCalls = 0;
    store.completeManagedLoginHandoff.mockImplementation(async (input) => {
      terminalWriteCalls += 1;
      if (terminalWriteCalls === 1 && input.browser) {
        run = {
          ...run,
          kernelLiveViewUrlEncrypted: input.browser.kernelLiveViewUrlEncrypted,
          kernelSessionId: input.browser.kernelSessionId,
          updatedAt: input.now,
        };
        handoff = {
          ...handoff,
          completedAt: input.now,
          status: "completed",
          updatedAt: input.now,
        };
      }
      throw new Error("resume completion response lost");
    });
    store.markRunRunning.mockImplementation(async () => {
      run = {
        ...run,
        pausedAt: null,
        status: "running",
      };
      return run;
    });
    const kernel = createKernel({
      createBrowser: vi.fn(async () => ({
        liveViewUrl: "https://browser.onkernel.com:8443/live/resumed",
        sessionId: "kernel-session-resumed",
      })),
      findManagedAuthConnection: vi.fn(async () => connection),
    });
    const service = new ComputerUseService({
      crypto: createCrypto(),
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
    expect(store.markRunRunning).not.toHaveBeenCalled();

    await expect(service.startRun({
      memberId: run.memberId,
      resumeAfterMailboxItemId: "mailbox-item-2",
      startUrl: run.lastUrl,
    })).resolves.toMatchObject({
      reused: true,
      runId: run.id,
      status: "running",
    });

    expect(store.completeManagedLoginHandoff).toHaveBeenCalledTimes(2);
    expect(kernel.createBrowser).toHaveBeenCalledTimes(1);
    expect(kernel.deleteBrowserByIdOrName.mock.calls.filter(
      ([idOrName]) => String(idOrName).startsWith("murph-browser-"),
    )).toHaveLength(1);
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalledWith("kernel-session-resumed");
    expect(store.markRunRunning).toHaveBeenCalledWith(expect.objectContaining({
      expectedKernelSessionId: "kernel-session-resumed",
      runId: run.id,
    }));
  });

  it("resumes a restored-browser stale managed checkpoint without replacing the task browser", async () => {
    const run = createRun({
      kernelLiveViewUrlEncrypted: "restored-live-view",
      kernelSessionId: "restored-task-browser",
      updatedAt: new Date("2026-06-17T12:01:00.000Z"),
    });
    const handoff = createHandoff({
      status: "checkpointing",
    });
    const claimed = {
      ...handoff,
      updatedAt: NOW,
    };
    const connection = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockResolvedValue(run);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => connection),
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
      status: "running",
    });
    expect(kernel.deleteBrowserByIdOrName).toHaveBeenCalledWith("managed-auth-browser");
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalledWith("restored-task-browser");
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.completeManagedLoginHandoff).toHaveBeenCalledWith({
      browser: null,
      expectedHandoffUpdatedAt: NOW,
      handoffId: handoff.id,
      memberId: run.memberId,
      now: NOW,
      runId: run.id,
    });
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    expect(store.markRunRunning).toHaveBeenCalledTimes(1);
  });

  it("does not trust a restored task browser that was not published after the stale claim", async () => {
    const handoff = createHandoff({
      status: "checkpointing",
    });
    const run = createRun({
      kernelLiveViewUrlEncrypted: "unproven-live-view",
      kernelSessionId: "unproven-task-browser",
      updatedAt: handoff.updatedAt,
    });
    const claimed = {
      ...handoff,
      updatedAt: NOW,
    };
    const connection = createConnection({
      browserSessionId: "managed-auth-browser",
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      flowStatus: "SUCCESS",
      status: "AUTHENTICATED",
    });
    const store = createStore({ handoff, run });
    store.findActiveRunForMember.mockResolvedValue(run);
    store.findHandoffByRun = vi.fn(async () => handoff);
    store.reclaimHandoffForCompletion.mockResolvedValue(claimed);
    store.requireOwnedRun.mockResolvedValue(run);
    const kernel = createKernel({
      findManagedAuthConnection: vi.fn(async () => connection),
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
    expect(kernel.deleteBrowserByIdOrName).not.toHaveBeenCalled();
    expect(kernel.createBrowser).not.toHaveBeenCalled();
    expect(store.completeManagedLoginHandoff).not.toHaveBeenCalled();
    expect(store.markHandoffExpired).not.toHaveBeenCalled();
    expect(store.markRunRunning).not.toHaveBeenCalled();
    expect(store.releaseHandoffClaim).toHaveBeenCalledWith({
      expectedUpdatedAt: NOW,
      handoffId: handoff.id,
    });
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
    resumeAfterMailboxLaneSeq: null,
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
    createdAt: new Date("2026-06-17T12:00:00.000Z"),
    expiresAt: new Date("2026-06-17T12:20:00.000Z"),
    id: "hch_handoff123",
    memberId: "member_123",
    purpose: "managed_login",
    returnContactKind: null,
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
  let latestHandoff = input.handoff;
  let latestRun = input.run;
  const claimed = input.handoff
    ? {
        ...input.handoff,
        status: "checkpointing" as const,
        updatedAt: CLAIMED_AT,
      }
    : null;
  const requireHandoffByTokenHash = vi.fn(async (
    lookupInput: Parameters<ComputerUseStore["requireHandoffByTokenHash"]>[0],
  ): Promise<ComputerHandoffRecord> => {
    void lookupInput;
    if (!input.handoff) {
      throw new Error("Handoff missing.");
    }
    return input.handoff;
  });
  const requireMemberComputerUseAvailable = vi.fn(async (
    availabilityInput: Parameters<
      ComputerUseStore["requireMemberComputerUseAvailable"]
    >[0],
  ): Promise<void> => {
    if (availabilityInput.memberId !== input.run.memberId) {
      throw new Error("Member missing.");
    }
  });
  const requireMemberOwnedProviderSetupRun = vi.fn(async (
    ownerInput: Parameters<
      ComputerUseStore["requireMemberOwnedProviderSetupRun"]
    >[0],
  ): ReturnType<ComputerUseStore["requireMemberOwnedProviderSetupRun"]> => {
    if (
      latestRun.memberId !== ownerInput.memberId
      || latestRun.id !== ownerInput.runId
      || latestRun.ownerKey !== ownerInput.ownerKey
      || latestRun.ownerPurpose !== ownerInput.ownerPurpose
    ) {
      throw new Error("Browser run ownership does not match setup.");
    }
    return {
      ...latestRun,
      deletionPending: false,
    };
  });
  const requireMemberOwnedProviderSetupRunAcquisition = vi.fn(async (
    ownerInput: Parameters<
      ComputerUseStore["requireMemberOwnedProviderSetupRunAcquisition"]
    >[0],
  ): Promise<void> => {
    if (ownerInput.expectedRunId === null) {
      throw new Error("Browser run belongs to another operation.");
    }
    await requireMemberOwnedProviderSetupRun({
      memberId: ownerInput.memberId,
      ownerKey: ownerInput.ownerKey,
      ownerPurpose: ownerInput.ownerPurpose,
      runId: ownerInput.expectedRunId,
    });
    if (
      ownerInput.candidateRunId
      && ownerInput.candidateRunId !== ownerInput.expectedRunId
    ) {
      throw new Error("Browser run ownership does not match setup.");
    }
  });
  const requireComputerHandoffAccess = vi.fn(async (
    accessInput: Parameters<ComputerUseStore["requireComputerHandoffAccess"]>[0],
  ): Promise<ComputerHandoffRecord> => {
    const handoff = await requireHandoffByTokenHash({
      tokenHash: accessInput.tokenHash,
    });
    if (handoff.memberId !== accessInput.memberId) {
      throw new Error("Handoff missing.");
    }
    const ownerKey = input.run.ownerKey;
    if (
      input.run.id === handoff.runId
      && input.run.memberId === accessInput.memberId
      && input.run.ownerPurpose === "member_owned_provider_setup"
      && typeof ownerKey === "string"
      && ownerKey.length > 0
    ) {
      await requireMemberOwnedProviderSetupRun({
        memberId: accessInput.memberId,
        ownerKey,
        ownerPurpose: "member_owned_provider_setup",
        runId: handoff.runId,
      });
    } else {
      await requireMemberComputerUseAvailable({
        memberId: accessInput.memberId,
      });
    }
    return handoff;
  });
  return {
    attachAwaitingRunHandoff: vi.fn(async (attachInput) => ({
      ...input.run,
      pausedAt: attachInput.now,
      pendingHandoffId: attachInput.newPendingHandoffId,
      resumeAfterMailboxLaneSeq: null,
    })),
    async attachRunBrowser() {
      throw new Error("attachRunBrowser should not be called.");
    },
    claimHandoffForCompletion: vi.fn(
      async () => claimed,
    ),
    claimLoginHandoffForCheckpoint: vi.fn(async () => {
      throw new Error("claimLoginHandoffForCheckpoint should not be called.");
    }),
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
    completeManagedLoginHandoff: vi.fn(async (completeInput) => {
      latestHandoff = {
        ...claimed!,
        completedAt: completeInput.now,
        status: "completed" as const,
        updatedAt: completeInput.now,
      };
      latestRun = {
        ...latestRun,
        ...(completeInput.browser
          ? {
              kernelLiveViewUrlEncrypted:
                completeInput.browser.kernelLiveViewUrlEncrypted,
              kernelSessionId: completeInput.browser.kernelSessionId,
            }
          : {}),
      };
      return {
        handoff: latestHandoff,
        run: latestRun,
      };
    }),
    convertManagedLoginHandoffToLogin: vi.fn(async (convertInput) => ({
      handoff: {
        ...claimed!,
        purpose: "login" as const,
        status: "open" as const,
      },
      run: {
        ...input.run,
        ...(convertInput.browser
          ? {
              kernelLiveViewUrlEncrypted:
                convertInput.browser.kernelLiveViewUrlEncrypted,
              kernelSessionId: convertInput.browser.kernelSessionId,
            }
          : {}),
        pausedAt: convertInput.now,
        resumeAfterMailboxLaneSeq: 1n,
      },
    })),
    createHandoff: vi.fn(async (handoffInput) => createHandoff({
      expiresAt: handoffInput.expiresAt,
      id: "hch_fallback",
      memberId: handoffInput.memberId,
      purpose: handoffInput.purpose,
      returnContactKind: handoffInput.returnContactKind,
      runId: handoffInput.runId,
      suggestedReply: handoffInput.suggestedReply,
      tokenHash: handoffInput.tokenHash,
    })),
    async createRun() {
      throw new Error("createRun should not be called.");
    },
    findActiveRunForMember: vi.fn(async () => null),
    findHandoffByRun: vi.fn(async () => latestHandoff),
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
    markRunRunning: vi.fn(async () => {
      latestRun = {
        ...latestRun,
        pausedAt: null,
        pendingHandoffId: null,
        resumeAfterMailboxLaneSeq: null,
        status: "running" as const,
      };
      return latestRun;
    }),
    reclaimHandoffForCompletion: vi.fn(async () => claimed),
    releaseHandoffClaim: vi.fn(async () => {}),
    replaceAwaitingRunHandoff: vi.fn(async (replaceInput) => ({
      ...input.run,
      pausedAt: replaceInput.now,
      pendingHandoffId: replaceInput.newPendingHandoffId,
      resumeAfterMailboxLaneSeq: null,
    })),
    replaceRunBrowser: vi.fn(async () => input.run),
    resumeRunAfterLoginCheckpoint: vi.fn(async () => {
      throw new Error("resumeRunAfterLoginCheckpoint should not be called.");
    }),
    rotateManagedLoginHandoffCapability: vi.fn(async (rotateInput) => ({
      ...input.handoff!,
      expiresAt: rotateInput.expiresAt,
      tokenHash: rotateInput.tokenHash,
    })),
    requireComputerHandoffAccess,
    requireHandoffByTokenHash,
    requireMemberComputerUseAvailable,
    requireMemberOwnedProviderSetupRun,
    requireMemberOwnedProviderSetupRunAcquisition,
    requireOwnedRun: vi.fn(async () => latestRun),
    async updateRunBrowserState() {},
  } satisfies MockComputerUseStore;
}
