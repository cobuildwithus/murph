import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/retell/webhook/route";
import { POST as consult } from "../app/api/retell/functions/ask-murph/route";
import { createPrismaClient } from "@/src/lib/prisma";
import { encryptHostedPhoneCallResult } from "@/src/lib/phone-calls/crypto";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const edges = vi.hoisted(() => ({
  db: null as PrismaClient | null,
  brief: vi.fn(),
  destination: vi.fn(),
  root: vi.fn(),
  signal: vi.fn(),
  failResult: false,
  failAppend: false,
  failUsage: false,
}));
vi.mock("@/src/lib/prisma", async original => ({
  ...await original<typeof import("@/src/lib/prisma")>(),
  getPrisma: () => {
    if (!edges.db) throw new Error("Synthetic database missing.");
    return edges.db;
  },
}));
// Keep all call CAS, usage settlement, mailbox dedupe and transactions real.
// Only external key/routing/signal boundaries are stubbed; append and usage
// faults occur after real writes to exercise rollback and committed replay.
vi.mock("@/src/lib/phone-calls/crypto", async original => {
  const actual = await original<typeof import("@/src/lib/phone-calls/crypto")>();
  return { ...actual, readHostedPhoneCallBrief: edges.brief,
    readHostedPhoneCallResult: async (input: Parameters<typeof actual.readHostedPhoneCallResult>[0]) => {
      if (edges.failResult) {
        edges.failResult = false;
        throw new TypeError("Synthetic stored result key unavailable.");
      }
      return actual.readHostedPhoneCallResult(input);
    },
  };
});
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async original => ({
  ...await original<typeof import("@/src/lib/hosted-routing/assistant-notification-destination")>(),
  requireHostedAssistantNotificationDestination: edges.destination,
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async original => ({
  ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  unwrapHostedDomainRootForWeb: edges.root,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: edges.signal,
}));
vi.mock("@/src/lib/phone-calls/reconciliation-workflow-signal", () => ({
  signalHostedPhoneCallReconciliation: vi.fn(),
}));
vi.mock("@/src/lib/hosted-mailbox/store", async original => {
  const actual = await original<typeof import("@/src/lib/hosted-mailbox/store")>();
  return { ...actual, appendHostedMailboxEnvelopeTx: async (
    input: Parameters<typeof actual.appendHostedMailboxEnvelopeTx>[0],
  ) => {
    const result = await actual.appendHostedMailboxEnvelopeTx(input);
    if (edges.failAppend) {
      edges.failAppend = false;
      throw new TypeError("Synthetic failure before mailbox commit.");
    }
    return result;
  } };
});
vi.mock("@/src/lib/phone-calls/usage", async original => {
  const actual = await original<typeof import("@/src/lib/phone-calls/usage")>();
  return { ...actual, accountRetellPhoneCallUsage: async (
    input: Parameters<typeof actual.accountRetellPhoneCallUsage>[0],
  ) => {
    const result = await actual.accountRetellPhoneCallUsage(input);
    if (edges.failUsage) {
      edges.failUsage = false;
      throw new TypeError("Synthetic failure after usage commit.");
    }
    return result;
  } };
});

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)
    || url.search || url.hash) throw new Error("Retell replay proof requires local test PostgreSQL.");
}

// Routing and brief decoding are external seams in this database proof.
const brief: HostedPhoneCallBrief = {
  allowTransferToUser: false, goal: "Confirm opening hours.", instructions: [], shareableFacts: { opening_hours: "Open on Sunday." },
  successCriteria: "Opening hours confirmed.", timeZone: "UTC",
  to: { label: "Synthetic recipient", phoneNumber: "" },
};

function signedRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const digest = createHmac("sha256", "synthetic-retell-key").update(`${body}${timestamp}`).digest("hex");
  return new Request("https://example.test/api/retell", {
    method: "POST", body,
    headers: { "x-retell-signature": `v=${timestamp},d=${digest}`, "content-type": "application/json" },
  });
}

async function fixture(run: (input: { db: PrismaClient; id: string; memberId: string }) => Promise<void>) {
  const db = createPrismaClient({ databaseUrl, poolMax: 4 });
  edges.db = db;
  const memberId = `synthetic-retell-${randomUUID()}`;
  const id = `synthetic-call-${randomUUID()}`;
  let created = false;
  try {
    await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    created = true;
    await db.hostedWorkspace.create({ data: { userId: memberId } });
    await db.hostedPhoneCall.create({ data: {
      id, memberId, requestKey: id, status: "calling", provider: "retell", providerCallId: id,
      briefEncrypted: "synthetic-brief", resultNotificationChannel: "telegram", resultDeliveryGeneration: 0,
    } });
    await run({ db, id, memberId });
  } finally {
    try {
      if (created) await db.hostedMember.deleteMany({ where: { id: memberId } });
    } finally {
      await db.$disconnect();
      edges.db = null;
    }
  }
}

function payload(id: string, event = "call_analyzed") {
  return { event, call: {
    call_id: id, metadata: { murph_phone_call_id: id }, data_storage_setting: "basic_attributes_only",
    start_timestamp: 1_800_000_000_000, end_timestamp: 1_800_000_060_000,
    call_cost: { combined_cost: 12.5 },
    call_analysis: { custom_analysis_data: { outcome: "completed", result: "Opening hours confirmed." } },
    ...(event === "transfer_ended" ? { disconnection_reason: "call_transfer", transfer_end_timestamp: 1_800_000_090_000 } : {}),
  } };
}

