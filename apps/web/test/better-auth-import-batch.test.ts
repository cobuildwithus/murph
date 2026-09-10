import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn(), access: vi.fn() }));
vi.mock("../src/lib/better-auth/migration-source", async (original) => ({
  ...await original<typeof import("../src/lib/better-auth/migration-source")>(), prepareHostedAuthImport: mocks.prepare,
}));
vi.mock("../src/lib/better-auth/import", () => ({ importHostedAuthMember: mocks.apply }));
vi.mock("../src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
import { importHostedAuthBatch } from "../src/lib/better-auth/import-batch";
import { HostedAuthMigrationConflictError } from "../src/lib/better-auth/migration-source";
import { POST } from "../app/api/ops/auth-migration/route";

const prisma = getPrisma();
const page = Array.from({ length: 6 }, (_, index) => ({ id: `synthetic-member-${index}` }));
const request = (body: unknown) => new Request("https://www.withmurph.ai/api/ops/auth-migration", {
  method: "POST", headers: { origin: "https://www.withmurph.ai", "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "false");
  mocks.prepare.mockResolvedValue({ kind: "prepared" });
  mocks.apply.mockResolvedValue("imported");
  mocks.access.mockResolvedValue({ member: { id: "synthetic-operator" } });
  vi.spyOn(prisma.hostedMember, "findMany").mockResolvedValue(page as never);
});

describe("hosted auth migration operation", () => {
  it("inspects at most five members per keyset page without applying", async () => {
    const result = await importHostedAuthBatch({ prisma, mode: "dry-run", after: "synthetic-cursor" });
    expect(prisma.hostedMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 6, orderBy: { id: "asc" }, where: expect.objectContaining({ id: { gt: "synthetic-cursor" } }),
    }));
    expect(result.results).toHaveLength(5);
    expect(result.next).toBe(page[4].id);
    expect(result.unresolved).toBe(0);
    expect(mocks.prepare).toHaveBeenCalledTimes(5);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("preserves idempotent outcomes and reports blocked members without provider details", async () => {
    mocks.apply.mockResolvedValueOnce("already_owned").mockRejectedValueOnce(new HostedAuthMigrationConflictError())
      .mockRejectedValueOnce(new Error("synthetic private provider token"))
      .mockRejectedValueOnce(hostedOnboardingError({ code: "HOSTED_MEMBER_SUSPENDED", httpStatus: 403, message: "Suspended" }))
      .mockResolvedValueOnce("imported");
    const result = await importHostedAuthBatch({ prisma, mode: "apply" });
    expect(result.results.map(({ outcome }) => outcome)).toEqual(["already_owned", "conflict", "unavailable", "suspended", "imported"]);
    expect(result.unresolved).toBe(3);
    expect(JSON.stringify(result)).not.toContain("provider token");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("requires operator and origin authority before reading a page", async () => {
    mocks.access.mockRejectedValueOnce(hostedOnboardingError({ code: "HOSTED_OPS_ACCESS_DENIED", httpStatus: 404, message: "Not found" }));
    expect((await POST(request({ mode: "apply" }))).status).toBe(404);
    expect(mocks.access).toHaveBeenCalledWith(expect.any(Request), { requireMutationOrigin: true });
    expect(prisma.hostedMember.findMany).not.toHaveBeenCalled();
  });

  it("defaults to inspection and blocks apply during an issuance pause", async () => {
    expect((await POST(request({}))).status).toBe(200);
    expect((await POST(request({ mode: "apply" }))).status).toBe(503);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect((await POST(request({ mode: "apply", memberId: "unscoped" }))).status).toBe(400);
  });
});
