import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), authority: vi.fn(), current: vi.fn(), workspace: vi.fn(), control: vi.fn(),
  session: vi.fn(), decode: vi.fn(), submit: vi.fn(), find: vi.fn(), create: vi.fn(), upsert: vi.fn(),
  update: vi.fn(), games: vi.fn(), seal: vi.fn(), open: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedWorkspace: mocks.workspace }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.control }));
vi.mock("@/src/lib/browser-vault/loader", () => ({
  parseBrowserVaultSessionResponse: (value: unknown) => value, decodeReadyBrowserVaultSession: mocks.decode,
}));
vi.mock("@/src/lib/member-actions/submit", () => ({ submitMemberAction: mocks.submit }));
vi.mock("@/src/lib/game/crypto", () => ({
  sealGameText: mocks.seal,
  openGameTexts: mocks.open,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $transaction: mocks.transaction,
  gameProfile: { findUnique: mocks.find, createMany: mocks.create, upsert: mocks.upsert, updateManyAndReturn: mocks.update },
  game: { findMany: mocks.games }, gameTicket: { findMany: async () => [] },
  gameEntry: { findFirst: async () => null }, gameBlock: { findMany: async () => [] },
  $queryRaw: async (query: { strings: readonly string[] } | readonly string[]) => ("strings" in query ? query.strings : query).join("").includes("clock_timestamp") ? [{ now: new Date() }] : [],
}) }));

import { GET } from "../app/api/game/v1/home/route";
import { runGameCommand } from "@/src/lib/game/service";
import { adoptVaultGameProfile } from "@/src/lib/game/vault-profile";

const memberId = "member_synthetic";
const replicaRef = {
  byteLength: 128, dataVersion: "d".repeat(64), generatedAt: "2026-11-04T18:00:00.000Z", generation: 18,
  keyId: "browser-vault-replica:d", objectKey: "users/browser-vault-replicas/opaque/replica.json",
  replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:test-root",
  schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
};
type Profile = { memberId: string; firstNameEncrypted: string; timeZone: string; photoKey: string | null };
let stored: Profile | null;
const profile = (name = "Robin"): Profile => ({ memberId, firstNameEncrypted: `sealed:${name}`, timeZone: "UTC", photoKey: null });
const snapshot = (displayName: unknown = "Avery", timeZone: unknown = "America/New_York") => ({ client: { replica: { displayName, meals: { timeZone } } } });
const home = () => GET(new Request("https://app.example.test/api/game/v1/home"));
const save = (firstName?: string, timeZone = "UTC") => runGameCommand({ actorMemberId: memberId, command: { type: "setProfile", firstName, timeZone } });

