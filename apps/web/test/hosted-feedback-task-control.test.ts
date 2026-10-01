import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ seal: vi.fn(), readWake: vi.fn(), access: vi.fn(), append: vi.fn(), handoff: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({ sealHostedUserSecureBoxString: mocks.seal, openHostedUserSecureBoxString: vi.fn() }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccess: mocks.access, requireHostedRuntimeActiveAccessForUpdateTx: mocks.access }));
vi.mock("@/src/lib/hosted-orchestration/mailbox-wake", () => ({ handoffHostedMailboxWake: mocks.handoff }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxWakeByItemId: mocks.readWake,
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: mocks.append,
  runWithPreparedHostedMailboxItemAppendCrypto: async (input: { append(prepared: object): Promise<unknown> }) => input.append({}),
}));
import { admitHostedOperatorTask, tryHandleHostedOperatorDiagnosticControl } from "@/src/lib/hosted-ops/operator-task";
const now = new Date("2026-09-08T12:00:00Z");
const task = { id: "opt_synthetic", memberId: "member_synthetic", feedbackId: "feedback_synthetic", kind: "diagnostic", status: "running", requestMailboxItemId: "ask_synthetic", expiresAt: new Date("2026-09-08T12:10:00Z") };
beforeEach(() => { vi.resetAllMocks(); mocks.seal.mockResolvedValue("encrypted"); });

describe("feedback task authority and persistence", () => {
  it("requires de-identified mode at prepare and sanitizes before encrypted completion", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { hostedOperatorTask: { findUnique: vi.fn().mockResolvedValue(task), updateMany } };
    mocks.readWake.mockResolvedValue({ kind: "assistant.ask.requested", ask: { question: "Explain the schema failure." } });
    const prepared = await tryHandleHostedOperatorDiagnosticControl({ now, prisma: prisma as never, boundRuntimeMemberId: "member_synthetic", request: { action: "prepare", requestId: "ask_synthetic" } });
    expect(prepared?.response).toMatchObject({ feedbackDiagnostic: true, question: "Explain the schema failure." });
    await tryHandleHostedOperatorDiagnosticControl({ now, prisma: prisma as never, boundRuntimeMemberId: "member_synthetic", request: { action: "complete", requestId: "ask_synthetic", result: { outcome: "answered", answer: "Schema failure for synthetic@example.test" } } });
    expect(mocks.seal).toHaveBeenCalledWith(expect.objectContaining({ value: JSON.stringify({ outcome: "answered", answer: "Schema failure for [redacted]" }) }));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "completed", completedAt: now, resultEncrypted: "encrypted" } }));
  });
  it("rejects a mismatched feedback target before appending mailbox work", async () => {
    const tx = {
      hostedProductFeedback: { findUnique: vi.fn().mockResolvedValue({ memberId: "member_other" }) },
      hostedOperatorTask: { findUnique: vi.fn() },
    };
    const prisma = { $transaction: async (run: (value: object) => Promise<unknown>) => run(tx) };
    await expect(admitHostedOperatorTask({ feedbackId: "feedback_synthetic", memberId: "member_synthetic", idempotencyKey: "retry", prompt: "Investigate the schema.", kind: "diagnostic", source: "ops" }, { prisma: prisma as never })).rejects.toMatchObject({ code: "HOSTED_FEEDBACK_TARGET_UNAVAILABLE" });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
});
