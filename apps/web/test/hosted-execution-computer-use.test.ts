import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import type {
  ComputerUseCrypto,
} from "../src/lib/computer-use/crypto";
import type {
  ComputerKernelClient,
} from "../src/lib/computer-use/kernel-client";
import { computerUseError } from "../src/lib/computer-use/errors";
import { ComputerUseService } from "../src/lib/computer-use/service";
import type {
  ComputerHandoffRecord,
  ComputerRunRecord,
  ComputerUseStore,
} from "../src/lib/computer-use/store";
import { PrismaComputerUseStore } from "../src/lib/computer-use/store";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.stubEnv("HOSTED_COMPUTER_PROFILE_NAMESPACE", "test");

describe("ComputerUseService", () => {
  it("stores a durable awaiting-user pause and returns the hosted handoff URL", async () => {
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
    expect(store.run).toMatchObject({
      awaitingMessage: null,
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

  it("stores final confirmation as a manual handoff pause", async () => {
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
      handoffPurpose: "manual_browser_help",
      memberId: "member_123",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      runId: "hcr_run123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(store.run).toMatchObject({
      awaitingMessage: null,
      awaitingReason: "final_confirmation",
      pausedAt: now,
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "done",
    });
  });

  it("refreshes an existing open handoff when a paused run is asked again", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const oldHandoff = createHandoffRecord({
      id: "hch_handoff123",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Old login request.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
      }),
    });
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
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(store.run).toMatchObject({
      awaitingMessage: "Old login request.",
      awaitingReason: "login_needed",
      pausedAt: now,
      pendingHandoffId: "hch_handoff124",
      status: "awaiting_user",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff123")).toMatchObject({
      status: "expired",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124")).toMatchObject({
      purpose: "login",
      status: "open",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      id: "hch_handoff124",
      status: "open",
    });
  });

  it("mints a replacement handoff for an expired link while the run is still alive", async () => {
    const now = new Date("2026-06-17T12:25:00.000Z");
    const oldHandoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      id: "hch_handoff123",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Old login request.",
        awaitingReason: "login_needed",
        expiresAt: new Date("2026-06-17T12:35:00.000Z"),
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
      }),
    });
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
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff123")).toMatchObject({
      status: "expired",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124")).toMatchObject({
      expiresAt: new Date("2026-06-17T12:35:00.000Z"),
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      pendingHandoffId: "hch_handoff124",
      status: "awaiting_user",
    });
  });

  it("preserves final-confirmation semantics when refreshing an awaiting handoff", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const oldHandoff = createHandoffRecord({
      id: "hch_handoff123",
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Should I book this appointment?",
        awaitingReason: "final_confirmation",
        checkpointContext: {
          conversationId: "conversation-a",
          recipientKey: "recipient-a",
        },
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
        suggestedReply: "yes",
      }),
    });
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
      pauseDeliveryContext: {
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
      },
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      suggestedReply: "yes",
    });
    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(store.run).toMatchObject({
      awaitingMessage: "Should I book this appointment?",
      awaitingReason: "final_confirmation",
      checkpointContext: {
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
      },
      pendingHandoffId: "hch_handoff124",
      suggestedReply: "yes",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124")).toMatchObject({
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
    });
  });

  it("keeps the manual handoff purpose when screen inspection is requested for the same paused run", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const oldHandoff = createHandoffRecord({
      id: "hch_handoff123",
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Should I book this appointment?",
        awaitingReason: "final_confirmation",
        checkpointContext: {
          conversationId: "conversation-a",
          recipientKey: "recipient-a",
        },
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
        suggestedReply: "yes",
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    // The open manual handoff page already holds a live, decrypted browser
    // iframe that we cannot revoke. A refreshed handoff for the same paused
    // run must preserve the existing manual_browser_help purpose so a later
    // "view-only" request cannot misrepresent an interactive session as
    // screenshot-only.
    const result = await service.pauseForUser({
      handoffPurpose: "screen_inspection",
      memberId: "member_123",
      pauseDeliveryContext: {
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
      },
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: null,
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      suggestedReply: "yes",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff123")).toMatchObject({
      status: "expired",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124")).toMatchObject({
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: "hch_handoff124",
      status: "awaiting_user",
    });
  });

  it("mints a replacement handoff after a final-confirmation handoff was completed too early", async () => {
    const now = new Date("2026-06-17T12:07:00.000Z");
    const oldHandoff = createHandoffRecord({
      completedAt: new Date("2026-06-17T12:05:00.000Z"),
      id: "hch_handoff123",
      purpose: "manual_browser_help",
      status: "completed",
      suggestedReply: "yes",
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Should I submit this booking?",
        awaitingReason: "final_confirmation",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
        suggestedReply: "yes",
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    const result = await service.pauseForUser({
      handoffPurpose: "manual_browser_help",
      memberId: "member_123",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: "yes",
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      suggestedReply: "yes",
    });
    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff123")).toMatchObject({
      status: "completed",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124")).toMatchObject({
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: "hch_handoff124",
      status: "awaiting_user",
    });
  });

  it("rejects refreshed handoffs for a different checkpoint context", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const oldHandoff = createHandoffRecord({
      id: "hch_handoff123",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Old login request.",
        awaitingReason: "login_needed",
        checkpointContext: {
          conversationId: "conversation-a",
          recipientKey: "recipient-a",
        },
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "login",
      memberId: "member_123",
      pauseDeliveryContext: {
        conversationId: "conversation-b",
        recipientKey: "recipient-a",
      },
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_CONTEXT_MISMATCH",
    });

    expect(store.handoffs).toHaveLength(1);
    expect(store.run).toMatchObject({
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
    });
  });

  it("allows final confirmation pauses without forcing a manual handoff", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({ updatedAt: now });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: null,
      memberId: "member_123",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: "yes",
    })).resolves.toMatchObject({
      awaitingReason: "final_confirmation",
      handoffUrl: null,
      status: "awaiting_user",
    });
  });

  it("rejects screen inspection for a running run", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({ updatedAt: now });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      kernel: fakeKernel,
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "screen_inspection",
      memberId: "member_123",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: "yes",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_SCREEN_INSPECTION_UNAVAILABLE",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      status: "running",
    });
    expect(store.handoff).toBeNull();
  });

  it("mints an inspection handoff for an already-awaiting final confirmation", async () => {
    const pausedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt,
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: pausedAt,
    });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    const result = await service.pauseForUser({
      handoffPurpose: "screen_inspection",
      memberId: "member_123",
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: null,
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      handoffUrl: expect.stringMatching(
        /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
      ),
      status: "awaiting_user",
      suggestedReply: "yes",
    });
    expect(store.run).toMatchObject({
      pausedAt: now,
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      purpose: "screen_inspection",
      status: "open",
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
      code: "await page.getByRole('button', { name: 'Add to cart' }).click();",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    await expect(service.pauseForUser({
      handoffPurpose: "login",
      memberId: "member_123",
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
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    await expect(service.ensureHandoffViewport({
      memberId: "member_123",
      preset: "desktop",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.ensureBrowserViewportInputs).toEqual([]);
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toBeNull();
  });

  it("passes arbitrary start URLs to Kernel navigation", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const startKernel = createFakeKernel();
    const startService = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel: startKernel,
      now: () => now,
      store: new FakeComputerUseStore({
        run: createRunRecord({
          kernelLiveViewUrlEncrypted: null,
          kernelSessionId: null,
          status: "completed",
        }),
      }),
    });
    await expect(startService.startRun({
      memberId: "member_123",
      startUrl: "data:text/html,<h1>owned</h1>",
    })).resolves.toMatchObject({
      reused: false,
      status: "running",
    });
    expect(startKernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(startKernel.executePlaywrightInputs[0]?.code ?? "").toContain(
      "data:text/html,<h1>owned</h1>",
    );
  });

  it("does not restore terminal URL or title from a stale observe result", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      completeRunBeforeUpdateBrowserState: true,
      run: createRunRecord({
        lastTitle: "Old title",
        lastUrl: "https://old.example.test",
        updatedAt: now,
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel({
        executeResult: {
          title: "Checkout",
          url: "https://shop.example.test/checkout?session=secret#step",
          visibleText: "Ready",
        },
      }),
      now: () => now,
      store,
    });

    await expect(service.observe({
      memberId: "member_123",
      runId: "hcr_run123",
    })).resolves.toMatchObject({
      title: "Checkout",
      url: "https://shop.example.test/checkout?session=secret#step",
    });
    expect(store.run).toMatchObject({
      lastTitle: null,
      lastUrl: null,
      status: "completed",
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

  it("resumes an awaiting final-confirmation run after fresh user reply proof", async () => {
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

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      awaitingReason: null,
      status: "running",
    });
    expect(store.lastResumeAwaitingReason).toBe("final_confirmation");
  });

  it("resumes the active awaiting run without deleting an unrelated stale sibling", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const appointmentsRun = createRunRecord({
      awaitingReason: "login_needed",
      id: "hcr_appointments",
      kernelProfileName: "kernel-profile-appointments",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "done",
      updatedAt: now,
    });
    const commerceSibling = createRunRecord({
      completedAt: new Date("2026-06-17T11:30:00.000Z"),
      id: "hcr_commerce_failed",
      kernelLiveViewUrlEncrypted: null,
      kernelProfileName: "kernel-profile-commerce",
      kernelSessionId: "kernel-session-commerce",
      status: "failed",
      updatedAt: new Date("2026-06-17T11:30:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      memberRuns: [appointmentsRun, commerceSibling],
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run: appointmentsRun,
    });
    const kernel = createFakeKernel({ deleteBrowserResults: ["fail"] });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_appointments",
      status: "running",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      id: "hcr_appointments",
      status: "running",
    });
  });

  it("rejects resume proof when the mailbox item was stored before the pause", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "login_needed",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "done",
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_skewed_old_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
  });

  it("requires server-owned resume proof to come from the paused delivery context", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "login_needed",
      checkpointContext: {
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
      },
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "done",
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      resumeDeliveryContext: {
        conversationId: "conversation-b",
        recipientKey: "recipient-a",
      },
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_CONTEXT_MISMATCH",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
  });

  it("returns an awaiting run when hidden user reply proof is missing", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "login_needed",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "awaiting_user",
      suggestedReply: "done",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ run });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: null,
    })).resolves.toMatchObject({
      awaitingReason: "login_needed",
      reused: true,
      runId: "hcr_run123",
      status: "awaiting_user",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("expires a stale checkpointing handoff without deleting a live browser run", async () => {
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

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("does not resume the active awaiting run while a handoff is still open", async () => {
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
      memberId: "member_123",
      startUrl: null,
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

  it("does not treat manual browser help as optional for login handoffs", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "manual_browser_help",
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
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

  it("resumes final confirmation from chat while an inspection handoff is open", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "screen_inspection",
      status: "open",
      suggestedReply: "yes",
      updatedAt: new Date("2026-06-17T12:03:00.000Z"),
    });
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:02:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      suggestedReply: "yes",
      updatedAt: new Date("2026-06-17T12:02:00.000Z"),
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    });

    expect(result).toMatchObject({
      awaitingReason: null,
      reused: true,
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      status: "running",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.lastResumeAwaitingReason).toBe("final_confirmation");
  });

  it.each([
    ["logically expired open", "open"],
    ["already marked expired", "expired"],
  ] as const)(
    "resumes final confirmation from chat while an inspection handoff is %s",
    async (_label, handoffStatus) => {
      const now = new Date("2026-06-17T12:25:00.000Z");
      const handoff = createHandoffRecord({
        expiresAt: new Date("2026-06-17T12:20:00.000Z"),
        purpose: "screen_inspection",
        status: handoffStatus,
        suggestedReply: "yes",
        updatedAt: new Date("2026-06-17T12:03:00.000Z"),
      });
      const run = createRunRecord({
        awaitingReason: "final_confirmation",
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        pausedAt: new Date("2026-06-17T12:02:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        suggestedReply: "yes",
        updatedAt: new Date("2026-06-17T12:02:00.000Z"),
      });
      const store = new FakeComputerUseStore({
        handoff,
        resumeMailboxItems: [
          createResumeMailboxItem({
            createdAt: new Date("2026-06-17T12:24:00.000Z"),
            id: "hmi_user_reply",
            occurredAt: new Date("2026-06-17T12:24:00.000Z"),
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
        memberId: "member_123",
        resumeAfterMailboxItemId: "hmi_user_reply",
        startUrl: null,
      });

      expect(result).toMatchObject({
        awaitingReason: null,
        reused: true,
        runId: "hcr_run123",
        status: "running",
      });
      expect(store.run).toMatchObject({
        pendingHandoffId: null,
        status: "running",
      });
      expect(store.handoff).toMatchObject({
        status: "expired",
      });
      expect(store.lastResumeAwaitingReason).toBe("final_confirmation");
    },
  );

  it("expires an open handoff without deleting the awaiting browser run", async () => {
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_EXPIRED",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_EXPIRED",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("does not delete a replacement browser that wins the browserless cleanup race", async () => {
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
    const store = new FakeComputerUseStore({
      handoff,
      replaceBrowserBeforeMarkRunCleanupPending: true,
      run,
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "awaiting_user",
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_EXPIRED",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("does not clear a newer open handoff installed while resume validates an older completion", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const completedHandoff = createHandoffRecord({
      completedAt: new Date("2026-06-17T12:04:00.000Z"),
      purpose: "login",
      status: "completed",
      updatedAt: new Date("2026-06-17T12:04:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: completedHandoff,
      replacePendingHandoffBeforeMarkRunRunning: true,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:30.000Z"),
        }),
      ],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: completedHandoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });

    expect(store.handoffs.find((handoff) => handoff.id === completedHandoff.id)).toMatchObject({
      status: "completed",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124")).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      pendingHandoffId: "hch_handoff124",
      status: "awaiting_user",
    });
  });

  it("reuses an awaiting member run when no hidden resume proof exists", async () => {
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
      memberId: "member_123",
      startUrl: null,
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

  it("does not return a browser handle while an active run is still provisioning", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "running",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_PROVISIONING",
    });
    expect(kernel.createdSessionIds).toEqual([]);
  });

  it("recovers a stale browserless provisioning reservation before starting a new browser", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        id: "hcr_stale",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "running",
        updatedAt: new Date("2026-06-17T12:02:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    const result = await service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });

    expect(result).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(result.runId).not.toBe("hcr_stale");
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_stale-/u),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "running",
    });
  });

  it("retries stale browserless provisioning cleanup before starting a replacement browser", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        id: "hcr_stale",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "running",
        updatedAt: new Date("2026-06-17T12:02:00.000Z"),
      }),
    });
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail", "ok"],
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });

    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_stale-/u),
    ]);
    expect(kernel.createdSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      id: "hcr_stale",
      kernelSessionId: null,
      status: "cleanup_pending",
    });

    const result = await service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });

    expect(result).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(result.runId).not.toBe("hcr_stale");
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_stale-/u),
      expect.stringMatching(/^murph-browser-hcr_stale-/u),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "running",
    });
  });

  it("retries terminal browserless cleanup before reusing the browser session", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const browserName = "murph-browser-hcr_run123-pending";
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: browserName,
        status: "failed",
      }),
    });
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail", "ok"],
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });

    expect(kernel.deletedSessionIds).toEqual([
      browserName,
    ]);
    expect(kernel.createdSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: browserName,
      status: "failed",
    });

    const result = await service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });

    expect(result).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(result.runId).not.toBe("hcr_run123");
    expect(kernel.deletedSessionIds).toEqual([
      browserName,
      browserName,
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "running",
    });
  });

  it("reuses an awaiting member run instead of starting another run", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        awaitingReason: "final_confirmation",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        status: "awaiting_user",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: null,
      }),
      kernel,
      now: () => now,
      store,
    });

    const result = await service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      reused: true,
      status: "awaiting_user",
    });
    expect(result.runId).toBe("hcr_run123");
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.createdBrowserInputs).toEqual([]);
  });

  it("uses the explicit profile namespace and caps initial browser timeout to the reserved run lifetime", async () => {
    const times = [
      new Date("2026-06-17T12:00:00.000Z"),
      new Date("2026-06-17T12:10:00.000Z"),
      new Date("2026-06-17T12:10:00.000Z"),
    ];
    const store = new FakeComputerUseStore({
      memberRuns: [],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "staging.alpha",
      },
      kernel,
      now: () => times.shift() ?? new Date("2026-06-17T12:10:00.000Z"),
      store,
    });

    const result = await service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });

    expect(result).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(store.run.kernelProfileName).toMatch(
      /^murph-staging\.alpha-[0-9a-f]{24}$/u,
    );
    expect(store.run.kernelProfileName).not.toContain("member_123");
    expect(kernel.createdBrowserInputs).toEqual([
      expect.objectContaining({
        browserName: expect.stringMatching(/^murph-browser-hcr_[0-9a-f]{32}-[0-9a-f]{24}$/u),
        profileName: store.run.kernelProfileName,
        timeoutSeconds: 3000,
      }),
    ]);
    expect(kernel.createdBrowserInputs[0]).not.toHaveProperty("startUrl");
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(kernel.executePlaywrightInputs[0]?.code ?? "").toContain("page.goto(");
    expect(kernel.executePlaywrightInputs[0]?.code ?? "").not.toContain("route(\"**/*\"");
    expect(store.run).toMatchObject({
      lastTitle: "Page",
      lastUrl: "https://example.test/",
    });
  });

  it("uses one deterministic member Kernel profile for every new run", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const storedProfileName = "kernel-profile-stored";
    const store = new FakeComputerUseStore({
      memberRuns: [
        createRunRecord({
          completedAt: new Date("2026-06-17T11:00:00.000Z"),
          expiresAt: new Date("2026-06-17T11:30:00.000Z"),
          id: "hcr_old",
          kernelLiveViewUrlEncrypted: null,
          kernelProfileName: storedProfileName,
          kernelSessionId: null,
          status: "completed",
          updatedAt: new Date("2026-06-17T11:05:00.000Z"),
        }),
      ],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        expiresAt: new Date("2026-06-17T11:30:00.000Z"),
        id: "hcr_old",
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: storedProfileName,
        kernelSessionId: null,
        status: "completed",
        updatedAt: new Date("2026-06-17T11:05:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).resolves.toMatchObject({
      reused: false,
      status: "running",
    });

    expect(store.run.kernelProfileName).toMatch(
      /^murph-test-[0-9a-f]{24}$/u,
    );
    expect(store.run.kernelProfileName).not.toContain("member_123");
    expect(store.run.kernelProfileName).not.toContain("commerce");
    expect(store.run.kernelProfileName).not.toContain("appointments");
    expect(store.createRunInputs.at(-1)).toMatchObject({
      kernelProfileName: store.run.kernelProfileName,
    });
    expect(kernel.createdBrowserInputs).toEqual([
      expect.objectContaining({
        profileName: store.run.kernelProfileName,
        saveChanges: true,
      }),
    ]);

    const firstProfileName = store.run.kernelProfileName;
    const completedFirstRun = {
      ...store.run,
      completedAt: new Date("2026-06-17T12:05:00.000Z"),
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      status: "completed" as const,
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    };
    store.run = completedFirstRun;
    store.memberRuns = [
      ...(store.memberRuns ?? []).filter((run) => run.id !== completedFirstRun.id),
      completedFirstRun,
    ];

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test/follow-up",
    })).resolves.toMatchObject({
      reused: false,
      status: "running",
    });

    expect(store.run.kernelProfileName).toBe(firstProfileName);
    expect(kernel.createdBrowserInputs.at(-1)).toEqual(expect.objectContaining({
      profileName: firstProfileName,
      saveChanges: true,
    }));
  });

  it("stores a blank browser live view without extra navigation setup", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      memberRuns: [],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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
      memberId: "member_123",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: false,
      status: "running",
    });

    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "running",
    });
  });

  it("keeps an attached browser usable when the initial state cache update fails", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failNextUpdateRunBrowserState: true,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Dentist",
        url: "https://dentist.example.test/intake?token=secret",
        visibleText: "Intake",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    const handle = await service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test/intake",
    });

    expect(handle).toMatchObject({
      reused: false,
      runId: store.run.id,
      status: "running",
    });

    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      lastTitle: null,
      lastUrl: "https://dentist.example.test/intake",
      status: "running",
    });
  });

  it("keeps an attached browser usable when the attach write commits but returns an error", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failAfterAttachRunBrowser: true,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    const handle = await service.startRun({
      memberId: "member_123",
      startUrl: null,
    });

    expect(handle).toMatchObject({
      reused: false,
      runId: store.run.id,
      status: "running",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "running",
    });
  });

  it("keeps an attached browser when the run pauses before ambiguous attach recovery", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failAfterAttachRunBrowser: true,
      pauseRunAfterFailedAttachRunBrowser: true,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    const handle = await service.startRun({
      memberId: "member_123",
      startUrl: null,
    });

    expect(handle).toMatchObject({
      reused: false,
      runId: store.run.id,
      status: "awaiting_user",
    });

    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      kernelSessionId: "kernel-session-2",
      status: "awaiting_user",
    });
  });

  it("does not preflight start URL DNS before creating a browser", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).resolves.toMatchObject({
      reused: false,
      status: "running",
    });
    expect(kernel.createdBrowserInputs).toHaveLength(1);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.executePlaywrightInputs[0]?.code ?? "").toContain("https://dentist.example.test");
  });

  it("requires an explicit profile namespace before creating a persistent profile", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      memberRuns: [],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_PROFILE_NAMESPACE_MISSING",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      status: "completed",
    });
  });

  it("requires a profile namespace before creating the member profile even with stored runs", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const storedProfileName = "kernel-profile-stored";
    const store = new FakeComputerUseStore({
      memberRuns: [
        createRunRecord({
          completedAt: new Date("2026-06-17T11:00:00.000Z"),
          expiresAt: new Date("2026-06-17T11:30:00.000Z"),
          id: "hcr_legacy",
          kernelLiveViewUrlEncrypted: null,
          kernelProfileName: storedProfileName,
          kernelSessionId: null,
          status: "completed",
          updatedAt: new Date("2026-06-17T11:05:00.000Z"),
        }),
      ],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        expiresAt: new Date("2026-06-17T11:30:00.000Z"),
        id: "hcr_legacy",
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: storedProfileName,
        kernelSessionId: null,
        status: "completed",
        updatedAt: new Date("2026-06-17T11:05:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_PROFILE_NAMESPACE_MISSING",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      status: "completed",
    });
  });

  it("keeps profile namespaces distinct when raw values normalize the same", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const firstStore = new FakeComputerUseStore({
      memberRuns: [],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const secondStore = new FakeComputerUseStore({
      memberRuns: [],
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });

    await new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "prod/foo",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store: firstStore,
    }).startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });
    await new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "prod foo",
      },
      kernel: createFakeKernel(),
      now: () => now,
      store: secondStore,
    }).startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    });

    expect(firstStore.run.kernelProfileName).toMatch(/^murph-prod-foo-[0-9a-f]{24}$/u);
    expect(secondStore.run.kernelProfileName).toMatch(/^murph-prod-foo-[0-9a-f]{24}$/u);
    expect(firstStore.run.kernelProfileName).not.toContain("member_123");
    expect(secondStore.run.kernelProfileName).not.toContain("member_123");
    expect(firstStore.run.kernelProfileName).not.toBe(secondStore.run.kernelProfileName);
  });

  it("deletes a newly created browser when its live-view origin is not allowed", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel({
      liveViewUrlForBrowser: (browserCount) =>
        `https://kernel.example.test/live/${browserCount}`,
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
    });
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-2"]);
  });

  it("keeps a reserved run retryable when ambiguous browser provisioning cleanup fails", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel({
      createBrowserResults: ["fail"],
      deleteBrowserResults: ["fail"],
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(kernel.createdBrowserInputs).toEqual([
      expect.objectContaining({
        browserName: expect.stringMatching(/^murph-browser-hcr_/u),
      }),
    ]);
    expect(kernel.createdBrowserInputs[0]).not.toHaveProperty("startUrl");
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_/u),
    ]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "cleanup_pending",
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).resolves.toMatchObject({
      status: "running",
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_/u),
      expect.stringMatching(/^murph-browser-hcr_/u),
    ]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      status: "running",
    });
  });

  it("fails closed when a suspended member race happens after browser creation", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      computerUseChecksBeforeUnavailable: 2,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "failed",
    });
  });

  it("does not create a browser when another start has already reserved the run", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failCreateRunWithConcurrentRun: true,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
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

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_PROVISIONING",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      id: "hcr_concurrent",
      kernelSessionId: null,
      status: "running",
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
          url: "https://shop.example.test/checkout?session=secret#step",
          visibleText: "Ready",
        },
      }),
      now: () => now,
      store,
    });

    await service.pauseForUser({
      handoffPurpose: "manual_browser_help",
      memberId: "member_123",
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

  it("returns a completed browser action when the state cache update fails", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failNextUpdateRunBrowserState: true,
      run: createRunRecord({
        lastTitle: "Old title",
        lastUrl: "https://old.example.test",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        result: { clicked: true },
        title: "Order placed",
        url: "https://shop.example.test/order/confirmed?token=secret",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.act({
      code: "await page.getByRole('button', { name: 'Place order', exact: true }).click(); return { clicked: true };",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 15000,
    })).resolves.toEqual({
      result: { clicked: true },
      title: "Order placed",
      url: "https://shop.example.test/order/confirmed?token=secret",
    });

    expect(kernel.executePlaywrightCalls).toBe(1);
    const code = kernel.executePlaywrightInputs[0]?.code ?? "";
    expect(code).not.toContain("route(\"**/*\"");
    expect(code).toContain("getByRole('button', { name: 'Place order', exact: true })");
    expect(code).toContain("__murphUserResult");
    expect(store.run).toMatchObject({
      lastTitle: "Old title",
      lastUrl: "https://old.example.test",
      status: "running",
    });
  });

  it("adds action context to Kernel browser evaluation failures", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        lastTitle: "Checkout",
        lastUrl: "https://shop.example.test/checkout",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel({
      executeResultForCall() {
        throw computerUseError({
          code: "HOSTED_COMPUTER_EVAL_FAILED",
          details: {
            kernelError: "Error: strict mode violation: button matched multiple elements",
            kernelErrorPresent: true,
            kernelStderrPresent: true,
            kernelStdoutPresent: false,
          },
          httpStatus: 502,
          message: "Computer browser evaluation failed.",
          retryable: true,
        });
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.act({
      code: "await page.getByRole('button', { name: 'Place your order', exact: true }).click();",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 20000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_EVAL_FAILED",
      details: {
        codeHash: expect.any(String),
        kernelError: "Error: strict mode violation: button matched multiple elements",
        kernelErrorPresent: true,
        kernelStderrPresent: true,
        kernelStdoutPresent: false,
        timeoutMs: 20000,
      },
      message: "Computer browser evaluation failed.",
      retryable: true,
    });
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      lastTitle: "Checkout",
      lastUrl: "https://shop.example.test/checkout",
      status: "running",
    });
  });

  it("passes raw Playwright source through the wrapper", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const kernel = createFakeKernel({
      executeResult: {
        result: { waited: true },
        title: "Checkout",
        url: "https://shop.example.test/cart",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store: new FakeComputerUseStore({
        run: createRunRecord({ updatedAt: now }),
      }),
    });

    await expect(service.act({
      code: "await page.waitForTimeout(0); return { waited: true };",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 15000,
    })).resolves.toMatchObject({
      title: "Checkout",
      url: "https://shop.example.test/cart",
    });

    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(kernel.executePlaywrightInputs[0]?.timeoutMs).toBe(18000);
    const code = kernel.executePlaywrightInputs[0]?.code ?? "";
    expect(code).toContain("await page.waitForTimeout(0); return { waited: true };");
    expect(code).not.toContain("route(\"**/*\"");
    expect(code).not.toContain("isMurphPublicNavigationUrl");
  });

  it("rejects malformed browser action state results as unknown outcomes", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        lastTitle: "Old title",
        lastUrl: "https://old.example.test",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {},
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.act({
      code: "await page.getByRole('button', { name: 'Place order' }).click();",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 15000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_ACTION_STATE_INVALID",
    });
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      lastTitle: "Old title",
      lastUrl: "https://old.example.test",
      status: "running",
    });
  });

  it("rejects browser action state results with malformed URLs", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        lastTitle: "Old title",
        lastUrl: "https://old.example.test",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Checkout",
        url: "not a url",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.act({
      code: "await page.getByRole('button', { name: 'Place order' }).click();",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 15000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_ACTION_STATE_INVALID",
    });
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      lastTitle: "Old title",
      lastUrl: "https://old.example.test",
      status: "running",
    });
  });

  it("accepts browser action state results with non-public final URLs", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        lastTitle: "Old title",
        lastUrl: "https://old.example.test",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        result: { inspected: true },
        title: "Internal",
        url: "http://127.0.0.1/latest/meta-data",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.act({
      code: "return { inspected: true };",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 15000,
    })).resolves.toMatchObject({
      result: { inspected: true },
      title: "Internal",
      url: "http://127.0.0.1/latest/meta-data",
    });
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      lastTitle: "Internal",
      lastUrl: "http://127.0.0.1/latest/meta-data",
      status: "running",
    });
  });

  it("runs raw browser actions without injecting a route guard", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({ updatedAt: now }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        result: { navigated: true },
        title: "Public page",
        url: "https://example.com/checkout?token=secret#step",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.act({
      code: "await page.goto('https://example.com/checkout', { waitUntil: 'domcontentloaded' }); return { navigated: true };",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 15000,
    })).resolves.toMatchObject({
      result: { navigated: true },
      title: "Public page",
      url: "https://example.com/checkout?token=secret#step",
    });

    const code = kernel.executePlaywrightInputs[0]?.code ?? "";
    expect(code).toContain("await page.goto('https://example.com/checkout'");
    expect(code).not.toContain("node:dns/promises");
    expect(code).not.toContain("unroute(\"**/*\"");
    expect(code).not.toContain("route(\"**/*\"");
    expect(code).not.toContain("route.abort(\"blockedbyclient\")");
    expect(code).toContain("__murphUserResult");
    expect(store.run).toMatchObject({
      lastTitle: "Public page",
      lastUrl: "https://example.com/checkout",
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
        decryptedRunSecret: "https://proxy.test-browser.onkernel.com:8443/live/1",
      }),
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
      status: "open",
    });
  });

  it("resizes the browser behind an open member-owned handoff", async () => {
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
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.ensureHandoffViewport({
      memberId: "member_123",
      preset: "mobile",
      token: "handoff-token",
    })).resolves.toBeUndefined();
    expect(kernel.ensureBrowserViewportInputs).toEqual([
      {
        preset: "mobile",
        sessionId: "kernel-session-1",
      },
    ]);
  });

  it("blocks browser resize when the handoff is no longer pending on the run", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: "hch_other_handoff",
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.ensureHandoffViewport({
      memberId: "member_123",
      preset: "mobile",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CLOSED",
    });
    expect(kernel.ensureBrowserViewportInputs).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: "hch_other_handoff",
      status: "awaiting_user",
    });
  });

  it("blocks handoff completion when member suspension races the claim", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      computerUseChecksBeforeUnavailable: 1,
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: handoff.id,
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
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
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
      kind: "checkpointing",
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

  it("reopens a stale checkpointing handoff page without losing the browser run", async () => {
    const now = new Date("2026-06-17T12:07:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      suggestedReply: "done",
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
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: "https://proxy.test-browser.onkernel.com:8443/live/1",
      }),
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      handoffId: handoff.id,
      iframeAllow: "autoplay; clipboard-read; clipboard-write",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://proxy.test-browser.onkernel.com:8443/live/1",
      purpose: "login",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("returns a view-only handoff page state for final confirmation inspection links", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "screen_inspection",
      status: "open",
      suggestedReply: "yes",
      updatedAt: new Date("2026-06-17T12:03:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "final_confirmation",
        pausedAt: new Date("2026-06-17T12:02:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        suggestedReply: "yes",
      }),
    });
    const crypto = createFakeCrypto({
      decryptedRunSecret: "https://proxy.test-browser.onkernel.com:8443/live/1",
    });
    const service = new ComputerUseService({
      crypto,
      kernel: createFakeKernel({
        executeResult: "data:image/jpeg;base64,aW1hZ2U=",
      }),
      now: () => now,
      store,
    });

    const result = await service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    });

    expect(result).toEqual({
      handoffId: handoff.id,
      interaction: "view_only",
      kind: "open",
      purpose: "screen_inspection",
      screenshotDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
      suggestedReply: "yes",
    });
    expect(store.run).toMatchObject({
      kernelLiveViewUrlEncrypted: "encrypted-live-view",
    });
    expect(crypto.decryptRunSecretCalls).toBe(0);
  });

  it("keeps final confirmation manual help handoffs interactive", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "final_confirmation",
        pausedAt: new Date("2026-06-17T12:02:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const crypto = createFakeCrypto({
      decryptedRunSecret: "https://proxy.test-browser.onkernel.com:8443/live/1",
    });
    const kernel = createFakeKernel({
      executeResult: "data:image/jpeg;base64,aW1hZ2U=",
    });
    const service = new ComputerUseService({
      crypto,
      kernel,
      now: () => now,
      store,
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      handoffId: handoff.id,
      iframeAllow: "autoplay; clipboard-read; clipboard-write",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://proxy.test-browser.onkernel.com:8443/live/1",
      purpose: "manual_browser_help",
      suggestedReply: "yes",
    });
    expect(crypto.decryptRunSecretCalls).toBe(1);
    expect(kernel.executePlaywrightCalls).toBe(0);
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

  it("keeps a terminal run retryable when finish cleanup fails", async () => {
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
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(store.run).toMatchObject({
      kernelLiveViewUrlEncrypted: "encrypted-live-view",
      kernelSessionId: "kernel-session-1",
      lastTitle: null,
      lastUrl: null,
      status: "completed",
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: "hcr_run123",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1", "kernel-session-1"]);
    expect(store.run).toMatchObject({
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      lastTitle: null,
      lastUrl: null,
      status: "completed",
    });
  });

  it("does not retry deterministic cleanup after a normal finish clears the browser", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({ run: createRunRecord({ updatedAt: now }) });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: "hcr_run123",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "completed",
    });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).resolves.toMatchObject({
      reused: false,
      status: "running",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
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
    });

    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      pendingHandoffId: null,
      status: "failed",
    });
  });

  it("deletes the deterministic browser name when finishing a browserless paused run", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    });

    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "failed",
    });
  });

  it("rejects completed finish while final confirmation handoff is still open", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "manual_browser_help" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "final_confirmation",
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
      outcome: "completed",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_NOT_COMPLETED",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("rejects completed finish for a paused run without a completed handoff", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        awaitingReason: "stuck",
        pendingHandoffId: null,
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
      outcome: "completed",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_NOT_COMPLETED",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("rejects completed finish if a run pauses between finish validation and cleanup", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      pauseRunBeforeSecondRequireOwnedRun: true,
      run: createRunRecord({
        awaitingReason: null,
        pendingHandoffId: null,
        status: "running",
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
      outcome: "completed",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_NOT_COMPLETED",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
  });

  it("allows completed finish after final confirmation handoff completes", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({
      completedAt: new Date("2026-06-17T11:59:00.000Z"),
      purpose: "manual_browser_help",
      status: "completed",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "final_confirmation",
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
      outcome: "completed",
      runId: "hcr_run123",
    });

    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      pendingHandoffId: null,
      status: "completed",
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
    expect(kernel.createdBrowserInputs).toEqual([
      expect.objectContaining({
        browserName: expect.stringMatching(/^murph-browser-hcr_run123-[0-9a-f]{24}$/u),
        profileName: "murph-test-member",
        timeoutSeconds: 3600,
      }),
      expect.objectContaining({
        browserName: expect.stringMatching(/^murph-browser-hcr_run123-[0-9a-f]{24}$/u),
        profileName: "murph-test-member",
        timeoutSeconds: 3600,
      }),
    ]);
    expect(kernel.createdBrowserInputs[1]?.browserName).toBe(
      kernel.createdBrowserInputs[0]?.browserName,
    );
    expect(kernel.createdBrowserInputs.every((browserInput) => !("startUrl" in browserInput))).toBe(true);
    expect(kernel.executePlaywrightInputs.every((executeInput) =>
      !executeInput.code.includes("route(\"**/*\"")
    )).toBe(true);
  });

  it("does not delete the member profile when suspension races with login checkpoint replacement", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      computerUseChecksBeforeUnavailable: 2,
      handoff,
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
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      "kernel-session-2",
    ]);
    expect(kernel.deletedProfileNames).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelProfileName: "murph-test-member",
      kernelSessionId: null,
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
    expect(kernel.createdBrowserInputs).toEqual([
      expect.objectContaining({
        timeoutSeconds: 3300,
      }),
    ]);
    expect(kernel.createdBrowserInputs[0]).not.toHaveProperty("startUrl");
    expect(kernel.executePlaywrightInputs.every((executeInput) =>
      !executeInput.code.includes("route(\"**/*\"")
    )).toBe(true);
  });

  it("deletes an orphan replacement browser before retrying a browserless login checkpoint", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({ suggestedReply: "done" });

    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.handoff).toMatchObject({
      completedAt: now,
      status: "completed",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
  });

  it("keeps a replacement browser usable when the replace write commits but returns an error", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      failAfterReplaceRunBrowser: true,
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({ suggestedReply: "done" });

    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.handoff).toMatchObject({
      completedAt: now,
      status: "completed",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
  });

  it("does not release a newer handoff claim from a stale completion failure", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      advanceHandoffClaimBeforeRejectReplaceRunBrowser: true,
      handoff,
      rejectReplaceRunBrowser: true,
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toThrow("Stale run state.");

    expect(store.handoff).toMatchObject({
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:06:00.000Z"),
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      "kernel-session-2",
    ]);
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

  it("expires the run instead of replacing the browser when login handoff completes after run expiry", async () => {
    const now = new Date("2026-06-17T13:00:01.000Z");
    const handoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T13:10:00.000Z"),
      purpose: "login",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_EXPIRED",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(kernel.createdSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("deletes a replacement browser when login handoff checkpointing rejects its live-view origin", async () => {
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
    const kernel = createFakeKernel({
      executeResult: {
        title: "Signed in",
        url: "https://shop.example.test/account",
        visibleText: "Account",
      },
      liveViewUrlForBrowser: (browserCount) =>
        `https://kernel.example.test/live/${browserCount}`,
    });
    const service = new ComputerUseService({
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
      status: "expired",
    });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 0,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1", "kernel-session-1"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("deletes deterministic browser names before expiring browserless cleanup rows", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        id: "hcr_orphan",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "cleanup_pending",
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
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_orphan-/u),
    ]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("deletes stored terminal browser cleanup handles during retention cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const browserName = "murph-browser-hcr_run123-pending";
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: browserName,
        status: "failed",
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
    expect(kernel.deletedSessionIds).toEqual([browserName]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "failed",
    });
  });

  it("deletes deterministic browser names before expiring interrupted login checkpoint rows", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("keeps browserless cleanup rows retryable when deterministic browser deletion fails", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        id: "hcr_orphan",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "cleanup_pending",
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
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_orphan-/u),
    ]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "cleanup_pending",
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
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
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
      run: createRunRecord({
        kernelProfileName: "kernel-profile-member",
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
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
  });

  it("deletes each unique stored Kernel profile during account deletion cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      memberRuns: [
        createRunRecord({
          completedAt: new Date("2026-06-16T10:00:00.000Z"),
          expiresAt: new Date("2026-06-16T11:00:00.000Z"),
          id: "hcr_run_a",
          kernelProfileName: "kernel-profile-shared",
          kernelSessionId: null,
          status: "failed",
        }),
        createRunRecord({
          completedAt: new Date("2026-06-16T10:05:00.000Z"),
          expiresAt: new Date("2026-06-16T11:05:00.000Z"),
          id: "hcr_run_b",
          kernelProfileName: "kernel-profile-shared",
          kernelSessionId: null,
          status: "completed",
        }),
        createRunRecord({
          completedAt: new Date("2026-06-16T10:10:00.000Z"),
          expiresAt: new Date("2026-06-16T11:10:00.000Z"),
          id: "hcr_run_c",
          kernelProfileName: "kernel-profile-distinct",
          kernelSessionId: null,
          status: "failed",
        }),
      ],
      run: createRunRecord(),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 0,
      profilesDeleted: 2,
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual([
      "kernel-profile-shared",
      "kernel-profile-distinct",
    ]);
  });

  it("fails account deletion cleanup while a browserless run is still provisioning", async () => {
    const now = new Date("2026-06-17T12:01:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "running",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_PROVISIONING",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "running",
    });
  });

  it("deletes stale browserless provisioning during account deletion cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: "kernel-profile-member",
        kernelSessionId: null,
        status: "running",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 1,
      profilesDeleted: 1,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "running",
    });
  });

  it("deletes a terminal browserless deterministic browser during account deletion cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: "kernel-profile-member",
        kernelSessionId: null,
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
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
      outcome: "failed",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: expect.stringMatching(/^murph-browser-hcr_run123-/u),
      status: "failed",
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 1,
      profilesDeleted: 1,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
  });

  it("deletes pre-existing terminal browserless deterministic browsers during account deletion cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T12:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: "kernel-profile-member",
        kernelSessionId: null,
        status: "failed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 1,
      profilesDeleted: 1,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "failed",
    });
  });

  it("does not delete historical terminal browserless deterministic names during account deletion cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-16T10:00:00.000Z"),
        expiresAt: new Date("2026-06-16T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: "kernel-profile-member",
        kernelSessionId: null,
        status: "failed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 0,
      profilesDeleted: 1,
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
  });

  it("deletes interrupted browserless awaiting browsers during account deletion cleanup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "payment",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "payment_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: "kernel-profile-member",
        kernelSessionId: null,
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

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).resolves.toEqual({
      browserSessionsDeleted: 1,
      profilesDeleted: 1,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "awaiting_user",
    });
  });

  it("fails account deletion cleanup while a handoff is checkpointing", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      handoff: createHandoffRecord({
        status: "checkpointing",
        updatedAt: now,
      }),
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual([]);
  });

  it("deletes stored Kernel sessions and profiles even when namespace cleanup is not configured", async () => {
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelProfileName: "kernel-profile-member",
        kernelSessionId: "kernel-session-1",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "",
        KERNEL_API_KEY: "test-key",
      },
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
    expect(kernel.deletedProfileNames).toEqual(["kernel-profile-member"]);
  });

  it("does not require Kernel cleanup when the member has no computer-use runs", async () => {
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        memberId: "member_with_runs",
      }),
    });
    const createBrowser = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const deleteBrowserByIdOrName = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const deleteProfile = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const ensureBrowserViewport = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const ensureProfile = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const executePlaywright = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const osControl = vi.fn(async () => {
      throw new Error("Kernel should not be called.");
    });
    const kernel: ComputerKernelClient = {
      createBrowser,
      deleteBrowserByIdOrName,
      deleteProfile,
      ensureBrowserViewport,
      ensureProfile,
      executePlaywright,
      osControl,
    };
    const service = new ComputerUseService({
      env: {
        HOSTED_COMPUTER_PROFILE_NAMESPACE: "test",
        KERNEL_API_KEY: "test-key",
      },
      kernel,
      store,
    });

    await expect(service.deleteMemberExternalStateForAccountDeletion({
      memberId: "member_without_runs",
    })).resolves.toEqual({
      browserSessionsDeleted: 0,
      profilesDeleted: 0,
    });
    expect(createBrowser).not.toHaveBeenCalled();
    expect(deleteBrowserByIdOrName).not.toHaveBeenCalled();
    expect(deleteProfile).not.toHaveBeenCalled();
    expect(ensureBrowserViewport).not.toHaveBeenCalled();
    expect(ensureProfile).not.toHaveBeenCalled();
    expect(executePlaywright).not.toHaveBeenCalled();
  });
});

