import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import type {
  ComputerUseCrypto,
} from "../src/lib/computer-use/crypto";
import type {
  ComputerKernelClient,
  KernelManagedAuthConnection,
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
      pauseDeliveryContext: {
        conversationId: null,
        recipientKey: null,
        returnContactKind: "email",
      },
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
      returnContactKind: "email",
      runId: "hcr_run123",
      status: "open",
      suggestedReply: "done",
    });
    expect(store.handoff?.tokenHash).toHaveLength(64);
  });

  it("requires a fresh persisted HTTPS browser domain before creating a managed-login handoff", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({
      lastUrl: "https://old.example/account",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ run });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Target login",
        url: "https://target.example/login?step=1#ignored",
        visibleText: "Sign in",
      },
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    const result = await service.pauseForUser({
      handoffPurpose: "managed_login",
      memberId: "member_123",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      lastTitle: "Target login",
      lastUrl: "https://target.example/login",
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      purpose: "managed_login",
      status: "open",
    });
  });

  it("does not create a managed-login handoff when the fresh browser domain cannot be persisted", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({
      lastUrl: "https://old.example/account",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      failNextUpdateRunBrowserState: true,
      run,
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Target login",
        url: "https://target.example/login",
        visibleText: "Sign in",
      },
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "managed_login",
      memberId: "member_123",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
      retryable: true,
    });
    expect(store.handoff).toBeNull();
    expect(store.run).toMatchObject({
      lastUrl: "https://old.example/account",
      pendingHandoffId: null,
      status: "running",
    });
  });

  it("rejects managed-login handoffs for non-login pause reasons before creating a handoff", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const run = createRunRecord({
      lastUrl: "https://checkout.example/pay",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({ run });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "managed_login",
      memberId: "member_123",
      reason: "payment_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_LOGIN_REQUIRES_LOGIN_NEEDED",
      retryable: true,
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.handoff).toBeNull();
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      status: "running",
    });
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

  it("rotates and completes only the exact setup-owned handoff without a reply channel", async () => {
    let now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
        updatedAt: now,
      }),
    });
    const requestProviderSetupContinuation = vi.fn(async () => undefined);
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: "https://proxy.test-browser.onkernel.com:8443/live/1",
      }),
      env: { HOSTED_WEB_BASE_URL: "https://web.example.test" },
      kernel: fakeKernel,
      now: () => now,
      requestProviderSetupContinuation,
      store,
    });
    const pause = () => service.pauseOwnedRunForUser({
      handoffPurpose: "manual_browser_help",
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      reason: "other",
      runId: "hcr_run123",
      suggestedReply: "done",
    });

    const first = await pause();
    expect(first.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
    expect(store.handoff).toMatchObject({
      id: "hch_handoff123",
      purpose: "manual_browser_help",
      returnContactKind: null,
      status: "open",
    });

    now = new Date("2026-06-17T12:05:00.000Z");
    const refreshed = await pause();
    expect(refreshed.handoffUrl).not.toBe(first.handoffUrl);
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff123"))
      .toMatchObject({ status: "expired" });
    expect(store.handoff).toMatchObject({
      id: "hch_handoff124",
      purpose: "manual_browser_help",
      status: "open",
    });

    now = new Date("2026-06-17T12:26:00.000Z");
    const afterExpiry = await pause();
    expect(afterExpiry.handoffUrl).not.toBe(refreshed.handoffUrl);
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff124"))
      .toMatchObject({ status: "expired" });
    expect(store.handoff).toMatchObject({
      id: "hch_handoff125",
      purpose: "manual_browser_help",
      status: "open",
    });

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "synthetic-current-token",
    })).resolves.toMatchObject({
      description: expect.stringContaining("developer prerequisite"),
      kind: "open",
      title: "Continue provider setup",
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "synthetic-current-token",
    })).resolves.toEqual({
      redirectTo: "/connect",
      returnContactKind: null,
      status: "completed",
      suggestedReply: null,
    });
    expect(requestProviderSetupContinuation).toHaveBeenCalledWith({
      handoffId: "hch_handoff125",
      memberId: "member_123",
      runId: "hcr_run123",
      setupId: "dps_setup123",
    });
    expect(store.run).toMatchObject({
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      pendingHandoffId: null,
      status: "running",
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "synthetic-current-token",
    })).resolves.toEqual({
      redirectTo: "/connect",
      returnContactKind: null,
      status: "completed",
      suggestedReply: null,
    });
    expect(requestProviderSetupContinuation).toHaveBeenCalledTimes(2);
    expect(requestProviderSetupContinuation).toHaveBeenNthCalledWith(2, {
      handoffId: "hch_handoff125",
      memberId: "member_123",
      runId: "hcr_run123",
      setupId: "dps_setup123",
    });
    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "synthetic-current-token",
    })).resolves.toEqual({ kind: "redirect", url: "/connect" });
  });

  it("rotates the capability for a browserless managed-login handoff when pause is retried", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const oldHandoff = createHandoffRecord({
      id: "hch_handoff123",
      purpose: "managed_login",
      status: "open",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: oldHandoff,
      run: createRunRecord({
        awaitingMessage: "Secure login is open.",
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: oldHandoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel,
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

    expect(result).toEqual({
      awaitingReason: "login_needed",
      handoffUrl: expect.stringMatching(
        /^https:\/\/web\.example\.test\/computer\/handoff\/mch_/u,
      ),
      runId: "hcr_run123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(kernel.createdBrowserInputs).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      pendingHandoffId: "hch_handoff123",
      status: "awaiting_user",
    });
    expect(store.handoffs.find((handoff) => handoff.id === "hch_handoff123")).toMatchObject({
      purpose: "managed_login",
      status: "open",
    });
    expect(store.handoff?.tokenHash).not.toBe(oldHandoff.tokenHash);
    expect(store.handoff?.updatedAt).toEqual(oldHandoff.updatedAt);
    expect(store.handoffs).toHaveLength(1);
  });

  it("rotates a stale managed-login recovery capability without refreshing its claim", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const staleClaim = createHandoffRecord({
      id: "hch_handoff123",
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff: staleClaim,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        pausedAt: staleClaim.updatedAt,
        pendingHandoffId: staleClaim.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      env: { HOSTED_WEB_BASE_URL: "https://web.example.test" },
      kernel,
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "managed_login",
      memberId: "member_123",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).resolves.toEqual({
      awaitingReason: "login_needed",
      handoffUrl: expect.stringMatching(
        /^https:\/\/web\.example\.test\/computer\/handoff\/mch_/u,
      ),
      runId: "hcr_run123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(kernel.createdBrowserInputs).toEqual([]);
    expect(store.handoff).toMatchObject({
      id: staleClaim.id,
      status: "checkpointing",
      updatedAt: staleClaim.updatedAt,
    });
    expect(store.handoff?.tokenHash).not.toBe(staleClaim.tokenHash);
    expect(store.handoffs).toHaveLength(1);
  });

  it("does not rotate a managed-login capability during a fresh controller claim", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      id: "hch_handoff123",
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      env: { HOSTED_WEB_BASE_URL: "https://web.example.test" },
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.pauseForUser({
      handoffPurpose: "managed_login",
      memberId: "member_123",
      reason: "login_needed",
      runId: "hcr_run123",
      suggestedReply: "done",
    })).resolves.toEqual({
      awaitingReason: "login_needed",
      handoffUrl: null,
      runId: "hcr_run123",
      status: "awaiting_user",
      suggestedReply: null,
    });
    expect(store.handoff).toEqual(handoff);
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
      returnContactKind: "email",
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
        returnContactKind: "telegram",
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
      returnContactKind: "email",
      status: "open",
      suggestedReply: "yes",
    });
  });

  it("replaces a legacy stored static-preview handoff with manual browser help", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const oldHandoff = createHandoffRecord({
      id: "hch_handoff123",
      purpose: "screen_inspection",
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
      handoffPurpose: "manual_browser_help",
      memberId: "member_123",
      pauseDeliveryContext: {
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
        returnContactKind: null,
      },
      reason: "final_confirmation",
      runId: "hcr_run123",
      suggestedReply: null,
    });

    expect(result).toMatchObject({
      awaitingReason: "final_confirmation",
      suggestedReply: "yes",
    });
    expect(result.handoffUrl).toMatch(
      /^https:\/\/web\.example\.test\/computer\/handoff\/[A-Za-z0-9_-]+$/u,
    );
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
        returnContactKind: null,
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

  it("mints a live handoff for an already-awaiting final confirmation", async () => {
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
      handoffPurpose: "manual_browser_help",
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
      purpose: "manual_browser_help",
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

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
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
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toBeNull();
  });

  it("captures provider credentials only inside the seal callback and scrubs browser results", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const capturedCredentials = {
      clientId: randomUUID(),
      clientSecret: randomUUID(),
    };
    const credentialResult = {
      result: { ...capturedCredentials },
      title: "Provider application",
      url: "https://provider.example.test/settings/application",
    };
    const kernel = createFakeKernel({ executeResult: credentialResult });
    const store = new FakeComputerUseStore({
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
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await service.captureAndSealProviderCredentials({
      code: "return await captureProviderCredentialsInsideTrustedBoundary();",
      consume: async (credentials) => {
        expect(credentials).toEqual(capturedCredentials);
        return { applicationId: "dpa_synthetic", revision: 7 };
      },
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      title: "Provider application",
      url: "https://provider.example.test/settings/application",
      value: { applicationId: "dpa_synthetic", revision: 7 },
    });
    expect(JSON.stringify(result)).not.toContain(capturedCredentials.clientId);
    expect(JSON.stringify(result)).not.toContain(capturedCredentials.clientSecret);
    expect(credentialResult.result).toEqual({ clientId: "", clientSecret: "" });
    expect(JSON.stringify(store.run)).not.toContain(capturedCredentials.clientSecret);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(capturedCredentials.clientSecret);
    expect(JSON.stringify(warningLog.mock.calls)).not.toContain(capturedCredentials.clientSecret);
    expect(kernel.executePlaywrightInputs[0]?.code).not.toContain(
      capturedCredentials.clientSecret,
    );

    errorLog.mockRestore();
    warningLog.mockRestore();
  });

  it("classifies trusted pre-submit capture failure without sealing credentials", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const kernel = createFakeKernel({
      executeResult: {
        result: { kind: "pre_submit_failed" },
        title: "Provider application",
        url: "https://provider.example.test/settings/application",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store: new FakeComputerUseStore({
        run: createRunRecord({ updatedAt: now }),
      }),
    });
    const consume = vi.fn(async () => ({ applicationId: "dpa_unreachable" }));

    await expect(service.captureAndSealProviderCredentials({
      code: "return await captureProviderCredentialsInsideTrustedBoundary();",
      consume,
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_PRE_SUBMIT_FAILED",
      retryable: true,
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("classifies trusted recovery absence without sealing credentials", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const kernel = createFakeKernel({
      executeResult: {
        result: { kind: "no_application" },
        title: "Provider applications",
        url: "https://provider.example.test/settings/application",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store: new FakeComputerUseStore({
        run: createRunRecord({ updatedAt: now }),
      }),
    });
    const consume = vi.fn(async () => ({ applicationId: "dpa_unreachable" }));

    await expect(service.captureAndSealProviderCredentials({
      code: "return await inspectProviderApplicationInsideTrustedBoundary();",
      consume,
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_PROVIDER_CREDENTIAL_CAPTURE_NO_APPLICATION",
      retryable: true,
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("scrubs malformed provider credential execution results before rejecting them", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const malformedCredentials = {
      clientId: randomUUID(),
      clientSecret: randomUUID(),
    };
    const malformedResult = {
      nested: { ...malformedCredentials },
    };
    const kernel = createFakeKernel({ executeResult: malformedResult });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store: new FakeComputerUseStore({
        run: createRunRecord({ updatedAt: now }),
      }),
    });
    const consume = vi.fn(async () => ({ applicationId: "dpa_unreachable" }));

    await expect(service.captureAndSealProviderCredentials({
      code: "return await captureProviderCredentialsInsideTrustedBoundary();",
      consume,
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_ACT_RESULT_INVALID",
    });
    expect(consume).not.toHaveBeenCalled();
    expect(malformedResult.nested).toEqual({ clientId: "", clientSecret: "" });
    expect(JSON.stringify(malformedResult)).not.toContain(malformedCredentials.clientId);
    expect(JSON.stringify(malformedResult)).not.toContain(malformedCredentials.clientSecret);
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

  it("opens a fresh browser run and returns current page state", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const kernel = createFakeKernel({
      executeResults: [
        {
          navigated: true,
        },
        {
          title: "Dentist portal",
          url: "https://dentist.example.test/book",
          visibleText: "Choose an appointment",
        },
      ],
    });
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:55:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
        updatedAt: new Date("2026-06-17T11:55:00.000Z"),
      }),
    });
    const service = new ComputerUseService({
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      },
      kernel,
      now: () => now,
      store,
    });

    const result = await service.openRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test/book",
    });

    expect(result).toMatchObject({
      reused: false,
      status: "running",
      title: "Dentist portal",
      url: "https://dentist.example.test/book",
      visibleText: "Choose an appointment",
    });
    expect(result.runId).toMatch(/^hcr_[a-f0-9]{32}$/u);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(kernel.executePlaywrightInputs[0]?.code ?? "").toContain(
      "https://dentist.example.test/book",
    );
    expect(kernel.executePlaywrightCalls).toBe(2);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      lastTitle: "Dentist portal",
      lastUrl: "https://dentist.example.test/book",
      status: "running",
    });
  });

  it("does not restore terminal URL or title from a stale open result", async () => {
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

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).resolves.toMatchObject({
      title: "Checkout",
      url: "https://shop.example.test/checkout",
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

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run.status).toBe("awaiting_user");
  });

  it("opens a completed handoff and returns the current browser state", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      completedAt: new Date("2026-06-17T12:04:00.000Z"),
      purpose: "managed_login",
      status: "completed",
      updatedAt: new Date("2026-06-17T12:04:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingMessage: "Secure login is open.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel({
        executeResult: {
          title: "Account",
          url: "https://shop.example.test/account",
          visibleText: "Signed in",
        },
      }),
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
      title: "Account",
      url: "https://shop.example.test/account",
      visibleText: "Signed in",
    });
    expect(store.run).toMatchObject({
      awaitingReason: null,
      pendingHandoffId: null,
      status: "running",
    });
    expect(store.handoff).toMatchObject({
      status: "completed",
    });
  });

  it("keeps a marked completed fallback locked until a later mailbox sequence", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const replyBoundarySeq = 41n;
    const handoff = createHandoffRecord({
      completedAt: new Date("2026-06-17T12:04:00.000Z"),
      purpose: "login",
      status: "completed",
      updatedAt: new Date("2026-06-17T12:04:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem({
        laneSeq: replyBoundarySeq,
      })],
      run: createRunRecord({
        awaitingMessage: "Secure login is open.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        resumeAfterMailboxLaneSeq: replyBoundarySeq,
        status: "awaiting_user",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Account",
        url: "https://shop.example.test/account",
        visibleText: "Signed in",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });
    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run).toMatchObject({
      resumeAfterMailboxLaneSeq: replyBoundarySeq,
      status: "awaiting_user",
    });

    store.resumeMailboxItems.push(createResumeMailboxItem({
      id: "hmi_later_reply",
      laneSeq: replyBoundarySeq + 1n,
    }));
    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_later_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
      title: "Account",
      url: "https://shop.example.test/account",
      visibleText: "Signed in",
    });
    expect(kernel.executePlaywrightCalls).toBe(2);
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      resumeAfterMailboxLaneSeq: null,
      status: "running",
    });
  });

  it("keeps a timed-out open checkpoint owner exclusive against a start retry", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingMessage: "Please sign in.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    let releaseReplacementRead = () => {};
    const replacementReadReleased = new Promise<void>((resolve) => {
      releaseReplacementRead = resolve;
    });
    let markReplacementReadStarted = () => {};
    const replacementReadStarted = new Promise<void>((resolve) => {
      markReplacementReadStarted = resolve;
    });
    const kernel = createFakeKernel({
      onExecutePlaywright: async (_input, callIndex) => {
        if (callIndex !== 1) {
          return;
        }
        markReplacementReadStarted();
        await replacementReadReleased;
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
    })).resolves.toMatchObject({ status: "completed" });

    const abandonedOpen = service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    });
    await replacementReadStarted;

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
      retryable: true,
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.handoff).toMatchObject({ status: "checkpointing" });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });

    releaseReplacementRead();
    await expect(abandonedOpen).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
    });
    expect(kernel.deletedSessionIds).not.toContain("kernel-session-2");
    expect(store.handoff).toMatchObject({ status: "completed" });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: null,
      status: "running",
    });
  });

  it("keeps a completed handoff locked when open cannot read the browser state", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      completedAt: new Date("2026-06-17T12:04:00.000Z"),
      purpose: "managed_login",
      status: "completed",
      updatedAt: new Date("2026-06-17T12:04:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingMessage: "Secure login is open.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel({
      onExecutePlaywright: () => {
        throw new Error("read failed");
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toThrow("read failed");

    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "completed",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("keeps an open managed-login handoff locked without resume proof", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "managed_login",
      status: "open",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingMessage: "Secure login is open.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Amazon",
        url: "https://www.amazon.com/ap/signin",
        visibleText: "Sign in or create account",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "open",
    });
  });

  it("reclaims an open handoff after hidden user reply proof", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "open",
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingMessage: "Secure login is open.",
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel({
        executeResult: {
          title: "Amazon",
          url: "https://www.amazon.com/cart",
          visibleText: "Cart",
        },
      }),
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
      title: "Amazon",
      url: "https://www.amazon.com/cart",
    });
    expect(store.run).toMatchObject({
      awaitingReason: null,
      pendingHandoffId: null,
      status: "running",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
  });

  it("reclaims an expired direct-login handoff on its first fresh reply", async () => {
    const now = new Date("2026-06-17T12:25:00.000Z");
    const handoff = createHandoffRecord({
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      purpose: "login",
      status: "expired",
      updatedAt: new Date("2026-06-17T12:20:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem({
        occurredAt: new Date("2026-06-17T12:24:00.000Z"),
      })],
      run: createRunRecord({
        awaitingReason: "final_confirmation",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const service = new ComputerUseService({
      kernel: createFakeKernel(),
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      awaitingReason: null,
      pendingHandoffId: null,
      status: "running",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
  });

  it("keeps fresh checkpointing handoffs locked during open", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
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

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run.status).toBe("awaiting_user");
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
  });

  it("opens a stale checkpointing handoff after hidden user reply proof", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Account",
        url: "https://shop.example.test/account?session=1#ignored",
        visibleText: "Signed in",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
      title: "Account",
      url: "https://shop.example.test/account",
      visibleText: "Signed in",
    });

    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      awaitingReason: null,
      lastTitle: "Account",
      lastUrl: "https://shop.example.test/account",
      pendingHandoffId: null,
      status: "running",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.lastResumeAwaitingReason).toBe("login_needed");
  });

  it("keeps a stale checkpointing handoff locked when open cannot read after hidden proof", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      onExecutePlaywright: () => {
        throw new Error("read failed");
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toThrow("read failed");

    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("does not unlock a stale checkpointing handoff if the browser session changes after read", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [
        createResumeMailboxItem({
          id: "hmi_user_reply",
          occurredAt: new Date("2026-06-17T12:04:00.000Z"),
        }),
      ],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Old browser",
        url: "https://old.example.test/account",
        visibleText: "Old session",
      },
      onExecutePlaywright: () => {
        store.run = {
          ...store.run,
          kernelLiveViewUrlEncrypted: "encrypted-new-live-view",
          kernelSessionId: "kernel-session-2",
        };
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });

    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      kernelSessionId: "kernel-session-2",
      lastTitle: "Scheduler",
      lastUrl: "https://dentist.example.test",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("keeps a stale checkpointing handoff locked without hidden user reply proof", async () => {
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
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
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

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });

    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run).toMatchObject({
      awaitingReason: "login_needed",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.lastResumeAwaitingReason).toBeNull();
  });

  it("does not reclaim browserless managed-login handoffs", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "managed_login",
      status: "open",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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

    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run.status).toBe("awaiting_user");
    expect(store.handoff).toMatchObject({
      status: "open",
    });
  });

  it("reconciles browserless managed login through the production open path", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      createdAt: new Date("2026-06-17T11:59:00.000Z"),
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        lastUrl: "https://www.amazon.com/ap/signin",
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Account",
        url: "https://www.amazon.com/account",
        visibleText: "Signed in",
      },
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T12:04:30.000Z"),
        flowStatus: "SUCCESS",
        hostedUrl: null,
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "AUTHENTICATED",
      },
    });
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: "https://browser.onkernel.com:8443/live/test",
      }),
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
      title: "Account",
      url: "https://www.amazon.com/account",
      visibleText: "Signed in",
    });

    expect(kernel.deletedSessionIds).toContain("managed-auth-browser");
    expect(kernel.createdBrowserInputs).toHaveLength(1);
    expect(store.handoff).toMatchObject({
      status: "completed",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: null,
      status: "running",
    });
  });

  it("does not generically resume a restored browser while managed login is in progress", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      createdAt: new Date("2026-06-17T11:59:00.000Z"),
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        lastUrl: "https://www.amazon.com/ap/signin",
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        updatedAt: new Date("2026-06-17T12:01:00.000Z"),
      }),
    });
    const kernel = createFakeKernel({
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/test",
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });

    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(kernel.createdBrowserInputs).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.handoff).toMatchObject({
      purpose: "managed_login",
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
  });

  it("keeps a terminal managed-login failure behind a newly rebased live-view checkpoint", async () => {
    let now = new Date("2026-06-17T12:05:00.000Z");
    const replyBoundarySeq = 41n;
    const handoff = createHandoffRecord({
      createdAt: new Date("2026-06-17T11:59:00.000Z"),
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      managedLoginFallbackReplyBoundarySeq: replyBoundarySeq,
      resumeMailboxItems: [createResumeMailboxItem({
        createdAt: new Date("2026-06-17T12:05:00.100Z"),
        laneSeq: replyBoundarySeq,
        occurredAt: new Date("2026-06-17T12:05:00.100Z"),
      })],
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        lastUrl: "https://www.amazon.com/ap/signin",
        pausedAt: new Date("2026-06-17T12:00:30.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: "Account",
        url: "https://www.amazon.com/account",
        visibleText: "Signed in",
      },
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T12:04:30.000Z"),
        flowStatus: "FAILED",
        hostedUrl: null,
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const service = new ComputerUseService({
      crypto: createFakeCrypto({
        decryptedRunSecret: "https://proxy.test-browser.onkernel.com:8443/live/2",
      }),
      kernel,
      now: () => now,
      store,
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_AWAITING_USER",
    });

    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(kernel.deletedSessionIds).toEqual([
      "managed-auth-browser",
      deterministicRunBrowserNameMatcher(),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.lastResumeAwaitingReason).toBeNull();
    expect(store.handoff).toMatchObject({
      purpose: "login",
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pausedAt: now,
      pendingHandoffId: handoff.id,
      resumeAfterMailboxLaneSeq: replyBoundarySeq,
      status: "awaiting_user",
    });

    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_REQUIRES_USER_REPLY",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run.status).toBe("awaiting_user");

    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toMatchObject({
      kind: "open",
      purpose: "login",
    });

    now = new Date("2026-06-17T12:21:00.000Z");
    await expect(service.readHandoffPageState({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toMatchObject({
      kind: "expired",
    });
    expect(store.handoff).toMatchObject({ status: "expired" });

    now = new Date("2026-06-17T12:22:00.000Z");
    store.resumeMailboxItems.push(createResumeMailboxItem({
      createdAt: new Date("2026-06-17T12:04:59.000Z"),
      id: "hmi_login_done",
      laneSeq: replyBoundarySeq + 1n,
      occurredAt: new Date("2026-06-17T12:21:30.000Z"),
    }));
    await expect(service.openRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_login_done",
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
      title: "Account",
      url: "https://www.amazon.com/account",
    });
    expect(kernel.executePlaywrightCalls).toBe(1);
    expect(store.handoff).toMatchObject({ status: "expired" });
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      resumeAfterMailboxLaneSeq: null,
      status: "running",
    });
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
        returnContactKind: null,
      },
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RESUME_CONTEXT_MISMATCH",
    });
    expect(store.run).toMatchObject({
      status: "awaiting_user",
    });
  });

  it("resumes a legacy unscoped checkpoint with a scoped same-channel delivery context", async () => {
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
        conversationId: JSON.stringify(["telegram", "conversation-a"]),
        recipientKey: JSON.stringify(["telegram", "recipient-a"]),
        returnContactKind: "telegram",
      },
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      checkpointContext: null,
      status: "running",
    });
  });

  it("resumes a scoped checkpoint with a legacy unscoped same-channel delivery context", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const run = createRunRecord({
      awaitingReason: "login_needed",
      checkpointContext: {
        conversationId: JSON.stringify(["telegram", "conversation-a"]),
        recipientKey: JSON.stringify(["telegram", "recipient-a"]),
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
        conversationId: "conversation-a",
        recipientKey: "recipient-a",
        returnContactKind: "telegram",
      },
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      checkpointContext: null,
      status: "running",
    });
  });

  it("rejects a legacy unscoped checkpoint when the scoped delivery channel differs", async () => {
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
        conversationId: JSON.stringify(["email", "conversation-a"]),
        recipientKey: JSON.stringify(["email", "recipient-a"]),
        returnContactKind: "telegram",
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

  it("does not treat manual browser help as optional for final confirmation", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "manual_browser_help",
      status: "open",
      suggestedReply: "yes",
      updatedAt: now,
    });
    const run = createRunRecord({
      awaitingReason: "final_confirmation",
      pausedAt: new Date("2026-06-17T12:00:00.000Z"),
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
      suggestedReply: "yes",
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
      awaitingReason: "final_confirmation",
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

  it("resumes over a legacy stored static-preview handoff after user reply proof", async () => {
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
      status: "running",
    });
    expect(store.lastResumeAwaitingReason).toBe("final_confirmation");
  });

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
      status: "checkpointing",
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
    let now = new Date("2026-06-17T12:05:00.000Z");
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

    now = new Date("2026-06-17T12:07:00.001Z");
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
      startUrl: "https://dentist.example.test/intake",
    });
    expect(kernel.executePlaywrightCalls).toBe(1);

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

  it.each(["fail", "ok"] as const)(
    "keeps a reserved run retryable when immediate ambiguous provisioning cleanup is %s",
    async (deleteBrowserResult) => {
      let now = new Date("2026-06-17T12:00:00.000Z");
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
        deleteBrowserResults: [deleteBrowserResult],
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
        retryable: true,
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

      now = new Date("2026-06-17T12:02:00.001Z");
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
    },
  );

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

  it("does not return a cleanup fence acquired between active-run lookup and reservation", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const store = new FakeComputerUseStore({
      failCreateRunWithCleanupPendingRun: true,
      run: createRunRecord({
        completedAt: new Date("2026-06-17T11:00:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "completed",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      id: "hcr_concurrent_cleanup",
      status: "cleanup_pending",
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
      returnContactKind: null,
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

  it("expires legacy stored static-preview handoff pages", async () => {
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
      kind: "expired",
      returnContactKind: null,
      suggestedReply: "yes",
    });
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: handoff.id,
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
      purpose: "login",
      returnContactKind: null,
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
      description: "Take over to finish this step. Use the keyboard icon in the browser to type or paste.",
      handoffId: handoff.id,
      iframeAllow: "autoplay; clipboard-read; clipboard-write",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://proxy.test-browser.onkernel.com:8443/live/1",
      purpose: "login",
      suggestedReply: "done",
      title: "Your turn",
    });
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
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
      description: "Take over to finish this step. Use the keyboard icon in the browser to type or paste.",
      handoffId: handoff.id,
      iframeAllow: "autoplay; clipboard-read; clipboard-write",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://proxy.test-browser.onkernel.com:8443/live/1",
      purpose: "manual_browser_help",
      suggestedReply: "yes",
      title: "Your turn",
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
      returnContactKind: null,
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

  it("keeps a cleanup fence active when another finish request observes it", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "managed_login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "cleanup_pending",
        updatedAt: now,
      }),
    });
    const kernel = createFakeKernel({
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T12:10:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/test",
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "failed",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(store.handoff).toMatchObject({ status: "open" });
    expect(store.run).toMatchObject({ status: "cleanup_pending" });
    expect(kernel.deletedSessionIds).toEqual([]);
  });

  it("finishes through the managed-auth cleanup fence acquired by that request", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "managed_login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T12:10:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/test",
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "failed",
      runId: "hcr_run123",
    })).resolves.toEqual({
      ok: true,
      runId: "hcr_run123",
      status: "failed",
    });
    expect(store.handoff).toMatchObject({ status: "expired" });
    expect(store.run).toMatchObject({
      pendingHandoffId: null,
      status: "failed",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "managed-auth-browser",
      "kernel-session-1",
    ]);
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

  it("proves a warm-old resume is below the deferred-checkpoint rollback floor", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: now,
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toMatchObject({ status: "completed" });
    const completed = store.handoff;
    if (!completed) {
      throw new Error("Expected the direct-login handoff to be completed.");
    }
    expect(completed).toMatchObject({
      completedAt: now,
      status: "completed",
    });

    // Mirrors the prior bundle's completed-handoff branch: it consumed the
    // pending handoff directly, without claiming or checkpointing the browser.
    await store.markRunRunning({
      awaitingReason: "login_needed",
      expectedHandoffStatus: "completed",
      expectedHandoffUpdatedAt: completed.updatedAt,
      expectedKernelSessionId: "kernel-session-1",
      expectedPausedAt: now,
      expectedPendingHandoffId: handoff.id,
      expectedResumeAfterMailboxLaneSeq: null,
      now,
      runId: "hcr_run123",
    });

    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.createdSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      pendingHandoffId: null,
      status: "running",
    });
  });

  it("completes login handoff before retrying profile reopen on authorized resume", async () => {
    let now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    })).resolves.toEqual({
      redirectTo: null,
      returnContactKind: null,
      status: "completed",
      suggestedReply: "done",
    });
    expect(store.handoff).toMatchObject({
      status: "completed",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.createdBrowserInputs).toEqual([]);

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toThrow("createBrowser failed");
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });

    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
      retryable: true,
    });
    expect(kernel.createdBrowserInputs).toHaveLength(1);

    now = new Date("2026-06-17T12:05:00.000Z");
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: null,
      status: "running",
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
        timeoutSeconds: 3300,
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

  it("keeps the old browser attached when the claimed checkpoint dies before Kernel cleanup", async () => {
    let now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({ deleteBrowserResults: ["fail"] });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toMatchObject({ status: "completed" });

    // The first Kernel browser mutation fails after the durable claim: the
    // claim must already be recorded while the run row still points at the
    // old browser, so the login profile is never silently lost.
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
      retryable: true,
    });
    expect(store.handoff).toMatchObject({
      completedAt: new Date("2026-06-17T12:00:00.000Z"),
      status: "checkpointing",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      pendingHandoffId: handoff.id,
      status: "awaiting_user",
    });
    expect(kernel.createdSessionIds).toEqual([]);

    // While the claim is fresh, an overlapping resume stops at the durable
    // owner without any Kernel call.
    const executeCallsBeforeRetry = kernel.executePlaywrightCalls;
    const deletesBeforeRetry = kernel.deletedSessionIds.length;
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_HANDOFF_CHECKPOINTING",
      retryable: true,
    });
    expect(kernel.executePlaywrightCalls).toBe(executeCallsBeforeRetry);
    expect(kernel.deletedSessionIds).toHaveLength(deletesBeforeRetry);
    expect(kernel.createdSessionIds).toEqual([]);

    // Stale-owner recovery re-claims and completes the checkpoint from the
    // still-attached old browser.
    now = new Date("2026-06-17T12:06:00.000Z");
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "running",
    });
    expect(store.handoff).toMatchObject({ status: "completed" });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: null,
      status: "running",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
    ]);
    expect(kernel.createdBrowserInputs).toEqual([
      expect.objectContaining({
        browserName: deterministicRunBrowserNameMatcher(),
        profileName: "murph-test-member",
      }),
    ]);
    expect(kernel.deletedProfileNames).toEqual([]);
  });

  it("does not delete the member profile when suspension races with login checkpoint replacement", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "login" });
    const store = new FakeComputerUseStore({
      computerUseChecksBeforeUnavailable: 4,
      handoff,
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    })).resolves.toMatchObject({
      status: "completed",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
      "kernel-session-2",
    ]);
    expect(kernel.deletedProfileNames).toEqual([]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
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
    })).resolves.toEqual({
      redirectTo: null,
      returnContactKind: null,
      status: "completed",
      suggestedReply: "done",
    });

    expect(store.handoff).toMatchObject({
      completedAt: now,
      status: "completed",
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.createdSessionIds).toEqual([]);
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      status: "awaiting_user",
    });
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
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      redirectTo: null,
      returnContactKind: null,
      status: "completed",
      suggestedReply: "done",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      status: "running",
    });

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
      pendingHandoffId: null,
      status: "running",
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
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toEqual({
      redirectTo: null,
      returnContactKind: null,
      status: "completed",
      suggestedReply: "done",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).resolves.toMatchObject({
      status: "running",
    });

    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
    ]);
    expect(kernel.createdSessionIds).toEqual(["kernel-session-2"]);
    expect(store.handoff).toMatchObject({
      completedAt: now,
      status: "completed",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: null,
      status: "running",
    });
  });

  it("does not overwrite a newer checkpoint claim after resume replacement loses its race", async () => {
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
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
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

    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toMatchObject({
      status: "completed",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toThrow("Stale run state.");

    expect(store.handoff).toMatchObject({
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:06:00.000Z"),
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
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
      redirectTo: null,
      returnContactKind: null,
      status: "checkpointing",
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

  it("keeps an expired-link deferred checkpoint claimed for resume recovery", async () => {
    const completedAt = new Date("2026-06-17T12:04:00.000Z");
    const now = new Date("2026-06-17T12:30:00.000Z");
    const handoff = createHandoffRecord({
      completedAt,
      expiresAt: new Date("2026-06-17T12:20:00.000Z"),
      purpose: "login",
      status: "checkpointing",
      updatedAt: new Date("2026-06-17T12:05:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    })).resolves.toMatchObject({
      kind: "checkpointing",
      purpose: "login",
    });
    await expect(service.completeHandoff({
      memberId: "member_123",
      token: "handoff-token",
    })).resolves.toMatchObject({
      status: "checkpointing",
    });
    expect(store.handoff).toMatchObject({
      completedAt,
      status: "checkpointing",
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
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    })).resolves.toMatchObject({
      status: "completed",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
      "kernel-session-2",
    ]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
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
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    })).resolves.toMatchObject({
      status: "completed",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toThrow("Stale run state.");
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
      "kernel-session-2",
    ]);
    expect(store.handoff).toMatchObject({
      status: "checkpointing",
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
      resumeMailboxItems: [createResumeMailboxItem()],
      run: createRunRecord({
        awaitingReason: "login_needed",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
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
    })).resolves.toMatchObject({
      status: "completed",
    });
    await expect(service.startRun({
      memberId: "member_123",
      resumeAfterMailboxItemId: "hmi_user_reply",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });
    expect(kernel.deletedSessionIds).toEqual([
      "kernel-session-1",
      deterministicRunBrowserNameMatcher(),
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
      redirectTo: null,
      returnContactKind: null,
      status: "completed",
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

  it("cleans an expired suspended-member run without reopening foreground access", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const store = new FakeComputerUseStore({
      computerUseAvailable: false,
      run: createRunRecord({
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        status: "running",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 1,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
    await expect(service.openRun({
      memberId: "member_123",
      startUrl: null,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
  });

  it("deletes a managed-auth writer before expiring its task browser run", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "managed_login",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        lastUrl: "https://www.amazon.com/ap/signin",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T14:10:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/test",
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 1,
    });

    expect(kernel.deletedSessionIds).toEqual([
      "managed-auth-browser",
      "kernel-session-1",
    ]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("fences replacement-run admission before managed-auth provider cleanup", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "managed_login" });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        lastUrl: "https://www.amazon.com/ap/signin",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T14:10:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/test",
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const originalFindManagedAuthConnection =
      kernel.findManagedAuthConnection.bind(kernel);
    let findCalls = 0;
    let signalLookupStarted = () => {};
    let releaseLookup = () => {};
    const lookupStarted = new Promise<void>((resolve) => {
      signalLookupStarted = resolve;
    });
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    kernel.findManagedAuthConnection = async (findInput) => {
      findCalls += 1;
      signalLookupStarted();
      await lookupGate;
      return await originalFindManagedAuthConnection(findInput);
    };
    const cleanupService = new ComputerUseService({ kernel, now: () => now, store });
    const foregroundService = new ComputerUseService({ kernel, now: () => now, store });

    const cleanup = cleanupService.cleanupExpiredRuns({ now });
    await lookupStarted;
    await expect(foregroundService.startRun({
      memberId: "member_123",
      startUrl: "https://dentist.example.test",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(store.run).toMatchObject({
      pendingHandoffId: handoff.id,
      status: "cleanup_pending",
    });
    expect(kernel.createdSessionIds).toEqual([]);
    expect(findCalls).toBe(1);

    releaseLookup();
    await expect(cleanup).resolves.toEqual({ expiredRuns: 1 });
    expect(kernel.deletedSessionIds).toEqual([
      "managed-auth-browser",
      "kernel-session-1",
    ]);
  });

  it("keeps managed-auth cleanup durable when provider browser deletion fails", async () => {
    let now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "managed_login",
    });
    const store = new FakeComputerUseStore({
      handoff,
      run: createRunRecord({
        awaitingReason: "login_needed",
        expiresAt: new Date("2026-06-17T13:00:00.000Z"),
        lastUrl: "https://www.amazon.com/ap/signin",
        pausedAt: new Date("2026-06-17T12:00:00.000Z"),
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
      }),
    });
    const kernel = createFakeKernel({
      deleteBrowserResults: ["fail"],
      managedAuthConnection: {
        browserSessionId: "managed-auth-browser",
        domain: "www.amazon.com",
        flowExpiresAt: new Date("2026-06-17T14:10:00.000Z"),
        flowStatus: "IN_PROGRESS",
        hostedUrl: "https://auth.onkernel.com/login/test",
        id: "managed-auth-1",
        profileName: "murph-test-member",
        status: "NEEDS_AUTH",
      },
    });
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.cleanupExpiredRuns({ now })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_BROWSER_DELETE_FAILED",
    });
    expect(store.handoff).toMatchObject({
      status: "open",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: "kernel-session-1",
      pendingHandoffId: handoff.id,
      status: "cleanup_pending",
    });

    now = new Date("2026-06-17T14:02:00.001Z");
    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 1,
    });
    expect(kernel.deletedSessionIds).toEqual([
      "managed-auth-browser",
      "managed-auth-browser",
      "kernel-session-1",
    ]);
    expect(store.handoff).toMatchObject({
      status: "expired",
    });
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "expired",
    });
  });

  it("leaves expired runs retryable when retention browser cleanup fails", async () => {
    let now = new Date("2026-06-17T14:00:00.000Z");
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
      status: "cleanup_pending",
    });

    now = new Date("2026-06-17T14:02:00.001Z");
    await expect(service.cleanupExpiredRuns({ now })).resolves.toEqual({
      expiredRuns: 1,
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
      profilesDeleted: 3,
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
      "kernel-profile-member",
    ]);
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
      profilesDeleted: 4,
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
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
      profilesDeleted: 3,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
      "kernel-profile-member",
    ]);
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
      profilesDeleted: 3,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
      "kernel-profile-member",
    ]);
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
      profilesDeleted: 3,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
      "kernel-profile-member",
    ]);
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
      profilesDeleted: 3,
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
      "kernel-profile-member",
    ]);
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
      profilesDeleted: 3,
    });
    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
      "kernel-profile-member",
    ]);
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

  it("rejects an unrelated active browser run when a provider setup acquires ownership", async () => {
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: null,
        ownerPurpose: null,
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, store });

    await expect(service.acquireOwnedRun({
      admitRun: vi.fn(async () => undefined),
      expectedRunId: null,
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    });

    expect(kernel.createdBrowserInputs).toEqual([]);
    expect(store.createRunInputs).toEqual([]);
  });

  it("reuses only the browser run already bound to the exact provider setup", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.acquireOwnedRun({
      admitRun: vi.fn(async () => undefined),
      expectedRunId: "hcr_run123",
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    })).resolves.toMatchObject({
      reused: true,
      runId: "hcr_run123",
      status: "running",
    });

    await expect(service.acquireOwnedRun({
      admitRun: vi.fn(async () => undefined),
      expectedRunId: "hcr_run123",
      memberId: "member_123",
      ownerKey: "dps_other",
      ownerPurpose: "member_owned_provider_setup",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    });
    expect(kernel.createdBrowserInputs).toEqual([]);
  });

  it("preserves a fresh setup-owned browserless cleanup claim", async () => {
    const now = new Date("2026-06-17T12:01:59.999Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
        status: "cleanup_pending",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.reconcileOwnedBrowserProvisioningRun({
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_run123",
    })).resolves.toBe("cleanup_pending");

    expect(kernel.deletedSessionIds).toEqual([]);
    expect(store.run).toMatchObject({ status: "cleanup_pending" });
  });

  it("settles only the exact stale setup-owned browserless cleanup claim", async () => {
    const now = new Date("2026-06-17T12:02:00.001Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
        status: "cleanup_pending",
        updatedAt: new Date("2026-06-17T12:00:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.reconcileOwnedBrowserProvisioningRun({
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_run123",
    })).resolves.toBe("settled");

    expect(kernel.deletedSessionIds).toEqual([
      expect.stringMatching(/^murph-browser-hcr_run123-/u),
    ]);
    expect(store.run).toMatchObject({
      kernelSessionId: null,
      status: "failed",
    });
  });

  it("recognizes an already settled exact provisioning claim without another cleanup", async () => {
    const now = new Date("2026-06-17T12:02:00.001Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        completedAt: new Date("2026-06-17T12:02:00.000Z"),
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
        status: "failed",
        updatedAt: new Date("2026-06-17T12:02:00.000Z"),
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.reconcileOwnedBrowserProvisioningRun({
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_run123",
    })).resolves.toBe("settled");

    expect(kernel.deletedSessionIds).toEqual([]);
  });

  it.each([
    {
      completedAt: new Date("2026-06-17T11:30:00.000Z"),
      label: "terminal",
      status: "completed" as const,
    },
    {
      completedAt: null,
      label: "expired",
      status: "running" as const,
    },
  ])("creates a replacement only after the setup-bound run is $label", async ({
    completedAt,
    status,
  }) => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const terminalRun = createRunRecord({
      completedAt,
      expiresAt: new Date("2026-06-17T11:30:00.000Z"),
      id: "hcr_terminal_setup",
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      status,
      updatedAt: new Date("2026-06-17T11:30:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      memberRuns: [terminalRun],
      run: terminalRun,
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });
    const admitRun = vi.fn(async () => {
      expect(kernel.createdBrowserInputs).toEqual([]);
    });

    const result = await service.acquireOwnedRun({
      admitRun,
      expectedRunId: terminalRun.id,
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    });

    expect(result).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(result.runId).not.toBe(terminalRun.id);
    expect(store.run).toMatchObject({
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    });
    expect(admitRun).toHaveBeenCalledWith(result.runId);
    expect(kernel.createdBrowserInputs).toHaveLength(1);
  });

  it("retires a reserved setup run when durable admission loses before Kernel provisioning", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const terminalRun = createRunRecord({
      completedAt: new Date("2026-06-17T11:30:00.000Z"),
      expiresAt: new Date("2026-06-17T11:30:00.000Z"),
      id: "hcr_terminal_setup",
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      status: "completed",
      updatedAt: new Date("2026-06-17T11:30:00.000Z"),
    });
    const store = new FakeComputerUseStore({
      memberRuns: [terminalRun],
      run: terminalRun,
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.acquireOwnedRun({
      admitRun: vi.fn(async () => {
        throw Object.assign(new Error("Setup changed before run admission."), {
          code: "DEVICE_PROVIDER_SETUP_CONFLICT",
        });
      }),
      expectedRunId: terminalRun.id,
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_CONFLICT",
    });

    expect(kernel.createdBrowserInputs).toEqual([]);
    expect(kernel.executePlaywrightCalls).toBe(0);
    expect(store.run.status).toBe("failed");
    await expect(store.findActiveRunForMember({
      memberId: "member_123",
      now,
    })).resolves.toBeNull();
  });

  it("recovers an ambiguous setup-owned acquisition only when the prior binding is terminal", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const terminalRun = createRunRecord({
      completedAt: new Date("2026-06-17T11:30:00.000Z"),
      expiresAt: new Date("2026-06-17T11:30:00.000Z"),
      id: "hcr_terminal_setup",
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      status: "completed",
      updatedAt: new Date("2026-06-17T11:30:00.000Z"),
    });
    const acquiredRun = createRunRecord({
      id: "hcr_acquired_setup",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      memberRuns: [terminalRun, acquiredRun],
      run: acquiredRun,
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.acquireOwnedRun({
      admitRun: vi.fn(async () => undefined),
      expectedRunId: terminalRun.id,
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    })).resolves.toMatchObject({
      reused: true,
      runId: acquiredRun.id,
      status: "running",
    });
    expect(kernel.createdBrowserInputs).toEqual([]);
  });


  it("rejects an ambiguous setup-owned acquisition while the prior binding remains active", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const expectedRun = createRunRecord({
      id: "hcr_active_setup",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      updatedAt: now,
    });
    const candidateRun = createRunRecord({
      id: "hcr_ambiguous_candidate",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      updatedAt: now,
    });
    const store = new FakeComputerUseStore({
      memberRuns: [candidateRun, expectedRun],
      run: candidateRun,
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({
      kernel,
      now: () => now,
      store,
    });

    await expect(service.acquireOwnedRun({
      admitRun: vi.fn(async () => undefined),
      expectedRunId: expectedRun.id,
      memberId: "member_123",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    });
    expect(kernel.createdBrowserInputs).toEqual([]);
    expect(store.createRunInputs).toEqual([]);
  });

  it("rejects generic browser actions against a setup-owned run", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.act({
      code: "return await page.title();",
      memberId: "member_123",
      runId: "hcr_run123",
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_PROVIDER_SETUP_ACTION_FORBIDDEN",
    });
    expect(kernel.executePlaywrightCalls).toBe(0);
  });

  it("runs setup-owned browser controls through a redacted read-only observation", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
      }),
    });
    const kernel = createFakeKernel({
      executeResult: {
        title: null,
        url: "https://provider.example.test/",
        visibleText: 'button "Create application"',
      },
    });
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.act({
      memberId: "member_123",
      runId: "hcr_run123",
      steps: [{
        action: "click",
        target: {
          exact: true,
          kind: "role",
          name: "Create application",
          role: "button",
        },
      }],
      timeoutMs: 1_000,
    })).resolves.toEqual({
      result: { visibleText: 'button "Create application"' },
      title: null,
      url: "https://provider.example.test/",
    });

    const code = kernel.executePlaywrightInputs[0]?.code ?? "";
    expect(code).toContain('page.route("**/*"');
    expect(code).toContain('new URL("/", window.location.origin).toString()');
    expect(code).toContain("title: null");
    expect(code).not.toContain("document.body.innerText");
    expect(code).not.toContain("page.title()");
    expect(code).not.toContain("window.location.href");
  });

  it("finishes only the exact setup-owned run during prerequisite cancellation", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.finishRun({
      memberId: "member_123",
      outcome: "canceled",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    });
    await expect(service.finishOwnedRun({
      memberId: "member_123",
      outcome: "canceled",
      ownerKey: "dps_other",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    });

    await expect(service.finishOwnedRun({
      memberId: "member_123",
      outcome: "canceled",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_run123",
    })).resolves.toEqual({
      ok: true,
      runId: "hcr_run123",
      status: "canceled",
    });
    expect(store.run).toMatchObject({
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      status: "canceled",
    });
    expect(kernel.deletedSessionIds).toEqual(["kernel-session-1"]);
  });

  it("releases a completed setup-owned run for generic work and a second setup owner", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        ownerKey: "dps_setup123",
        ownerPurpose: "member_owned_provider_setup",
      }),
    });
    const kernel = createFakeKernel();
    const service = new ComputerUseService({ kernel, now: () => now, store });

    await expect(service.finishOwnedRun({
      memberId: "member_123",
      outcome: "completed",
      ownerKey: "dps_setup123",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_run123",
    })).resolves.toMatchObject({
      runId: "hcr_run123",
      status: "completed",
    });

    const generic = await service.startRun({
      memberId: "member_123",
      startUrl: null,
    });
    expect(generic).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(store.run).toMatchObject({
      ownerKey: null,
      ownerPurpose: null,
    });

    await service.finishRun({
      memberId: "member_123",
      outcome: "completed",
      runId: generic.runId,
    });
    const secondSetup = await service.acquireOwnedRun({
      admitRun: vi.fn(async () => undefined),
      expectedRunId: null,
      memberId: "member_123",
      ownerKey: "dps_second_provider",
      ownerPurpose: "member_owned_provider_setup",
    });
    expect(secondSetup).toMatchObject({
      reused: false,
      status: "running",
    });
    expect(store.run).toMatchObject({
      ownerKey: "dps_second_provider",
      ownerPurpose: "member_owned_provider_setup",
    });
    const [genericBrowser, setupBrowser] = kernel.createdBrowserInputs;
    expect(genericBrowser?.profileName).toEqual(deterministicProfileNameMatcher());
    expect(setupBrowser?.profileName).toEqual(
      deterministicProviderSetupProfileNameMatcher(),
    );
    expect(setupBrowser?.profileName).not.toBe(genericBrowser?.profileName);
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

  it("deletes the deterministic Kernel profile even when no run rows remain", async () => {
    const store = new FakeComputerUseStore({
      run: createRunRecord({
        memberId: "member_with_runs",
      }),
    });
    const kernel = createFakeKernel();
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
      profilesDeleted: 2,
    });
    expect(kernel.deletedSessionIds).toEqual([]);
    expect(kernel.deletedProfileNames).toEqual([
      deterministicProfileNameMatcher(),
      deterministicProviderSetupProfileNameMatcher(),
    ]);
  });
});

