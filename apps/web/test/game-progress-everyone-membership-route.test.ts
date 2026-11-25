import { beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), profile: vi.fn(), command: vi.fn() }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ gameProfile: { findUnique: mocks.profile } }) }));
vi.mock("@/src/lib/game/service", () => ({ runGameCommand: mocks.command }));
import { GET, PUT } from "../app/api/game/v1/progress/everyone/route";

const auth = { member: { id: "member-viewer" } };
const url = "https://example.test/api/game/v1/progress/everyone";
const put = (body: unknown) => PUT(new Request(url, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(auth); });

it.each([null, { everyoneJoinedAt: null }, { everyoneJoinedAt: new Date("2026-10-03T12:00:00Z") }])("reads only the own membership flag: %j", async profile => {
  mocks.profile.mockResolvedValue(profile);
  const response = await GET(new Request(url));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ joined: profile?.everyoneJoinedAt != null });
  expect(mocks.profile).toHaveBeenCalledExactlyOnceWith({ where: { memberId: "member-viewer" }, select: { everyoneJoinedAt: true } });
  expect(mocks.current).toHaveBeenCalledExactlyOnceWith(auth, expect.anything());
});

it.each([{}, { joined: null }, { joined: "true" }, { joined: 1 }, { joined: true, memberId: "member-other" }, { joined: false, firstName: "Maren" }])("rejects an invalid membership write before the command: %j", async body => {
  const response = await put(body);
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.command).not.toHaveBeenCalled();
});

it.each([true, false])("adapts membership %s to the canonical profile command", async joined => {
  mocks.command.mockResolvedValue({ ok: true, game: null, joined });
  const response = await put({ joined });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, joined });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const [input] = mocks.command.mock.calls[0]!;
  expect(input).toEqual({ actorMemberId: "member-viewer", command: { type: "setProfile", everyoneJoined: joined }, beforeMutationTx: expect.any(Function) });
  const tx = { synthetic: true };
  await input.beforeMutationTx(tx);
  expect(mocks.current).toHaveBeenCalledWith(auth, tx);
  expect(mocks.profile).not.toHaveBeenCalled();
});

it("preserves command refusal and revoked-session errors", async () => {
  mocks.command.mockResolvedValue({ ok: false, status: 409, error: { code: "PROFILE_REQUIRED", message: "Create a profile first." } });
  expect((await put({ joined: true })).status).toBe(409);
  mocks.current.mockRejectedValue(hostedOnboardingError({ code: "UNAUTHENTICATED", httpStatus: 401, message: "Sign in.", retryable: false }));
  mocks.profile.mockResolvedValue({ everyoneJoinedAt: new Date() });
  const response = await GET(new Request(url));
  expect(response.status).toBe(401);
  expect(await response.json()).not.toHaveProperty("joined");
});
