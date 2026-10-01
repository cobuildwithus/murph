import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), owner: vi.fn(), access: vi.fn(), consent: vi.fn(),
  sponsoredLock: vi.fn(), append: vi.fn(), signal: vi.fn(),
  events: [] as string[],
}));
const tx = { marker: "transaction" };
const prepared = { marker: "prepared-crypto" };
const prisma = {
  $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
    mocks.events.push("transaction");
    const result = await run(tx);
    mocks.events.push("commit");
    return result;
  }),
};
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: mocks.auth,
}));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({
  requireHostedRuntimeOwnerTx: mocks.owner,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.access,
}));
vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted: mocks.consent,
}));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: { maxWait: 5_000, timeout: 10_000 },
  lockHostedMemberSponsoredAccessRows: mocks.sponsoredLock,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  runWithPreparedHostedMailboxItemAppendCrypto: async (input: { append: (value: typeof prepared) => Promise<unknown> }) => {
    mocks.events.push("crypto");
    return input.append(prepared);
  },
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: mocks.append,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signal,
}));

import { POST } from "../app/api/internal/hosted-mailbox/voice-input/route";

const input = {
  callId: "call-synthetic", inputId: "input-synthetic",
  occurredAt: "2026-09-21T12:00:00.000Z", text: "What is on my calendar?",
};
function request(query = "?runtimeAuthority=1&runtimeAttempt=rt_synthetic&runtimeGeneration=7") {
  return new Request("https://example.test/api/internal/hosted-mailbox/voice-input" + query, { method: "POST" });
}
const denied = () => hostedOnboardingError({ code: "TEST_DENIED", httpStatus: 403, message: "Denied." });

describe("signed voice input admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.auth.mockImplementation(async () => {
      mocks.events.push("auth");
      return { userId: "member-synthetic", payload: input };
    });
    mocks.owner.mockImplementation(async () => {
      mocks.events.push("owner");
      return { processingMode: "default", platformAiUsageAllowed: true };
    });
    mocks.sponsoredLock.mockImplementation(async () => { mocks.events.push("sponsor"); });
    mocks.access.mockImplementation(async () => { mocks.events.push("access"); });
    mocks.consent.mockImplementation(async () => { mocks.events.push("consent"); });
    mocks.append.mockImplementation(async () => {
      mocks.events.push("append");
      return { dedupeConflict: false, item: { id: "mailbox-synthetic", lane: "conversation", laneSeq: "4" } };
    });
    mocks.signal.mockImplementation(async () => { mocks.events.push("signal"); });
  });

  it("binds publication to the signed member and current attempt in the append transaction", async () => {
    const req = request();
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mailboxItemId: "mailbox-synthetic" });
    expect(mocks.auth).toHaveBeenCalledWith(req, { maxBodyBytes: 65536, runtimeAuthority: "caller_transaction" });
    expect(mocks.owner).toHaveBeenCalledWith(tx, {
      userId: "member-synthetic", attemptId: "rt_synthetic", generation: "7", workspaceVersion: null,
    });
    expect(mocks.append).toHaveBeenCalledWith({
      tx, prepared,
      envelope: {
        kind: "conversation.message", eventId: "voice.input:call-synthetic:input-synthetic",
        userId: "member-synthetic", occurredAt: input.occurredAt,
        message: { channel: "voice", callId: input.callId, inputId: input.inputId, text: input.text },
      },
    });
    expect(mocks.events).toEqual(["auth", "crypto", "transaction", "owner", "sponsor", "access", "consent", "append", "commit", "signal"]);
  });

  it.each(["auth", "owner", "access", "consent"] as const)("does not append when %s rejects", async (boundary) => {
    mocks[boundary].mockRejectedValueOnce(denied());
    expect((await POST(request())).status).toBe(403);
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it("requires signed attempt authority even for an authenticated callback", async () => {
    expect((await POST(request(""))).status).toBe(403);
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it.each([
    { userId: "other-member" }, { callId: "call:ambiguous" }, { text: " " },
    { occurredAt: "2026-02-30T12:00:00.000Z" }, { text: "x".repeat(32769) },
  ])("rejects invalid or authority-widening payload fields", async (change) => {
    mocks.auth.mockResolvedValueOnce({ userId: "member-synthetic", payload: { ...input, ...change } });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it.each([
    { processingMode: "system_mailbox", platformAiUsageAllowed: true },
    { processingMode: "default", platformAiUsageAllowed: false },
  ])("rejects runtimes without foreground platform voice authority", async (owner) => {
    mocks.owner.mockResolvedValueOnce(owner);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("rolls back a conflicting duplicate and does not signal it", async () => {
    mocks.append.mockResolvedValueOnce({ dedupeConflict: true });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.events).not.toContain("commit");
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it("replays unchanged input and repeats the post-commit wake", async () => {
    for (let n = 0; n < 2; n++) {
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ mailboxItemId: "mailbox-synthetic" });
    }
    expect(mocks.append.mock.calls[0]).toEqual(mocks.append.mock.calls[1]);
    expect(mocks.signal).toHaveBeenCalledTimes(2);
  });
});
