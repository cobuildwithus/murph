import { beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), authority: vi.fn(), workspace: vi.fn(), control: vi.fn(), decode: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActivePrivyMemberAuthFromBearerToken: mocks.auth }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedWorkspace: mocks.workspace }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: () => ({ createBrowserVaultSession: mocks.control }) }));
vi.mock("@/src/lib/browser-vault/loader", () => ({
  parseBrowserVaultSessionResponse: (value: unknown) => value,
  decodeReadyBrowserVaultSession: mocks.decode,
}));
import { GET } from "../app/api/device-sync/companion/journal/route";

const replicaRef = {
  byteLength: 128, dataVersion: "d".repeat(64), generatedAt: "2026-04-20T08:00:00.000Z",
  keyId: "browser-vault-replica:d", objectKey: "users/browser-vault-replicas/opaque/replica.json",
  replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:test-root",
  schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
};
const request = () => new Request("https://app.example.test/api/device-sync/companion/journal?memberId=someone-else");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ member: { id: "member_native" } });
  mocks.authority.mockResolvedValue(undefined);
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: replicaRef, version: "v1" });
  mocks.control.mockResolvedValue({ state: "ready" });
  mocks.decode.mockResolvedValue({ client: { replica: { journal: { days: [], eventCount: 0 }, privateNotes: ["must not leave reader"] } } });
});

it("returns only the saved journal with no-store and derives identity from bearer auth", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ journal: { days: [], eventCount: 0 }, freshness: "stale" });
  expect(mocks.control).toHaveBeenCalledWith(expect.objectContaining({ userId: "member_native", requestedShards: ["core"] }));
  expect(mocks.decode).toHaveBeenCalledWith(expect.objectContaining({ expectedMemberId: "member_native" }));
  expect(mocks.authority).toHaveBeenCalledTimes(2);
});

it("does not fetch ciphertext without current member consent", async () => {
  mocks.authority.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", message: "Consent required.", httpStatus: 403 }));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(mocks.control).not.toHaveBeenCalled();
});

it("does not disclose a journal after access is revoked during the external read", async () => {
  mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", message: "Consent required.", httpStatus: 403 }));
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("days");
});

it("returns unavailable without starting a runtime or calculation when no replica exists", async () => {
  mocks.workspace.mockResolvedValue(null);
  const response = await GET(request());
  expect(await response.json()).toEqual({ journal: null, freshness: "stale" });
  expect(mocks.control).not.toHaveBeenCalled();
});

it("stops before workspace access when authentication fails", async () => {
  mocks.auth.mockRejectedValue(hostedOnboardingError({ code: "UNAUTHORIZED", message: "Sign in required.", httpStatus: 401 }));
  expect((await GET(request())).status).toBe(401);
  expect(mocks.authority).not.toHaveBeenCalled();
  expect(mocks.workspace).not.toHaveBeenCalled();
});
