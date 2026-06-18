import { describe, expect, it } from "vitest";

import type {
  ComputerKernelClient,
} from "../src/lib/computer-use/kernel-client";
import { ComputerUseService } from "../src/lib/computer-use/service";
import type {
  ComputerHandoffRecord,
  ComputerProfileRecord,
  ComputerRunRecord,
  ComputerUseStore,
} from "../src/lib/computer-use/store";

describe("ComputerUseService", () => {
  it("stores a durable awaiting-user pause and composes the handoff message", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({ updatedAt: now });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    const result = await service.pauseForUser({
      handoffPurpose: "login",
      memberId: "member_123",
      message: "Can you log in here?",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    expect(result).toMatchObject({
      awaitingReason: "login_needed",
      runId: "hcr_run123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(result.message).toBe(`Can you log in here?\n\n${result.handoffUrl}`);
    expect(store.run).toMatchObject({
      awaitingMessage: result.message,
      awaitingReason: "login_needed",
      pausedAt: now,
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      id: "hch_handoff123",
      memberId: "member_123",
      purpose: "login",
      runId: "hcr_run123",
      status: "open",
      suggestedReply: "done",
    });
    expect(store.handoff?.tokenHash).toHaveLength(64);
  });

  it("stores final confirmation as the generic pause without creating a handoff", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({ updatedAt: now });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    const result = await service.pauseForUser({
      handoffPurpose: null,
      memberId: "member_123",
      message: "Should I book this appointment?",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: "yes",
    });

    expect(result).toEqual({
      awaitingReason: "final_confirmation",
      handoffUrl: null,
      message: "Should I book this appointment?",
      runId: "hcr_run123",
      status: "awaiting_user",
      suggestedReply: "yes",
    });
    expect(store.handoff).toBeNull();
    expect(store.run).toMatchObject({
      awaitingMessage: "Should I book this appointment?",
      awaitingReason: "final_confirmation",
      pausedAt: now,
      pendingHandoffId: null,
      status: "awaiting_user",
      suggestedReply: "yes",
    });
  });

  it("does not auto-resume a final-confirmation pause from browser actions", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingMessage: "Should I book this appointment?",
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ run });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.observe({
      memberId: "member_123",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run.status).toBe("awaiting_user");
  });

  it("resumes an awaiting final-confirmation run only when a later conversation message exists", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const resumeMailboxItem = {
      createdAt: new Date("2026-06-17T12:04:30.000Z"),
      id: "mailbox_user_reply",
    };
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ resumeMailboxItem, run });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      startUrl: null,
      taskKind: "appointment",
    });

    expect(result).toMatchObject({
      awaitingReason: null,
      reused: true,
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      awaitingReason: null,
      resumedAt: now,
      status: "running",
    });
    expect(store.lastResumeMailboxItem).toEqual({
      ...resumeMailboxItem,
      awaitingReason: "final_confirmation",
      source: "conversation_message",
    });
  });

  it("does not resume an awaiting run without a later conversation message", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      startUrl: null,
      taskKind: "appointment",
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      reused: true,
      runId: "hcr_run123",
      status: "awaiting_user",
    });
    expect(store.run.status).toBe("awaiting_user");
    expect(store.lastResumeMailboxItem).toBeNull();
  });

  it("updates the browser URL and title before storing a pause checkpoint", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({
      lastTitle: "Old title",
      lastUrl: "https://old.example.test",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: createFakeKernel({
        executeResult: {
          title: "Checkout",
          url: "https://shop.example.test/checkout",
          visibleText: "Ready",
        },
      }),
      now: () => now,
      store,
    });

    await service.pauseForUser({
      handoffPurpose: null,
      memberId: "member_123",
      message: "Should I place this order?",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: "yes",
    });

    expect(store.run).toMatchObject({
      lastTitle: "Checkout",
      lastUrl: "https://shop.example.test/checkout",
      status: "awaiting_user",
    });
  });

  it("returns an expired handoff page state instead of throwing for stale handoff links", async () => {
    const now = new Date("2026-06-17T12:30:00.000Z");
    const handoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      suggestedReply: "done",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "expired",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("does not expose a handoff after the run stops awaiting it", async () => {
    const now = new Date("2026-06-17T12:10:00.000Z");
    const handoff = createHandoffRecord({ purpose: "payment" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: null,
        pendingHandoffId: handoff.id,
        status: "failed",
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      kind: "expired",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
  });

  it("keeps Kernel identifiers when finish cleanup fails so a retry can delete the browser", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({ run: createRunRecord({ updatedAt: now }) });
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail", "ok"],
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: "hcr_run123",
      summary: "Done.",
    });
    expect(store.run).toMatchObject({
      kernelCdpWsUrlEncrypted: "encrypted-cdp",
      kernelLiveViewUrlEncrypted: "encrypted-live-view",
      kernelSessionId: "kernel-session-1",
      status: "completed",
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: "hcr_run123",
      summary: "Done.",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1", "kernel-session-1"]);
    expect(store.run).toMatchObject({
      kernelCdpWsUrlEncrypted: null,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      status: "completed",
    });
  });

  it("closes a pending handoff when a paused run is finished", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "payment" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "payment_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail"],
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "failed",
      runId: "hcr_run123",
      summary: "Could not send checkpoint message.",
    });

    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      pendingHandoffId: handoff.id,
      status: "failed",
    });
  });

  it("leaves login handoff open and retryable if profile reopen fails after browser delete", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      profile: createProfileRecord(),
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      createBrowserResults: ["fail", "ok"],
      executeResult: {
        title: "Signed in",
        url: "https://shop.example.test/account",
        visibleText: "Account",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toThrow("createBrowser failed");
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
    });

    await service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    });
    expect(store.handoff).toMatchObject({
      status: "completed",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
  });

  it("does not resume a non-login handoff when the user clicks Done", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "manual_browser_help",
      suggestedReply: "done",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "stuck",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      status: "completed",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
  });

  it("expires stale active computer runs during retention cleanup", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 1,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });
});