beforeEach(() => {
  vi.resetAllMocks();
  stored = null;
  mocks.auth.mockResolvedValue({ member: { id: memberId } });
  mocks.authority.mockResolvedValue(undefined);
  mocks.current.mockResolvedValue(undefined);
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: replicaRef, version: 1 });
  mocks.control.mockReturnValue({ createBrowserVaultSession: mocks.session });
  mocks.session.mockResolvedValue({ state: "ready" });
  mocks.decode.mockResolvedValue(snapshot());
  mocks.submit.mockResolvedValue({ accepted: true });
  mocks.find.mockImplementation(async () => stored);
  mocks.transaction.mockImplementation(async (run: (tx: object) => Promise<unknown>) => {
    const previous = stored;
    try { return await run({ gameProfile: { createMany: mocks.create, findUnique: mocks.find, upsert: mocks.upsert, updateManyAndReturn: mocks.update } }); }
    catch (error) { stored = previous; throw error; }
  });
  mocks.create.mockImplementation(async ({ data }: { data: Profile[] }) => {
    if (stored) return { count: 0 };
    stored = { ...data[0]!, photoKey: null }; return { count: 1 };
  });
  mocks.upsert.mockImplementation(async ({ create, update }: { create: Profile; update: Partial<Profile> }) => {
    stored = stored ? { ...stored, ...update } : { ...create, photoKey: null }; return stored;
  });
  mocks.update.mockImplementation(async ({ data }: { data: Partial<Profile> }) => {
    if (!stored) return []; stored = { ...stored, ...data }; return [stored];
  });
  mocks.seal.mockImplementation(async (_target, value: string) => `sealed:${value}`);
  mocks.open.mockImplementation(async (rows: { value: string | null }[]) => rows.map(row => row.value?.replace(/^sealed:/u, "") ?? null));
  mocks.games.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("silently adopts and returns a vault name through Home, without a member action", async () => {
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me).toMatchObject({ firstName: "Avery", timeZone: "America/New_York" });
  expect(stored?.firstNameEncrypted).toBe("sealed:Avery");
  expect(mocks.create).toHaveBeenCalledWith({ data: [{ memberId, firstNameEncrypted: "sealed:Avery", timeZone: "America/New_York" }], skipDuplicates: true });
  expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ requestedShards: ["core"], userId: memberId }));
  expect(mocks.decode).toHaveBeenCalledWith(expect.objectContaining({ requestedShards: ["core"] }));
  expect(mocks.authority).toHaveBeenCalledTimes(2);
  expect(mocks.authority.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspace.mock.invocationCallOrder[0]!);
  expect(mocks.current.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.decode.mock.invocationCallOrder[0]!);
  expect(mocks.authority.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.decode.mock.invocationCallOrder[0]!);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("a saved profile never reaches replica loading, authority, or the control client", async () => {
  stored = profile();
  expect((await (await home()).json()).me.firstName).toBe("Robin");
  for (const call of [mocks.authority, mocks.current, mocks.workspace, mocks.control, mocks.session, mocks.decode, mocks.create, mocks.submit]) {
    expect(call).not.toHaveBeenCalled();
  }
});

it("adopts the same normalized name as the typed-name command", async () => {
  mocks.decode.mockResolvedValue(snapshot("Av\u200bery"));
  expect((await (await home()).json()).me.firstName).toBe("Avery");
  expect(stored?.firstNameEncrypted).toBe("sealed:Avery");
});

it("rolls back adoption if its final database read fails", async () => {
  mocks.find.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Synthetic read failure"));
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me.firstName).toBeNull();
  expect(stored).toBeNull();
});

it("starts the optional lookup alongside the other Home reads", async () => {
  let finish!: (value: []) => void;
  mocks.games.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const response = home();
  await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  finish([]);
  expect((await response).status).toBe(200);
});

it.each([
  ["missing name", undefined, "UTC"], ["empty name", "", "UTC"], ["multiple words", "Avery Robin", "UTC"],
  ["tab", "Avery\tRobin", "UTC"], ["surrounding whitespace", " Avery", "UTC"],
  ["missing zone", "Avery", undefined], ["invalid zone", "Avery", "invalid/zone"],
  ["game parser rejection", "A".repeat(201), "UTC"], ["moderation rejection", "porn", "UTC"],
])("%s leaves Home 200 without a row", async (_label, name, zone) => {
  mocks.decode.mockResolvedValue({ client: { replica: { displayName: name, meals: { timeZone: zone } } } });
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me.firstName).toBeNull();
  expect(stored).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});

