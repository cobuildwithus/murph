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
      resultEncrypted,
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

  it("returns no result while encrypted analysis is absent", async () => {
    const call = buildHostedPhoneCall({ resultEncrypted: null });
    await expect(readHostedPhoneCallResult({ call })).resolves.toBeNull();
  });

  it.each(["", "malformed-ciphertext"])(
    "fails closed for present %s",
    async (briefEncrypted) => {
      const decryptBrief = vi.fn(async () => {
        throw new Error("Ciphertext rejected.");
      });
      const crypto = {
        ...createTestCrypto(),
        decryptBrief,
      };
      const call = buildHostedPhoneCall({ briefEncrypted });

      await expect(readHostedPhoneCallBrief({ call, crypto })).rejects.toThrow(
        "Ciphertext rejected.",
      );
      expect(decryptBrief).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["", "malformed-ciphertext"])(
    "fails closed for present result %s",
    async (resultEncrypted) => {
      const decryptResult = vi.fn(async () => {
        throw new Error("Result ciphertext rejected.");
      });
      const crypto = {
        ...createTestCrypto(),
        decryptResult,
      };
      const call = buildHostedPhoneCall({ resultEncrypted });

      await expect(readHostedPhoneCallResult({ call, crypto })).rejects.toThrow(
        "Result ciphertext rejected.",
      );
      expect(decryptResult).toHaveBeenCalledTimes(1);
    },
  );


});

function buildHostedPhoneCall(overrides: Partial<HostedPhoneCall> = {}): HostedPhoneCall {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    analyzedAt: null,
    briefEncrypted: "synthetic-unread-brief",
    createdAt: now,
    endedAt: null,
    id: "hpc_private_test",
    memberId: "member_private_test",
    originSessionId: "session_phone_call",
    provider: "retell",
    providerCallId: null,
    requestKey: "request_private_test",
    resultEncrypted: null,
    resultDeliveryGeneration: 0,
    resultDeliveryStatus: null,
    resultDeliveryTerminalAt: null,
    resultNotificationChannel: null,
    status: "starting",
    stopRequestedAt: null,
    updatedAt: now,
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
