import { readFileSync } from "node:fs";

import type { HostedPhoneCall } from "@prisma/client";
import {
  hostedPhoneCallBriefSchema,
  hostedPhoneCallResultSchema,
  type HostedPhoneCallBrief,
  type HostedPhoneCallResult,
} from "@murphai/hosted-execution/phone-calls";
import { describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  encryptHostedPhoneCallBrief,
  encryptHostedPhoneCallResult,
  readHostedPhoneCallBrief,
  readHostedPhoneCallResult,
  type HostedPhoneCallCrypto,
} from "@/src/lib/phone-calls/crypto";
import {
  backfillHostedPhoneCallPrivateContent,
  type HostedPhoneCallPrivateContentBackfillCandidate,
  type HostedPhoneCallPrivateContentBackfillStore,
} from "@/src/lib/phone-calls/private-content-backfill";
import {
  parseHostedPhoneCallPrivateContentBackfillScriptOptions,
} from "@/scripts/backfill-hosted-phone-call-private-content";

const PRIVATE_MARKER = "phone-call-private-marker";
const VALID_BRIEF: HostedPhoneCallBrief = hostedPhoneCallBriefSchema.parse({
  allowTransferToUser: false,
  goal: `Confirm the ${PRIVATE_MARKER} appointment.`,
  instructions: ["Do not change the appointment."],
  shareableFacts: { appointment_reference: PRIVATE_MARKER },
  successCriteria: "The office confirms the appointment.",
  timeZone: "America/New_York",
  to: {
    label: "Clinic",
    phoneNumber: "+12125550123",
  },
});
const VALID_RESULT: HostedPhoneCallResult = hostedPhoneCallResultSchema.parse({
  outcome: "completed",
  summary: `The office confirmed ${PRIVATE_MARKER}.`,
});

