import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAssignablePoolReady: vi.fn(),
  getEnvironment: vi.fn(),
  getPrisma: vi.fn(),
  syncConfiguredLines: vi.fn(),
  syncProviderInventory: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("../src/lib/hosted-onboarding/linq-line-store", () => ({
  assertHostedLinqAssignableHomeLinePoolReady: mocks.assertAssignablePoolReady,
  syncHostedLinqConfiguredLinesTx: mocks.syncConfiguredLines,
}));
vi.mock("../src/lib/hosted-onboarding/linq-phone-number-inventory", () => ({
  HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT: 100,
  syncHostedLinqPhoneNumberInventory: mocks.syncProviderInventory,
}));
vi.mock("../src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getEnvironment,
}));

import { syncHostedLinqLines } from "../scripts/sync-hosted-linq-lines";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");

function createPrismaOwner() {
  const transactionClient = {};
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const transaction = vi.fn(async (callback: (tx: object) => Promise<void>) => {
    await callback(transactionClient);
  });

  return {
    disconnect,
    prisma: {
      $disconnect: disconnect,
      $transaction: transaction,
    },
    transaction,
  };
}

describe("sync-hosted-linq-lines script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: [],
      linqMaxActiveMembersPerConversationPhone: 1,
    });
    mocks.syncConfiguredLines.mockResolvedValue(undefined);
    mocks.syncProviderInventory.mockResolvedValue({ syncedCount: 0 });
    mocks.assertAssignablePoolReady.mockResolvedValue(undefined);
  });

  it("validates the environment before acquiring the Prisma owner", async () => {
    const invalidEnvironment = new Error("invalid environment");
    mocks.getEnvironment.mockImplementation(() => {
      throw invalidEnvironment;
    });

    await expect(syncHostedLinqLines([])).rejects.toBe(invalidEnvironment);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("awaits one Prisma disconnect after a successful sync", async () => {
    const owner = createPrismaOwner();
    let releaseDisconnect: () => void = () => undefined;
    owner.disconnect.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    }));
    mocks.getPrisma.mockReturnValue(owner.prisma);

    let settled = false;
    const sync = syncHostedLinqLines([]).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(owner.disconnect).toHaveBeenCalledOnce();
    });

    expect(owner.transaction).toHaveBeenCalledOnce();
    expect(mocks.syncConfiguredLines).toHaveBeenCalledOnce();
    expect(mocks.syncProviderInventory).toHaveBeenCalledOnce();
    expect(mocks.assertAssignablePoolReady).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    releaseDisconnect();
    await sync;
    expect(settled).toBe(true);
  });

  it.each([
    ["transaction", mocks.syncConfiguredLines],
    ["provider inventory", mocks.syncProviderInventory],
    ["readiness", mocks.assertAssignablePoolReady],
  ])("disconnects once and preserves a %s failure", async (_stage, failingOperation) => {
    const owner = createPrismaOwner();
    const failure = new Error(`${_stage} failed`);
    mocks.getPrisma.mockReturnValue(owner.prisma);
    failingOperation.mockRejectedValueOnce(failure);

    await expect(syncHostedLinqLines([])).rejects.toBe(failure);
    expect(owner.disconnect).toHaveBeenCalledOnce();
  });

  it("omits malformed configured line values from stderr", () => {
    const rawLine = "15551234567";
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_OPTIONS;
    const result = spawnSync(
      "pnpm",
      [
        "--dir",
        "apps/web",
        "linq:sync-lines",
        "--",
        "--skip-provider-inventory",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...childEnvironment,
          DATABASE_URL: process.env.DATABASE_URL
            ?? "postgresql://postgres:postgres@127.0.0.1:1/murph_test",
          HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
          HOSTED_CONTACT_PRIVACY_KEYS: `v1:${TEST_KEY}`,
          HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS: `bad ${rawLine}`,
          NODE_ENV: "test",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS");
    expect(result.stderr).not.toContain("bad");
    expect(result.stderr).not.toContain(rawLine);
  });

  it("loads the legacy Stripe migration CLI without Next server conditions", () => {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_OPTIONS;
    const result = spawnSync(
      "pnpm",
      [
        "--dir",
        "apps/web",
        "stripe:migrate-legacy-usage-items",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: childEnvironment,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Legacy usage migration requires --stripe-mode=<test|live>.",
    );
    expect(result.stderr).not.toContain("server-only");
  });
});
