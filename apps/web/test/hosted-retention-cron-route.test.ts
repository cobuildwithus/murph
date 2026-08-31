import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVercelCronRequest: vi.fn(),
  runHostedControlPlaneRetentionCleanup: vi.fn(),
  runHostedExternalRetentionCleanup: vi.fn(),
  runHostedNonceRetentionCleanup: vi.fn(),
  runHostedRuntimeMaintenanceCleanup: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-retention/cleanup", () => ({
  runHostedControlPlaneRetentionCleanup:
    mocks.runHostedControlPlaneRetentionCleanup,
}));

vi.mock("@/src/lib/hosted-retention/external-cleanup", () => ({
  runHostedExternalRetentionCleanup: mocks.runHostedExternalRetentionCleanup,
}));

vi.mock("@/src/lib/hosted-retention/nonce-cleanup", () => ({
  runHostedNonceRetentionCleanup: mocks.runHostedNonceRetentionCleanup,
}));

vi.mock("@/src/lib/hosted-retention/runtime-maintenance-cleanup", () => ({
  runHostedRuntimeMaintenanceCleanup:
    mocks.runHostedRuntimeMaintenanceCleanup,
}));

type ControlPlaneRoute = typeof import("../app/api/internal/hosted-execution/retention/control-plane/cron/route");
type ExternalRoute = typeof import("../app/api/internal/hosted-execution/retention/external/cron/route");
type NonceRoute = typeof import("../app/api/internal/hosted-execution/retention/nonces/cron/route");
type RuntimeRoute = typeof import("../app/api/internal/hosted-execution/retention/runtime/cron/route");

let controlPlaneRoute: ControlPlaneRoute;
let externalRoute: ExternalRoute;
let nonceRoute: NonceRoute;
let runtimeRoute: RuntimeRoute;

describe("hosted retention cron routes", () => {
  beforeAll(async () => {
    [controlPlaneRoute, externalRoute, nonceRoute, runtimeRoute] =
      await Promise.all([
        import("../app/api/internal/hosted-execution/retention/control-plane/cron/route"),
        import("../app/api/internal/hosted-execution/retention/external/cron/route"),
        import("../app/api/internal/hosted-execution/retention/nonces/cron/route"),
        import("../app/api/internal/hosted-execution/retention/runtime/cron/route"),
      ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.runHostedControlPlaneRetentionCleanup.mockResolvedValue({
      expiredMailboxContentRetired: 7,
    });
    mocks.runHostedExternalRetentionCleanup.mockResolvedValue({
      accountDeletionCleanup: {
        completed: 1,
        failed: 0,
        pending: 2,
        selected: 3,
      },
      expiredComputerRunsCleanedUp: 4,
    });
    mocks.runHostedNonceRetentionCleanup.mockResolvedValue({
      expiredBrowserAssertionNoncesDeleted: 3,
      expiredCallbackRequestNoncesDeleted: 8,
    });
    mocks.runHostedRuntimeMaintenanceCleanup.mockResolvedValue({
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 3,
      oldRuntimeLogsDeleted: 6,
    });
  });

  it("runs ordinary control-plane retention in its own bounded route", async () => {
    expect(controlPlaneRoute.maxDuration).toBe(300);

    const response = await controlPlaneRoute.GET(requestFor("control-plane"));

    expectCronResponse(response);
    expect(mocks.runHostedControlPlaneRetentionCleanup).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      cleanup: { expiredMailboxContentRetired: 7 },
    });
  });

  it("gives only nonce retention the extended catch-up duration", async () => {
    expect(nonceRoute.maxDuration).toBe(800);

    const response = await nonceRoute.GET(requestFor("nonces"));

    expectCronResponse(response);
    expect(mocks.runHostedNonceRetentionCleanup).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      cleanup: {
        expiredBrowserAssertionNoncesDeleted: 3,
        expiredCallbackRequestNoncesDeleted: 8,
      },
    });
  });

  it("isolates external provider cleanup from the database owners", async () => {
    expect(externalRoute.maxDuration).toBe(300);

    const response = await externalRoute.GET(requestFor("external"));

    expectCronResponse(response);
    expect(mocks.runHostedExternalRetentionCleanup).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      cleanup: { expiredComputerRunsCleanedUp: 4 },
    });
  });

  it("isolates runtime signals and diagnostic-log retention", async () => {
    expect(runtimeRoute.maxDuration).toBe(300);

    const response = await runtimeRoute.GET(requestFor("runtime"));

    expectCronResponse(response);
    expect(mocks.runHostedRuntimeMaintenanceCleanup).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      cleanup: {
        inboxMediaRetentionRuntimeSignalFailures: 1,
        inboxMediaRetentionRuntimeSignalsSent: 3,
        oldRuntimeLogsDeleted: 6,
      },
    });
  });

  it("still runs nonce retention when external cleanup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runHostedExternalRetentionCleanup.mockRejectedValueOnce(
      new Error("HOSTED_COMPUTER_BROWSER_DELETE_FAILED"),
    );

    const externalResponse = await externalRoute.GET(requestFor("external"));
    const nonceResponse = await nonceRoute.GET(requestFor("nonces"));

    expect(externalResponse.status).toBe(500);
    expect(nonceResponse.status).toBe(200);
    expect(mocks.runHostedNonceRetentionCleanup).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

function requestFor(owner: string): Request {
  return new Request(
    `https://join.example.test/api/internal/hosted-execution/retention/${owner}/cron`,
  );
}

function expectCronResponse(response: Response): void {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
}
