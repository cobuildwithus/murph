import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedEnvironmentVoiceMailboxEnvelopeTx: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  deleteEnvironmentVoice: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedMailboxWakeAfterDedupeLockTx: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  stageEnvironmentVoice: vi.fn(),
}));

const transaction = vi.fn(async (callback: (tx: {
  hostedMember: {
    findUnique: () => Promise<{ suspendedAt: null }>;
  };
}) => Promise<unknown>) =>
  await callback({
    hostedMember: {
      findUnique: async () => ({ suspendedAt: null }),
    },
  })
);

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedEnvironmentVoiceMailboxEnvelopeTx:
    mocks.appendHostedEnvironmentVoiceMailboxEnvelopeTx,
  readHostedMailboxWakeAfterDedupeLockTx:
    mocks.readHostedMailboxWakeAfterDedupeLockTx,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: transaction }),
}));

import { POST } from "../app/api/environment/voice/route";

describe("environment voice upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      deleteEnvironmentVoice: mocks.deleteEnvironmentVoice,
      stageEnvironmentVoice: mocks.stageEnvironmentVoice,
    });
    mocks.stageEnvironmentVoice.mockImplementation(async (input: {
      bytes: Uint8Array;
      sha256: string;
    }) => ({
      audioKey: "a".repeat(40),
      byteLength: input.bytes.byteLength,
      sha256: input.sha256,
    }));
    mocks.appendHostedEnvironmentVoiceMailboxEnvelopeTx.mockResolvedValue({
      claimedAudioKey: "a".repeat(40),
      dedupeConflict: false,
      duplicate: false,
      item: { id: "mailbox_123" },
    });
  });

  it("stages an authenticated recording, appends one mailbox wake, and signals runtime", async () => {
    const bytes = createWebmBytes();
    const captureId = await sha256Hex(bytes);
    const request = createRequest({
      bytes,
      captureId,
      capturedAt: new Date().toISOString(),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      captureId,
      duplicate: false,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      request,
    );
    expect(mocks.stageEnvironmentVoice).toHaveBeenCalledWith({
      bytes,
      captureId,
      contentType: "audio/webm",
      sha256: captureId,
      userId: "member_123",
    });
    expect(
      mocks.appendHostedEnvironmentVoiceMailboxEnvelopeTx,
    ).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        environmentVoice: expect.objectContaining({
          audioKey: "a".repeat(40),
          captureId,
          contentType: "audio/webm",
          durationMs: 12_000,
          sha256: captureId,
        }),
        eventId: `environment-voice:${captureId}`,
        kind: "environment-voice.captured",
        userId: "member_123",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("rejects unsupported audio before staging", async () => {
    const bytes = createWebmBytes();
    const captureId = await sha256Hex(bytes);
    const request = createRequest({
      bytes,
      captureId,
      capturedAt: new Date().toISOString(),
      contentType: "audio/wav",
    });

    const response = await POST(request);

    expect(response.status).toBe(415);
    expect(mocks.stageEnvironmentVoice).not.toHaveBeenCalled();
  });
});

function createRequest(input: {
  bytes: Uint8Array;
  captureId: string;
  capturedAt: string;
  contentType?: string;
}): Request {
  return new Request("https://local.withmurph.ai/api/environment/voice", {
    body: Uint8Array.from(input.bytes),
    headers: {
      "content-type": input.contentType ?? "audio/webm",
      "x-murph-environment-voice-capture-id": input.captureId,
      "x-murph-environment-voice-captured-at": input.capturedAt,
      "x-murph-environment-voice-duration-ms": "12000",
    },
    method: "POST",
  });
}

function createWebmBytes(): Uint8Array {
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