describe("PrismaComputerUseStore", () => {
  it("rejects every setup-owned run after member suspension", async () => {
    const run = createRunRecord({
      id: "hcr_setup_exact",
      memberId: "member_suspended",
      ownerKey: "dps_setup_exact",
      ownerPurpose: "member_owned_provider_setup",
    });
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findFirst: vi.fn(async () => run),
      },
      hostedMember: {
        findUnique: vi.fn(async () => ({
          id: "member_suspended",
          suspendedAt: new Date("2026-06-17T11:00:00.000Z"),
        })),
      },
    } as never);

    await expect(store.requireMemberOwnedProviderSetupRun({
      memberId: "member_suspended",
      ownerKey: "dps_setup_exact",
      ownerPurpose: "member_owned_provider_setup",
      runId: "hcr_setup_exact",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
    });
  });

  it("uses mailbox sequence as the managed fallback reply boundary", async () => {
    const findFirst = vi.fn(async () => ({ id: "hmi_user_reply" }));
    const store = new PrismaComputerUseStore({
      hostedMailboxItem: { findFirst },
    } as never);

    await expect(store.hasConversationMailboxItemAfter({
      after: new Date("2026-06-17T12:05:00.000Z"),
      afterLaneSeq: 41n,
      mailboxItemId: "hmi_user_reply",
      memberId: "member_123",
    })).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: "hmi_user_reply",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: { gt: 41n },
        userId: "member_123",
      },
    });
  });

  it("preserves timestamp reply proof for unmarked direct handoffs", async () => {
    const findFirst = vi.fn(async () => null);
    const store = new PrismaComputerUseStore({
      hostedMailboxItem: { findFirst },
    } as never);
    const pausedAt = new Date("2026-06-17T12:05:00.000Z");

    await expect(store.hasConversationMailboxItemAfter({
      after: pausedAt,
      afterLaneSeq: null,
      mailboxItemId: "hmi_user_reply",
      memberId: "member_123",
    })).resolves.toBe(false);

    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        createdAt: { gt: pausedAt },
        id: "hmi_user_reply",
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_123",
      },
    });
  });

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

  it("reclaims a stale managed checkpoint without reopening it", async () => {
    const staleUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const reclaimed = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: now,
    });
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: reclaimed.memberId }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(reclaimed)),
        findUnique: vi.fn(async () => reclaimed),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.reclaimHandoffForCompletion({
      expectedUpdatedAt: staleUpdatedAt,
      handoffId: reclaimed.id,
      memberId: reclaimed.memberId,
      now,
    })).resolves.toEqual(reclaimed);

    expect(tx.hostedComputerHandoff.updateMany).toHaveBeenCalledWith({
      data: {
        updatedAt: now,
      },
      where: {
        id: reclaimed.id,
        memberId: reclaimed.memberId,
        purpose: "managed_login",
        status: "checkpointing",
        updatedAt: staleUpdatedAt,
      },
    });
    expect(tx.hostedComputerHandoff.findUnique).toHaveBeenCalledWith({
      where: { id: reclaimed.id },
    });
  });

  it("claims a completed login checkpoint under the member lock before provider work", async () => {
    const completedAt = new Date("2026-06-17T12:04:00.000Z");
    const expectedUpdatedAt = new Date("2026-06-17T12:04:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const pausedAt = new Date("2026-06-17T12:00:00.000Z");
    const replyBoundarySeq = 41n;
    const completed = createHandoffRecord({
      completedAt,
      status: "completed",
      updatedAt: expectedUpdatedAt,
    });
    const claimed = {
      ...completed,
      status: "checkpointing" as const,
      updatedAt: now,
    };
    const tx = {
      $queryRaw: vi.fn<(
        strings: TemplateStringsArray,
        memberId: string,
      ) => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([{ id: completed.memberId }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(completed)),
        findUnique: vi.fn(async () => claimed),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.claimLoginHandoffForCheckpoint({
      expectedAwaitingReason: "login_needed",
      expectedKernelSessionId: "kernel-session-1",
      expectedPausedAt: pausedAt,
      expectedResumeAfterMailboxLaneSeq: replyBoundarySeq,
      expectedStatus: "completed",
      expectedUpdatedAt,
      handoffId: completed.id,
      memberId: completed.memberId,
      now,
      runId: completed.runId,
    })).resolves.toEqual(claimed);

    expect(tx.hostedComputerHandoff.updateMany).toHaveBeenCalledWith({
      data: {
        status: "checkpointing",
        updatedAt: now,
      },
      where: {
        completedAt: { not: null },
        id: completed.id,
        memberId: completed.memberId,
        purpose: "login",
        run: {
          is: {
            awaitingReason: "login_needed",
            expiresAt: { gt: now },
            id: completed.runId,
            kernelSessionId: "kernel-session-1",
            memberId: completed.memberId,
            pausedAt,
            pendingHandoffId: completed.id,
            resumeAfterMailboxLaneSeq: replyBoundarySeq,
            status: "awaiting_user",
          },
        },
        runId: completed.runId,
        status: "completed",
        updatedAt: expectedUpdatedAt,
      },
    });
    const lockSql = Array.from(tx.$queryRaw.mock.calls[0]?.[0] ?? []).join("?");
    expect(lockSql).toContain("hosted_member");
    expect(lockSql).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.hostedComputerHandoff.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("consumes a login checkpoint claim in the same transaction that resumes the run", async () => {
    const completedAt = new Date("2026-06-17T12:04:00.000Z");
    const claimedUpdatedAt = new Date("2026-06-17T12:05:00.000Z");
    const now = new Date("2026-06-17T12:05:30.000Z");
    const pausedAt = new Date("2026-06-17T12:00:00.000Z");
    const claimed = createHandoffRecord({
      completedAt,
      status: "checkpointing",
      updatedAt: claimedUpdatedAt,
    });
    const resumed = createRunRecord({
      awaitingReason: null,
      kernelSessionId: "kernel-session-2",
      pausedAt: null,
      pendingHandoffId: null,
      status: "running",
      updatedAt: now,
    });
    const tx = {
      $queryRaw: vi.fn<(
        strings: TemplateStringsArray,
        memberId: string,
      ) => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([{ id: claimed.memberId }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(claimed)),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedComputerRun: {
        findUnique: vi.fn(async () => resumed),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.resumeRunAfterLoginCheckpoint({
      awaitingReason: "login_needed",
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      expectedKernelSessionId: "kernel-session-2",
      expectedPausedAt: pausedAt,
      expectedResumeAfterMailboxLaneSeq: 41n,
      handoffId: claimed.id,
      memberId: claimed.memberId,
      now,
      runId: claimed.runId,
    })).resolves.toEqual(resumed);

    expect(tx.hostedComputerRun.updateMany).toHaveBeenCalledWith({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        metadataJson: Prisma.JsonNull,
        pausedAt: null,
        pendingHandoffId: null,
        resumeAfterMailboxLaneSeq: null,
        status: "running",
        suggestedReply: null,
      },
      where: {
        awaitingReason: "login_needed",
        handoffs: {
          some: {
            id: claimed.id,
            status: "checkpointing",
            updatedAt: claimedUpdatedAt,
          },
        },
        id: claimed.runId,
        kernelSessionId: "kernel-session-2",
        memberId: claimed.memberId,
        pausedAt,
        pendingHandoffId: claimed.id,
        resumeAfterMailboxLaneSeq: 41n,
        status: "awaiting_user",
      },
    });
    expect(tx.hostedComputerHandoff.updateMany).toHaveBeenCalledWith({
      data: { status: "completed" },
      where: {
        completedAt: { not: null },
        id: claimed.id,
        memberId: claimed.memberId,
        purpose: "login",
        runId: claimed.runId,
        status: "checkpointing",
        updatedAt: claimedUpdatedAt,
      },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.hostedComputerRun.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.hostedComputerRun.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.hostedComputerHandoff.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("returns no login checkpoint claim when the claim CAS misses", async () => {
    const tx = {
      $queryRaw: vi.fn<(
        strings: TemplateStringsArray,
        memberId: string,
      ) => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([{ id: "member_123" }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(createHandoffRecord())),
        findUnique: vi.fn(async () => createHandoffRecord()),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.claimLoginHandoffForCheckpoint({
      expectedAwaitingReason: "login_needed",
      expectedKernelSessionId: "kernel-session-1",
      expectedPausedAt: new Date("2026-06-17T12:00:00.000Z"),
      expectedResumeAfterMailboxLaneSeq: null,
      expectedStatus: "completed",
      expectedUpdatedAt: new Date("2026-06-17T12:04:00.000Z"),
      handoffId: "hch_handoff123",
      memberId: "member_123",
      now: new Date("2026-06-17T12:05:00.000Z"),
      runId: "hcr_run123",
    })).resolves.toBeNull();
    expect(tx.hostedComputerHandoff.findUnique).not.toHaveBeenCalled();
  });

  it("aborts the resume transaction when the login checkpoint consume misses", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:05:00.000Z");
    const tx = {
      $queryRaw: vi.fn<(
        strings: TemplateStringsArray,
        memberId: string,
      ) => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([{ id: "member_123" }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(createHandoffRecord())),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      hostedComputerRun: {
        findUnique: vi.fn(async () => createRunRecord()),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.resumeRunAfterLoginCheckpoint({
      awaitingReason: "login_needed",
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      expectedKernelSessionId: "kernel-session-2",
      expectedPausedAt: new Date("2026-06-17T12:00:00.000Z"),
      expectedResumeAfterMailboxLaneSeq: null,
      handoffId: "hch_handoff123",
      memberId: "member_123",
      now: new Date("2026-06-17T12:05:30.000Z"),
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
      retryable: true,
    });
    expect(tx.hostedComputerRun.findUnique).not.toHaveBeenCalled();
  });

  it("does not consume the login checkpoint claim when the fenced resume misses", async () => {
    const tx = {
      $queryRaw: vi.fn<(
        strings: TemplateStringsArray,
        memberId: string,
      ) => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([{ id: "member_123" }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(createHandoffRecord())),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedComputerRun: {
        findUnique: vi.fn(async () => createRunRecord()),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.resumeRunAfterLoginCheckpoint({
      awaitingReason: "login_needed",
      expectedHandoffUpdatedAt: new Date("2026-06-17T12:05:00.000Z"),
      expectedKernelSessionId: "kernel-session-2",
      expectedPausedAt: new Date("2026-06-17T12:00:00.000Z"),
      expectedResumeAfterMailboxLaneSeq: null,
      handoffId: "hch_handoff123",
      memberId: "member_123",
      now: new Date("2026-06-17T12:05:30.000Z"),
      runId: "hcr_run123",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
      retryable: true,
    });
    expect(tx.hostedComputerHandoff.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedComputerRun.findUnique).not.toHaveBeenCalled();
  });

  it("rotates a managed-login capability without refreshing its claim lease", async () => {
    const claimUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:10:00.000Z");
    const expiresAt = new Date("2026-06-17T12:30:00.000Z");
    const handoff = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
      tokenHash: "old-hash",
      updatedAt: claimUpdatedAt,
    });
    const rotated = {
      ...handoff,
      expiresAt,
      tokenHash: "new-hash",
    };
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: handoff.memberId }]),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(handoff)),
        findUnique: vi.fn(async () => rotated),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.rotateManagedLoginHandoffCapability({
      expectedStatus: "checkpointing",
      expectedTokenHash: "old-hash",
      expectedUpdatedAt: claimUpdatedAt,
      expiresAt,
      handoffId: handoff.id,
      memberId: handoff.memberId,
      now,
      runId: handoff.runId,
      tokenHash: "new-hash",
    })).resolves.toEqual(rotated);

    expect(tx.hostedComputerHandoff.updateMany).toHaveBeenCalledWith({
      data: {
        expiresAt,
        tokenHash: "new-hash",
        updatedAt: claimUpdatedAt,
      },
      where: {
        id: handoff.id,
        memberId: handoff.memberId,
        purpose: "managed_login",
        run: {
          is: {
            expiresAt: { gt: now },
            pendingHandoffId: handoff.id,
            status: "awaiting_user",
          },
        },
        runId: handoff.runId,
        status: "checkpointing",
        tokenHash: "old-hash",
        updatedAt: claimUpdatedAt,
      },
    });
  });

  it("claims task-browser cleanup under the member lock without discarding provider coordinates", async () => {
    const previousUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T14:00:00.000Z");
    const handoff = createHandoffRecord({ purpose: "managed_login" });
    const cleanupRun = createRunRecord({
      awaitingReason: "login_needed",
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      lastUrl: "https://www.amazon.com/ap/signin",
      pendingHandoffId: handoff.id,
      status: "cleanup_pending",
      updatedAt: now,
    });
    const tx = {
      $queryRaw: vi.fn<(
        strings: TemplateStringsArray,
        memberId: string,
      ) => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([{ id: cleanupRun.memberId }]),
      hostedComputerRun: {
        findUnique: vi.fn(async () => cleanupRun),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.markRunCleanupPending({
      expectedHandoffStatus: "open",
      expectedHandoffUpdatedAt: handoff.updatedAt,
      expectedKernelSessionId: "kernel-session-1",
      expectedPendingHandoffId: handoff.id,
      expectedRunStatus: "awaiting_user",
      expectedRunUpdatedAt: previousUpdatedAt,
      memberId: cleanupRun.memberId,
      now,
      runId: cleanupRun.id,
    })).resolves.toEqual(cleanupRun);

    expect(tx.hostedComputerRun.updateMany).toHaveBeenCalledWith({
      data: { status: "cleanup_pending" },
      where: {
        handoffs: {
          some: {
            id: handoff.id,
            status: "open",
            updatedAt: handoff.updatedAt,
          },
        },
        id: cleanupRun.id,
        kernelSessionId: "kernel-session-1",
        memberId: cleanupRun.memberId,
        pendingHandoffId: handoff.id,
        status: "awaiting_user",
        updatedAt: previousUpdatedAt,
      },
    });
    expect(cleanupRun).toMatchObject({
      lastUrl: "https://www.amazon.com/ap/signin",
      pendingHandoffId: handoff.id,
    });
    const lockSql = Array.from(tx.$queryRaw.mock.calls[0]?.[0] ?? []).join("?");
    expect(lockSql).toContain("WHERE id = ?");
    expect(lockSql).toContain("FOR UPDATE");
    expect(lockSql).not.toContain("suspended_at");
    expect(tx.$queryRaw.mock.calls[0]?.[1]).toBe(cleanupRun.memberId);
  });

  it("publishes a restored browser and converts managed login in one transaction", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const replyBoundarySeq = 41n;
    const claimed = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: claimedUpdatedAt,
    });
    const browserlessRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      pendingHandoffId: claimed.id,
      status: "awaiting_user",
    });
    const publishedRun = {
      ...browserlessRun,
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
    };
    const rebasedRun = {
      ...publishedRun,
      pausedAt: now,
      resumeAfterMailboxLaneSeq: replyBoundarySeq,
      updatedAt: now,
    };
    const converted = {
      ...claimed,
      purpose: "login",
      status: "open",
      updatedAt: now,
    };
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = Array.from(strings).join("?");
      return sql.includes("hosted_mailbox_lane_counter")
        ? [{ boundary: replyBoundarySeq }]
        : [{ id: "member_123" }];
    });
    const tx = {
      $queryRaw: queryRaw,
      hostedComputerHandoff: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(
            createOrdinaryComputerHandoffAccessRecord(claimed),
          )
          .mockResolvedValueOnce(claimed),
        findUnique: vi.fn(async () => converted),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedComputerRun: {
        findFirst: vi.fn(async () => browserlessRun),
        findUnique: vi.fn()
          .mockResolvedValueOnce(publishedRun)
          .mockResolvedValueOnce(rebasedRun),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    };
    const store = new PrismaComputerUseStore(prisma as never);

    await expect(store.convertManagedLoginHandoffToLogin({
      browser: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      handoffId: claimed.id,
      memberId: claimed.memberId,
      now,
      runId: claimed.runId,
    })).resolves.toEqual({
      handoff: converted,
      run: rebasedRun,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.hostedComputerRun.updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      where: {
        expiresAt: { gt: now },
        handoffs: {
          some: {
            id: claimed.id,
            status: "checkpointing",
            updatedAt: claimedUpdatedAt,
          },
        },
        id: claimed.runId,
        kernelSessionId: null,
        memberId: claimed.memberId,
        pendingHandoffId: claimed.id,
        status: "awaiting_user",
      },
    });
    expect(tx.hostedComputerRun.updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        pausedAt: now,
        resumeAfterMailboxLaneSeq: replyBoundarySeq,
      },
      where: {
        expiresAt: { gt: now },
        handoffs: {
          some: {
            id: claimed.id,
            status: "checkpointing",
            updatedAt: claimedUpdatedAt,
          },
        },
        id: claimed.runId,
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
        memberId: claimed.memberId,
        pausedAt: browserlessRun.pausedAt,
        pendingHandoffId: claimed.id,
        resumeAfterMailboxLaneSeq: null,
        status: "awaiting_user",
      },
    });
    expect(tx.hostedComputerHandoff.updateMany).toHaveBeenCalledWith({
      data: {
        purpose: "login",
        status: "open",
      },
      where: {
        id: claimed.id,
        memberId: claimed.memberId,
        purpose: "managed_login",
        runId: claimed.runId,
        status: "checkpointing",
        updatedAt: claimedUpdatedAt,
      },
    });
    const boundarySql = Array.from(queryRaw.mock.calls[0]?.[0] ?? []).join("?");
    expect(boundarySql).toContain("hosted_mailbox_lane_counter");
    expect(boundarySql).toContain("ON CONFLICT");
    expect(boundarySql).toContain("RETURNING next_seq - 1 AS boundary");
    const memberLockSql = Array.from(queryRaw.mock.calls[1]?.[0] ?? []).join("?");
    expect(memberLockSql).toContain("hosted_member");
    expect(memberLockSql).toContain("FOR UPDATE");
  });

  it("returns a typed retryable failure before locking the member when reply boundary storage fails", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const claimed = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
    });
    const queryRaw = vi.fn(async () => {
      throw new Error("database boundary failure");
    });
    const tx = {
      $queryRaw: queryRaw,
      hostedComputerHandoff: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedComputerRun: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.convertManagedLoginHandoffToLogin({
      browser: null,
      expectedHandoffUpdatedAt: claimed.updatedAt,
      handoffId: claimed.id,
      memberId: claimed.memberId,
      now,
      runId: claimed.runId,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_REPLY_BOUNDARY_UNAVAILABLE",
      message: "Computer reply boundary is temporarily unavailable.",
      retryable: true,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedComputerHandoff.findFirst).not.toHaveBeenCalled();
    expect(tx.hostedComputerRun.updateMany).not.toHaveBeenCalled();
  });

  it("does not expose a managed-login fallback when pause rebasing loses its claim", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const replyBoundarySeq = 41n;
    const claimed = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: claimedUpdatedAt,
    });
    const browserlessRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      kernelLiveViewUrlEncrypted: null,
      kernelSessionId: null,
      pendingHandoffId: claimed.id,
      status: "awaiting_user",
    });
    const publishedRun = {
      ...browserlessRun,
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
    };
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        return sql.includes("hosted_mailbox_lane_counter")
          ? [{ boundary: replyBoundarySeq }]
          : [{ id: claimed.memberId }];
      }),
      hostedComputerHandoff: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(
            createOrdinaryComputerHandoffAccessRecord(claimed),
          )
          .mockResolvedValueOnce(claimed),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedComputerRun: {
        findFirst: vi.fn(async () => browserlessRun),
        findUnique: vi.fn(async () => publishedRun),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.convertManagedLoginHandoffToLogin({
      browser: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      handoffId: claimed.id,
      memberId: claimed.memberId,
      now,
      runId: claimed.runId,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });

    expect(tx.hostedComputerRun.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.hostedComputerHandoff.updateMany).not.toHaveBeenCalled();
  });

  it("exact-replays an already converted managed-login fallback", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const replyBoundarySeq = 41n;
    const converted = createHandoffRecord({
      purpose: "login",
      status: "open",
      updatedAt: now,
    });
    const publishedRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: converted.id,
      resumeAfterMailboxLaneSeq: replyBoundarySeq,
      status: "awaiting_user",
    });
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        return sql.includes("hosted_mailbox_lane_counter")
          ? [{ boundary: replyBoundarySeq + 1n }]
          : [{ id: "member_123" }];
      }),
      hostedComputerHandoff: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(
            createOrdinaryComputerHandoffAccessRecord(converted),
          )
          .mockResolvedValueOnce(converted),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedComputerRun: {
        findFirst: vi.fn(async () => publishedRun),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.convertManagedLoginHandoffToLogin({
      browser: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      handoffId: converted.id,
      memberId: converted.memberId,
      now,
      runId: converted.runId,
    })).resolves.toEqual({
      handoff: converted,
      run: publishedRun,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.hostedComputerRun.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedComputerHandoff.updateMany).not.toHaveBeenCalled();
  });

  it("does not infer exact replay for an unmarked login handoff", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const converted = createHandoffRecord({
      purpose: "login",
      status: "open",
      updatedAt: now,
    });
    const unmarkedRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: converted.id,
      status: "awaiting_user",
    });
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        return sql.includes("hosted_mailbox_lane_counter")
          ? [{ boundary: 42n }]
          : [{ id: converted.memberId }];
      }),
      hostedComputerHandoff: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(
            createOrdinaryComputerHandoffAccessRecord(converted),
          )
          .mockResolvedValueOnce(converted),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedComputerRun: {
        findFirst: vi.fn(async () => unmarkedRun),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.convertManagedLoginHandoffToLogin({
      browser: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      handoffId: converted.id,
      memberId: converted.memberId,
      now,
      runId: converted.runId,
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    });
    expect(tx.hostedComputerRun.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedComputerHandoff.updateMany).not.toHaveBeenCalled();
  });

  it("exact-replays an already completed managed login", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const completed = createHandoffRecord({
      completedAt: now,
      purpose: "managed_login",
      status: "completed",
      updatedAt: now,
    });
    const publishedRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: completed.id,
      status: "awaiting_user",
    });
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: completed.memberId }]),
      hostedComputerHandoff: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(
            createOrdinaryComputerHandoffAccessRecord(completed),
          )
          .mockResolvedValueOnce(completed),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedComputerRun: {
        findFirst: vi.fn(async () => publishedRun),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.completeManagedLoginHandoff({
      browser: {
        kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
        kernelSessionId: "kernel-session-2",
      },
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      handoffId: completed.id,
      memberId: completed.memberId,
      now,
      runId: completed.runId,
    })).resolves.toEqual({
      handoff: completed,
      run: publishedRun,
    });
    expect(tx.hostedComputerRun.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedComputerHandoff.updateMany).not.toHaveBeenCalled();
  });

  it("completes managed login without republishing an existing task browser", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const claimed = createHandoffRecord({
      purpose: "managed_login",
      status: "checkpointing",
      updatedAt: claimedUpdatedAt,
    });
    const restoredRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      kernelLiveViewUrlEncrypted: "encrypted-live-view-2",
      kernelSessionId: "kernel-session-2",
      pendingHandoffId: claimed.id,
      status: "awaiting_user",
    });
    const completed = {
      ...claimed,
      completedAt: now,
      status: "completed",
      updatedAt: now,
    };
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "member_123" }]),
      hostedComputerHandoff: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(
            createOrdinaryComputerHandoffAccessRecord(claimed),
          )
          .mockResolvedValueOnce(claimed),
        findUnique: vi.fn(async () => completed),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedComputerRun: {
        findFirst: vi.fn(async () => restoredRun),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.completeManagedLoginHandoff({
      browser: null,
      expectedHandoffUpdatedAt: claimedUpdatedAt,
      handoffId: claimed.id,
      memberId: claimed.memberId,
      now,
      runId: claimed.runId,
    })).resolves.toEqual({
      handoff: completed,
      run: restoredRun,
    });

    expect(tx.hostedComputerRun.updateMany).not.toHaveBeenCalled();
    expect(tx.hostedComputerHandoff.updateMany).toHaveBeenCalledWith({
      data: {
        completedAt: now,
        status: "completed",
      },
      where: {
        id: claimed.id,
        memberId: claimed.memberId,
        purpose: "managed_login",
        runId: claimed.runId,
        status: "checkpointing",
        updatedAt: claimedUpdatedAt,
      },
    });
  });

  it("fences browser clear and replace by the checkpoint owner and exact updatedAt", async () => {
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
      hostedComputerHandoff: {
        findFirst: vi.fn(async () =>
          createOrdinaryComputerHandoffAccessRecord(createHandoffRecord())),
      },
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
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
        resumeAfterMailboxLaneSeq: null,
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
        resumeAfterMailboxLaneSeq: null,
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
      expectedKernelSessionId: "kernel-session-1",
      expectedPausedAt: pausedAt,
      expectedPendingHandoffId: "hch_handoff123",
      expectedResumeAfterMailboxLaneSeq: null,
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
        resumeAfterMailboxLaneSeq: null,
        status: "running",
        suggestedReply: null,
      },
      where: {
        awaitingReason: "login_needed",
        id: "hcr_run123",
        kernelSessionId: "kernel-session-1",
        pausedAt,
        pendingHandoffId: "hch_handoff123",
        resumeAfterMailboxLaneSeq: null,
        status: "awaiting_user",
      },
    });
  });

  it("fences managed fallback resume by its handoff and mailbox sequence", async () => {
    const handoffUpdatedAt = new Date("2026-06-17T12:03:00.000Z");
    const pausedAt = new Date("2026-06-17T12:02:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const replyBoundarySeq = 41n;
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
      expectedKernelSessionId: "kernel-session-1",
      expectedPausedAt: pausedAt,
      expectedPendingHandoffId: "hch_handoff123",
      expectedResumeAfterMailboxLaneSeq: replyBoundarySeq,
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
        resumeAfterMailboxLaneSeq: null,
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
        kernelSessionId: "kernel-session-1",
        pausedAt,
        pendingHandoffId: "hch_handoff123",
        resumeAfterMailboxLaneSeq: replyBoundarySeq,
        status: "awaiting_user",
      },
    });
  });

  it("clears the managed fallback mailbox sequence when the run expires", async () => {
    const now = new Date("2026-06-17T12:05:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => createRunRecord({
      completedAt: now,
      resumeAfterMailboxLaneSeq: null,
      status: "expired",
      updatedAt: now,
    }));
    const store = new PrismaComputerUseStore({
      hostedComputerRun: {
        findUnique,
        updateMany,
      },
    } as never);

    await expect(store.markRunExpired({
      expectedKernelSessionId: "kernel-session-1",
      now,
      runId: "hcr_run123",
    })).resolves.toMatchObject({
      expired: true,
      run: {
        id: "hcr_run123",
        resumeAfterMailboxLaneSeq: null,
        status: "expired",
      },
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
        resumeAfterMailboxLaneSeq: null,
        status: "expired",
        suggestedReply: null,
      },
      where: {
        id: "hcr_run123",
        kernelSessionId: "kernel-session-1",
        status: { in: ["running", "awaiting_user", "cleanup_pending"] },
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
        resumeAfterMailboxLaneSeq: null,
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
        resumeAfterMailboxLaneSeq: null,
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
        ownerKey: null,
        ownerPurpose: null,
      },
    });
    expect(trace).toEqual(["lock-member", "find-active-run", "create-run"]);
  });

  it("blocks run creation while an expired cleanup fence is still active", async () => {
    const now = new Date("2026-06-17T14:00:00.000Z");
    const cleanupRun = createRunRecord({
      expiresAt: new Date("2026-06-17T13:00:00.000Z"),
      status: "cleanup_pending",
    });
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: cleanupRun.memberId }]),
      hostedComputerRun: {
        create: vi.fn(),
        findFirst: vi.fn(async () => cleanupRun),
      },
    };
    const store = new PrismaComputerUseStore({
      $transaction: vi.fn(async <TResult>(
        callback: (transaction: typeof tx) => Promise<TResult>,
      ) => await callback(tx)),
    } as never);

    await expect(store.createRun({
      expiresAt: new Date("2026-06-17T15:00:00.000Z"),
      id: "hcr_new",
      kernelProfileName: cleanupRun.kernelProfileName,
      memberId: cleanupRun.memberId,
      now,
      startUrl: null,
    })).resolves.toEqual({
      created: false,
      run: cleanupRun,
    });
    expect(tx.hostedComputerRun.findFirst).toHaveBeenCalledWith({
      where: {
        memberId: cleanupRun.memberId,
        OR: [
          { status: "cleanup_pending" },
          {
            expiresAt: { gt: now },
            status: { in: ["running", "awaiting_user"] },
          },
        ],
      },
    });
    expect(tx.hostedComputerRun.create).not.toHaveBeenCalled();
  });

  it("locks member computer-use availability before attaching a browser to a reserved run", async () => {
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        trace.push(sql.includes("suspended_at IS NULL")
          ? "check-member-active"
          : "lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerRun: {
        findFirst: vi.fn(async () => {
          trace.push("find-run-owner");
          return createOrdinaryComputerRunAccessRecord();
        }),
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
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
    expect(trace).toEqual([
      "lock-member",
      "find-run-owner",
      "check-member-active",
      "attach-browser",
      "find-run",
    ]);
  });

  it("treats same-browser attach replay as already attached under the member lock", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        trace.push(sql.includes("suspended_at IS NULL")
          ? "check-member-active"
          : "lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerRun: {
        findFirst: vi.fn()
          .mockImplementationOnce(async () => {
            trace.push("find-run-owner");
            return createOrdinaryComputerRunAccessRecord();
          })
          .mockImplementationOnce(async () => {
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
    expect(trace).toEqual([
      "lock-member",
      "find-run-owner",
      "check-member-active",
      "attach-browser",
      "find-attached-run",
    ]);
  });

  it("treats same-browser replacement replay as already attached under the member lock", async () => {
    const claimedUpdatedAt = new Date("2026-06-17T12:00:00.000Z");
    const now = new Date("2026-06-17T12:05:00.000Z");
    const trace: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        trace.push(sql.includes("suspended_at IS NULL")
          ? "check-member-active"
          : "lock-member");
        return [{ id: "member_123" }];
      }),
      hostedComputerHandoff: {
        findFirst: vi.fn(async () => {
          trace.push("find-handoff-owner");
          return createOrdinaryComputerHandoffAccessRecord(
            createHandoffRecord(),
          );
        }),
      },
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
    expect(trace).toEqual([
      "lock-member",
      "find-handoff-owner",
      "check-member-active",
      "replace-browser",
      "find-replaced-run",
    ]);
  });
});