it.each(["no replica", "no control", "unready", "no access", "no consent", "workspace error", "session error", "decode error", "revoked session", "revoked consent", "seal error", "insert error"])("%s preserves the name screen", async failure => {
  const error = new Error("Synthetic unavailable");
  if (failure === "no replica") mocks.workspace.mockResolvedValue(null);
  if (failure === "no control") mocks.control.mockReturnValue(null);
  if (failure === "unready") mocks.session.mockResolvedValue({ state: "missing" });
  if (failure === "no access" || failure === "no consent") mocks.authority.mockRejectedValue(error);
  if (failure === "workspace error") mocks.workspace.mockRejectedValue(error);
  if (failure === "session error") mocks.session.mockRejectedValue(error);
  if (failure === "decode error") mocks.decode.mockRejectedValue(error);
  if (failure === "revoked session") mocks.current.mockRejectedValue(error);
  if (failure === "revoked consent") mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
  if (failure === "seal error") mocks.seal.mockRejectedValue(error);
  if (failure === "insert error") mocks.create.mockRejectedValue(error);
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me.firstName).toBeNull();
  expect(stored).toBeNull();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("bounds session creation and never saves a late completion", async () => {
  vi.useFakeTimers();
  let finish!: (value: { state: string }) => void;
  mocks.session.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const response = home();
  await vi.waitFor(() => expect(mocks.session).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(1_500);
  expect((await response).status).toBe(200);
  expect((await (await response).json()).me.firstName).toBeNull();
  finish({ state: "ready" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(stored).toBeNull();
});

it("uses one 1.5-second budget across session creation and ciphertext I/O", async () => {
  vi.useFakeTimers();
  mocks.session.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ state: "ready" }), 1_000)));
  mocks.decode.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(snapshot()), 1_000)));
  const response = home();
  await vi.waitFor(() => expect(mocks.session).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(1_500);
  expect((await (await response).json()).me.firstName).toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(stored).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("returns a raced app save instead of overwriting its name or zone", async () => {
  mocks.decode.mockImplementation(async () => { await save("Robin", "Europe/Paris"); return snapshot(); });
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me).toMatchObject({ firstName: "Robin", timeZone: "Europe/Paris" });
  expect(mocks.submit).toHaveBeenCalledTimes(1); // Only the explicit app save.
});

