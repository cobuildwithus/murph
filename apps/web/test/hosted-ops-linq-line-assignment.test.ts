import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  origin: vi.fn(),
  findMany: vi.fn(),
  updateManyAndReturn: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.session,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.origin,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ hostedLinqLine: mocks }),
}));

import { GET, POST } from "../app/api/ops/linq-line-assignment/route";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const line = { assignmentWeight: 0, phoneNumberHint: "*** 0001", phoneNumberLookupKey: "lookup:line-test" };
const request = (body?: unknown) => new Request("https://www.withmurph.ai/api/ops/linq-line-assignment", {
  ...(body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("HOSTED_OPS_MEMBER_IDS", "member_ops");
  mocks.session.mockResolvedValue({ member: { id: "member_ops" } });
  mocks.findMany.mockResolvedValue([line]);
  mocks.updateManyAndReturn.mockResolvedValue([line]);
});
afterEach(() => vi.unstubAllEnvs());

describe("Linq assignment operator route", () => {
  it("lists drained configured lines using only a bounded safe projection", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lines: [line] });
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { configuredAt: { not: null } },
      select: { assignmentWeight: true, phoneNumberHint: true, phoneNumberLookupKey: true },
      orderBy: { phoneNumberLookupKey: "asc" }, take: 251,
    });
  });

  it.each([0, 100])("updates only one configured line's weight to %s and returns its committed value", async assignmentWeight => {
    mocks.updateManyAndReturn.mockResolvedValue([{ ...line, assignmentWeight }]);
    const req = request({ phoneNumberLookupKey: line.phoneNumberLookupKey, assignmentWeight });
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ line: { ...line, assignmentWeight } });
    expect(mocks.origin).toHaveBeenCalledExactlyOnceWith(req);
    expect(mocks.updateManyAndReturn).toHaveBeenCalledExactlyOnceWith({
      where: { configuredAt: { not: null }, phoneNumberLookupKey: line.phoneNumberLookupKey },
      data: { assignmentWeight },
      select: { assignmentWeight: true, phoneNumberHint: true, phoneNumberLookupKey: true },
    });
  });

  it("rejects non-operators before reading or changing any line", async () => {
    mocks.session.mockResolvedValue({ member: { id: "member_regular" } });
    expect((await GET(request())).status).toBe(404);
    expect((await POST(request(line))).status).toBe(404);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it("rejects missing sessions and foreign mutation origins before changing a line", async () => {
    mocks.session.mockRejectedValueOnce(hostedOnboardingError({ code: "TEST_SESSION_REQUIRED", httpStatus: 401, message: "Session required." }));
    expect((await POST(request(line))).status).toBe(401);
    mocks.origin.mockImplementationOnce(() => { throw hostedOnboardingError({ code: "TEST_ORIGIN_REJECTED", httpStatus: 403, message: "Origin rejected." }); });
    expect((await POST(request(line))).status).toBe(403);
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, 10001, "0", null])("rejects invalid weight %s", async assignmentWeight => {
    expect((await POST(request({ ...line, assignmentWeight }))).status).toBe(400);
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it("refuses an unknown or unconfigured line without inserting it", async () => {
    mocks.updateManyAndReturn.mockResolvedValue([]);
    expect((await POST(request(line))).status).toBe(404);
  });

  it("fails closed instead of returning a partial inventory", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 251 }, () => line));
    expect((await GET(request())).status).toBe(409);
  });
});