interface ResumeMailboxItem {
  createdAt: Date;
  id: string;
  kind: "conversation.message";
  lane: "conversation";
  laneSeq: bigint;
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
  failCreateRunWithCleanupPendingRun = false;
  failCreateRunWithConcurrentRun = false;
  failNextUpdateRunBrowserState = false;
  createRunInputs: Parameters<ComputerUseStore["createRun"]>[0][] = [];
  handoff: ComputerHandoffRecord | null = null;
  handoffs: ComputerHandoffRecord[] = [];
  lastResumeAwaitingReason: Parameters<ComputerUseStore["markRunRunning"]>[0]["awaitingReason"] | null = null;
  managedLoginFallbackReplyBoundarySeq: bigint | null = null;
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
    failCreateRunWithCleanupPendingRun?: boolean;
    failCreateRunWithConcurrentRun?: boolean;
    failNextUpdateRunBrowserState?: boolean;
    handoff?: ComputerHandoffRecord | null;
    managedLoginFallbackReplyBoundarySeq?: bigint | null;
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
    this.failCreateRunWithCleanupPendingRun =
      input.failCreateRunWithCleanupPendingRun ?? false;
    this.failCreateRunWithConcurrentRun = input.failCreateRunWithConcurrentRun ?? false;
    this.failNextUpdateRunBrowserState = input.failNextUpdateRunBrowserState ?? false;
    this.handoff = input.handoff ?? null;
    this.handoffs = this.handoff ? [this.handoff] : [];
    this.managedLoginFallbackReplyBoundarySeq =
      input.managedLoginFallbackReplyBoundarySeq ?? null;
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

