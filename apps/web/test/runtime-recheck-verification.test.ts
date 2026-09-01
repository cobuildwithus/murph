import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  captureHostedRuntimeRecoveryWitnesses,
  classifyHostedRuntimeRecoveryWitness,
  readHostedRuntimeRecoveryFacts,
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
      checkpointedAt: "2026-09-01T12:01:00.000Z",
      pendingHeadSequence: "7",
      workspaceVersion: "11",
    }))).toBe("progressing");
    expect(classify(baseline, currentState(baseline, {
      allocatedSystemHighWater: "20",
      canonicalSystemConsumed: "8",
      checkpointedAt: "2026-09-01T12:02:00.000Z",
      pendingHeadSequence: "9",
      workspaceVersion: "12",
    }))).toBe("recovered");
    expect(classify(baseline, currentState(baseline, {
      allocatedSystemHighWater: "20",
      canonicalSystemConsumed: "12",
      checkpointedAt: "2026-09-01T12:02:00.000Z",
      pendingHeadSequence: null,
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
      checkpointedAt: "2026-09-01T12:03:00.000Z",
      pendingHeadSequence: "9",
      workspaceVersion: "13",
    }))).toBe("recovered");
  });

  it("requires the captured sequence to remain the live head until consumption reaches it", async () => {
    const baseline = await recoveryWitness({
      canonicalSystemConsumed: 3n,
      pendingHeadSequence: 6n,
    });

    expect(classify(baseline, currentState(baseline))).toBe("requested");
    expect(classify(baseline, currentState(baseline, {
      pendingHeadSequence: null,
    }))).toBe("unknown");
    expect(classify(baseline, currentState(baseline, {
      pendingHeadSequence: "7",
    }))).toBe("unknown");
    expect(classify(baseline, currentState(baseline, {
      pendingHeadSequence: "4",
    }))).toBe("unknown");
    expect(classify(baseline, currentState(baseline, {
      canonicalSystemConsumed: "6",
      checkpointedAt: "2026-09-01T12:01:00.000Z",
      pendingHeadSequence: "7",
      workspaceVersion: "11",
    }))).toBe("progressing");
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
        pendingHeadSequence: "7",
      }),
      currentState(baseline, {
        pendingHeadSequence: null,
      }),
      currentState(baseline, {
        pendingHeadSequence: "7",
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
      checkpointedAt: "2026-09-01T12:01:00.000Z",
      pendingHeadSequence: null,
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
      baselines: [{ ...baseline, capturedHeadSequence: "7" }],
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

  it("builds one live-head lookup for capture and verification", async () => {
    const queries: unknown[] = [];
    const queryRaw = vi.fn(async (query: unknown) => {
      queries.push(query);
      return [];
    });

    await readHostedRuntimeRecoveryFacts({
      now: REQUESTED_AT,
      prisma: { $queryRaw: queryRaw },
      userIds: [USER_ID],
    });

    expect(queries).toHaveLength(1);
    const sql = readSqlText(queries[0]);
    expect(sql.match(/\bLEFT JOIN LATERAL\b/gu)).toHaveLength(1);
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
    checkpointedAt: new Date("2026-09-01T11:00:00.000Z"),
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
    checkpointedAt: baseline.checkpointedAt,
    observedAt: VERIFIED_AT.toISOString(),
    pendingHeadSequence: baseline.capturedHeadSequence,
    userId: baseline.userId,
    workspaceVersion: baseline.workspaceVersion,
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

function readSqlText(value: unknown): string {
  if (
    value === null
    || typeof value !== "object"
    || !("sql" in value)
    || typeof value.sql !== "string"
  ) {
    throw new TypeError("Expected a Prisma SQL query.");
  }
  return value.sql;
}
