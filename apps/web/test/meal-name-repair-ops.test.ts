import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ access: vi.fn(), overview: vi.fn(), submit: vi.fn(), status: vi.fn() }));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
vi.mock("@/src/lib/hosted-ops/runtime-maintenance", () => ({ readHostedRuntimeMaintenanceOverview: mocks.overview }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/member-actions/submit", () => ({ submitMemberAction: mocks.submit }));
vi.mock("@/src/lib/member-actions/outcome", () => ({ readMemberActionStatus: mocks.status }));
import { GET, POST } from "../app/api/ops/meal-name-repair/route";
import { mealNameRepairActionId } from "@/src/lib/hosted-ops/meal-name-repair";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ member: { id: "synthetic-owner" } }); mocks.submit.mockResolvedValue({ accepted: true }); });
it("binds owner selection and retries to one fixed mailbox request with mutation-origin authentication", async () => {
  const request = () => new Request("https://www.withmurph.ai/api/ops/meal-name-repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "owner", batch: 0 }) });
  expect((await POST(request())).status).toBe(200);
  expect((await POST(request())).status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith(expect.any(Request), { requireMutationOrigin: true });
  expect(mocks.submit.mock.calls[0]![0]).toEqual(mocks.submit.mock.calls[1]![0]);
  expect(mocks.submit.mock.calls[0]![0]).toMatchObject({ memberId: "synthetic-owner", request: { action: { kind: "meal.names.repair", version: 1, batch: 0 } } });
  expect(mealNameRepairActionId("synthetic-owner", 0)).not.toBe(mealNameRepairActionId("synthetic-other", 0));
});
it("denies unauthenticated mutation before enqueue", async () => {
  mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_OPS_ACCESS_DENIED", httpStatus: 404, message: "Unavailable" }));
  expect((await POST(new Request("https://www.withmurph.ai/api/ops/meal-name-repair", { method: "POST" }))).status).toBe(404);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("rejects model-controlled payloads and invalid batch identities", async () => {
  for (const body of [{ target: "owner", batch: -1 }, { target: "owner", batch: 0, prompt: "Change nutrition" }]) {
    expect((await POST(new Request("https://www.withmurph.ai/api/ops/meal-name-repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).status).toBe(400);
  }
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("paginates through the existing bounded workspace owner without profile or meal content", async () => {
  mocks.overview.mockResolvedValue({ candidates: [{ userId: "synthetic-member", snapshotRef: "private" }], nextCursor: "synthetic-member", totalCandidateCount: 12 });
  const result = await GET(new Request("https://www.withmurph.ai/api/ops/meal-name-repair?cursor=synthetic-before"));
  expect(await result.json()).toEqual({ targets: ["synthetic-member"], nextCursor: "synthetic-member", count: 12 });
  expect(mocks.overview).toHaveBeenCalledWith({ cursor: "synthetic-before", limit: 10 });
});