  async requireMemberOwnedProviderSetupRunAcquisition(
    input: Parameters<ComputerUseStore["requireMemberOwnedProviderSetupRunAcquisition"]>[0],
  ): Promise<void> {
    if (input.memberId !== this.run.memberId) {
      throw new Error("Member not found.");
    }
    if (!this.computerUseAvailable) {
      throw Object.assign(new Error("Computer use is not available for this hosted member."), {
        code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
      });
    }
    const runs = this.memberRuns ?? [this.run];
    const now = input.now ?? new Date("2026-06-17T12:00:00.000Z");
    const exactOwner = (run: ComputerRunRecord | undefined): boolean => Boolean(
      run
      && run.memberId === input.memberId
      && run.ownerKey === input.ownerKey
      && run.ownerPurpose === input.ownerPurpose,
    );
    if (input.expectedRunId === null) {
      const activeRun = selectActiveRunForTest(runs, input.memberId, now);
      if (
        activeRun
        && (activeRun.ownerKey || activeRun.ownerPurpose)
        && !exactOwner(activeRun)
      ) {
        throw Object.assign(new Error("Browser run belongs to another operation."), {
          code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        });
      }
      if (activeRun && !activeRun.ownerKey && !activeRun.ownerPurpose) {
        throw Object.assign(new Error("Browser run belongs to another operation."), {
          code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        });
      }
      return;
    }

    const expectedRun = runs.find((run) => run.id === input.expectedRunId);
    if (!exactOwner(expectedRun)) {
      throw Object.assign(new Error("Browser run ownership does not match setup."), {
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      });
    }
    if (!input.candidateRunId) {
      return;
    }

    const candidateRun = runs.find((run) => run.id === input.candidateRunId);
    if (
      !expectedRun
      || !exactOwner(candidateRun)
      || selectActiveRunForTest([expectedRun], input.memberId, now)
      || selectActiveRunForTest(candidateRun ? [candidateRun] : [], input.memberId, now) === null
    ) {
      throw Object.assign(new Error("Browser run ownership does not match setup."), {
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      });
    }
  }

