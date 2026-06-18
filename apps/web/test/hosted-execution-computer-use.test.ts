import { describe, expect, it } from "vitest";

import type {
  ComputerUseCrypto,
} from "../src/lib/computer-use/crypto";
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
      awaitingMessage: "Can you log in here?",
      awaitingReason: "login_needed",
      pausedAt: now,
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(store.run.awaitingMessage).not.toContain("/computer/handoff/");
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

  it("rejects pause requests for terminal runs", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: now,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "login",
      memberId: "member_123",
      message: "Can you log in here?",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_NOT_RUNNING",
    });
    expect(store.handoff).toBeNull();
    expect(store.run).toMatchObject({
      status: "completed",
    });
  });

  it("expires a new handoff if pause loses the run transition race", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      completeRunBeforeMarkAwaitingUser: true,
      run: createRunRecord({ updatedAt: now }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "login",
      memberId: "member_123",
      message: "Can you log in here?",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "completed",
    });
  });

  it("blocks active computer operations for suspended members", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const kernel = createFakeKernel();
    const store = new FakeComputerUseStore({
      computerUseAvailable: false,
      run: createRunRecord({ updatedAt: now }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.observe({
      memberId: "member_123",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    await expect(service.act({
      action: "click",
      memberId: "member_123",
      runId: "hcr_run123",
      selector: "button[type=submit]",
      timeoutMs: 1_000,
      url: null,
      value: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    await expect(service.pauseForUser({
      handoffPurpose: "login",
      memberId: "member_123",
      message: "Can you log in here?",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "canceled",
      runId: "hcr_run123",
      summary: "Canceled.",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toBeNull();
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

  it("resumes an awaiting final-confirmation run only when the run is explicit", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run,
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
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
    expect(store.lastResumeAwaitingReason).toBe("final_confirmation");
  });

  it("rejects resume proof when the mailbox item was stored before the pause", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      resumeMailboxItems: [
        createResumeMailboxItem({
          createdAt: new Date("2026-06-17T11:59:59.000Z"),
          id: "hmi_skewed_old_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run,
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_skewed_old_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
  });

  it("requires explicit resume to come from the paused delivery context", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      checkpointContext: {
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
      },
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
        }),
      ],
      run,
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeDeliveryContext: {
        conversationId: "conversation-b",
        recipientKey: "recipient-a",
      },
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_CONTEXT_MISMATCH",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
  });

  it("does not resume an awaiting run without a fresh user reply proof", async () => {
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

    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("resumes after a stale checkpointing handoff when the run is explicit", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const run = createRunRecord({
      awaitingReason: "login_needed",
      pausedAt: new Date("2026-06-17T12:01:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run,
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    });

    expect(result).toMatchObject({
      awaitingReason: null,
      reused: true,
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      resumedAt: now,
      status: "running",
    });
  });

  it("does not resume an explicit run while a handoff is still open", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "open",
      updatedAt: now,
    });
    const run = createRunRecord({
      awaitingReason: "login_needed",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      suggestedReply: "done",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ handoff, run });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    });

    expect(result).toMatchObject({
      awaitingReason: "login_needed",
      reused: true,
      runId: "hcr_run123",
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("expires an awaiting run instead of resuming after its open handoff expires", async () => {
    const now = new Date("2026-06-17T12:25:00.000Z");
    const handoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      purpose: "login",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const run = createRunRecord({
      awaitingReason: "login_needed",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      suggestedReply: "done",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ handoff, run });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
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

  it("expires stale login handoffs with no browser session instead of returning a dead handle", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const run = createRunRecord({
      awaitingReason: "login_needed",
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      pausedAt: new Date("2026-06-17T12:01:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ handoff, run });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("does not expire a fresh checkpointing login handoff with a temporarily cleared browser", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: now,
    });
    const run = createRunRecord({
      awaitingReason: "login_needed",
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      pausedAt: new Date("2026-06-17T12:01:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run,
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    });

    expect(result).toMatchObject({
      awaitingReason: "login_needed",
      reused: true,
      runId: "hcr_run123",
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
    });
  });

  it("does not revive an awaiting run whose pending handoff is already expired", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "expired",
      updatedAt: new Date("2026-06-17T12:01:00.000Z"),
    });
    const run = createRunRecord({
      awaitingReason: "login_needed",
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      pausedAt: new Date("2026-06-17T12:01:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run,
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("does not resume an awaiting run without an explicit resume run id", async () => {
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
      resumeRunId: null,
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
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("does not reuse an awaiting run from another computer profile", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      profile: createProfileRecord({
        id: "hcp_appointments",
        profileKey: "appointments",
      }),
      run: createRunRecord({
        awaitingReason: "final_confirmation",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        profileId: "hcp_commerce",
        status: "awaiting_user",
        taskKind: "purchase",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: null,
      }),
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    const result = await service.startRun({
      goal: "Book a dentist appointment.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: null,
      startUrl: "https://dentist.example.test",
      taskKind: "appointment",
    });

    expect(result).toMatchObject({
      awaitingReason: null,
      reused: false,
      status: "running",
    });
    expect(result.runId).not.toBe("hcr_run123");
    expect(store.run).toMatchObject({
      goal: "Book a dentist appointment.",
      kernelSessionId: "kernel-session-2",
      profileId: "hcp_appointments",
      status: "running",
      taskKind: "appointment",
    });
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
  });

  it("fails closed before browser creation when live-view origins are not configured", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Book a dentist appointment.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: null,
      startUrl: "https://dentist.example.test",
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGINS_MISSING",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([]);
  });

  it("deletes a newly created browser when its live-view origin is not allowed", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://allowed.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Book a dentist appointment.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: null,
      startUrl: "https://dentist.example.test",
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
    });
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-2"]);
  });

  it("fails closed when a suspended member race happens after browser creation", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      computerUseChecksBeforeUnavailable: 1,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Book a dentist appointment.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: null,
      startUrl: "https://dentist.example.test",
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      status: "completed",
    });
  });

  it("keeps a concurrent-start loser browser retryable when immediate cleanup fails", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failCreateRunWithConcurrentRun: true,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        status: "completed",
      }),
    });
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail"],
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      goal: "Book a dentist appointment.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeRunId: null,
      startUrl: "https://dentist.example.test",
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      id: "hcr_concurrent",
      kernelSessionId: "kernel-session-concurrent",
      status: "running",
    });
    expect(store.cleanupRun).toMatchObject({
      expiresAt: new Date(0),
      kernelSessionId: "kernel-session-2",
      status: "running",
    });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 1,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-2", "kernel-session-2"]);
    expect(store.cleanupRun).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
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

  it("does not expose a handoff live view when the stored origin is not allowed", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: "https://kernel.example.test/live/1",
      }),
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://allowed.example.test",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
    });
    expect(store.handoff).toMatchObject({
      openedAt: null,
      status: "open",
    });
  });

  it("blocks suspended members from opening a handoff page", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      computerUseAvailable: false,
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: "https://kernel.example.test/live/1",
      }),
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(store.handoff).toMatchObject({
      openedAt: null,
      status: "open",
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

  it("does not expire a fresh checkpointing handoff page after its TTL", async () => {
    const now = new Date("2026-06-17T12:21:00.000Z");
    const handoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      purpose: "login",
      status: "checkpointing",
      suggestedReply: "done",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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
      kind: "completed",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
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

  it("keeps a run active when finish cleanup fails so a retry can delete the browser", async () => {
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

    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: "hcr_run123",
      summary: "Done.",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(store.run).toMatchObject({
      kernelLiveViewUrlEncrypted: "encrypted-live-view",
      kernelSessionId: "kernel-session-1",
      status: "running",
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: "hcr_run123",
      summary: "Done.",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1", "kernel-session-1"]);
    expect(store.run).toMatchObject({
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
    const kernel = createFakeKernel();
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
      kernelSessionId: null,
      pendingHandoffId: handoff.id,
      status: "failed",
    });
  });

  it("does not expire a handoff freshly claimed after finish reads it", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      checkpointHandoffBeforeMarkExpired: true,
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
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

    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "failed",
      runId: "hcr_run123",
      summary: "Canceled.",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("keeps finish retryable while a login handoff is checkpointing", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
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

    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "failed",
      runId: "hcr_run123",
      summary: "Canceled.",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
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
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
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

  it("retries a stale checkpointing login handoff instead of leaving it stuck", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({ suggestedReply: "done" });

    expect(store.handoff).toMatchObject({
      completedAt: now,
      status: "completed",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
  });

  it("does not expire a fresh checkpointing handoff completion after its TTL", async () => {
    const now = new Date("2026-06-17T12:21:00.000Z");
    const handoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      purpose: "login",
      status: "checkpointing",
      suggestedReply: "done",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
    });
  });

  it("deletes a replacement browser when login handoff checkpointing rejects its live-view origin", async () => {
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
      executeResult: {
        title: "Signed in",
        url: "https://shop.example.test/account",
        visibleText: "Account",
      },
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://allowed.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      "kernel-session-2",
    ]);
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
    });
  });

  it("deletes a replacement browser when login checkpoint replace loses the run race", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      profile: createProfileRecord(),
      rejectReplaceRunBrowser: true,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Signed in",
        url: "https://shop.example.test/account",
        visibleText: "Account",
      },
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toThrow("Stale run state.");
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      "kernel-session-2",
    ]);
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
    });
  });

  it("deletes a replacement browser when the login handoff expires before replace", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      expireHandoffBeforeReplaceRunBrowser: true,
      handoff,
      profile: createProfileRecord(),
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Signed in",
        url: "https://shop.example.test/account",
        visibleText: "Account",
      },
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      "kernel-session-2",
    ]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
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

  it("leaves expired runs retryable when retention browser cleanup fails", async () => {
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
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail"],
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 0,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("does not delete an expired run browser while its handoff is checkpointing", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: now,
        }),
      ],
      run: createRunRecord({
        awaitingReason: "login_needed",
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
      expiredRuns: 0,
    });
    await expect(service.startRun({
      goal: "Resume appointment booking.",
      memberId: "member_123",
      profileKey: "appointments",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeRunId: "hcr_run123",
      startUrl: null,
      taskKind: "appointment",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("does not expire a run that completed before stale cleanup marks it expired", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const store = new FakeComputerUseStore({
      completeRunBeforeMarkExpired: true,
      run: createRunRecord({
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        status: "running",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 0,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "completed",
    });
  });

  it("deletes member Kernel sessions and profiles during account deletion cleanup", async () => {
    const store = new FakeComputerUseStore({
      profile: createProfileRecord({
        kernelProfileName: "kernel-profile-appointments",
      }),
      run: createRunRecord({
        kernelSessionId: "kernel-session-1",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 1,
      profilesDeleted: 1,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-appointments"]);
  });
});

interface ResumeMailboxItem {
  createdAt: Date;
  id: string;
  kind: "conversation.message";
  lane: "conversation";
  memberId: string;
  occurredAt: Date;
}

class FakeComputerUseStore implements ComputerUseStore {
  computerUseAvailable = true;
  computerUseChecksBeforeUnavailable: number | null = null;
  checkpointHandoffBeforeMarkExpired = false;
  completeRunBeforeMarkAwaitingUser = false;
  completeRunBeforeMarkExpired = false;
  cleanupRun: ComputerRunRecord | null = null;
  expireHandoffBeforeReplaceRunBrowser = false;
  failCreateRunWithConcurrentRun = false;
  handoff: ComputerHandoffRecord | null = null;
  lastResumeAwaitingReason: Parameters<ComputerUseStore["markRunRunning"]>[0]["awaitingReason"] | null = null;
  profile: ComputerProfileRecord;
  rejectReplaceRunBrowser = false;
  resumeMailboxItems: ResumeMailboxItem[] = [];
  run: ComputerRunRecord;

  constructor(input: {
    computerUseAvailable?: boolean;
    computerUseChecksBeforeUnavailable?: number | null;
    checkpointHandoffBeforeMarkExpired?: boolean;
    completeRunBeforeMarkAwaitingUser?: boolean;
    completeRunBeforeMarkExpired?: boolean;
    expireHandoffBeforeReplaceRunBrowser?: boolean;
    failCreateRunWithConcurrentRun?: boolean;
    handoff?: ComputerHandoffRecord | null;
    profile?: ComputerProfileRecord;
    rejectReplaceRunBrowser?: boolean;
    resumeMailboxItems?: ResumeMailboxItem[];
    run: ComputerRunRecord;
  }) {
    this.computerUseAvailable = input.computerUseAvailable ?? true;
    this.computerUseChecksBeforeUnavailable = input.computerUseChecksBeforeUnavailable ?? null;
    this.checkpointHandoffBeforeMarkExpired = input.checkpointHandoffBeforeMarkExpired ?? false;
    this.completeRunBeforeMarkAwaitingUser = input.completeRunBeforeMarkAwaitingUser ?? false;
    this.completeRunBeforeMarkExpired = input.completeRunBeforeMarkExpired ?? false;
    this.expireHandoffBeforeReplaceRunBrowser = input.expireHandoffBeforeReplaceRunBrowser ?? false;
    this.failCreateRunWithConcurrentRun = input.failCreateRunWithConcurrentRun ?? false;
    this.handoff = input.handoff ?? null;
    this.profile = input.profile ?? createProfileRecord();
    this.rejectReplaceRunBrowser = input.rejectReplaceRunBrowser ?? false;
    this.resumeMailboxItems = input.resumeMailboxItems ?? [];
    this.run = input.run;
  }

  async requireMemberComputerUseAvailable(input: {
    memberId: string;
  }): Promise<void> {
    if (this.computerUseChecksBeforeUnavailable !== null) {
      if (this.computerUseChecksBeforeUnavailable <= 0) {
        this.computerUseAvailable = false;
      } else {
        this.computerUseChecksBeforeUnavailable -= 1;
      }
    }
    if (!this.computerUseAvailable) {
      throw Object.assign(new Error("Computer use is not available for this hosted member."), {
        code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
      });
    }
    if (input.memberId !== this.run.memberId && input.memberId !== this.profile.memberId) {
      throw new Error("Member not found.");
    }
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

  async listStaleActiveRuns(input: Parameters<ComputerUseStore["listStaleActiveRuns"]>[0]): Promise<ComputerRunRecord[]> {
    const runs = this.run.expiresAt <= input.now
      && (this.run.status === "running" || this.run.status === "awaiting_user")
      ? [this.run]
      : [];
    if (
      this.cleanupRun &&
      this.cleanupRun.expiresAt <= input.now &&
      (this.cleanupRun.status === "running" || this.cleanupRun.status === "awaiting_user")
    ) {
      runs.push(this.cleanupRun);
    }
    return runs;
  }

  async listMemberRuns(input: Parameters<ComputerUseStore["listMemberRuns"]>[0]): Promise<ComputerRunRecord[]> {
    if (input.memberId !== this.run.memberId) {
      return [];
    }
    return this.cleanupRun ? [this.run, this.cleanupRun] : [this.run];
  }

  async listMemberProfiles(input: Parameters<ComputerUseStore["listMemberProfiles"]>[0]): Promise<ComputerProfileRecord[]> {
    return input.memberId === this.profile.memberId ? [this.profile] : [];
  }

  async hasConversationMailboxItemAfter(
    input: Parameters<ComputerUseStore["hasConversationMailboxItemAfter"]>[0],
  ): Promise<boolean> {
    return this.resumeMailboxItems.some((item) =>
      item.id === input.mailboxItemId
      && item.memberId === input.memberId
      && item.lane === "conversation"
      && item.kind === "conversation.message"
      && item.createdAt > input.after
    );
  }

  async listStaleActiveRunsForProfile(input: Parameters<ComputerUseStore["listStaleActiveRunsForProfile"]>[0]): Promise<ComputerRunRecord[]> {
    const runs = input.memberId === this.run.memberId
      && input.profileId === this.run.profileId
      && this.run.expiresAt <= input.now
      && (this.run.status === "running" || this.run.status === "awaiting_user")
      ? [this.run]
      : [];
    if (
      this.cleanupRun &&
      input.memberId === this.cleanupRun.memberId &&
      input.profileId === this.cleanupRun.profileId &&
      this.cleanupRun.expiresAt <= input.now &&
      (this.cleanupRun.status === "running" || this.cleanupRun.status === "awaiting_user")
    ) {
      runs.push(this.cleanupRun);
    }
    return runs;
  }

  async findActiveRunForProfile(input: Parameters<ComputerUseStore["findActiveRunForProfile"]>[0]): Promise<ComputerRunRecord | null> {
    return input.memberId === this.run.memberId
      && input.profileId === this.run.profileId
      && this.run.expiresAt > input.now
      && (this.run.status === "running" || this.run.status === "awaiting_user")
      ? this.run
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
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    };
    return this.handoff;
  }

  async createRun(input: Parameters<ComputerUseStore["createRun"]>[0]): ReturnType<ComputerUseStore["createRun"]> {
    if (this.failCreateRunWithConcurrentRun) {
      this.cleanupRun = createRunRecord({
        expiresAt: new Date(0),
        goal: input.goal,
        id: input.id,
        kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
        kernelSessionId: input.kernelSessionId,
        lastTitle: null,
        lastUrl: input.startUrl,
        memberId: input.memberId,
        profileId: input.profileId,
        status: "running",
        taskKind: input.taskKind,
        updatedAt: input.now,
      });
      this.run = createRunRecord({
        expiresAt: input.expiresAt,
        goal: "Concurrent run.",
        id: "hcr_concurrent",
        kernelLiveViewUrlEncrypted: "encrypted-concurrent-live-view",
        kernelSessionId: "kernel-session-concurrent",
        lastTitle: null,
        lastUrl: input.startUrl,
        memberId: input.memberId,
        profileId: input.profileId,
        status: "running",
        taskKind: input.taskKind,
        updatedAt: new Date("2026-06-17T12:05:00.000Z"),
      });
      return {
        cleanupRun: this.cleanupRun,
        created: false,
        run: this.run,
      };
    }
    this.run = createRunRecord({
      expiresAt: input.expiresAt,
      goal: input.goal,
      id: input.id,
      kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
      kernelSessionId: input.kernelSessionId,
      lastTitle: null,
      lastUrl: input.startUrl,
      memberId: input.memberId,
      profileId: input.profileId,
      status: "running",
      taskKind: input.taskKind,
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    });
    return {
      cleanupRun: null,
      created: true,
      run: this.run,
    };
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
    if (this.checkpointHandoffBeforeMarkExpired) {
      this.checkpointHandoffBeforeMarkExpired = false;
      this.handoff = {
        ...this.handoff,
        status: "checkpointing",
        updatedAt: input.now,
      };
    }
    if (
      (input.expectedStatus && this.handoff.status !== input.expectedStatus) ||
      (input.expectedUpdatedAt &&
        this.handoff.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    ) {
      throw staleRunStateError();
    }
    if (this.handoff.status !== "open" && this.handoff.status !== "checkpointing") {
      return this.handoff;
    }
    this.handoff = {
      ...this.handoff,
      status: "expired",
      updatedAt: input.now,
    };
    return this.handoff;
  }

  async completeHandoff(input: Parameters<ComputerUseStore["completeHandoff"]>[0]): Promise<ComputerHandoffRecord> {
    if (!this.handoff || this.handoff.id !== input.handoffId || this.handoff.status !== "checkpointing") {
      throw staleRunStateError();
    }
    this.handoff = {
      ...this.handoff,
      completedAt: input.now,
      status: "completed",
      updatedAt: input.now,
    };
    return this.handoff;
  }

  async claimHandoffForCompletion(input: Parameters<ComputerUseStore["claimHandoffForCompletion"]>[0]): Promise<ComputerHandoffRecord | null> {
    if (!this.handoff || this.handoff.id !== input.handoffId || this.handoff.status !== "open") {
      return null;
    }
    this.handoff = {
      ...this.handoff,
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    };
    return this.handoff;
  }

  async releaseHandoffClaim(input: Parameters<ComputerUseStore["releaseHandoffClaim"]>[0]): Promise<void> {
    if (this.handoff && this.handoff.id === input.handoffId && this.handoff.status === "checkpointing") {
      this.handoff = {
        ...this.handoff,
        status: "open",
        updatedAt: new Date("2026-06-17T12:05:00.000Z"),
      };
    }
  }

  async markRunAwaitingUser(
    input: Parameters<ComputerUseStore["markRunAwaitingUser"]>[0],
  ): Promise<ComputerRunRecord> {
    if (this.completeRunBeforeMarkAwaitingUser) {
      this.run = {
        ...this.run,
        completedAt: input.now,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
        updatedAt: input.now,
      };
    }
    if (this.run.id !== input.runId || this.run.status !== "running") {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      awaitingMessage: input.awaitingMessage,
      awaitingReason: input.awaitingReason,
      checkpointContext: input.checkpointContext,
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
    if (
      this.run.id !== input.runId
      || this.run.status !== "awaiting_user"
      || !this.run.kernelSessionId
    ) {
      throw staleRunStateError();
    }
    this.lastResumeAwaitingReason = input.awaitingReason;
    this.run = {
      ...this.run,
      awaitingMessage: null,
      awaitingReason: null,
      checkpointContext: null,
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
    if (
      this.run.id !== input.runId
      || this.run.kernelSessionId !== input.expectedKernelSessionId
      || this.run.pendingHandoffId !== input.expectedPendingHandoffId
      || this.run.status !== "awaiting_user"
      || !this.isExpectedHandoffCheckpointing(input.expectedPendingHandoffId)
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      updatedAt: input.now,
    };
    return this.run;
  }

  async replaceRunBrowser(input: Parameters<ComputerUseStore["replaceRunBrowser"]>[0]): Promise<ComputerRunRecord> {
    if (this.expireHandoffBeforeReplaceRunBrowser && this.handoff?.id === input.expectedPendingHandoffId) {
      this.handoff = {
        ...this.handoff,
        status: "expired",
        updatedAt: input.now,
      };
    }
    if (
      this.rejectReplaceRunBrowser
      || this.run.id !== input.runId
      || this.run.kernelSessionId !== null
      || this.run.pendingHandoffId !== input.expectedPendingHandoffId
      || this.run.status !== "awaiting_user"
      || !this.isExpectedHandoffCheckpointing(input.expectedPendingHandoffId)
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
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
      && (this.handoff.status === "open" || this.handoff.status === "checkpointing")
      ? this.handoff
      : null;
  }

  async findHandoffByRun(input: Parameters<ComputerUseStore["findHandoffByRun"]>[0]): Promise<ComputerHandoffRecord | null> {
    return this.handoff
      && this.handoff.id === input.handoffId
      && this.handoff.runId === input.runId
      ? this.handoff
      : null;
  }

  async markHandoffOpened(input: Parameters<ComputerUseStore["markHandoffOpened"]>[0]): Promise<void> {
    if (this.handoff && this.handoff.id === input.handoffId && !this.handoff.openedAt) {
      this.handoff = {
        ...this.handoff,
        openedAt: input.now,
        updatedAt: input.now,
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
    if (this.cleanupRun?.id === input.runId) {
      if (
        this.cleanupRun.kernelSessionId === input.expectedKernelSessionId &&
        (this.cleanupRun.status === "running" || this.cleanupRun.status === "awaiting_user")
      ) {
        this.cleanupRun = {
          ...this.cleanupRun,
          completedAt: input.now,
          kernelLiveViewUrlEncrypted: null,
          kernelSessionId: null,
          status: "expired",
          updatedAt: input.now,
        };
      }
      return this.cleanupRun;
    }
    if (this.completeRunBeforeMarkExpired) {
      this.run = {
        ...this.run,
        completedAt: input.now,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
        updatedAt: input.now,
      };
    }
    if (
      this.run.id !== input.runId
      || this.run.kernelSessionId !== input.expectedKernelSessionId
      || (this.run.status !== "running" && this.run.status !== "awaiting_user")
    ) {
      return this.run;
    }
    this.run = {
      ...this.run,
      completedAt: input.now,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
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
    if (
      this.run.id !== input.runId
      || this.run.kernelSessionId !== input.expectedKernelSessionId
      || (this.run.status !== "running" && this.run.status !== "awaiting_user")
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      completedAt: input.now,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      status: input.outcome,
      updatedAt: input.now,
    };
    return this.run;
  }

  private isExpectedHandoffCheckpointing(handoffId: string | null): boolean {
    return !handoffId
      || Boolean(this.handoff && this.handoff.id === handoffId && this.handoff.status === "checkpointing");
  }
}

const fakeKernel = createFakeKernel();

function createFakeKernel(input: {
  createBrowserResults?: Array<"fail" | "ok">;
  deleteBrowserResults?: Array<"fail" | "ok">;
  executeResult?: unknown;
} = {}): ComputerKernelClient & {
  createdSessionIds: string[];
  deletedProfileNames: string[];
  deletedSessionIds: string[];
  executePlaywrightCalls: number;
} {
  let browserCount = 1;
  const createBrowserResults = [...(input.createBrowserResults ?? [])];
  const deleteBrowserResults = [...(input.deleteBrowserResults ?? [])];
  return {
    createdSessionIds: [],
    deletedProfileNames: [],
    deletedSessionIds: [],
    executePlaywrightCalls: 0,
    async createBrowser() {
      const result = createBrowserResults.shift() ?? "ok";
      if (result === "fail") {
        throw new Error("createBrowser failed");
      }
      browserCount += 1;
      this.createdSessionIds.push(`kernel-session-${browserCount}`);
      return {
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
    async deleteProfile(name: string) {
      this.deletedProfileNames.push(name);
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

function createFakeCrypto(input: {
  decryptedRunSecret: string | null;
}): ComputerUseCrypto {
  return {
    async decryptRunSecret() {
      return input.decryptedRunSecret;
    },
    async encryptRunSecret(encryptInput) {
      return encryptInput.value ?? null;
    },
  };
}

function staleRunStateError(): Error {
  return Object.assign(new Error("Stale run state."), {
    code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
  });
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
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

function createResumeMailboxItem(overrides: Partial<ResumeMailboxItem> = {}): ResumeMailboxItem {
  return {
    createdAt: new Date("2026-06-17T12:04:00.000Z"),
    id: "hmi_user_reply",
    kind: "conversation.message",
    lane: "conversation",
    memberId: "member_123",
    occurredAt: new Date("2026-06-17T12:04:00.000Z"),
    ...overrides,
  };
}

function createRunRecord(overrides: Partial<ComputerRunRecord> = {}): ComputerRunRecord {
  return {
    awaitingMessage: null,
    awaitingReason: null,
    checkpointContext: null,
    completedAt: null,
    expiresAt: new Date("2026-06-17T13:00:00.000Z"),
    goal: "Book a dentist appointment.",
    id: "hcr_run123",
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
