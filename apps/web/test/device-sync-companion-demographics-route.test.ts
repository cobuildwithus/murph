import { beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), authority: vi.fn(), workspace: vi.fn(), control: vi.fn(), decode: vi.fn(), submit: vi.fn(), status: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: mocks.auth }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedWorkspace: mocks.workspace }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: () => ({ createBrowserVaultSession: mocks.control }) }));
vi.mock("@/src/lib/member-actions/submit", () => ({ submitMemberAction: mocks.submit }));
vi.mock("@/src/lib/member-actions/outcome", () => ({ readMemberActionStatus: mocks.status }));
vi.mock("@/src/lib/browser-vault/loader", () => ({ parseBrowserVaultSessionResponse: (value: unknown) => value, decodeReadyBrowserVaultSession: mocks.decode }));
import { PUT } from "../app/api/device-sync/companion/demographics/route";
import { GET } from "../app/api/device-sync/companion/member-actions/[actionId]/route";
const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
const requestedAt = "2025-12-31T23:30:00Z";
const body = { actionId, requestedAt, age: 39, biologicalSex: "female" };
const ref = {
  byteLength: 128, dataVersion: "d".repeat(64), generatedAt: "2026-11-04T18:00:00.000Z", generation: 18,
  keyId: "browser-vault-replica:d", objectKey: "users/browser-vault-replicas/opaque/replica.json",
  replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:test-root",
  schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
};
const request = (value: unknown = body) => new Request("https://app.example.test/api/device-sync/companion/demographics", { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer synthetic-native" }, body: JSON.stringify(value) });
const statusRequest = () => new Request(`https://app.example.test/api/device-sync/companion/member-actions/${actionId}`, { headers: { authorization: "Bearer synthetic-native" } });
const context = (id = actionId) => ({ params: Promise.resolve({ actionId: id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ member: { id: "member_native" } });
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: ref, version: "v1" });
  mocks.control.mockResolvedValue({ state: "ready" });
  mocks.decode.mockResolvedValue({ client: { replica: { generation: 18, demographics: { birthYear: null, birthYearPrecision: null, biologicalSex: null, status: "resolved", revision: "a".repeat(64) } } } });
  mocks.submit.mockImplementation(async input => {
    await input.assertCurrentAuthorityTx({ transaction: true });
    return { accepted: true, actionId, dedupeConflict: false };
  });
  mocks.status.mockResolvedValue({ actionId, schemaVersion: 1, status: "pending" });
});

it("retains the original envelope when an acceptance response is lost and the request is retried", async () => {
  for (let i = 0; i < 2; i++) {
    const response = await PUT(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ accepted: true, actionId });
  }
  expect(mocks.submit.mock.calls[0]![0].request).toEqual(mocks.submit.mock.calls[1]![0].request);
  expect(mocks.submit.mock.calls[0]![0].request).toEqual({ actionId, requestedAt, schemaVersion: 1, action: { kind: "demographics.set", version: 1, patch: { age: 39, biologicalSex: "female" } } });
  expect(mocks.current).toHaveBeenLastCalledWith({ member: { id: "member_native" } }, { transaction: true });
  expect(mocks.control).toHaveBeenCalledWith(expect.objectContaining({ userId: "member_native", requestedShards: ["core"] }));
});

it("rejects action-ID collisions instead of reporting acceptance", async () => {
  mocks.submit.mockResolvedValue({ accepted: true, actionId, dedupeConflict: true });
  const response = await PUT(request({ ...body, age: 40 }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "MEMBER_ACTION_ID_CONFLICT" } });
});

it.each([
  {}, { actionId, requestedAt }, { ...body, actionId: "bad" }, { ...body, requestedAt: "bad" },
  { ...body, age: 12 }, { ...body, age: 121 }, { ...body, age: 39.5 },
  { actionId, requestedAt, birthYear: 1899 }, { actionId, requestedAt, birthYear: 9999 },
  { ...body, birthYear: null }, { ...body, biologicalSex: "woman" }, { ...body, memberId: "other" },
])("rejects invalid bounded demographic requests %j", async value => {
  expect((await PUT(request(value))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("accepts explicit clearing, bounds streamed bodies, and requires no Messages credential", async () => {
  expect((await PUT(request({ actionId, requestedAt, birthYear: null, biologicalSex: null }))).status).toBe(202);
  expect(mocks.submit.mock.calls[0]![0].request.action.patch).toEqual({ birthYear: null, biologicalSex: null });
  expect((await PUT(request({ ...body, padding: "x".repeat(1100) }))).status).toBe(413);
  expect(mocks.auth).toHaveBeenCalled();
});

it.each([null, { ...ref, generation: 17 }])("requires gen-18 reference before fetching or admitting", async replicaRef => {
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: replicaRef });
  expect((await PUT(request())).status).toBe(503);
  expect(mocks.control).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each([{ generation: 17, demographics: {} }, { generation: 18 }])("also requires a decoded compatible projection", async replica => {
  mocks.decode.mockResolvedValue({ client: { replica } });
  expect((await PUT(request())).status).toBe(503);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each([401, 403])("revalidates native session and current consent at admission and after outcome reads (%i)", async httpStatus => {
  const error = hostedOnboardingError({ code: "AUTH_REVOKED", httpStatus, message: "Access changed." });
  mocks.current.mockRejectedValue(error);
  expect((await PUT(request())).status).toBe(httpStatus);
  expect((await GET(statusRequest(), context())).status).toBe(httpStatus);
  mocks.current.mockResolvedValue(undefined);
  mocks.authority.mockRejectedValue(error);
  expect((await PUT(request())).status).toBe(httpStatus);
  expect((await GET(statusRequest(), context())).status).toBe(httpStatus);
});

it.each(["pending", "applied", "unchanged", "rejected"] as const)("returns member-scoped %s regardless of projection publication", async status => {
  const outcome = status === "pending" ? { actionId, schemaVersion: 1, status }
    : { actionId, schemaVersion: 1, status, completedAt: requestedAt, reason: status === "rejected" ? "demographics_unresolved" : null };
  mocks.status.mockResolvedValue(outcome);
  mocks.workspace.mockRejectedValue(new Error("publication delayed"));
  const response = await GET(statusRequest(), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(outcome);
  expect(mocks.status).toHaveBeenCalledWith({ actionId, memberId: "member_native", prisma: {} });
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(mocks.control).not.toHaveBeenCalled();
});

it("rejects invalid status IDs and missing native auth before reading private outcomes", async () => {
  expect((await GET(statusRequest(), context("bad"))).status).toBe(400);
  mocks.auth.mockRejectedValue(hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in." }));
  expect((await GET(statusRequest(), context())).status).toBe(401);
  expect(mocks.status).not.toHaveBeenCalled();
});