describe("PrismaComputerUseStore", () => {
  it("fences handoff release and completion by the claimed updatedAt", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createHandoffRecord({
      completedAt: now,
      status: "completed",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerHandoff: {
        findUnique,
        updateMany,
      },
    } as never);

    await store.completeHandoff({
      expectedUpdatedAt: claimedUpdatedAt,
      handoffId: "hch_handoff123",
      now,
    });
    await store.releaseHandoffClaim({
      expectedUpdatedAt: claimedUpdatedAt,
      handoffId: "hch_handoff123",
    });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        completedAt: now,
        status: "completed",
      },
      where: {
        id: "hch_handoff123",
        status: "checkpointing",
        updatedAt: claimedUpdatedAt,
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        status: "open",
      },
      where: {
        id: "hch_handoff123",
        status: "checkpointing",
        updatedAt: claimedUpdatedAt,
      },
    });
  });

  it("fences browser clear and replace by the claimed handoff updatedAt", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
      updatedAt: now,
    }));
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "member_123" }]),
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => callback(tx)),
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await store.clearRunBrowser({
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      expectedKernelSessionId: "kernel-session-1",
      expectedPendingHandoffId: "hch_handoff123",
      now,
      runId: "hcr_run123",
    });
    await store.replaceRunBrowser({
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      expectedPendingHandoffId: "hch_handoff123",
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
      memberId: "member_123",
      now,
      runId: "hcr_run123",
    });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
      },
      where: {
        handoffs: {
          some: {
            id: "hch_handoff123",
            status: "checkpointing",
            updatedAt: claimedUpdatedAt,
          },
        },
        id: "hcr_run123",
        kernelSessionId: "kernel-session-1",
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      where: {
        handoffs: {
          some: {
            id: "hch_handoff123",
            status: "checkpointing",
            updatedAt: claimedUpdatedAt,
          },
        },
        expiresAt: { gt: now },
        id: "hcr_run123",
        kernelSessionId: null,
        memberId: "member_123",
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[1]!,
    );
  });

  it("fences awaiting handoff replacement by the old open handoff updatedAt", async () => {
    const oldUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      awaitingMessage: "Can you log in here?",
      awaitingReason: "login_needed",
      pendingHandoffId: "hch_handoff124",
      status: "awaiting_user",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await store.replaceAwaitingRunHandoff({
      expectedHandoffUpdatedAt: oldUpdatedAt,
      expectedPendingHandoffId: "hch_handoff123",
      newPendingHandoffId: "hch_handoff124",
      now,
      runId: "hcr_run123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        pausedAt: now,
        pendingHandoffId: "hch_handoff124",
      },
      where: {
        handoffs: {
          some: {
            id: "hch_handoff123",
            status: { in: ["open", "expired", "completed"] },
            updatedAt: oldUpdatedAt,
          },
        },
        id: "hcr_run123",
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      },
    });
  });

  it("fences first awaiting handoff attachment by the observed pause", async () => {
    const pausedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: now,
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await store.attachAwaitingRunHandoff({
      awaitingReason: "final_confirmation",
      expectedPausedAt: pausedAt,
      newPendingHandoffId: "hch_handoff123",
      now,
      runId: "hcr_run123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        pausedAt: now,
        pendingHandoffId: "hch_handoff123",
      },
      where: {
        awaitingReason: "final_confirmation",
        expiresAt: { gt: now },
        id: "hcr_run123",
        kernelSessionId: { not: null },
        pausedAt,
        pendingHandoffId: null,
        status: "awaiting_user",
      },
    });
  });

  it("fences resume by the observed pause and pending handoff", async () => {
    const pausedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      awaitingReason: null,
      pausedAt: null,
      pendingHandoffId: null,
      status: "running",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await store.markRunRunning({
      awaitingReason: "login_needed",
      expectedPausedAt: pausedAt,
      expectedPendingHandoffId: "hch_handoff123",
      now,
      runId: "hcr_run123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        metadataJson: Prisma.JsonNull,
        pausedAt: null,
        pendingHandoffId: null,
        status: "running",
        suggestedReply: null,
      },
      where: {
        awaitingReason: "login_needed",
        id: "hcr_run123",
        kernelSessionId: { not: null },
        pausedAt,
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      },
    });
  });

  it("can fence resume by an optional open inspection handoff", async () => {
    const handoffUpdatedAt = new Date("2026-06-17T12:03:00.000Z");
    const pausedAt = new Date("2026-06-17T12:02:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      awaitingReason: null,
      pausedAt: null,
      pendingHandoffId: null,
      status: "running",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await store.markRunRunning({
      awaitingReason: "final_confirmation",
      expectedHandoffStatus: "open",
      expectedHandoffUpdatedAt: handoffUpdatedAt,
      expectedPausedAt: pausedAt,
      expectedPendingHandoffId: "hch_handoff123",
      now,
      runId: "hcr_run123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        metadataJson: Prisma.JsonNull,
        pausedAt: null,
        pendingHandoffId: null,
        status: "running",
        suggestedReply: null,
      },
      where: {
        awaitingReason: "final_confirmation",
        handoffs: {
          some: {
            id: "hch_handoff123",
            status: "open",
            updatedAt: handoffUpdatedAt,
          },
        },
        id: "hcr_run123",
        kernelSessionId: { not: null },
        pausedAt,
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      },
    });
  });

  it("fences completed finish by the completed pending handoff", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      completedAt: now,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      pendingHandoffId: "hch_handoff123",
      status: "completed",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await expect(store.finishRun({
      expectedCompletedHandoffId: "hch_handoff123",
      expectedKernelSessionId: "kernel-session-1",
      now,
      outcome: "completed",
      runId: "hcr_run123",
    })).resolves.toMatchObject({
      id: "hcr_run123",
      status: "completed",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: now,
        lastTitle: null,
        lastUrl: null,
        metadataJson: Prisma.JsonNull,
        pendingHandoffId: null,
        status: "completed",
        suggestedReply: null,
      },
      where: {
        handoffs: {
          some: {
            id: "hch_handoff123",
            status: "completed",
          },
        },
        id: "hcr_run123",
        kernelSessionId: "kernel-session-1",
        pendingHandoffId: "hch_handoff123",
        status: { in: ["running", "awaiting_user"] },
      },
    });
  });

  it("fences completed finish without a handoff to a still-running run", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      completedAt: now,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      status: "completed",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await expect(store.finishRun({
      expectedCompletedHandoffId: null,
      expectedKernelSessionId: "kernel-session-1",
      expectedRunStatus: "running",
      now,
      outcome: "completed",
      runId: "hcr_run123",
    })).resolves.toMatchObject({
      id: "hcr_run123",
      status: "completed",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: now,
        lastTitle: null,
        lastUrl: null,
        metadataJson: Prisma.JsonNull,
        pendingHandoffId: null,
        status: "completed",
        suggestedReply: null,
      },
      where: {
        id: "hcr_run123",
        kernelSessionId: "kernel-session-1",
        status: "running",
      },
    });
  });

  it("locks member computer-use availability inside run creation", async () => {
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        trace.push("lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerRun: {
        create: vi.fn(async () => {
          trace.push("create-run");
          return createRunRecord({
            id: "hcr_created",
            kernelProfileName: "murph-test-member",
          });
        }),
        findFirst: vi.fn(async () => {
          trace.push("find-active-run");
          return null;
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => callback(tx)),
    };
    const store = new PrismaComputerUseStore(prisma as never);

    await expect(store.createRun({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      id: "hcr_created",
      kernelProfileName: "murph-test-member",
      memberId: "member_123",
      now: new Date("2026-06-17T12:00:00.000Z"),
      startUrl: null,
    })).resolves.toMatchObject({
      created: true,
      run: {
        id: "hcr_created",
      },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedComputerRun.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.hostedComputerRun.create).toHaveBeenCalledTimes(1);
    expect(tx.hostedComputerRun.create).toHaveBeenCalledWith({
      data: {
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        id: "hcr_created",
        kernelProfileName: "murph-test-member",
        lastUrl: null,
        memberId: "member_123",
      },
    });
    expect(trace).toEqual(["lock-member", "find-active-run", "create-run"]);
  });

  it("locks member computer-use availability before attaching a browser to a reserved run", async () => {
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        trace.push("lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerRun: {
        findUnique: vi.fn(async () => {
          trace.push("find-run");
          return createRunRecord({
            id: "hcr_created",
            kernelLiveViewUrlEncrypted: "encrypted-live-view",
            kernelSessionId: "kernel-session-1",
          });
        }),
        updateMany: vi.fn(async () => {
          trace.push("attach-browser");
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => callback(tx)),
    };
    const store = new PrismaComputerUseStore(prisma as never);

    await expect(store.attachRunBrowser({
      kernelLiveViewUrlEncrypted: "encrypted-live-view",
      kernelSessionId: "kernel-session-1",
      memberId: "member_123",
      now: new Date("2026-06-17T12:00:00.000Z"),
      runId: "hcr_created",
    })).resolves.toMatchObject({
      id: "hcr_created",
      kernelSessionId: "kernel-session-1",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedComputerRun.updateMany).toHaveBeenCalledWith({
      data: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view",
        kernelSessionId: "kernel-session-1",
      },
      where: {
        expiresAt: { gt: new Date("2026-06-17T12:00:00.000Z") },
        id: "hcr_created",
        kernelSessionId: null,
        memberId: "member_123",
        status: "running",
      },
    });
    expect(trace).toEqual(["lock-member", "attach-browser", "find-run"]);
  });

  it("treats same-browser attach replay as already attached under the member lock", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        trace.push("lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerRun: {
        findFirst: vi.fn(async () => {
          trace.push("find-attached-run");
          return createRunRecord({
            id: "hcr_created",
            kernelLiveViewUrlEncrypted: "encrypted-live-view",
            kernelSessionId: "kernel-session-1",
            status: "running",
          });
        }),
        findUnique: vi.fn(),
        updateMany: vi.fn(async () => {
          trace.push("attach-browser");
          return { count: 0 };
        }),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => callback(tx)),
    } as never);

    await expect(store.attachRunBrowser({
      kernelLiveViewUrlEncrypted: "encrypted-live-view",
      kernelSessionId: "kernel-session-1",
      memberId: "member_123",
      now,
      runId: "hcr_created",
    })).resolves.toMatchObject({
      id: "hcr_created",
      kernelSessionId: "kernel-session-1",
    });

    expect(tx.hostedComputerRun.findFirst).toHaveBeenCalledWith({
      where: {
        expiresAt: { gt: now },
        id: "hcr_created",
        kernelLiveViewUrlEncrypted: "encrypted-live-view",
        kernelSessionId: "kernel-session-1",
        memberId: "member_123",
        status: { in: ["running", "awaiting_user"] },
      },
    });
    expect(tx.hostedComputerRun.findUnique).not.toHaveBeenCalled();
    expect(trace).toEqual(["lock-member", "attach-browser", "find-attached-run"]);
  });

  it("treats same-browser replacement replay as already attached under the member lock", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        trace.push("lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerRun: {
        findFirst: vi.fn(async () => {
          trace.push("find-replaced-run");
          return createRunRecord({
            kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
            kernelSessionId: "kernel-session-2",
            pendingHandoffId: "hch_handoff123",
            status: "awaiting_user",
          });
        }),
        findUnique: vi.fn(),
        updateMany: vi.fn(async () => {
          trace.push("replace-browser");
          return { count: 0 };
        }),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => callback(tx)),
    } as never);

    await expect(store.replaceRunBrowser({
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      expectedPendingHandoffId: "hch_handoff123",
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
      memberId: "member_123",
      now,
      runId: "hcr_run123",
    })).resolves.toMatchObject({
      id: "hcr_run123",
      kernelSessionId: "kernel-session-2",
    });

    expect(tx.hostedComputerRun.findFirst).toHaveBeenCalledWith({
      where: {
        expiresAt: { gt: now },
        handoffs: {
          some: {
            id: "hch_handoff123",
            status: "checkpointing",
            updatedAt: claimedUpdatedAt,
          },
        },
        id: "hcr_run123",
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
        memberId: "member_123",
        pendingHandoffId: "hch_handoff123",
        status: "awaiting_user",
      },
    });
    expect(tx.hostedComputerRun.findUnique).not.toHaveBeenCalled();
    expect(trace).toEqual(["lock-member", "replace-browser", "find-replaced-run"]);
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
  advanceHandoffClaimBeforeRejectReplaceRunBrowser = false;
  computerUseAvailable = true;
  computerUseChecksBeforeUnavailable: number | null = null;
  checkpointHandoffBeforeMarkExpired = false;
  completeRunBeforeMarkAwaitingUser = false;
  completeRunBeforeMarkExpired = false;
  completeRunBeforeUpdateBrowserState = false;
  expireHandoffBeforeReplaceRunBrowser = false;
  failAfterAttachRunBrowser = false;
  failAfterReplaceRunBrowser = false;
  failCreateRunWithConcurrentRun = false;
  failNextUpdateRunBrowserState = false;
  createRunInputs: Parameters<ComputerUseStore["createRun"]>[0][] = [];
  handoff: ComputerHandoffRecord | null = null;
  handoffs: ComputerHandoffRecord[] = [];
  lastResumeAwaitingReason: Parameters<ComputerUseStore["markRunRunning"]>[0]["awaitingReason"] | null = null;
  memberRuns: ComputerRunRecord[] | null = null;
  pauseRunBeforeSecondRequireOwnedRun = false;
  pauseRunAfterFailedAttachRunBrowser = false;
  rejectReplaceRunBrowser = false;
  replaceBrowserBeforeMarkRunCleanupPending = false;
  replacePendingHandoffBeforeMarkRunRunning = false;
  resumeMailboxItems: ResumeMailboxItem[] = [];
  run: ComputerRunRecord;
  private requireOwnedRunCallCount = 0;

  constructor(input: {
    advanceHandoffClaimBeforeRejectReplaceRunBrowser?: boolean;
    computerUseAvailable?: boolean;
    computerUseChecksBeforeUnavailable?: number | null;
    checkpointHandoffBeforeMarkExpired?: boolean;
    completeRunBeforeMarkAwaitingUser?: boolean;
    completeRunBeforeMarkExpired?: boolean;
    completeRunBeforeUpdateBrowserState?: boolean;
    expireHandoffBeforeReplaceRunBrowser?: boolean;
    failAfterAttachRunBrowser?: boolean;
    failAfterReplaceRunBrowser?: boolean;
    failCreateRunWithConcurrentRun?: boolean;
    failNextUpdateRunBrowserState?: boolean;
    handoff?: ComputerHandoffRecord | null;
    memberRuns?: ComputerRunRecord[];
    pauseRunAfterFailedAttachRunBrowser?: boolean;
    pauseRunBeforeSecondRequireOwnedRun?: boolean;
    rejectReplaceRunBrowser?: boolean;
    replaceBrowserBeforeMarkRunCleanupPending?: boolean;
    replacePendingHandoffBeforeMarkRunRunning?: boolean;
    resumeMailboxItems?: ResumeMailboxItem[];
    run: ComputerRunRecord;
  }) {
    this.advanceHandoffClaimBeforeRejectReplaceRunBrowser =
      input.advanceHandoffClaimBeforeRejectReplaceRunBrowser ?? false;
    this.computerUseAvailable = input.computerUseAvailable ?? true;
    this.computerUseChecksBeforeUnavailable = input.computerUseChecksBeforeUnavailable ?? null;
    this.checkpointHandoffBeforeMarkExpired = input.checkpointHandoffBeforeMarkExpired ?? false;
    this.completeRunBeforeMarkAwaitingUser = input.completeRunBeforeMarkAwaitingUser ?? false;
    this.completeRunBeforeMarkExpired = input.completeRunBeforeMarkExpired ?? false;
    this.completeRunBeforeUpdateBrowserState =
      input.completeRunBeforeUpdateBrowserState ?? false;
    this.expireHandoffBeforeReplaceRunBrowser = input.expireHandoffBeforeReplaceRunBrowser ?? false;
    this.failAfterAttachRunBrowser = input.failAfterAttachRunBrowser ?? false;
    this.failAfterReplaceRunBrowser = input.failAfterReplaceRunBrowser ?? false;
    this.failCreateRunWithConcurrentRun = input.failCreateRunWithConcurrentRun ?? false;
    this.failNextUpdateRunBrowserState = input.failNextUpdateRunBrowserState ?? false;
    this.handoff = input.handoff ?? null;
    this.handoffs = this.handoff ? [this.handoff] : [];
    this.memberRuns = input.memberRuns ?? null;
    this.pauseRunAfterFailedAttachRunBrowser =
      input.pauseRunAfterFailedAttachRunBrowser ?? false;
    this.pauseRunBeforeSecondRequireOwnedRun =
      input.pauseRunBeforeSecondRequireOwnedRun ?? false;
    this.rejectReplaceRunBrowser = input.rejectReplaceRunBrowser ?? false;
    this.replaceBrowserBeforeMarkRunCleanupPending =
      input.replaceBrowserBeforeMarkRunCleanupPending ?? false;
    this.replacePendingHandoffBeforeMarkRunRunning =
      input.replacePendingHandoffBeforeMarkRunRunning ?? false;
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
    if (input.memberId !== this.run.memberId) {
      throw new Error("Member not found.");
    }
  }

  async requireOwnedRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord> {
    this.requireOwnedRunCallCount += 1;
    if (
      this.pauseRunBeforeSecondRequireOwnedRun &&
      this.requireOwnedRunCallCount === 2
    ) {
      this.run = {
        ...this.run,
        awaitingMessage: "Waiting for user.",
        awaitingReason: "stuck",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        status: "awaiting_user",
      };
    }
    if (input.memberId !== this.run.memberId || input.runId !== this.run.id) {
      throw new Error("Run not found.");
    }
    return this.run;
  }

  async listStaleActiveRuns(input: Parameters<ComputerUseStore["listStaleActiveRuns"]>[0]): Promise<ComputerRunRecord[]> {
    return isStaleRunForCleanup(this.run, input.now)
      ? [this.run]
      : [];
  }

  async listMemberRuns(input: Parameters<ComputerUseStore["listMemberRuns"]>[0]): Promise<ComputerRunRecord[]> {
    return (this.memberRuns ?? [this.run]).filter((run) =>
      run.memberId === input.memberId
    );
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

  async listStaleActiveRunsForMember(input: Parameters<ComputerUseStore["listStaleActiveRunsForMember"]>[0]): Promise<ComputerRunRecord[]> {
    return (this.memberRuns ?? [this.run])
      .filter((run) => run.memberId === input.memberId && isStaleRunForCleanup(run, input.now))
      .slice(0, input.limit);
  }

  async findActiveRunForMember(input: Parameters<ComputerUseStore["findActiveRunForMember"]>[0]): Promise<ComputerRunRecord | null> {
    return selectActiveRunForTest(
      this.memberRuns ?? [this.run],
      input.memberId,
      input.now,
    );
  }

  async createHandoff(input: Parameters<ComputerUseStore["createHandoff"]>[0]): Promise<ComputerHandoffRecord> {
    const id = this.handoffs.some((handoff) => handoff.id === "hch_handoff123")
      ? `hch_handoff${123 + this.handoffs.length}`
      : "hch_handoff123";
    const handoff: ComputerHandoffRecord = {
      completedAt: null,
      expiresAt: input.expiresAt,
      id,
      memberId: input.memberId,
      purpose: input.purpose,
      runId: input.runId,
      status: "open",
      suggestedReply: input.suggestedReply,
      tokenHash: input.tokenHash,
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    };
    this.storeHandoff(handoff, { active: true });
    return handoff;
  }

  async createRun(input: Parameters<ComputerUseStore["createRun"]>[0]): ReturnType<ComputerUseStore["createRun"]> {
    this.createRunInputs.push(input);
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
    if (this.failCreateRunWithConcurrentRun) {
      this.run = createRunRecord({
        expiresAt: input.expiresAt,
        id: "hcr_concurrent",
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: input.kernelProfileName,
        kernelSessionId: null,
        lastTitle: null,
        lastUrl: input.startUrl,
        memberId: input.memberId,
        status: "running",
        updatedAt: new Date("2026-06-17T12:05:00.000Z"),
      });
      this.storeMemberRun(this.run);
      return {
        created: false,
        run: this.run,
      };
    }
    this.run = createRunRecord({
      expiresAt: input.expiresAt,
      id: input.id,
      kernelLiveViewUrlEncrypted: null,
      kernelProfileName: input.kernelProfileName,
      kernelSessionId: null,
      lastTitle: null,
      lastUrl: input.startUrl,
      memberId: input.memberId,
      status: "running",
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    });
    this.storeMemberRun(this.run);
    return {
      created: true,
      run: this.run,
    };
  }

  async attachRunBrowser(input: Parameters<ComputerUseStore["attachRunBrowser"]>[0]): Promise<ComputerRunRecord> {
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
    if (
      this.run.id !== input.runId ||
      this.run.memberId !== input.memberId ||
      this.run.expiresAt <= input.now
    ) {
      throw staleRunStateError();
    }
    if (this.run.kernelSessionId !== null) {
      if (
        this.run.kernelSessionId === input.kernelSessionId &&
        this.run.kernelLiveViewUrlEncrypted === input.kernelLiveViewUrlEncrypted &&
        (this.run.status === "running" || this.run.status === "awaiting_user")
      ) {
        return this.run;
      }
      throw staleRunStateError();
    }
    if (this.run.status !== "running") {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
      kernelSessionId: input.kernelSessionId,
    };
    if (this.failAfterAttachRunBrowser) {
      this.failAfterAttachRunBrowser = false;
      if (this.pauseRunAfterFailedAttachRunBrowser) {
        this.pauseRunAfterFailedAttachRunBrowser = false;
        this.run = {
          ...this.run,
          awaitingMessage: "Waiting for user.",
          awaitingReason: "login_needed",
          pausedAt: input.now,
          status: "awaiting_user",
          updatedAt: input.now,
        };
      }
      throw new Error("attachRunBrowser failed after write");
    }
    return this.run;
  }

  async requireHandoffByTokenHash(): Promise<ComputerHandoffRecord> {
    if (!this.handoff) {
      throw new Error("Handoff not found.");
    }
    return this.handoff;
  }

  async markHandoffExpired(input: Parameters<ComputerUseStore["markHandoffExpired"]>[0]): Promise<ComputerHandoffRecord> {
    let handoff = this.findStoredHandoff(input.handoffId);
    if (!handoff) {
      throw new Error("Handoff not found.");
    }
    if (this.checkpointHandoffBeforeMarkExpired) {
      this.checkpointHandoffBeforeMarkExpired = false;
      handoff = this.storeHandoff({
        ...handoff,
        status: "checkpointing",
        updatedAt: input.now,
      });
    }
    if (
      (input.expectedStatus && handoff.status !== input.expectedStatus) ||
      (input.expectedUpdatedAt &&
        handoff.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    ) {
      throw staleRunStateError();
    }
    if (handoff.status !== "open" && handoff.status !== "checkpointing") {
      return handoff;
    }
    return this.storeHandoff({
      ...handoff,
      status: "expired",
      updatedAt: input.now,
    });
  }

  async completeHandoff(input: Parameters<ComputerUseStore["completeHandoff"]>[0]): Promise<ComputerHandoffRecord> {
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      !handoff ||
      handoff.status !== "checkpointing" ||
      (input.expectedUpdatedAt &&
        handoff.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    ) {
      throw staleRunStateError();
    }
    return this.storeHandoff({
      ...handoff,
      completedAt: input.now,
      status: "completed",
      updatedAt: input.now,
    });
  }

  async claimHandoffForCompletion(input: Parameters<ComputerUseStore["claimHandoffForCompletion"]>[0]): Promise<ComputerHandoffRecord | null> {
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
    const handoff = this.findStoredHandoff(input.handoffId);
    if (!handoff || handoff.memberId !== input.memberId || handoff.status !== "open") {
      return null;
    }
    return this.storeHandoff({
      ...handoff,
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    });
  }

  async releaseHandoffClaim(input: Parameters<ComputerUseStore["releaseHandoffClaim"]>[0]): Promise<void> {
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      handoff &&
      handoff.status === "checkpointing" &&
      (!input.expectedUpdatedAt ||
        handoff.updatedAt.getTime() === input.expectedUpdatedAt.getTime())
    ) {
      this.storeHandoff({
        ...handoff,
        status: "open",
        updatedAt: new Date("2026-06-17T12:05:00.000Z"),
      });
      return;
    }
    if (input.expectedUpdatedAt) {
      throw staleRunStateError();
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

  async attachAwaitingRunHandoff(
    input: Parameters<ComputerUseStore["attachAwaitingRunHandoff"]>[0],
  ): Promise<ComputerRunRecord> {
    const handoff = this.findStoredHandoff(input.newPendingHandoffId);
    if (
      this.run.id !== input.runId ||
      this.run.status !== "awaiting_user" ||
      !this.run.kernelSessionId ||
      this.run.awaitingReason !== input.awaitingReason ||
      this.run.pendingHandoffId !== null ||
      !this.run.pausedAt ||
      this.run.pausedAt.getTime() !== input.expectedPausedAt.getTime() ||
      this.run.expiresAt <= input.now ||
      !handoff ||
      handoff.status !== "open"
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      pausedAt: input.now,
      pendingHandoffId: input.newPendingHandoffId,
      updatedAt: input.now,
    };
    return this.run;
  }

  async replaceAwaitingRunHandoff(
    input: Parameters<ComputerUseStore["replaceAwaitingRunHandoff"]>[0],
  ): Promise<ComputerRunRecord> {
    const existing = this.findStoredHandoff(input.expectedPendingHandoffId);
    const replacement = this.findStoredHandoff(input.newPendingHandoffId);
    if (
      this.run.id !== input.runId ||
      this.run.pendingHandoffId !== input.expectedPendingHandoffId ||
      this.run.status !== "awaiting_user" ||
      !existing ||
      !["open", "expired", "completed"].includes(existing.status) ||
      existing.updatedAt.getTime() !== input.expectedHandoffUpdatedAt.getTime() ||
      !replacement ||
      replacement.status !== "open"
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      pausedAt: input.now,
      pendingHandoffId: input.newPendingHandoffId,
      updatedAt: input.now,
    };
    return this.run;
  }

  async markRunRunning(
    input: Parameters<ComputerUseStore["markRunRunning"]>[0],
  ): Promise<ComputerRunRecord> {
    if (this.replacePendingHandoffBeforeMarkRunRunning) {
      this.replacePendingHandoffBeforeMarkRunRunning = false;
      const replacement = this.storeHandoff(createHandoffRecord({
        id: "hch_handoff124",
        purpose: "login",
        status: "open",
        updatedAt: input.now,
      }));
      this.run = {
        ...this.run,
        pausedAt: input.now,
        pendingHandoffId: replacement.id,
        updatedAt: input.now,
      };
    }
    const expectedHandoff = input.expectedPendingHandoffId
      ? this.findStoredHandoff(input.expectedPendingHandoffId)
      : null;
    if (
      this.run.id !== input.runId
      || this.run.status !== "awaiting_user"
      || !this.run.kernelSessionId
      || this.run.awaitingReason !== input.awaitingReason
      || this.run.pendingHandoffId !== input.expectedPendingHandoffId
      || !this.run.pausedAt
      || this.run.pausedAt.getTime() !== input.expectedPausedAt.getTime()
      || (
        input.expectedHandoffStatus &&
        expectedHandoff?.status !== input.expectedHandoffStatus
      )
      || (
        input.expectedHandoffUpdatedAt &&
        expectedHandoff?.updatedAt.getTime() !== input.expectedHandoffUpdatedAt.getTime()
      )
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
      || !this.isExpectedHandoffCheckpointing(
        input.expectedPendingHandoffId,
        input.expectedHandoffUpdatedAt ?? null,
      )
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      ...(Object.hasOwn(input, "lastTitle") ? { lastTitle: input.lastTitle } : {}),
      ...(Object.hasOwn(input, "lastUrl") ? { lastUrl: input.lastUrl } : {}),
      updatedAt: input.now,
    };
    return this.run;
  }

  async replaceRunBrowser(input: Parameters<ComputerUseStore["replaceRunBrowser"]>[0]): Promise<ComputerRunRecord> {
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
    let handoff = input.expectedPendingHandoffId
      ? this.findStoredHandoff(input.expectedPendingHandoffId)
      : null;
    if (this.expireHandoffBeforeReplaceRunBrowser && handoff) {
      handoff = this.storeHandoff({
        ...handoff,
        status: "expired",
        updatedAt: input.now,
      });
    }
    if (
      this.advanceHandoffClaimBeforeRejectReplaceRunBrowser &&
      handoff
    ) {
      handoff = this.storeHandoff({
        ...handoff,
        updatedAt: new Date("2026-06-17T12:06:00.000Z"),
      });
    }
    if (
      this.rejectReplaceRunBrowser
      || this.run.id !== input.runId
      || this.run.memberId !== input.memberId
      || this.run.expiresAt <= input.now
      || this.run.pendingHandoffId !== input.expectedPendingHandoffId
      || this.run.status !== "awaiting_user"
      || !this.isExpectedHandoffCheckpointing(
        input.expectedPendingHandoffId,
        input.expectedHandoffUpdatedAt ?? null,
      )
    ) {
      throw staleRunStateError();
    }
    if (this.run.kernelSessionId !== null) {
      if (
        this.run.kernelSessionId === input.kernelSessionId &&
        this.run.kernelLiveViewUrlEncrypted === input.kernelLiveViewUrlEncrypted
      ) {
        return this.run;
      }
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
      kernelSessionId: input.kernelSessionId,
      updatedAt: input.now,
    };
    if (this.failAfterReplaceRunBrowser) {
      this.failAfterReplaceRunBrowser = false;
      throw new Error("replaceRunBrowser failed after write");
    }
    return this.run;
  }

  async updateRunBrowserState(input: Parameters<ComputerUseStore["updateRunBrowserState"]>[0]): Promise<void> {
    if (this.failNextUpdateRunBrowserState) {
      this.failNextUpdateRunBrowserState = false;
      throw new Error("updateRunBrowserState failed");
    }
    if (this.completeRunBeforeUpdateBrowserState) {
      this.completeRunBeforeUpdateBrowserState = false;
      this.run = {
        ...this.run,
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: new Date("2026-06-17T12:05:00.000Z"),
        lastTitle: null,
        lastUrl: null,
        pendingHandoffId: null,
        status: "completed",
        suggestedReply: null,
        updatedAt: new Date("2026-06-17T12:05:00.000Z"),
      };
    }
    if (
      this.run.id !== input.runId ||
      this.run.kernelSessionId !== input.expectedKernelSessionId ||
      (
        this.run.status !== "running" &&
        this.run.status !== "awaiting_user" &&
        this.run.status !== "cleanup_pending"
      )
    ) {
      return;
    }
    this.run = {
      ...this.run,
      lastTitle: input.lastTitle,
      lastUrl: input.lastUrl,
    };
  }

  async findHandoffByRun(input: Parameters<ComputerUseStore["findHandoffByRun"]>[0]): Promise<ComputerHandoffRecord | null> {
    const handoff = this.findStoredHandoff(input.handoffId);
    return handoff && handoff.runId === input.runId
      ? handoff
      : null;
  }

  async markRunExpired(
    input: Parameters<ComputerUseStore["markRunExpired"]>[0],
  ): ReturnType<ComputerUseStore["markRunExpired"]> {
    let run = this.findStoredRun(input.runId) ?? this.run;
    if (this.completeRunBeforeMarkExpired) {
      run = this.storeRun({
        ...run,
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: input.now,
        lastTitle: null,
        lastUrl: null,
        pendingHandoffId: null,
        status: "completed",
        suggestedReply: null,
        updatedAt: input.now,
      });
    }
    let expired = false;
    if (
      run.id !== input.runId
      || run.kernelSessionId !== input.expectedKernelSessionId
      || (
        run.status !== "running" &&
        run.status !== "awaiting_user" &&
        run.status !== "cleanup_pending"
      )
    ) {
      return {
        expired,
        run,
      };
    }
    expired = true;
    run = this.storeRun({
      ...run,
      awaitingMessage: null,
      awaitingReason: null,
      completedAt: input.now,
      lastTitle: null,
      lastUrl: null,
      pendingHandoffId: null,
      status: "expired",
      suggestedReply: null,
      updatedAt: input.now,
    });
    return {
      expired,
      run,
    };
  }

  async markRunCleanupPending(input: Parameters<ComputerUseStore["markRunCleanupPending"]>[0]): Promise<ComputerRunRecord> {
    if (this.replaceBrowserBeforeMarkRunCleanupPending) {
      this.replaceBrowserBeforeMarkRunCleanupPending = false;
      this.run = {
        ...this.run,
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
        status: "awaiting_user",
        updatedAt: input.now,
      };
    }
    const hasExpectedPendingHandoffId = Object.hasOwn(input, "expectedPendingHandoffId");
    const expectedRunStatus = input.expectedRunStatus ?? "running";
    const expectedHandoff = input.expectedPendingHandoffId
      ? this.findStoredHandoff(input.expectedPendingHandoffId)
      : null;
    if (
      this.run.id !== input.runId ||
      this.run.kernelSessionId !== null ||
      this.run.status !== expectedRunStatus ||
      (!input.expectedRunStatus && this.run.expiresAt <= input.now) ||
      (
        hasExpectedPendingHandoffId &&
        this.run.pendingHandoffId !== (input.expectedPendingHandoffId ?? null)
      ) ||
      (
        input.expectedHandoffStatus &&
        expectedHandoff?.status !== input.expectedHandoffStatus
      ) ||
      (
        input.expectedHandoffUpdatedAt &&
        expectedHandoff?.updatedAt.getTime() !== input.expectedHandoffUpdatedAt.getTime()
      )
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      awaitingMessage: null,
      awaitingReason: null,
      lastTitle: null,
      lastUrl: null,
      pendingHandoffId: null,
      status: "cleanup_pending",
      suggestedReply: null,
      updatedAt: input.now,
    };
    return this.run;
  }

  async finishRun(input: Parameters<ComputerUseStore["finishRun"]>[0]): Promise<ComputerRunRecord> {
    if (input.expectedCompletedHandoffId) {
      const handoff = this.findStoredHandoff(input.expectedCompletedHandoffId);
      if (
        this.run.pendingHandoffId !== input.expectedCompletedHandoffId ||
        !handoff ||
        handoff.status !== "completed"
      ) {
        throw staleRunStateError();
      }
    }
    if (
      this.run.id !== input.runId
      || this.run.kernelSessionId !== input.expectedKernelSessionId
      || (input.expectedRunStatus && this.run.status !== input.expectedRunStatus)
      || (!input.expectedRunStatus && this.run.status !== "running" && this.run.status !== "awaiting_user")
    ) {
      throw staleRunStateError();
    }
    this.run = {
      ...this.run,
      awaitingMessage: null,
      awaitingReason: null,
      completedAt: input.now,
      ...(input.terminalBrowserCleanupId ? { kernelSessionId: input.terminalBrowserCleanupId } : {}),
      lastTitle: null,
      lastUrl: null,
      pendingHandoffId: null,
      status: input.outcome,
      suggestedReply: null,
      updatedAt: input.now,
    };
    return this.run;
  }

  async clearTerminalRunBrowser(
    input: Parameters<ComputerUseStore["clearTerminalRunBrowser"]>[0],
  ): Promise<ComputerRunRecord> {
    const run = this.findStoredRun(input.runId) ?? this.run;
    if (
      run.id === input.runId &&
      run.kernelSessionId === input.expectedKernelSessionId &&
      (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "expired" ||
        run.status === "canceled"
      )
    ) {
      return this.storeRun({
        ...run,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        updatedAt: input.now,
      });
    }
    return run;
  }

  private findStoredRun(runId: string): ComputerRunRecord | null {
    return this.memberRuns?.find((run) => run.id === runId) ??
      (this.run.id === runId ? this.run : null);
  }

  private findStoredHandoff(handoffId: string): ComputerHandoffRecord | null {
    return this.handoffs.find((handoff) => handoff.id === handoffId) ?? null;
  }

  private storeHandoff(
    handoff: ComputerHandoffRecord,
    input: { active?: boolean } = {},
  ): ComputerHandoffRecord {
    const index = this.handoffs.findIndex((stored) => stored.id === handoff.id);
    if (index === -1) {
      this.handoffs.push(handoff);
    } else {
      this.handoffs[index] = handoff;
    }
    if (input.active || this.handoff?.id === handoff.id) {
      this.handoff = handoff;
    }
    return handoff;
  }

  private storeRun(run: ComputerRunRecord): ComputerRunRecord {
    if (this.run.id === run.id) {
      this.run = run;
    }
    this.storeMemberRun(run);
    return run;
  }

  private storeMemberRun(run: ComputerRunRecord): void {
    if (!this.memberRuns) {
      return;
    }
    this.memberRuns = [
      ...this.memberRuns.filter((storedRun) => storedRun.id !== run.id),
      run,
    ];
  }

  private isExpectedHandoffCheckpointing(
    handoffId: string | null,
    expectedUpdatedAt?: Date | null,
  ): boolean {
    const handoff = handoffId ? this.findStoredHandoff(handoffId) : null;
    return !handoffId
      || Boolean(
        handoff &&
        handoff.status === "checkpointing" &&
        (!expectedUpdatedAt ||
          handoff.updatedAt.getTime() === expectedUpdatedAt.getTime()),
      );
  }
}

const fakeKernel = createFakeKernel();

function createFakeKernel(input: {
  createBrowserResults?: Array<"fail" | "ok">;
  deleteBrowserResults?: Array<"fail" | "ok">;
  executeResultForCall?: (
    input: Parameters<ComputerKernelClient["executePlaywright"]>[0],
    callIndex: number,
  ) => unknown;
  executeResults?: unknown[];
  executeResult?: unknown;
  liveViewUrlForBrowser?: (browserCount: number) => string;
  onExecutePlaywright?: (
    input: Parameters<ComputerKernelClient["executePlaywright"]>[0],
    callIndex: number,
  ) => void;
  onDeleteBrowserByIdOrName?: (sessionId: string) => void;
} = {}): ComputerKernelClient & {
  createdBrowserInputs: Parameters<ComputerKernelClient["createBrowser"]>[0][];
  createdSessionIds: string[];
  deletedProfileNames: string[];
  deletedSessionIds: string[];
  ensureBrowserViewportInputs:
    Parameters<ComputerKernelClient["ensureBrowserViewport"]>[0][];
  executePlaywrightCalls: number;
  executePlaywrightInputs: Parameters<ComputerKernelClient["executePlaywright"]>[0][];
} {
  let browserCount = 1;
  const createBrowserResults = [...(input.createBrowserResults ?? [])];
  const deleteBrowserResults = [...(input.deleteBrowserResults ?? [])];
  const executeResults = [...(input.executeResults ?? [])];
  return {
    createdBrowserInputs: [],
    createdSessionIds: [],
    deletedProfileNames: [],
    deletedSessionIds: [],
    ensureBrowserViewportInputs: [],
    executePlaywrightCalls: 0,
    executePlaywrightInputs: [],
    async createBrowser(browserInput) {
      this.createdBrowserInputs.push(browserInput);
      const result = createBrowserResults.shift() ?? "ok";
      if (result === "fail") {
        throw new Error("createBrowser failed");
      }
      browserCount += 1;
      this.createdSessionIds.push(`kernel-session-${browserCount}`);
      return {
        liveViewUrl: input.liveViewUrlForBrowser?.(browserCount)
          ?? `https://proxy.test-browser.onkernel.com:8443/live/${browserCount}`,
        sessionId: `kernel-session-${browserCount}`,
      };
    },
    async deleteBrowserByIdOrName(sessionId: string) {
      this.deletedSessionIds.push(sessionId);
      const result = deleteBrowserResults.shift() ?? "ok";
      if (result === "fail") {
        throw new Error("deleteBrowser failed");
      }
      input.onDeleteBrowserByIdOrName?.(sessionId);
    },
    async deleteProfile(name: string) {
      this.deletedProfileNames.push(name);
    },
    async ensureBrowserViewport(viewportInput) {
      this.ensureBrowserViewportInputs.push(viewportInput);
    },
    async ensureProfile() {},
    async executePlaywright(executeInput) {
      const callIndex = this.executePlaywrightCalls;
      this.executePlaywrightCalls += 1;
      this.executePlaywrightInputs.push(executeInput);
      input.onExecutePlaywright?.(executeInput, callIndex);
      return {
        result: input.executeResultForCall?.(executeInput, callIndex)
          ?? executeResults.shift()
          ?? input.executeResult
          ?? {
          title: "Page",
          url: "https://example.test",
          visibleText: "Page text",
        },
      };
    },
    async osControl() {},
  };
}

function createFakeCrypto(input: {
  decryptedRunSecret: string | null;
}): ComputerUseCrypto & {
  decryptRunSecretCalls: number;
} {
  return {
    decryptRunSecretCalls: 0,
    async decryptRunSecret() {
      this.decryptRunSecretCalls += 1;
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

function createHandoffRecord(overrides: Partial<ComputerHandoffRecord> = {}): ComputerHandoffRecord {
  return {
    completedAt: null,
    expiresAt: new Date("2026-06-17T12:20:00.000Z"),
    id: "hch_handoff123",
    memberId: "member_123",
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
    id: "hcr_run123",
    kernelLiveViewUrlEncrypted: "encrypted-live-view",
    kernelProfileName: "murph-test-member",
    kernelSessionId: "kernel-session-1",
    lastTitle: "Scheduler",
    lastUrl: "https://dentist.example.test",
    memberId: "member_123",
    pausedAt: null,
    pendingHandoffId: null,
    status: "running",
    suggestedReply: null,
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

function isStaleRunForCleanup(
  run: ComputerRunRecord,
  now: Date,
): boolean {
  if (
    run.expiresAt <= now &&
    (
      run.status === "running" ||
      run.status === "awaiting_user" ||
      run.status === "cleanup_pending"
    )
  ) {
    return true;
  }

  return Boolean(
    run.kernelSessionId &&
      (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "expired" ||
        run.status === "canceled"
      )
  );
}

function selectActiveRunForTest(
  runs: readonly ComputerRunRecord[],
  memberId: string,
  now: Date,
): ComputerRunRecord | null {
  return runs.find((run) =>
    run.memberId === memberId &&
    run.expiresAt > now &&
    (
      run.status === "running" ||
      run.status === "awaiting_user" ||
      run.status === "cleanup_pending"
    )
  ) ?? null;
}
