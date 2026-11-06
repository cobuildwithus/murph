import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), parse: vi.fn(), recover: vi.fn(), signal: vi.fn(), after: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: mocks.authenticate }));
vi.mock("@murphai/hosted-execution/runtime-resources", () => ({ parseHostedCheckpointRecoveryRequest: mocks.parse }));
vi.mock("@/src/lib/hosted-workspace/checkpoint-recovery", () => ({ recoverHostedWorkspaceCheckpoint: mocks.recover }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedRuntimeRecheckRuntime: mocks.signal }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "../app/api/internal/hosted-workspace/recovery/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: "synthetic-member", payload: { synthetic: true } });
  mocks.parse.mockReturnValue({ synthetic: true });
  mocks.recover.mockResolvedValue({ status: "staged", workspaceVersion: "7" });
  mocks.signal.mockResolvedValue(undefined);
});

it("rejects runtime capability URLs and headers before recovery admission", async () => {
  for (const request of [new Request("https://example.invalid/api/internal/hosted-workspace/recovery?runtimeAuthority=1", { method: "POST" }),
    new Request("https://example.invalid/api/internal/hosted-workspace/recovery", { method: "POST", headers: { "x-hosted-runtime-attempt-id": "synthetic" } })]) {
    expect((await POST(request)).status).toBe(403);
  }
  expect(mocks.authenticate).not.toHaveBeenCalled();
  expect(mocks.recover).not.toHaveBeenCalled();
});

it("binds recovery to the authenticated member and wakes only after publication", async () => {
  const request = () => new Request("https://example.invalid/api/internal/hosted-workspace/recovery", { method: "POST", body: "{}" });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { maxBodyBytes: 65536 });
  expect(mocks.recover).toHaveBeenCalledWith(expect.objectContaining({ userId: "synthetic-member", request: { synthetic: true } }));
  expect(mocks.after).not.toHaveBeenCalled();
  mocks.recover.mockResolvedValue({ status: "published", workspaceVersion: "8" });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.after).toHaveBeenCalledTimes(1);
  await mocks.after.mock.calls[0]![0]();
  expect(mocks.signal).toHaveBeenCalledWith({ userId: "synthetic-member" });
});

it("does not reach the mutation owner when signed callback authentication fails", async () => {
  mocks.authenticate.mockRejectedValue(new TypeError("Synthetic authentication rejection"));
  expect((await POST(new Request("https://example.invalid/api/internal/hosted-workspace/recovery", { method: "POST" }))).status).not.toBe(200);
  expect(mocks.recover).not.toHaveBeenCalled();
});
