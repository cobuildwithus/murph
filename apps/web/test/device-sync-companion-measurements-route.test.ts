import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), authority: vi.fn(), submit: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: mocks.auth }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/member-actions/submit", () => ({ submitMemberAction: mocks.submit }));
import { POST } from "../app/api/device-sync/companion/measurements/route";

const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
const requestedAt = "2026-11-06T12:00:00.000Z";
const body = { actionId, requestedAt, metric: "estimated-vo2-max", value: 42.5 };
const request = (value: unknown = body, query = "") => new Request(`https://app.example.test/api/device-sync/companion/measurements${query}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic-native" }, body: JSON.stringify(value),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(requestedAt));
  mocks.auth.mockResolvedValue({ member: { id: "member_native" } });
  mocks.submit.mockImplementation(async input => {
    await input.assertCurrentAuthorityTx({ transaction: true });
    return { accepted: true, actionId: input.request.actionId, dedupeConflict: false };
  });
});
afterEach(() => vi.useRealTimers());

it("accepts a stable typed reading and retries the identical envelope", async () => {
  for (let i = 0; i < 2; i++) {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ accepted: true, actionId });
    vi.setSystemTime(new Date("2026-11-06T13:00:00.000Z"));
  }
  expect(mocks.submit.mock.calls[0]![0].request).toEqual(mocks.submit.mock.calls[1]![0].request);
  expect(mocks.submit.mock.calls[0]![0].request).toEqual({ actionId, requestedAt, schemaVersion: 1,
    action: { kind: "measurement.add", version: 1, metric: "estimated-vo2-max", value: 42.5 } });
  expect(mocks.current).toHaveBeenLastCalledWith({ member: { id: "member_native" } }, { transaction: true });
});

it.each([10, 90])("accepts the inclusive bound %s", async value => {
  expect((await POST(request({ ...body, value }))).status).toBe(202);
});

it.each([
  {}, { ...body, value: 9.9 }, { ...body, value: 90.1 }, { ...body, value: null },
  { ...body, value: "42" }, { ...body, metric: "weight" }, { ...body, actionId: "bad" },
  { ...body, requestedAt: "2026-11-06" }, { ...body, requestedAt: "2026-11-07T12:00:00.001Z" },
  { ...body, memberId: "other" }, { ...body, source: "manual" }, { ...body, unit: "ml/kg/min" },
])("rejects invalid input before append %j", async value => {
  expect((await POST(request(value))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("accepts the exact future boundary and delayed retries but rejects query parameters", async () => {
  expect((await POST(request({ ...body, requestedAt: "2026-11-07T12:00:00.000Z" }))).status).toBe(202);
  expect((await POST(request({ ...body, requestedAt: "2026-10-01T12:00:00.000Z" }))).status).toBe(202);
  mocks.submit.mockClear();
  expect((await POST(request(body, "?extra=1"))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("bounds streamed bodies and rejects malformed JSON", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...body, padding: "x".repeat(1100) })));
    controller.close();
  } });
  const streamed = new Request(request().url, { method: "POST", body: stream, duplex: "half" } as RequestInit);
  expect((await POST(streamed)).status).toBe(413);
  expect((await POST(new Request(request().url, { method: "POST", body: "{" }))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each([401, 403])("preserves auth denial %s before parsing and inside admission", async httpStatus => {
  const error = hostedOnboardingError({ code: "AUTH_REVOKED", httpStatus, message: "Access changed." });
  mocks.auth.mockRejectedValueOnce(error);
  expect((await POST(request())).status).toBe(httpStatus);
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.current.mockRejectedValueOnce(error);
  expect((await POST(request())).status).toBe(httpStatus);
  mocks.authority.mockRejectedValueOnce(error);
  expect((await POST(request())).status).toBe(httpStatus);
});

it("returns conflict for different content at one action identity and retryable failure for unavailable saves", async () => {
  mocks.submit.mockResolvedValueOnce({ accepted: true, actionId, dedupeConflict: true });
  const conflict = await POST(request({ ...body, value: 43 }));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: { code: "MEMBER_ACTION_ID_CONFLICT", retryable: false } });
  mocks.submit.mockRejectedValueOnce(new Error("synthetic unavailable mailbox"));
  const unavailable = await POST(request());
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ error: { code: "MEASUREMENT_SAVE_UNAVAILABLE", retryable: true } });
});