async function state(db: PrismaClient, id: string, memberId: string) {
  return {
    call: await db.hostedPhoneCall.findUniqueOrThrow({ where: { id }, select: {
      analyzedAt: true, endedAt: true, resultEncrypted: true, resultDeliveryGeneration: true, resultDeliveryStatus: true,
    } }),
    mailbox: await db.hostedMailboxItem.findMany({ where: { userId: memberId }, select: { id: true, dedupeKey: true } }),
    usage: await db.hostedAiUsage.findMany({ where: { memberId }, select: { id: true, allowanceCostUsdMicros: true } }),
    periods: await db.hostedAiUsagePeriod.findMany({ where: { memberId }, select: { spentUsdMicros: true } }),
  };
}

describe.skipIf(!enabled)("Retell route PostgreSQL replay", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    edges.failResult = false;
    edges.failAppend = false;
    edges.failUsage = false;
    vi.stubEnv("RETELL_API_KEY", "synthetic-retell-key");
    edges.brief.mockResolvedValue(brief);
    edges.destination.mockResolvedValue({
      conversationShape: "direct-member", externalThreadRouteAuthority: null,
      route: { actorId: null, channel: "telegram", identityId: null, threadId: "synthetic-thread",
        threadIsDirect: true, delivery: { kind: "thread", target: "synthetic-thread" } },
    });
    edges.root.mockImplementation(async () => ({ rootKey: new Uint8Array(32) }));
  });

  it.each(["success", "result", "brief", "route", "root", "append", "usage", "signal"] as const)(
    "dedupes partial effects and lost responses after %s", async phase => fixture(async ({ db, id, memberId }) => {
      if (phase === "result") {
        const resultEncrypted = await encryptHostedPhoneCallResult({ callId: id, memberId,
          value: { outcome: "completed", summary: "Opening hours confirmed." } });
        await db.hostedPhoneCall.update({ where: { id }, data: {
          analyzedAt: new Date(), resultEncrypted, resultDeliveryStatus: "pending", status: "completed",
        } });
        edges.failResult = true;
      }
      if (phase === "brief") edges.brief.mockRejectedValueOnce(new TypeError("Synthetic decrypt failure."));
      if (phase === "route") edges.destination.mockRejectedValueOnce(hostedOnboardingError({
        code: "HOSTED_ASSISTANT_NOTIFICATION_ROUTE_REQUIRED", httpStatus: 409, message: "Synthetic route unavailable.",
      }));
      if (phase === "root") edges.root.mockRejectedValueOnce(new TypeError("Synthetic key unavailable."));
      if (phase === "append") edges.failAppend = true;
      if (phase === "usage") edges.failUsage = true;
      if (phase === "signal") edges.signal.mockRejectedValueOnce(new TypeError("Synthetic signal failure."));
      const first = await POST(signedRequest(payload(id)));
      // A member with no route keeps its 409; Retell resends any non-2xx.
      expect(first.status).toBe(phase === "success" ? 204 : phase === "route" ? 409 : ["result", "brief"].includes(phase) ? 503 : 500);
      const partial = await state(db, id, memberId);
      expect(partial.call.resultEncrypted).not.toBeNull();
      expect(partial.usage).toHaveLength(1);
      if (["result", "brief", "route", "root", "append"].includes(phase)) {
        expect(partial.mailbox).toHaveLength(0);
        expect(partial.call.resultDeliveryGeneration).toBe(0);
      }
      expect((await POST(signedRequest(payload(id)))).status).toBe(204);
      const committed = await state(db, id, memberId);
      expect(committed.call.resultEncrypted).toBe(partial.call.resultEncrypted);
      expect(committed.call.resultDeliveryGeneration).toBe(1);
      expect(committed.mailbox).toHaveLength(1);
      expect(committed.usage).toHaveLength(1);
      expect(committed.periods).toEqual([{ spentUsdMicros: committed.usage[0]!.allowanceCostUsdMicros }]);
      // Discard the successful response; provider retries concurrently.
      expect((await Promise.all([POST(signedRequest(payload(id))), POST(signedRequest(payload(id)))]))
        .map(response => response.status)).toEqual([204, 204]);
      expect(await state(db, id, memberId)).toEqual(committed);
    }),
  );

  it.each(["call_ended", "transfer_ended"])("dedupes %s after usage committed but its response failed", async event =>
    fixture(async ({ db, id, memberId }) => {
      edges.failUsage = true;
      expect((await POST(signedRequest(payload(id, event)))).status).toBe(500);
      const committed = await state(db, id, memberId);
      expect(committed.usage).toHaveLength(1);
      expect((await POST(signedRequest(payload(id, event)))).status).toBe(204);
      expect((await POST(signedRequest(payload(id, event)))).status).toBe(204);
      expect(await state(db, id, memberId)).toEqual(committed);
    }),
  );

  it("reuses the consultation provider claim after decryption failure and lost response", async () =>
    fixture(async ({ db, id, memberId }) => {
      await db.hostedPhoneCall.update({ where: { id }, data: { providerCallId: null, status: "starting" } });
      edges.brief.mockRejectedValueOnce(new TypeError("Synthetic decrypt failure."));
      const request = () => signedRequest({ ...payload(id), args: { question: "What are the opening hours?" } });
      expect((await consult(request())).status).toBe(500);
      const claimed = await db.hostedPhoneCall.findUniqueOrThrow({ where: { id } });
      expect(claimed.providerCallId).toBe(id);
      expect(claimed.status).toBe("calling");
      const response = await consult(request());
      expect(response.status).toBe(200);
      const advice = await response.json();
      expect(advice.directive).toBe("continue");
      const replay = await consult(request());
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(advice);
      expect(await db.hostedPhoneCall.findUniqueOrThrow({ where: { id } })).toEqual(claimed);
      expect((await state(db, id, memberId)).usage).toHaveLength(0);
    }),
  );
});