it("login adoption uses the phone's zone, even when the vault has none", async () => {
  mocks.decode.mockResolvedValue(snapshot("Avery", null));
  const auth = { member: { id: memberId } } as Parameters<typeof adoptVaultGameProfile>[0];
  expect(await adoptVaultGameProfile(auth, { timeZone: "Europe/Paris", timeoutMs: 2_000 })).toMatchObject({ firstName: "Avery", timeZone: "Europe/Paris" });
  expect(stored?.timeZone).toBe("Europe/Paris");
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("login adoption honors its own read budget", async () => {
  vi.useFakeTimers();
  mocks.session.mockReturnValue(new Promise(() => undefined));
  const auth = { member: { id: memberId } } as Parameters<typeof adoptVaultGameProfile>[0];
  let settled = false;
  const adopted = adoptVaultGameProfile(auth, { timeoutMs: 2_000 }).finally(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(1_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await adopted).toBeNull();
  expect(stored).toBeNull();
});

it("a session revoked while sealing adopts nothing", async () => {
  mocks.seal.mockImplementation(async (_target, value: string) => {
    mocks.current.mockRejectedValue(new Error("Synthetic revoked session"));
    return `sealed:${value}`;
  });
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me.firstName).toBeNull();
  expect(stored).toBeNull();
});

it("submits each first or changed name with a new UUID, including A to B to A", async () => {
  for (const name of ["Avery", "Robin", "Avery"]) expect(await save(name)).toMatchObject({ ok: true, profile: { firstName: name } });
  const requests = mocks.submit.mock.calls.map(([input]) => input.request);
  expect(requests.map(request => request.action)).toEqual(["Avery", "Robin", "Avery"].map(displayName => ({ kind: "display-name.set", version: 1, displayName })));
  expect(new Set(requests.map(request => request.actionId)).size).toBe(3);
  for (const request of requests) expect(request.actionId).toMatch(/^[a-f0-9-]{36}$/u);
});

it("same name with a new zone, and a partial zone update, submit nothing", async () => {
  stored = profile("Avery");
  expect(await save("Avery", "Europe/Paris")).toMatchObject({ ok: true, profile: { timeZone: "Europe/Paris" } });
  expect(await save(undefined, "UTC")).toMatchObject({ ok: true, profile: { timeZone: "UTC" } });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(["refused", "failed"])("a %s submit never fails the profile save", async failure => {
  mocks.submit.mockRejectedValue(failure === "refused"
    ? hostedOnboardingError({ code: "ACCESS_REQUIRED", httpStatus: 403, message: "Access required." })
    : new Error("Synthetic submit failure"));
  expect(await save("Avery")).toMatchObject({ ok: true, profile: { firstName: "Avery" } });
  expect(stored?.firstNameEncrypted).toBe("sealed:Avery");
});

it("an unreadable previous name skips the vault write and keeps the save", async () => {
  stored = profile("Robin");
  mocks.open.mockImplementation(async (rows: { value: string | null }[]) => {
    if (rows[0]?.value === "sealed:Robin") throw new Error("Synthetic decrypt failure");
    return rows.map(row => row.value?.replace(/^sealed:/u, "") ?? null);
  });
  expect(await save("Avery")).toMatchObject({ ok: true, profile: { firstName: "Avery" } });
  expect(stored?.firstNameEncrypted).toBe("sealed:Avery");
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("checks the session and member authority inside the vault write's transaction", async () => {
  const beforeMutationTx = vi.fn();
  expect(await runGameCommand({ actorMemberId: memberId, beforeMutationTx, command: { type: "setProfile", firstName: "Avery", timeZone: "UTC" } })).toMatchObject({ ok: true });
  beforeMutationTx.mockClear();
  const tx = {};
  await mocks.submit.mock.calls[0]![0].assertCurrentAuthorityTx(tx);
  expect(beforeMutationTx).toHaveBeenCalledWith(tx);
  expect(mocks.authority).toHaveBeenCalledWith({ memberId, prisma: tx });
});

it("saves a game-valid name longer than memory's limit without submitting", async () => {
  expect(await save("A".repeat(121))).toMatchObject({ ok: true });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.runIf(process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1").each([false, true])(
  "uses PostgreSQL insert-if-absent and returns the winning row, raced save=%s", async raced => {
    const url = new URL(process.env.DATABASE_URL ?? "http://missing");
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/murph_test_/u);
    const { getPrisma } = await vi.importActual<typeof import("@/src/lib/prisma")>("@/src/lib/prisma");
    const db = getPrisma();
    await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    mocks.find.mockImplementation(args => db.gameProfile.findUnique(args));
    mocks.upsert.mockImplementation(args => db.gameProfile.upsert(args));
    mocks.transaction.mockImplementation(run => db.$transaction(run));
    if (raced) mocks.decode.mockImplementation(async () => { await save("Robin", "Europe/Paris"); return snapshot(); });
    try {
      const response = await home();
      expect(response.status).toBe(200);
      expect((await response.json()).me).toMatchObject({
        firstName: raced ? "Robin" : "Avery", timeZone: raced ? "Europe/Paris" : "America/New_York",
      });
      expect(await db.gameProfile.findUnique({ where: { memberId } })).toMatchObject({
        firstNameEncrypted: raced ? "sealed:Robin" : "sealed:Avery", timeZone: raced ? "Europe/Paris" : "America/New_York",
      });
      expect(mocks.submit).toHaveBeenCalledTimes(raced ? 1 : 0);
    } finally { await db.hostedMember.delete({ where: { id: memberId } }); }
  },
);


it("keeps an unreadable raced profile inside the optional Home fallback", async () => {
  mocks.decode.mockImplementation(async () => { stored = profile(); return snapshot(); });
  mocks.open.mockRejectedValue(new Error("Synthetic decrypt failure"));
  const response = await home();
  expect(response.status).toBe(200);
  expect((await response.json()).me.firstName).toBeNull();
  expect(stored).toEqual(profile());
  expect(mocks.submit).not.toHaveBeenCalled();
});
