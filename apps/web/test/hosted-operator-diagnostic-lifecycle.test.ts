import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ readWake: vi.fn(), seal: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxString: vi.fn(),
  sealHostedUserSecureBoxString: mocks.seal,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  readHostedMailboxWakeByItemId: mocks.readWake,
  runWithPreparedHostedMailboxItemAppendCrypto: vi.fn(),
}));

import { tryHandleHostedOperatorDiagnosticControl } from "@/src/lib/hosted-ops/operator-task";

const now = new Date("2036-06-01T12:00:00.000Z");
const expiresAt = new Date("2036-06-01T12:10:00.000Z");
const wake = { kind: "assistant.ask.requested", ask: { question: "Inspect synthetic runtime state." } };
const result = { outcome: "answered" as const, answer: "Synthetic diagnostic result." };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readWake.mockResolvedValue(wake);
  mocks.seal.mockResolvedValue("synthetic-ciphertext");
});

describe("operator diagnostic terminal transitions", () => {
  it.each(["prepare", "complete"] as const)("does not %s a failed diagnostic", async (action) => {
    const fixture = createTaskFixture("failed");

    const response = await fixture.control(action);

    expect(response?.response).toMatchObject({ action, status: "terminal", terminalReason: "unavailable" });
    expect(fixture.task.status).toBe("failed");
    expect(mocks.readWake).not.toHaveBeenCalled();
    expect(mocks.seal).not.toHaveBeenCalled();
  });

  it.each(["queued", "running"] as const)("does not prepare a %s task terminalized while reading its mailbox", async (initialStatus) => {
    const fixture = createTaskFixture(initialStatus);
    const reading = deferred();
    const release = deferred();
    mocks.readWake.mockImplementationOnce(async () => {
      reading.resolve();
      await release.promise;
      return wake;
    });

    const preparation = fixture.control("prepare");
    await reading.promise;
    await expect(fixture.control("prepare", expiresAt)).resolves.toMatchObject({
      response: { status: "terminal", terminalReason: "expired" },
    });
    release.resolve();

    await expect(preparation).resolves.toMatchObject({
      response: { status: "terminal", terminalReason: "unavailable" },
    });
    expect(fixture.task.status).toBe("failed");
  });

  it("does not acknowledge a result rejected after concurrent expiry", async () => {
    const fixture = createTaskFixture("running");
    const sealing = deferred();
    const release = deferred();
    mocks.seal.mockImplementationOnce(async () => {
      sealing.resolve();
      await release.promise;
      return "synthetic-ciphertext";
    });

    const completion = fixture.control("complete");
    await sealing.promise;
    await fixture.control("prepare", expiresAt);
    release.resolve();

    await expect(completion).resolves.toMatchObject({
      response: { status: "terminal", terminalReason: "unavailable" },
    });
    expect(fixture.task).toMatchObject({ status: "failed", resultEncrypted: null });
  });

  it("reports the winning result when two completion callbacks overlap", async () => {
    const fixture = createTaskFixture("running");
    const sealing = deferred();
    const release = deferred();
    mocks.seal.mockImplementationOnce(async () => {
      sealing.resolve();
      await release.promise;
      return "losing-ciphertext";
    });

    const first = fixture.control("complete");
    await sealing.promise;
    await expect(fixture.control("complete")).resolves.toMatchObject({ response: { status: "completed" } });
    release.resolve();

    await expect(first).resolves.toMatchObject({ response: { status: "already_completed" } });
    expect(fixture.task.resultEncrypted).toBe("synthetic-ciphertext");
  });

  it("preserves queued admission, running retry, and idempotent successful completion", async () => {
    const fixture = createTaskFixture("queued");

    await expect(fixture.control("prepare")).resolves.toMatchObject({ response: { status: "ready", question: wake.ask.question } });
    expect(fixture.task.status).toBe("running");
    await expect(fixture.control("prepare")).resolves.toMatchObject({ response: { status: "ready" } });
    await expect(fixture.control("complete")).resolves.toMatchObject({ response: { status: "completed" } });
    await expect(fixture.control("complete")).resolves.toMatchObject({ response: { status: "already_completed" } });
    expect(fixture.task).toMatchObject({ status: "completed", resultEncrypted: "synthetic-ciphertext" });
    expect(mocks.seal).toHaveBeenCalledOnce();
  });
});

function createTaskFixture(status: string) {
  const task = {
    completedAt: null as Date | null,
    expiresAt,
    feedbackId: null,
    id: "opt_synthetic",
    kind: "diagnostic",
    memberId: "member_synthetic",
    requestMailboxItemId: "ask_synthetic",
    resultEncrypted: null as string | null,
    status,
  };
  const prisma = {
    hostedOperatorTask: {
      findUnique: vi.fn(async () => ({ ...task })),
      updateMany: vi.fn(async (input: {
        data: Partial<typeof task>;
        where: { id: string; status: string | { in: string[] } };
      }) => {
        const statuses = typeof input.where.status === "string" ? [input.where.status] : input.where.status.in;
        if (input.where.id !== task.id || !statuses.includes(task.status)) return { count: 0 };
        Object.assign(task, input.data);
        return { count: 1 };
      }),
    },
  };
  return {
    task,
    control(action: "complete" | "prepare", at = now) {
      return tryHandleHostedOperatorDiagnosticControl({
        boundRuntimeMemberId: task.memberId,
        now: at,
        prisma: prisma as never,
        request: { action, requestId: task.requestMailboxItemId, ...(action === "complete" ? { result } : {}) },
      });
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