class FakeComputerUseStore implements ComputerUseStore {
  handoff: ComputerHandoffRecord | null = null;
  lastResumeMailboxItem: Parameters<ComputerUseStore["markRunRunning"]>[0]["resumeMailboxItem"] | null = null;
  profile: ComputerProfileRecord;
  resumeMailboxItem: Awaited<ReturnType<ComputerUseStore["findLatestConversationMessageAfter"]>> = null;
  run: ComputerRunRecord;

  constructor(input: {
    handoff?: ComputerHandoffRecord | null;
    profile?: ComputerProfileRecord;
    resumeMailboxItem?: Awaited<ReturnType<ComputerUseStore["findLatestConversationMessageAfter"]>>;
    run: ComputerRunRecord;
  }) {
    this.handoff = input.handoff ?? null;
    this.profile = input.profile ?? createProfileRecord();
    this.resumeMailboxItem = input.resumeMailboxItem ?? null;
    this.run = input.run;
  }

  async requireOwnedRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord> {
    if (input.memberId !== this.run.memberId || input.runId !== this.run.id) {
      throw new Error("Run not found.");
    }
    return this.run;
  }

  async expireStaleActiveRunsForProfile(): Promise<void> {}

  async listStaleActiveRuns(input: Parameters<ComputerUseStore["listStaleActiveRuns"]>[0]): Promise<ComputerRunRecord[]> {
    return this.run.expiresAt <= input.now
      && (this.run.status === "running" || this.run.status === "awaiting_user")
      ? [this.run]
      : [];
  }

  async listStaleActiveRunsForProfile(input: Parameters<ComputerUseStore["listStaleActiveRunsForProfile"]>[0]): Promise<ComputerRunRecord[]> {
    return input.memberId === this.run.memberId
      && input.profileId === this.run.profileId
      && this.run.expiresAt <= input.now
      && (this.run.status === "running" || this.run.status === "awaiting_user")
      ? [this.run]
      : [];
  }

  async findActiveRunForProfile(input: Parameters<ComputerUseStore["findActiveRunForProfile"]>[0]): Promise<ComputerRunRecord | null> {
    return input.memberId === this.run.memberId
      && input.profileId === this.run.profileId
      && this.run.expiresAt > input.now
      && (this.run.status === "running" || this.run.status === "awaiting_user")
      ? this.run
      : null;
  }

  async findLatestPendingComputerRun(input: Parameters<ComputerUseStore["findLatestPendingComputerRun"]>[0]): Promise<ComputerRunRecord | null> {
    return input.memberId === this.run.memberId
      && this.run.expiresAt > input.now
      && (this.run.status === "awaiting_user" || this.run.status === "running")
      ? this.run
      : null;
  }

  async findLatestConversationMessageAfter(input: Parameters<ComputerUseStore["findLatestConversationMessageAfter"]>[0]): Promise<Awaited<ReturnType<ComputerUseStore["findLatestConversationMessageAfter"]>>> {
    return this.resumeMailboxItem
      && input.memberId === this.run.memberId
      && this.resumeMailboxItem.createdAt > input.after
      && this.resumeMailboxItem.createdAt <= input.now
      ? this.resumeMailboxItem
      : null;
  }