  async requireMemberOwnedProviderSetupRun(
    input: Parameters<ComputerUseStore["requireMemberOwnedProviderSetupRun"]>[0],
  ): ReturnType<ComputerUseStore["requireMemberOwnedProviderSetupRun"]> {
    if (
      input.memberId !== this.run.memberId
      || input.runId !== this.run.id
      || input.ownerKey !== this.run.ownerKey
      || input.ownerPurpose !== this.run.ownerPurpose
    ) {
      throw Object.assign(new Error("Browser run ownership does not match setup."), {
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      });
    }
    if (!this.computerUseAvailable) {
      throw Object.assign(new Error("Computer use is not available for this hosted member."), {
        code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
      });
    }
    return this.run;
  }

  async requireComputerHandoffAccess(
    input: Parameters<ComputerUseStore["requireComputerHandoffAccess"]>[0],
  ): Promise<ComputerHandoffRecord> {
    const handoff = await this.requireHandoffByTokenHash({
      tokenHash: input.tokenHash,
    });
    if (handoff.memberId !== input.memberId) {
      throw new Error("Handoff not found.");
    }
    const ownerKey = this.run.ownerKey;
    if (
      this.run.id === handoff.runId
      && this.run.memberId === input.memberId
      && this.run.ownerPurpose === "member_owned_provider_setup"
      && typeof ownerKey === "string"
      && ownerKey.length > 0
    ) {
      await this.requireMemberOwnedProviderSetupRun({
        memberId: input.memberId,
        ownerKey,
        ownerPurpose: "member_owned_provider_setup",
        runId: handoff.runId,
      });
      return handoff;
    }
    await this.requireMemberComputerUseAvailable({
      memberId: input.memberId,
    });
    return handoff;
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
      && (input.afterLaneSeq === null
        ? item.createdAt > input.after
        : item.laneSeq > input.afterLaneSeq)
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
      createdAt: new Date("2026-06-17T12:00:00.000Z"),
      expiresAt: input.expiresAt,
      id,
      memberId: input.memberId,
      purpose: input.purpose,
      returnContactKind: input.returnContactKind,
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
    if (this.failCreateRunWithCleanupPendingRun) {
      this.run = createRunRecord({
        expiresAt: input.expiresAt,
        id: "hcr_concurrent_cleanup",
        kernelLiveViewUrlEncrypted: null,
        kernelProfileName: input.kernelProfileName,
        kernelSessionId: null,
        lastTitle: null,
        lastUrl: input.startUrl,
        memberId: input.memberId,
        ownerKey: input.ownerKey ?? null,
        ownerPurpose: input.ownerPurpose ?? null,
        status: "cleanup_pending",
        updatedAt: input.now,
      });
      this.storeMemberRun(this.run);
      return {
        created: false,
        run: this.run,
      };
    }
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
        ownerKey: input.ownerKey ?? null,
        ownerPurpose: input.ownerPurpose ?? null,
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
      ownerKey: input.ownerKey ?? null,
      ownerPurpose: input.ownerPurpose ?? null,
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

  async requireHandoffByTokenHash(
    input: Parameters<ComputerUseStore["requireHandoffByTokenHash"]>[0],
  ): Promise<ComputerHandoffRecord> {
    void input;
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

  async completeManagedLoginHandoff(
    input: Parameters<ComputerUseStore["completeManagedLoginHandoff"]>[0],
  ): ReturnType<ComputerUseStore["completeManagedLoginHandoff"]> {
    const handoff = this.requireClaimedManagedLoginHandoff(input);
    this.publishManagedLoginBrowser(input);
    const completed = this.storeHandoff({
      ...handoff,
      completedAt: input.now,
      status: "completed",
      updatedAt: input.now,
    });
    return {
      handoff: completed,
      run: this.run,
    };
  }

  async convertManagedLoginHandoffToLogin(
    input: Parameters<ComputerUseStore["convertManagedLoginHandoffToLogin"]>[0],
  ): ReturnType<ComputerUseStore["convertManagedLoginHandoffToLogin"]> {
    const handoff = this.requireClaimedManagedLoginHandoff(input);
    this.publishManagedLoginBrowser(input);
    const replyBoundarySeq =
      this.managedLoginFallbackReplyBoundarySeq ?? 0n;
    this.run = {
      ...this.run,
      pausedAt: input.now,
      resumeAfterMailboxLaneSeq: replyBoundarySeq,
      updatedAt: input.now,
    };
    const converted = this.storeHandoff({
      ...handoff,
      purpose: "login",
      status: "open",
      updatedAt: input.now,
    });
    return {
      handoff: converted,
      run: this.run,
    };
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

  async claimLoginHandoffForCheckpoint(
    input: Parameters<ComputerUseStore["claimLoginHandoffForCheckpoint"]>[0],
  ): Promise<ComputerHandoffRecord | null> {
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      !handoff ||
      handoff.completedAt === null ||
      handoff.memberId !== input.memberId ||
      handoff.purpose !== "login" ||
      handoff.runId !== input.runId ||
      handoff.status !== input.expectedStatus ||
      handoff.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() ||
      this.run.awaitingReason !== input.expectedAwaitingReason ||
      this.run.expiresAt <= input.now ||
      this.run.id !== input.runId ||
      this.run.kernelSessionId !== input.expectedKernelSessionId ||
      !this.run.pausedAt ||
      this.run.pausedAt.getTime() !== input.expectedPausedAt.getTime() ||
      this.run.pendingHandoffId !== input.handoffId ||
      this.run.resumeAfterMailboxLaneSeq !==
        input.expectedResumeAfterMailboxLaneSeq ||
      this.run.status !== "awaiting_user"
    ) {
      return null;
    }
    return this.storeHandoff({
      ...handoff,
      status: "checkpointing",
      updatedAt: input.now,
    });
  }

  async reclaimHandoffForCompletion(
    input: Parameters<ComputerUseStore["reclaimHandoffForCompletion"]>[0],
  ): Promise<ComputerHandoffRecord | null> {
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      !handoff ||
      handoff.memberId !== input.memberId ||
      handoff.purpose !== "managed_login" ||
      handoff.status !== "checkpointing" ||
      handoff.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      return null;
    }
    return this.storeHandoff({
      ...handoff,
      updatedAt: input.now,
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

  async rotateManagedLoginHandoffCapability(
    input: Parameters<ComputerUseStore["rotateManagedLoginHandoffCapability"]>[0],
  ): Promise<ComputerHandoffRecord> {
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      !handoff ||
      handoff.memberId !== input.memberId ||
      handoff.runId !== input.runId ||
      handoff.purpose !== "managed_login" ||
      handoff.status !== input.expectedStatus ||
      handoff.tokenHash !== input.expectedTokenHash ||
      handoff.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() ||
      this.run.id !== input.runId ||
      this.run.pendingHandoffId !== input.handoffId ||
      this.run.status !== "awaiting_user" ||
      this.run.expiresAt <= input.now
    ) {
      throw staleRunStateError();
    }
    return this.storeHandoff({
      ...handoff,
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
    });
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
      resumeAfterMailboxLaneSeq: null,
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
      resumeAfterMailboxLaneSeq: null,
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
      resumeAfterMailboxLaneSeq: null,
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
      || this.run.kernelSessionId !== input.expectedKernelSessionId
      || this.run.awaitingReason !== input.awaitingReason
      || this.run.pendingHandoffId !== input.expectedPendingHandoffId
      || !this.run.pausedAt
      || this.run.pausedAt.getTime() !== input.expectedPausedAt.getTime()
      || this.run.resumeAfterMailboxLaneSeq !==
        input.expectedResumeAfterMailboxLaneSeq
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
      resumeAfterMailboxLaneSeq: null,
      status: "running",
      suggestedReply: null,
      updatedAt: input.now,
    };
    return this.run;
  }

  async resumeRunAfterLoginCheckpoint(
    input: Parameters<ComputerUseStore["resumeRunAfterLoginCheckpoint"]>[0],
  ): Promise<ComputerRunRecord> {
    await this.requireMemberComputerUseAvailable({ memberId: input.memberId });
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
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      !handoff ||
      handoff.completedAt === null ||
      handoff.memberId !== input.memberId ||
      handoff.purpose !== "login" ||
      handoff.runId !== input.runId ||
      handoff.status !== "checkpointing" ||
      handoff.updatedAt.getTime() !== input.expectedHandoffUpdatedAt.getTime() ||
      this.run.awaitingReason !== input.awaitingReason ||
      this.run.id !== input.runId ||
      this.run.kernelSessionId !== input.expectedKernelSessionId ||
      !this.run.pausedAt ||
      this.run.pausedAt.getTime() !== input.expectedPausedAt.getTime() ||
      this.run.pendingHandoffId !== input.handoffId ||
      this.run.resumeAfterMailboxLaneSeq !==
        input.expectedResumeAfterMailboxLaneSeq ||
      this.run.status !== "awaiting_user"
    ) {
      throw staleRunStateError();
    }
    this.storeHandoff({
      ...handoff,
      status: "completed",
      updatedAt: input.now,
    });
    this.lastResumeAwaitingReason = input.awaitingReason;
    this.run = {
      ...this.run,
      awaitingMessage: null,
      awaitingReason: null,
      checkpointContext: null,
      pausedAt: null,
      pendingHandoffId: null,
      resumeAfterMailboxLaneSeq: null,
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
      || !this.isExpectedHandoffForBrowserUpdate(
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
      || !this.isExpectedHandoffForBrowserUpdate(
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
        resumeAfterMailboxLaneSeq: null,
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
        resumeAfterMailboxLaneSeq: null,
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
      resumeAfterMailboxLaneSeq: null,
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
    const expectedHandoff = input.expectedPendingHandoffId
      ? this.findStoredHandoff(input.expectedPendingHandoffId)
      : null;
    if (
      this.run.id !== input.runId ||
      this.run.memberId !== input.memberId ||
      this.run.kernelSessionId !== input.expectedKernelSessionId ||
      this.run.status !== input.expectedRunStatus ||
      this.run.updatedAt.getTime() !== input.expectedRunUpdatedAt.getTime() ||
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
      status: "cleanup_pending",
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
      resumeAfterMailboxLaneSeq: null,
      status: input.outcome,
      suggestedReply: null,
      updatedAt: input.now,
    };
    this.storeMemberRun(this.run);
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

  private requireClaimedManagedLoginHandoff(input: {
    expectedHandoffUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): ComputerHandoffRecord {
    const handoff = this.findStoredHandoff(input.handoffId);
    if (
      !handoff ||
      handoff.memberId !== input.memberId ||
      handoff.purpose !== "managed_login" ||
      handoff.runId !== input.runId ||
      handoff.status !== "checkpointing" ||
      handoff.updatedAt.getTime() !== input.expectedHandoffUpdatedAt.getTime() ||
      this.run.expiresAt <= input.now ||
      this.run.id !== input.runId ||
      this.run.memberId !== input.memberId ||
      this.run.pendingHandoffId !== input.handoffId ||
      this.run.status !== "awaiting_user"
    ) {
      throw staleRunStateError();
    }
    return handoff;
  }

  private publishManagedLoginBrowser(input: {
    browser: Parameters<ComputerUseStore["completeManagedLoginHandoff"]>[0]["browser"];
    now: Date;
  }): void {
    if (!input.browser) {
      if (!this.run.kernelSessionId || !this.run.kernelLiveViewUrlEncrypted) {
        throw staleRunStateError();
      }
      return;
    }
    if (this.run.kernelSessionId) {
      if (
        this.run.kernelSessionId !== input.browser.kernelSessionId ||
        this.run.kernelLiveViewUrlEncrypted !==
          input.browser.kernelLiveViewUrlEncrypted
      ) {
        throw staleRunStateError();
      }
      return;
    }
    this.run = {
      ...this.run,
      kernelLiveViewUrlEncrypted: input.browser.kernelLiveViewUrlEncrypted,
      kernelSessionId: input.browser.kernelSessionId,
      updatedAt: input.now,
    };
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

  private isExpectedHandoffForBrowserUpdate(
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
  managedAuthConnection?: KernelManagedAuthConnection | null;
  onExecutePlaywright?: (
    input: Parameters<ComputerKernelClient["executePlaywright"]>[0],
    callIndex: number,
  ) => Promise<void> | void;
  onDeleteBrowserByIdOrName?: (sessionId: string) => void;
} = {}): ComputerKernelClient & {
  createdBrowserInputs: Parameters<ComputerKernelClient["createBrowser"]>[0][];
  createdSessionIds: string[];
  deletedProfileNames: string[];
  deletedSessionIds: string[];
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
    async deleteManagedAuthConnection() {},
    async ensureManagedAuthConnection(managedInput) {
      return {
        browserSessionId: null,
        domain: managedInput.domain,
        flowExpiresAt: null,
        flowStatus: null,
        hostedUrl: null,
        id: "managed-auth-1",
        profileName: managedInput.profileName,
        status: "NEEDS_AUTH" as const,
      };
    },
    async findManagedAuthConnection() {
      return input.managedAuthConnection ?? null;
    },
    async listManagedAuthConnections() {
      return [];
    },
    async startManagedAuthLogin() {
      return {
        flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
        hostedUrl: "https://auth.onkernel.com/login/test",
      };
    },
    async deleteProfile(name: string) {
      this.deletedProfileNames.push(name);
    },
    async ensureProfile() {},
    async executePlaywright(executeInput) {
      const callIndex = this.executePlaywrightCalls;
      this.executePlaywrightCalls += 1;
      this.executePlaywrightInputs.push(executeInput);
      await input.onExecutePlaywright?.(executeInput, callIndex);
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

function deterministicRunBrowserNameMatcher() {
  return expect.stringMatching(/^murph-browser-hcr_run123-[0-9a-f]{24}$/u);
}

function deterministicProfileNameMatcher() {
  return expect.stringMatching(/^murph-test-[0-9a-f]{24}$/u);
}

function deterministicProviderSetupProfileNameMatcher() {
  return expect.stringMatching(/^murph-test-provider-setup-[0-9a-f]{24}$/u);
}

function staleRunStateError(): Error {
  return Object.assign(new Error("Stale run state."), {
    code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
  });
}

function createHandoffRecord(overrides: Partial<ComputerHandoffRecord> = {}): ComputerHandoffRecord {
  return {
    completedAt: null,
    createdAt: new Date("2026-06-17T12:00:00.000Z"),
    expiresAt: new Date("2026-06-17T12:20:00.000Z"),
    id: "hch_handoff123",
    memberId: "member_123",
    purpose: "login",
    returnContactKind: null,
    runId: "hcr_run123",
    status: "open",
    suggestedReply: "done",
    tokenHash: "hash",
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

function createOrdinaryComputerHandoffAccessRecord(
  handoff: Pick<ComputerHandoffRecord, "memberId" | "runId">,
) {
  return {
    run: {
      id: handoff.runId,
      memberId: handoff.memberId,
      ownerKey: null,
      ownerPurpose: null,
    },
  };
}

function createOrdinaryComputerRunAccessRecord() {
  return {
    ownerKey: null,
    ownerPurpose: null,
  };
}

function createResumeMailboxItem(overrides: Partial<ResumeMailboxItem> = {}): ResumeMailboxItem {
  return {
    createdAt: new Date("2026-06-17T12:04:00.000Z"),
    id: "hmi_user_reply",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 1n,
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
    ownerKey: null,
    ownerPurpose: null,
    pausedAt: null,
    pendingHandoffId: null,
    resumeAfterMailboxLaneSeq: null,
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
    (
      run.status === "cleanup_pending" ||
      (
        run.expiresAt > now &&
        (run.status === "running" || run.status === "awaiting_user")
      )
    )
  ) ?? null;
}
