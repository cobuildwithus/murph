import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  captureHostedRuntimeRecoveryWitnesses,
  classifyHostedRuntimeRecoveryWitness,
  type HostedRuntimeRecoveryCurrentState,
  type HostedRuntimeRecoveryFactRow,
  type HostedRuntimeRecoveryWitness,
  verifyHostedRuntimeRecoveryWitnesses,
} from "../src/lib/hosted-ops/runtime-recheck-verification";

const USER_ID = "hbm_test_recovery";
const HMAC_ENV: NodeJS.ProcessEnv = {
  HOSTED_APP_SESSION_HMAC_KEY: Buffer.alloc(32, 11).toString("base64url"),
  NODE_ENV: "test",
};
const REQUESTED_AT = new Date("2026-09-01T12:00:00.000Z");
const VERIFIED_AT = new Date("2026-09-01T12:05:00.000Z");

describe("runtime recheck recovery verification", () => {
  it("classifies the required positive states from canonical consumption and a newer checkpoint pair", async () => {
    const baseline = await recoveryWitness();

    expect(classify(baseline, currentState(baseline))).toBe("requested");
    expect(classify(baseline, currentState(baseline, {
      workspaceVersion: "11",
    }))).toBe("requested");
    expect(classify(baseline, currentState(baseline, {
      checkpointedAt: "2026-09-01T11:01:00.000Z",
    }))).toBe("unknown");
    expect(classify(baseline, currentState(baseline, {
      checkpointedAt: "2026-09-01T12:01:00.000Z",
      workspaceVersion: "11",
    }))).toBe("checkpoint_advanced");
    expect(classify(baseline, currentState(baseline, {
      canonicalSystemConsumed: "6",
      capturedHead: null,
      checkpointedAt: "2026-09-01T12:01:00.000Z",
      pendingHead: pendingHead("7"),
      workspaceVersion: "11",
    }))).toBe("progressing");
    expect(classify(baseline, currentState(baseline, {
      allocatedSystemHighWater: "20",
      canonicalSystemConsumed: "8",
      capturedHead: null,
      checkpointedAt: "2026-09-01T12:02:00.000Z",
      pendingHead: pendingHead("9", {
        createdAt: "2026-09-01T12:04:00.000Z",
      }),
      workspaceVersion: "12",
    }))).toBe("recovered");
    expect(classify(baseline, currentState(baseline, {
      allocatedSystemHighWater: "20",
      canonicalSystemConsumed: "12",
      capturedHead: null,
      checkpointedAt: "2026-09-01T12:02:00.000Z",
      pendingHead: null,
      workspaceVersion: "12",
    }))).toBe("recovered");
  });

  it("keeps the request-time target fixed despite newer work and ignores handled diagnostics", async () => {
    const baseline = await recoveryWitness({
      redactedStatusJson: {
        hostedMailboxSystemHandledThroughSeq: "999",
        hostedMailboxSystemImportedSeq: "8",
      },
    });

    expect(baseline.importedSystemSequence).toBe("8");
    expect(classify(baseline, currentState(baseline))).toBe("requested");
    expect(classify(baseline, currentState(baseline, {
      allocatedSystemHighWater: "40",
      canonicalSystemConsumed: "8",
      capturedHead: null,
      checkpointedAt: "2026-09-01T12:03:00.000Z",
      pendingHead: pendingHead("9", {
        createdAt: "2026-09-01T12:04:00.000Z",
      }),
      workspaceVersion: "13",
    }))).toBe("recovered");
  });

  it("fails closed for consumption without the newer pair and for missing, regressed, or impossible facts", async () => {
    const baseline = await recoveryWitness();
    const alreadyHandled: HostedRuntimeRecoveryWitness = {
      ...baseline,
      canonicalSystemConsumed: baseline.importedSystemSequence,
    };
    const futureBaseline: HostedRuntimeRecoveryWitness = {
      ...baseline,
      observedAt: "2026-09-01T12:10:00.000Z",
    };
    const malformedBaseline = {
      ...baseline,
      workspaceVersion: "01",
    } as HostedRuntimeRecoveryWitness;
    const unknownStates: Array<HostedRuntimeRecoveryCurrentState | null> = [
      null,
      currentState(baseline, { activeAccess: false }),
      currentState(baseline, { workspaceVersion: "9" }),
      currentState(baseline, { checkpointedAt: "2026-09-01T10:59:00.000Z" }),
      currentState(baseline, { canonicalSystemConsumed: "4" }),
      currentState(baseline, { allocatedSystemHighWater: "7" }),
      currentState(baseline, { canonicalSystemConsumed: "9" }),
      currentState(baseline, {
        canonicalSystemConsumed: "6",
        capturedHead: null,
        pendingHead: pendingHead("7"),
      }),
      currentState(baseline, {
        capturedHead: null,
        pendingHead: null,
      }),
      currentState(baseline, {
        capturedHead: pendingHead("6", { kind: "different.kind" }),
      }),
      currentState(baseline, {
        observedAt: "2026-09-15T11:30:00.000Z",
      }),
    ];

    for (const state of unknownStates) {
      expect(classify(baseline, state)).toBe("unknown");
    }
    expect(classifyHostedRuntimeRecoveryWitness({
      baseline: alreadyHandled,
      current: currentState(baseline),
      now: VERIFIED_AT,
    })).toBe("unknown");
    expect(classifyHostedRuntimeRecoveryWitness({
      baseline: futureBaseline,
      current: currentState(baseline),
      now: VERIFIED_AT,
    })).toBe("unknown");
    expect(classifyHostedRuntimeRecoveryWitness({
      baseline: malformedBaseline,
      current: currentState(baseline),
      now: VERIFIED_AT,
    })).toBe("unknown");
    expect(classify(baseline, currentState(baseline, {
      canonicalSystemConsumed: "not-a-sequence",
    }))).toBe("unknown");
  });

  it("strictly validates and deduplicates untrusted presentation witnesses", async () => {
    const baseline = await recoveryWitness();
    const readCurrentStates = vi.fn(async () => [currentState(baseline, {
      canonicalSystemConsumed: "8",
      capturedHead: null,
      checkpointedAt: "2026-09-01T12:01:00.000Z",
      pendingHead: null,
      workspaceVersion: "11",
    })]);

    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [baseline],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toMatchObject({
      results: [{ status: "recovered", userId: USER_ID }],
    });
    expect(readCurrentStates).toHaveBeenCalledTimes(1);

    readCurrentStates.mockClear();
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [{ ...baseline, importedSystemSequence: "6" }],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toMatchObject({
      results: [{ status: "unknown", userId: USER_ID }],
    });
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [baseline, baseline],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toEqual({
      generatedAt: VERIFIED_AT.toISOString(),
      results: [{
        explanation: "The current canonical facts cannot safely verify this request-time witness.",
        status: "unknown",
        userId: USER_ID,
      }],
    });
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [{ userId: USER_ID }],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toMatchObject({
      results: [{ status: "unknown", userId: USER_ID }],
    });
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [{ ...baseline, unexpected: true }],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toMatchObject({
      results: [{ status: "unknown", userId: USER_ID }],
    });
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [{ ...baseline, observedAt: "2026-09-01T12:00:00Z" }],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toMatchObject({
      results: [{ status: "unknown", userId: USER_ID }],
    });
    expect(readCurrentStates).not.toHaveBeenCalled();
  });

  it("rejects an invalid outer batch and treats signed future evidence as Unknown", async () => {
    const future = await recoveryWitness({}, new Date("2026-09-01T12:10:00.000Z"));
    const readCurrentStates = vi.fn(async () => [currentState(future)]);

    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [],
      environment: HMAC_ENV,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_RECOVERY_WITNESSES_INVALID",
      httpStatus: 400,
    });
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [future, future, future, future],
      environment: HMAC_ENV,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_RECOVERY_WITNESSES_INVALID",
      httpStatus: 400,
    });
    await expect(verifyHostedRuntimeRecoveryWitnesses({
      baselines: [future],
      environment: HMAC_ENV,
      now: VERIFIED_AT,
      readCurrentStates,
    })).resolves.toMatchObject({
      results: [{ status: "unknown", userId: USER_ID }],
    });
  });
});

