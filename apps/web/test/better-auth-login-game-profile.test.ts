import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ verify: vi.fn(), find: vi.fn(), auth: vi.fn(), adopt: vi.fn() }));
vi.mock("@/src/lib/better-auth/otp-request", () => ({
  sendHostedAuthOtpRequest: vi.fn(), verifyHostedAuthOtpRequest: mocks.verify,
}));
vi.mock("@/src/lib/better-auth/transport", async importOriginal => ({
  ...await importOriginal<object>(), serializeHostedNativeSessionToken: () => "synthetic-native-token",
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ gameProfile: { findUnique: mocks.find } }) }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth }));
vi.mock("@/src/lib/game/vault-profile", () => ({ adoptVaultGameProfile: mocks.adopt }));

import { verifyHostedAuthCode } from "@/src/lib/better-auth/routes";

const memberId = "member_synthetic";
const auth = { member: { id: memberId } };
const expiresAt = new Date("2030-01-01T00:00:00.000Z");
const login = (transport: "browser" | "native" = "native") =>
  verifyHostedAuthCode(new Request("https://app.example.test/api/device-sync/companion/auth/otp/verify", { method: "POST" }), transport);

async function expectLoggedIn(response: Response) {
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, memberId, token: "synthetic-native-token" });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ expiresAt, headers: new Headers(), memberId, timeZone: "Europe/Paris", token: "issued" });
  mocks.find.mockResolvedValue(null);
  mocks.auth.mockResolvedValue(auth);
  mocks.adopt.mockResolvedValue(null);
});

it("picks up the name with the issued session and the phone's zone before answering", async () => {
  await expectLoggedIn(await login());
  expect(mocks.auth.mock.calls[0]![0].headers.get("authorization")).toBe("Bearer synthetic-native-token");
  expect(mocks.adopt).toHaveBeenCalledWith(auth, { timeZone: "Europe/Paris", timeoutMs: 2_000 });
});

it("a member with a profile stops at one lookup", async () => {
  mocks.find.mockResolvedValue({ memberId });
  await expectLoggedIn(await login());
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.adopt).not.toHaveBeenCalled();
});

it("browser login never reaches the pickup", async () => {
  expect((await login("browser")).status).toBe(200);
  expect(mocks.find).not.toHaveBeenCalled();
});

it.each([
  ["the profile lookup", () => mocks.find],
  ["the session check", () => mocks.auth],
  ["adoption", () => mocks.adopt],
])("a failure in %s never fails login", async (_step, mock) => {
  mock().mockRejectedValue(new Error("Synthetic pickup failure"));
  await expectLoggedIn(await login());
});

it.each([
  ["the profile lookup", () => mocks.find],
  ["the session check", () => mocks.auth],
  ["adoption", () => mocks.adopt],
])("a hang in %s releases login at the deadline", async (_step, mock) => {
  mock().mockReturnValue(new Promise(() => undefined));
  const started = Date.now();
  await expectLoggedIn(await login());
  expect(Date.now() - started).toBeGreaterThanOrEqual(2_400);
  expect(mock()).toHaveBeenCalled();
}, 5_000); // Without the deadline, this test never finishes.

// Last: replacing the module mock would otherwise leak into the tests after it.
it("game code that cannot load never fails login", async () => {
  vi.resetModules();
  vi.doMock("@/src/lib/game/vault-profile", () => { throw new Error("Synthetic load failure"); });
  const routes = await import("@/src/lib/better-auth/routes");
  await expectLoggedIn(await routes.verifyHostedAuthCode(new Request("https://app.example.test/verify", { method: "POST" }), "native"));
  expect(mocks.adopt).not.toHaveBeenCalled();
});