  async createHandoff(input: Parameters<ComputerUseStore["createHandoff"]>[0]): Promise<ComputerHandoffRecord> {
    this.handoff = {
      completedAt: null,
      expiresAt: input.expiresAt,
      id: "hch_handoff123",
      memberId: input.memberId,
      openedAt: null,
      purpose: input.purpose,
      runId: input.runId,
      status: "open",
      suggestedReply: input.suggestedReply,
      tokenHash: input.tokenHash,
    };
    return this.handoff;
  }

  async createRun(): Promise<ComputerRunRecord> {
    throw unsupported("createRun");
  }

  async requireHandoffByTokenHash(): Promise<ComputerHandoffRecord> {
    if (!this.handoff) {
      throw new Error("Handoff not found.");
    }
    return this.handoff;
  }

  async markHandoffExpired(input: Parameters<ComputerUseStore["markHandoffExpired"]>[0]): Promise<ComputerHandoffRecord> {
    if (!this.handoff || this.handoff.id !== input.handoffId) {
      throw new Error("Handoff not found.");
    }
    this.handoff = {
      ...this.handoff,
      status: "expired",
    };
    return this.handoff;
  }

  async completeHandoff(input: Parameters<ComputerUseStore["completeHandoff"]>[0]): Promise<ComputerHandoffRecord> {
    if (!this.handoff || this.handoff.id !== input.handoffId) {
      throw new Error("Handoff not found.");
    }
    this.handoff = {
      ...this.handoff,
      completedAt: input.now,
      status: "completed",
    };
    return this.handoff;
  }

  async markRunAwaitingUser(
    input: Parameters<ComputerUseStore["markRunAwaitingUser"]>[0],
  ): Promise<ComputerRunRecord> {
    this.run = {
      ...this.run,
      awaitingMessage: input.awaitingMessage,
      awaitingReason: input.awaitingReason,
      pausedAt: input.now,
      pendingHandoffId: input.pendingHandoffId,
      status: "awaiting_user",
      suggestedReply: input.suggestedReply,
      updatedAt: input.now,
    };
    return this.run;
  }

  async markRunRunning(
    input: Parameters<ComputerUseStore["markRunRunning"]>[0],
  ): Promise<ComputerRunRecord> {
    this.lastResumeMailboxItem = input.resumeMailboxItem;
    this.run = {
      ...this.run,
      awaitingMessage: null,
      awaitingReason: null,
      pausedAt: null,
      pendingHandoffId: null,
      resumedAt: input.now,
      status: "running",
      suggestedReply: null,
      updatedAt: input.now,
    };
    return this.run;
  }

  async clearRunBrowser(input: Parameters<ComputerUseStore["clearRunBrowser"]>[0]): Promise<ComputerRunRecord> {
    this.run = {
      ...this.run,
      kernelCdpWsUrlEncrypted: null,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      updatedAt: input.now,
    };
    return this.run;
  }

  async replaceRunBrowser(input: Parameters<ComputerUseStore["replaceRunBrowser"]>[0]): Promise<ComputerRunRecord> {
    this.run = {
      ...this.run,
      kernelCdpWsUrlEncrypted: input.kernelCdpWsUrlEncrypted,
      kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
      kernelSessionId: input.kernelSessionId,
      updatedAt: input.now,
    };
    return this.run;
  }

  async updateRunBrowserState(input: Parameters<ComputerUseStore["updateRunBrowserState"]>[0]): Promise<void> {
    this.run = {
      ...this.run,
      lastTitle: input.lastTitle,
      lastUrl: input.lastUrl,
    };
  }

  async findOpenHandoffByRun(input: Parameters<ComputerUseStore["findOpenHandoffByRun"]>[0]): Promise<ComputerHandoffRecord | null> {
    return this.handoff
      && this.handoff.id === input.handoffId
      && this.handoff.runId === input.runId
      && this.handoff.status === "open"
      ? this.handoff
      : null;
  }

  async markHandoffOpened(input: Parameters<ComputerUseStore["markHandoffOpened"]>[0]): Promise<void> {
    if (this.handoff && this.handoff.id === input.handoffId && !this.handoff.openedAt) {
      this.handoff = {
        ...this.handoff,
        openedAt: input.now,
      };
    }
  }

  async markProfileCheckpointed(input: Parameters<ComputerUseStore["markProfileCheckpointed"]>[0]): Promise<void> {
    this.profile = {
      ...this.profile,
      lastAuthenticatedAt: input.authenticated ? input.now : this.profile.lastAuthenticatedAt,
      lastCheckpointAt: input.now,
    };
  }