async function recoveryWitness(
  overrides: Partial<HostedRuntimeRecoveryFactRow> = {},
  now = REQUESTED_AT,
): Promise<HostedRuntimeRecoveryWitness> {
  const witnesses = await captureHostedRuntimeRecoveryWitnesses({
    environment: HMAC_ENV,
    now,
    readFacts: async () => [factRow(overrides)],
    userIds: [USER_ID],
  });
  const witness = witnesses.get(USER_ID);
  if (!witness) {
    throw new Error("Synthetic recovery witness was not captured.");
  }
  return witness;
}

function factRow(
  overrides: Partial<HostedRuntimeRecoveryFactRow> = {},
): HostedRuntimeRecoveryFactRow {
  return {
    allocatedSystemHighWater: 12n,
    canonicalSystemConsumed: 5n,
    capturedHeadCreatedAt: null,
    capturedHeadExpiresAt: null,
    capturedHeadKind: null,
    capturedHeadSequence: null,
    checkpointedAt: new Date("2026-09-01T11:00:00.000Z"),
    pendingHeadCreatedAt: new Date("2026-09-01T11:30:00.000Z"),
    pendingHeadExpiresAt: null,
    pendingHeadKind: "device-sync.wake",
    pendingHeadSequence: 6n,
    redactedStatusJson: {
      hostedMailboxSystemImportedSeq: "8",
    },
    userId: USER_ID,
    workspaceVersion: 10n,
    ...overrides,
  };
}

function currentState(
  baseline: HostedRuntimeRecoveryWitness,
  overrides: Partial<HostedRuntimeRecoveryCurrentState> = {},
): HostedRuntimeRecoveryCurrentState {
  return {
    activeAccess: true,
    allocatedSystemHighWater: baseline.allocatedSystemHighWater,
    canonicalSystemConsumed: baseline.canonicalSystemConsumed,
    capturedHead: baseline.pendingHead,
    checkpointedAt: baseline.checkpointedAt,
    observedAt: VERIFIED_AT.toISOString(),
    pendingHead: baseline.pendingHead,
    userId: baseline.userId,
    workspaceVersion: baseline.workspaceVersion,
    ...overrides,
  };
}

function pendingHead(
  sequence: string,
  overrides: Partial<NonNullable<HostedRuntimeRecoveryWitness["pendingHead"]>> = {},
) {
  return {
    createdAt: "2026-09-01T11:30:00.000Z",
    expiresAt: null,
    kind: "device-sync.wake",
    sequence,
    ...overrides,
  };
}

function classify(
  baseline: HostedRuntimeRecoveryWitness,
  current: HostedRuntimeRecoveryCurrentState | null,
) {
  return classifyHostedRuntimeRecoveryWitness({
    baseline,
    current,
    now: VERIFIED_AT,
  });
}
