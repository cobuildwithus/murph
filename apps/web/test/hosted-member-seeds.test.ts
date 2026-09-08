import { setImmediate } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seedMocks = vi.hoisted(() => ({
  createMember: vi.fn(),
  disconnect: vi.fn(),
  routeMember: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  createPrismaClient: () => ({
    $disconnect: seedMocks.disconnect,
    $transaction: async (operation: (tx: object) => Promise<void>) => operation({}),
  }),
}));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedPhoneLookupKey: () => "synthetic-phone-key",
  createHostedPhoneLookupKeyReadCandidates: () => [],
  readHostedPhoneHint: () => "0001",
}));
vi.mock("../src/lib/hosted-crypto/domain-root-store", () => ({
  provisionHostedCryptoDomainRootsForUserTx: vi.fn(),
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  upsertHostedMemberIdentity: vi.fn(),
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: seedMocks.routeMember,
  upsertHostedMemberTelegramRoutingBindingTx: vi.fn(),
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-store", () => ({
  createHostedMember: seedMocks.createMember,
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRefTx: vi.fn(),
}));
vi.mock("../src/lib/hosted-onboarding/starter-usage-grant", () => ({
  ensureHostedStarterUsageGrantTx: vi.fn(),
}));
vi.mock("../src/lib/hosted-onboarding/linq-daily-state", () => ({
  incrementHostedLinqInboundDailyState: vi.fn(),
}));
vi.mock("../src/lib/hosted-onboarding/linq-line-store", () => ({
  projectHostedLinqLineForDeliveryReceiptTx: vi.fn(),
  upsertHostedLinqLineForPhoneTx: vi.fn(),
}));

import { seedHostedActiveLinqMember } from "./support/hosted-member-seeds";

function seed(memberId: string, environment?: NodeJS.ProcessEnv) {
  return seedHostedActiveLinqMember({
    environment,
    homePhone: "+15559870002",
    memberId,
    memberPhone: "+15559870001",
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("hosted member seed environment ownership", () => {
  let originalEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnvironment = { ...process.env };
    process.env.HOSTED_MAILBOX_FINGERPRINT_KEY = "synthetic-original";
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it.each([false, true])("serializes routing and restores environment after first failure=%s", async (failFirst) => {
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const routes: Array<[string, string | undefined]> = [];
    const failure = new Error("synthetic seed failure");
    seedMocks.createMember.mockImplementation(async ({ memberId }: { memberId: string }) => {
      if (memberId === "member_first") {
        firstEntered.resolve();
        await releaseFirst.promise;
        if (failFirst) throw failure;
      }
    });
    seedMocks.routeMember.mockImplementation(async ({ memberId }: { memberId: string }) => {
      routes.push([memberId, process.env.HOSTED_MAILBOX_FINGERPRINT_KEY]);
    });

    const first = seed("member_first", { NODE_ENV: "test", HOSTED_MAILBOX_FINGERPRINT_KEY: "synthetic-first" });
    const firstOutcome = first.catch((error: unknown) => error);
    await Promise.race([firstEntered.promise, first]);
    const second = seed("member_second", { NODE_ENV: "test", HOSTED_MAILBOX_FINGERPRINT_KEY: "synthetic-second" });
    const secondOutcome = second.catch((error: unknown) => error);
    try {
      await setImmediate();
      expect(seedMocks.createMember).toHaveBeenCalledTimes(1);
      expect(process.env.HOSTED_MAILBOX_FINGERPRINT_KEY).toBe("synthetic-first");
    } finally {
      releaseFirst.resolve();
      await Promise.all([firstOutcome, secondOutcome]);
    }

    expect(await firstOutcome).toBe(failFirst ? failure : undefined);
    expect(await secondOutcome).toBeUndefined();
    expect(routes).toEqual([
      ...(failFirst ? [] : [["member_first", "synthetic-first"]]),
      ["member_second", "synthetic-second"],
    ]);
    expect(seedMocks.disconnect).toHaveBeenCalledTimes(2);
    expect(process.env.HOSTED_MAILBOX_FINGERPRINT_KEY).toBe("synthetic-original");
  });

  it.each([false, true])("resolves queued ambient environment after restoration, explicit process.env=%s", async (explicit) => {
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const observed: Array<string | undefined> = [];
    seedMocks.createMember.mockImplementation(async ({ memberId }: { memberId: string }) => {
      if (memberId === "member_first") {
        firstEntered.resolve();
        await releaseFirst.promise;
      } else {
        observed.push(process.env.HOSTED_MAILBOX_FINGERPRINT_KEY);
      }
    });
    const first = seed("member_first", { NODE_ENV: "test", HOSTED_MAILBOX_FINGERPRINT_KEY: "synthetic-first" });
    await Promise.race([firstEntered.promise, first]);
    const second = seed("member_second", explicit ? process.env : undefined);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(observed).toEqual(["synthetic-original"]);
    expect(process.env.HOSTED_MAILBOX_FINGERPRINT_KEY).toBe("synthetic-original");
  });
});