  async markRunExpired(input: Parameters<ComputerUseStore["markRunExpired"]>[0]): Promise<ComputerRunRecord> {
    this.run = {
      ...this.run,
      completedAt: input.now,
      status: "expired",
      updatedAt: input.now,
    };
    return this.run;
  }

  async requireOwnedProfile(): Promise<ComputerProfileRecord> {
    return this.profile;
  }

  async upsertProfile(input: Parameters<ComputerUseStore["upsertProfile"]>[0]): Promise<ComputerProfileRecord> {
    this.profile = {
      ...this.profile,
      kernelProfileName: input.kernelProfileName,
      memberId: input.memberId,
      profileKey: input.profileKey,
    };
    return this.profile;
  }

  async finishRun(input: Parameters<ComputerUseStore["finishRun"]>[0]): Promise<ComputerRunRecord> {
    const cleanupSucceeded = input.error === null;
    this.run = {
      ...this.run,
      completedAt: input.now,
      kernelCdpWsUrlEncrypted: cleanupSucceeded ? null : this.run.kernelCdpWsUrlEncrypted,
      kernelLiveViewUrlEncrypted: cleanupSucceeded ? null : this.run.kernelLiveViewUrlEncrypted,
      kernelSessionId: cleanupSucceeded ? null : this.run.kernelSessionId,
      status: input.outcome,
      updatedAt: input.now,
    };
    return this.run;
  }
}

function unsupported(method: string): never {
  throw new Error(`Unexpected fake store call: ${method}`);
}

const fakeKernel = createFakeKernel();

function createFakeKernel(input: {
  createBrowserResults?: Array<"fail" | "ok">;
  deleteBrowserResults?: Array<"fail" | "ok">;
  executeResult?: unknown;
} = {}): ComputerKernelClient & {
  deletedSessionIds: string[];
  executePlaywrightCalls: number;
} {
  let browserCount = 1;
  const createBrowserResults = [...(input.createBrowserResults ?? [])];
  const deleteBrowserResults = [...(input.deleteBrowserResults ?? [])];
  return {
    deletedSessionIds: [],
    executePlaywrightCalls: 0,
    async createBrowser() {
      const result = createBrowserResults.shift() ?? "ok";
      if (result === "fail") {
        throw new Error("createBrowser failed");
      }
      browserCount += 1;
      return {
        cdpWsUrl: `wss://kernel.example.test/cdp/${browserCount}`,
        liveViewUrl: `https://kernel.example.test/live/${browserCount}`,
        sessionId: `kernel-session-${browserCount}`,
      };
    },
    async deleteBrowser(sessionId: string) {
      this.deletedSessionIds.push(sessionId);
      const result = deleteBrowserResults.shift() ?? "ok";
      if (result === "fail") {
        throw new Error("deleteBrowser failed");
      }
    },
    async ensureProfile() {},
    async executePlaywright() {
      this.executePlaywrightCalls += 1;
      return {
        result: input.executeResult ?? {
          title: "Page",
          url: "https://example.test",
          visibleText: "Page text",
        },
      };
    },
  };
}

function createProfileRecord(overrides: Partial<ComputerProfileRecord> = {}): ComputerProfileRecord {
  return {
    id: "hcp_profile123",
    kernelProfileName: "murph-test-member-appointments",
    lastAuthenticatedAt: null,
    lastCheckpointAt: null,
    memberId: "member_123",
    profileKey: "appointments",
    ...overrides,
  };
}

function createHandoffRecord(overrides: Partial<ComputerHandoffRecord> = {}): ComputerHandoffRecord {
  return {
    completedAt: null,
    expiresAt: new Date("2026-06-17T12:20:00.000Z"),
    id: "hch_handoff123",
    memberId: "member_123",
    openedAt: null,
    purpose: "login",
    runId: "hcr_run123",
    status: "open",
    suggestedReply: "done",
    tokenHash: "hash",
    ...overrides,
  };
}

function createRunRecord(overrides: Partial<ComputerRunRecord> = {}): ComputerRunRecord {
  return {
    awaitingMessage: null,
    awaitingReason: null,
    completedAt: null,
    expiresAt: new Date("2026-06-17T13:00:00.000Z"),
    goal: "Book a dentist appointment.",
    id: "hcr_run123",
    kernelCdpWsUrlEncrypted: "encrypted-cdp",
    kernelLiveViewUrlEncrypted: "encrypted-live-view",
    kernelSessionId: "kernel-session-1",
    lastTitle: "Scheduler",
    lastUrl: "https://dentist.example.test",
    memberId: "member_123",
    pausedAt: null,
    pendingHandoffId: null,
    profileId: "hcp_profile123",
    resumedAt: null,
    status: "running",
    suggestedReply: null,
    taskKind: "appointment",
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}
