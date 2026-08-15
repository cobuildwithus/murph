import type { HostedPhoneCall } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  accountRetellPhoneCallUsage,
  readRetellTerminalProviderUsage,
} from "@/src/lib/phone-calls/usage";

type UsageStore = NonNullable<Parameters<typeof accountRetellPhoneCallUsage>[0]["prisma"]>;
type UsageTx = Parameters<UsageStore["$transaction"]>[0] extends (
  tx: infer Tx,
) => Promise<unknown>
  ? Tx
  : never;

describe("Retell phone-call usage", () => {
  it("converts fractional cents and attributes usage from the stored call", async () => {
    const call = buildHostedPhoneCall();
    const store = createUsageStore(call);

    await expect(accountRetellPhoneCallUsage({
      call: {
        call_cost: { combined_cost: 7.125 },
        call_id: "retell_call_123",
        duration_ms: 61_250,
        end_timestamp: "2026-06-25T12:00:00.000Z",
        start_timestamp: "2026-06-25T11:58:58.750Z",
        metadata: {
          murph_phone_call_id: call.id,
        },
      },
      prisma: store.prisma,
    })).resolves.toBe("accounted");

    expect(store.recordUsage).toHaveBeenCalledWith({
      call,
      usage: {
        combinedCostUsdMicros: 71_250,
        occurredAt: new Date("2026-06-25T11:58:58.750Z"),
        providerCallId: "retell_call_123",
      },
    });
  });

  it("records legitimate zero-cost calls with the same stable facts on replay", async () => {
    const call = buildHostedPhoneCall();
    const store = createUsageStore(call);
    const providerCall = {
      call_cost: { combined_cost: 0 },
      call_id: "retell_call_123",
      end_timestamp: 1_782_386_400_000,
      start_timestamp: 1_782_386_340_000,
    };

    await accountRetellPhoneCallUsage({ call: providerCall, prisma: store.prisma });
    await accountRetellPhoneCallUsage({ call: providerCall, prisma: store.prisma });

    expect(store.recordUsage).toHaveBeenCalledTimes(2);
    expect(store.recordUsage.mock.calls[0]).toEqual(store.recordUsage.mock.calls[1]);
    expect(store.recordUsage).toHaveBeenLastCalledWith(expect.objectContaining({
      usage: expect.objectContaining({
        combinedCostUsdMicros: 0,
      }),
    }));
  });

  it("waits for a provider terminal timestamp before making usage immutable", async () => {
    const store = createUsageStore(buildHostedPhoneCall());

    await expect(accountRetellPhoneCallUsage({
      call: {
        call_cost: { combined_cost: 4.5 },
        call_id: "retell_call_123",
      },
      prisma: store.prisma,
    })).resolves.toBe("not_ready");

    expect(store.recordUsage).not.toHaveBeenCalled();
  });

  it("defers transferred calls until the transfer leg ends", async () => {
    const call = buildHostedPhoneCall();
    const store = createUsageStore(call);
    const transferredCall = {
      call_cost: { combined_cost: 12 },
      call_id: "retell_call_123",
      disconnection_reason: "call_transfer",
      end_timestamp: 1_782_386_400_000,
      start_timestamp: 1_782_386_340_000,
    };

    await expect(accountRetellPhoneCallUsage({
      call: transferredCall,
      prisma: store.prisma,
    })).resolves.toBe("not_ready");
    expect(store.recordUsage).not.toHaveBeenCalled();

    await expect(accountRetellPhoneCallUsage({
      call: {
        ...transferredCall,
        call_cost: { combined_cost: 18.75 },
        transfer_end_timestamp: 1_782_408_600_000,
      },
      prisma: store.prisma,
    })).resolves.toBe("accounted");
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      usage: expect.objectContaining({
        combinedCostUsdMicros: 187_500,
        occurredAt: new Date(1_782_386_340_000),
      }),
    }));
  });

  it("rejects provider-id mismatches without trusting callback metadata for member authority", async () => {
    const store = createUsageStore(buildHostedPhoneCall({
      providerCallId: "retell_other",
    }));

    await expect(accountRetellPhoneCallUsage({
      call: {
        call_cost: { combined_cost: 5 },
        call_id: "retell_call_123",
        end_timestamp: 1_782_386_400_000,
        start_timestamp: 1_782_386_340_000,
        metadata: {
          murph_phone_call_id: "hpc_123",
          member_id: "member_untrusted",
        },
      },
      prisma: store.prisma,
    })).resolves.toBe("not_found");
    expect(store.recordUsage).not.toHaveBeenCalled();
  });

  it("requires final provider cost and time during reconciliation", () => {
    expect(readRetellTerminalProviderUsage({
      call_id: "retell_call_123",
      end_timestamp: 1_782_386_400_000,
    })).toEqual({ state: "pending" });

    expect(readRetellTerminalProviderUsage({
      call_cost: { combined_cost: 3.3333 },
      call_id: "retell_call_123",
      duration_ms: 20_000,
      end_timestamp: 1_782_386_400_000,
    })).toEqual({
      state: "ready",
      usage: {
        combinedCostUsdMicros: 33_333,
        occurredAt: new Date(1_782_386_380_000),
        providerCallId: "retell_call_123",
      },
    });
  });
});

function buildHostedPhoneCall(overrides: Partial<HostedPhoneCall> = {}): HostedPhoneCall {
  const createdAt = new Date("2026-06-25T11:00:00.000Z");
  return {
    analyzedAt: null,
    briefEncrypted: null,
    briefJson: null,
    createdAt,
    endedAt: null,
    id: "hpc_123",
    memberId: "member_123",
    originSessionId: "session_phone_call",
    provider: "retell",
    providerCallId: "retell_call_123",
    requestKey: "request_123",
    resultEncrypted: null,
    resultJson: null,
    resultNotificationChannel: null,
    status: "calling",
    updatedAt: createdAt,
    ...overrides,
  };
}

function createUsageStore(call: HostedPhoneCall) {
  const recordUsage = vi.fn<UsageTx["recordUsage"]>(async () => undefined);
  const tx: UsageTx = {
    hostedPhoneCall: {
      findUnique: async ({ where }) => {
        if ("id" in where) {
          return where.id === call.id ? call : null;
        }
        return where.providerCallId === call.providerCallId ? call : null;
      },
    },
    recordUsage,
  };
  const prisma: UsageStore = {
    $transaction: async (callback) => callback(tx),
  };
  return {
    prisma,
    recordUsage,
  };
}
