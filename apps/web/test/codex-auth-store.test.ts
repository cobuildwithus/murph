import type { HostedCodexAuthUpdate } from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { applyHostedCodexAuthUpdate } from "@/src/lib/codex-auth/store";

const MEMBER_ID = "member_legacy_callback";
const ATTEMPT_ID = "hca_legacy_callback_0001";
const NEXT_ATTEMPT_ID = "hca_legacy_callback_0002";
const APPLIED = { applied: true, status: "applied" };
const ALREADY_APPLIED = { applied: true, status: "already_applied" };
const SUPERSEDED = { applied: false, status: "superseded" };
const DEVICE_CODE = {
  attemptId: ATTEMPT_ID,
  phase: "device_code",
  userCode: "TEST-CODE",
  verificationUrl: "https://auth.openai.com/codex/device",
} satisfies HostedCodexAuthUpdate;

describe("retained legacy Codex auth callback store", () => {
  beforeEach(() => mocks.getPrisma.mockReset());

  it.each(["connecting", "connect_error"])(
    "retains device-code application and duplicate semantics from %s",
    async (state) => {
      const store = createStore(state);

      expect(await apply(DEVICE_CODE)).toEqual(APPLIED);
      expect(store.row).toMatchObject({
        state: "connecting",
        userCode: DEVICE_CODE.userCode,
        verificationUrl: DEVICE_CODE.verificationUrl,
      });
      // The original consumer reapplies a device code while still connecting.
      expect(await apply(DEVICE_CODE)).toEqual(APPLIED);
      expect(await apply({ attemptId: ATTEMPT_ID, phase: "connected" }))
        .toEqual(APPLIED);
      expect(await apply(DEVICE_CODE)).toEqual(ALREADY_APPLIED);
      expect(store.row).toMatchObject({
        state: "connected", userCode: null, verificationUrl: null,
      });
    },
  );

  it.each([
    ["connecting", "connected", "connected"],
    ["connect_error", "connected", "connected"],
    ["disconnecting", "disconnected", "disconnected"],
    ["disconnect_error", "disconnected", "disconnected"],
    ["connecting", "failed", "connect_error"],
    ["disconnecting", "failed", "disconnect_error"],
  ] as const)("applies %s -> %s and acknowledges the duplicate", async (state, phase, nextState) => {
    const store = createStore(state);
    const update = { attemptId: ATTEMPT_ID, phase };

    expect(await apply(update)).toEqual(APPLIED);
    expect(store.row).toMatchObject({
      attemptId: ATTEMPT_ID,
      memberId: MEMBER_ID,
      state: nextState,
      userCode: null,
      verificationUrl: null,
    });
    expect(await apply(update)).toEqual(ALREADY_APPLIED);
  });

  it.each([
    ["connected", "failed"],
    ["disconnected", "failed"],
    ["disconnecting", "connected"],
    ["connecting", "disconnected"],
  ] as const)("does not overwrite %s with %s", async (state, phase) => {
    const store = createStore(state);
    const before = { ...store.row };

    expect(await apply({ attemptId: ATTEMPT_ID, phase })).toEqual(SUPERSEDED);
    expect(store.row).toEqual(before);
  });

  it.each(["connect_error", "disconnect_error", "error"])(
    "acknowledges the former failed state %s without writing",
    async (state) => {
      const store = createStore(state);
      expect(await apply({ attemptId: ATTEMPT_ID, phase: "failed" }))
        .toEqual(ALREADY_APPLIED);
      expect(store.updateMany).not.toHaveBeenCalled();
    },
  );

  describe.each(["device_code", "connected", "disconnected", "failed"] as const)(
    "%s authority binding",
    (phase) => {
      const update: HostedCodexAuthUpdate = phase === "device_code"
        ? DEVICE_CODE
        : { attemptId: ATTEMPT_ID, phase };

      it("does not create a missing attempt", async () => {
        const store = createStore(null);
        expect(await apply(update)).toEqual(SUPERSEDED);
        expect(store.row).toBeNull();
      });

      it("does not write another member's matching attempt", async () => {
        const store = createStore(phase === "disconnected" ? "disconnecting" : "connecting");
        const before = { ...store.row };
        expect(await applyHostedCodexAuthUpdate({ memberId: "member_other", update }))
          .toEqual(SUPERSEDED);
        expect(store.row).toEqual(before);
      });

      it.each(["pending", "terminal"])(
        "does not acknowledge or overwrite a %s replacement attempt",
        async (stage) => {
          const state = phase === "disconnected"
            ? stage === "pending" ? "disconnecting" : "disconnected"
            : stage === "pending" ? "connecting" : "connected";
          const store = createStore(state);
          Object.assign(store.row!, { attemptId: NEXT_ATTEMPT_ID });
          const before = { ...store.row };
          expect(await apply(update)).toEqual(SUPERSEDED);
          expect(store.row).toEqual(before);
        },
      );
    },
  );

  it.each([
    ["connecting", NEXT_ATTEMPT_ID, SUPERSEDED],
    ["connected", ATTEMPT_ID, SUPERSEDED],
    ["connect_error", ATTEMPT_ID, ALREADY_APPLIED],
    ["error", ATTEMPT_ID, ALREADY_APPLIED],
  ] as const)("rechecks a failed-update CAS miss without retrying (%s)", async (state, attemptId, receipt) => {
    const store = createStore("connecting");
    store.beforeWrite = () => Object.assign(store.row!, { state, attemptId });

    expect(await apply({ attemptId: ATTEMPT_ID, phase: "failed" })).toEqual(receipt);
    expect(store.row).toMatchObject({ state, attemptId });
    expect(store.updateMany).toHaveBeenCalledTimes(1);
    expect(store.findUnique).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid stored state instead of acknowledging it", async () => {
    const store = createStore("invalid_state");
    await expect(apply({ attemptId: ATTEMPT_ID, phase: "failed" }))
      .rejects.toThrow("Hosted Codex auth connection state is invalid.");
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it.each(["updateMany", "findUnique"] as const)(
    "propagates canonical %s failure without a success receipt",
    async (operation) => {
      const store = createStore("connecting");
      const error = new Error("Synthetic canonical update failure");
      store[operation].mockRejectedValueOnce(error);

      await expect(apply({
        attemptId: ATTEMPT_ID,
        phase: operation === "updateMany" ? "connected" : "failed",
      })).rejects.toBe(error);
      expect(store.row?.state).toBe("connecting");
    },
  );
});

function apply(update: HostedCodexAuthUpdate) {
  return applyHostedCodexAuthUpdate({ memberId: MEMBER_ID, update });
}

interface ConnectionRow {
  attemptId: string;
  memberId: string;
  state: string;
  userCode: string | null;
  verificationUrl: string | null;
}

function createStore(state: string | null) {
  const stateHolder: {
    row: ConnectionRow | null;
    beforeWrite?: () => void;
  } = {
    row: state === null ? null : {
      attemptId: ATTEMPT_ID,
      memberId: MEMBER_ID,
      state,
      userCode: "OLD-CODE",
      verificationUrl: "https://auth.openai.com/codex/device",
    },
  };
  const findUnique = vi.fn(async ({ where }: { where: { memberId: string } }) => {
    const row = stateHolder.row;
    return row?.memberId === where.memberId ? { ...row } : null;
  });
  const updateMany = vi.fn(async ({ data, where }: {
    data: Partial<ConnectionRow>;
    where: { memberId: string; attemptId: string; state: string | { in: readonly string[] } };
  }) => {
    stateHolder.beforeWrite?.();
    const row = stateHolder.row;
    const states = typeof where.state === "string" ? [where.state] : where.state.in;
    if (!row || row.memberId !== where.memberId || row.attemptId !== where.attemptId
      || !states.includes(row.state)) {
      return { count: 0 };
    }
    Object.assign(row, data);
    return { count: 1 };
  });
  mocks.getPrisma.mockReturnValue({ hostedCodexAuthConnection: { findUnique, updateMany } });
  return Object.assign(stateHolder, { findUnique, updateMany });
}