describe("hosted phone-call private content", () => {
  it("round-trips encrypted briefs/results without putting private markers on the logical row", async () => {
    const briefEncrypted = await encryptHostedPhoneCallBrief({
      callId: "hpc_private_test",
      memberId: "member_private_test",
      value: VALID_BRIEF,
    });
    const resultEncrypted = await encryptHostedPhoneCallResult({
      callId: "hpc_private_test",
      memberId: "member_private_test",
      value: VALID_RESULT,
    });
    const call = buildHostedPhoneCall({
      briefEncrypted,
      briefJson: null,
      resultEncrypted,
      resultJson: null,
    });

    expect(JSON.stringify(call)).not.toContain(PRIVATE_MARKER);
    await expect(readHostedPhoneCallBrief({ call })).resolves.toEqual(VALID_BRIEF);
    await expect(readHostedPhoneCallResult({ call })).resolves.toEqual(VALID_RESULT);
  });

  it("binds secure-box encryption to the exact lane, member, table, row, field, and scope", async () => {
    const encryptCalls: Array<Record<string, unknown>> = [];
    setHostedSecureBoxStringTestCodecForTests({
      decrypt: () => {
        throw new Error("Unexpected decrypt.");
      },
      encrypt: (input) => {
        encryptCalls.push(input);
        return "aad-test-ciphertext";
      },
    });
    try {
      await encryptHostedPhoneCallBrief({
        callId: "hpc_aad_test",
        memberId: "member_aad_test",
        value: VALID_BRIEF,
      });
      await encryptHostedPhoneCallResult({
        callId: "hpc_aad_test",
        memberId: "member_aad_test",
        value: VALID_RESULT,
      });
    } finally {
      restoreDefaultSecureBoxCodec();
    }

    expect(encryptCalls).toEqual([
      expect.objectContaining({
        aad: {
          field: "brief_encrypted",
          purpose: "hosted-phone-call-private-content",
          rowId: "hpc_aad_test",
          table: "hosted_phone_call",
        },
        lane: "hosted-member-private-field",
        scope: "hosted-phone-call:brief",
        userId: "member_aad_test",
      }),
      expect.objectContaining({
        aad: {
          field: "result_encrypted",
          purpose: "hosted-phone-call-private-content",
          rowId: "hpc_aad_test",
          table: "hosted_phone_call",
        },
        lane: "hosted-member-private-field",
        scope: "hosted-phone-call:result",
        userId: "member_aad_test",
      }),
    ]);
  });

  it("reads legacy JSON only when ciphertext is null", async () => {
    const legacy = buildHostedPhoneCall({
      briefEncrypted: null,
      briefJson: VALID_BRIEF,
      resultEncrypted: null,
      resultJson: VALID_RESULT,
    });

    await expect(readHostedPhoneCallBrief({ call: legacy })).resolves.toEqual(VALID_BRIEF);
    await expect(readHostedPhoneCallResult({ call: legacy })).resolves.toEqual(VALID_RESULT);
  });

  it.each(["", "malformed-ciphertext"])(
    "fails closed for present %s instead of falling back to plaintext",
    async (briefEncrypted) => {
      const decryptBrief = vi.fn(async () => {
        throw new Error("Ciphertext rejected.");
      });
      const crypto = {
        ...createTestCrypto(),
        decryptBrief,
      };
      const call = buildHostedPhoneCall({ briefEncrypted, briefJson: VALID_BRIEF });

      await expect(readHostedPhoneCallBrief({ call, crypto })).rejects.toThrow(
        "Ciphertext rejected.",
      );
      expect(decryptBrief).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["", "malformed-ciphertext"])(
    "fails closed for present result %s instead of falling back to plaintext",
    async (resultEncrypted) => {
      const decryptResult = vi.fn(async () => {
        throw new Error("Result ciphertext rejected.");
      });
      const crypto = {
        ...createTestCrypto(),
        decryptResult,
      };
      const call = buildHostedPhoneCall({ resultEncrypted, resultJson: VALID_RESULT });

      await expect(readHostedPhoneCallResult({ call, crypto })).rejects.toThrow(
        "Result ciphertext rejected.",
      );
      expect(decryptResult).toHaveBeenCalledTimes(1);
    },
  );

  it("defaults the operator script to a bounded dry run", () => {
    expect(parseHostedPhoneCallPrivateContentBackfillScriptOptions([])).toEqual({
      batchSize: undefined,
      help: false,
      mode: "dry-run",
    });
    expect(parseHostedPhoneCallPrivateContentBackfillScriptOptions([
      "--apply",
      "--batch-size",
      "100",
    ])).toEqual({
      batchSize: 100,
      help: false,
      mode: "apply",
    });
    expect(() => parseHostedPhoneCallPrivateContentBackfillScriptOptions([
      "--batch-size",
      "101",
    ])).toThrow("--batch-size requires an integer from 1 through 100.");
  });

  it("dry-runs without crypto or mutation and reports metadata counts only", async () => {
    const row = buildBackfillCandidate();
    const store = createBackfillStore([row]);
    const crypto = createTestCrypto();
    const decryptBrief = vi.spyOn(crypto, "decryptBrief");
    const decryptResult = vi.spyOn(crypto, "decryptResult");
    const encryptBrief = vi.spyOn(crypto, "encryptBrief");
    const encryptResult = vi.spyOn(crypto, "encryptResult");

    const summary = await backfillHostedPhoneCallPrivateContent({
      crypto,
      mode: "dry-run",
      store: store.store,
    });

    expect(summary).toEqual({
      batchSize: 50,
      conflicts: 0,
      fields: {
        brief: { encrypted: 0, scrubbed: 0, wouldEncrypt: 1, wouldScrub: 1 },
        result: { encrypted: 0, scrubbed: 0, wouldEncrypt: 1, wouldScrub: 1 },
      },
      hasMore: false,
      mode: "dry-run",
      selectedRows: 1,
    });
    expect(store.applyCalls).toHaveLength(0);
    expect(store.rows[0]).toEqual(row);
    expect(decryptBrief).not.toHaveBeenCalled();
    expect(decryptResult).not.toHaveBeenCalled();
    expect(encryptBrief).not.toHaveBeenCalled();
    expect(encryptResult).not.toHaveBeenCalled();
  });

  it("selects at most one bounded batch and reports when more legacy rows remain", async () => {
    const store = createBackfillStore([
      buildBackfillCandidate({ id: "hpc_backfill_1" }),
      buildBackfillCandidate({ id: "hpc_backfill_2" }),
      buildBackfillCandidate({ id: "hpc_backfill_3" }),
    ]);
    const crypto = createTestCrypto();
    const encryptBrief = vi.spyOn(crypto, "encryptBrief");
    const encryptResult = vi.spyOn(crypto, "encryptResult");

    const summary = await backfillHostedPhoneCallPrivateContent({
      batchSize: 2,
      crypto,
      mode: "dry-run",
      store: store.store,
    });

    expect(summary).toMatchObject({
      batchSize: 2,
      hasMore: true,
      selectedRows: 2,
    });
    expect(summary.fields).toEqual({
      brief: { encrypted: 0, scrubbed: 0, wouldEncrypt: 2, wouldScrub: 2 },
      result: { encrypted: 0, scrubbed: 0, wouldEncrypt: 2, wouldScrub: 2 },
    });
    expect(store.applyCalls).toHaveLength(0);
    expect(encryptBrief).not.toHaveBeenCalled();
    expect(encryptResult).not.toHaveBeenCalled();
  });

  it("encrypts, verifies, scrubs atomically, and is idempotent on rerun", async () => {
    const store = createBackfillStore([buildBackfillCandidate()]);

    const first = await backfillHostedPhoneCallPrivateContent({
      crypto: createTestCrypto(),
      mode: "apply",
      store: store.store,
    });
    const second = await backfillHostedPhoneCallPrivateContent({
      crypto: createTestCrypto(),
      mode: "apply",
      store: store.store,
    });

    expect(first.fields).toEqual({
      brief: { encrypted: 1, scrubbed: 1, wouldEncrypt: 1, wouldScrub: 1 },
      result: { encrypted: 1, scrubbed: 1, wouldEncrypt: 1, wouldScrub: 1 },
    });
    expect(store.rows[0]).toMatchObject({
      briefEncrypted: expect.stringMatching(/^brief:/u),
      briefJson: null,
      resultEncrypted: expect.stringMatching(/^result:/u),
      resultJson: null,
    });
    expect(second).toMatchObject({
      conflicts: 0,
      hasMore: false,
      selectedRows: 0,
    });
  });

  it("refuses to scrub when existing ciphertext does not equal legacy content", async () => {
    const store = createBackfillStore([
      buildBackfillCandidate({
        briefEncrypted: `brief:${JSON.stringify({
          ...VALID_BRIEF,
          goal: "Different content",
        })}`,
      }),
    ]);

    await expect(backfillHostedPhoneCallPrivateContent({
      crypto: createTestCrypto(),
      mode: "apply",
      store: store.store,
    })).rejects.toThrow("Hosted phone-call private-content verification failed.");
    expect(store.applyCalls).toHaveLength(0);
    expect(store.rows[0]?.briefJson).toEqual(VALID_BRIEF);
  });

  it("reports a CAS conflict without counting stale plaintext as scrubbed", async () => {
    const store = createBackfillStore([buildBackfillCandidate()], { conflict: true });
    const summary = await backfillHostedPhoneCallPrivateContent({
      crypto: createTestCrypto(),
      mode: "apply",
      store: store.store,
    });

    expect(summary.conflicts).toBe(1);
    expect(summary.fields.brief.scrubbed).toBe(0);
    expect(summary.fields.result.scrubbed).toBe(0);
    expect(store.rows[0]?.briefJson).toEqual(VALID_BRIEF);
  });

  it("excludes both database-null and JSON-null legacy values from candidate discovery", () => {
    const source = readFileSync(
      new URL("../src/lib/phone-calls/private-content-backfill.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("{ briefJson: { not: Prisma.AnyNull } }");
    expect(source).toContain("{ resultJson: { not: Prisma.AnyNull } }");
  });
});

function buildHostedPhoneCall(overrides: Partial<HostedPhoneCall> = {}): HostedPhoneCall {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    analyzedAt: null,
    briefEncrypted: null,
    briefJson: null,
    createdAt: now,
    endedAt: null,
    id: "hpc_private_test",
    memberId: "member_private_test",
    originDirectChannel: null,
    originSessionId: "session_phone_call",
    provider: "retell",
    providerCallId: null,
    requestKey: "request_private_test",
    resultEncrypted: null,
    resultJson: null,
    status: "starting",
    stopRequestedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function buildBackfillCandidate(
  overrides: Partial<HostedPhoneCallPrivateContentBackfillCandidate> = {},
): HostedPhoneCallPrivateContentBackfillCandidate {
  return {
    briefEncrypted: null,
    briefJson: VALID_BRIEF,
    id: "hpc_backfill_test",
    memberId: "member_backfill_test",
    resultEncrypted: null,
    resultJson: VALID_RESULT,
    updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    ...overrides,
  };
}

function createTestCrypto(): HostedPhoneCallCrypto {
  return {
    decryptBrief: async ({ value }) => hostedPhoneCallBriefSchema.parse(
      JSON.parse(value.replace(/^brief:/u, "")),
    ),
    decryptResult: async ({ value }) => hostedPhoneCallResultSchema.parse(
      JSON.parse(value.replace(/^result:/u, "")),
    ),
    encryptBrief: async ({ value }) => `brief:${JSON.stringify(value)}`,
    encryptResult: async ({ value }) => `result:${JSON.stringify(value)}`,
  };
}

function createBackfillStore(
  initialRows: HostedPhoneCallPrivateContentBackfillCandidate[],
  options: { conflict?: boolean } = {},
): {
  applyCalls: Array<Parameters<HostedPhoneCallPrivateContentBackfillStore["applyCandidate"]>[0]>;
  rows: HostedPhoneCallPrivateContentBackfillCandidate[];
  store: HostedPhoneCallPrivateContentBackfillStore;
} {
  const rows = initialRows.map((row) => ({ ...row }));
  const applyCalls: Array<Parameters<HostedPhoneCallPrivateContentBackfillStore["applyCandidate"]>[0]> = [];
  return {
    applyCalls,
    rows,
    store: {
      applyCandidate: async (input) => {
        applyCalls.push(input);
        if (options.conflict) {
          return false;
        }
        const row = rows.find((candidate) => candidate.id === input.id);
        if (
          !row
          || row.memberId !== input.memberId
          || row.updatedAt.getTime() !== input.updatedAt.getTime()
          || row.briefEncrypted !== input.expectedBriefEncrypted
          || row.resultEncrypted !== input.expectedResultEncrypted
          || !Object.is(row.briefJson, input.expectedBriefJson)
          || !Object.is(row.resultJson, input.expectedResultJson)
        ) {
          return false;
        }
        row.briefEncrypted = input.briefEncrypted;
        row.resultEncrypted = input.resultEncrypted;
        if (input.scrubBrief) {
          row.briefJson = null;
        }
        if (input.scrubResult) {
          row.resultJson = null;
        }
        return true;
      },
      listCandidates: async ({ take }) => rows
        .filter((row) => row.briefJson !== null || row.resultJson !== null)
        .slice(0, take),
    },
  };
}

function restoreDefaultSecureBoxCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(input.value.replace(/^hsb-test:/u, ""), "base64url").toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}
