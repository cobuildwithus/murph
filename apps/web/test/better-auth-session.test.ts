import { Prisma, type HostedAuthRecord } from "@prisma/client";
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedBetterAuth } from "../src/lib/better-auth/auth";
import { sealAuthRecord } from "../src/lib/better-auth/record-crypto";
import { readHostedAuthSession } from "../src/lib/better-auth/session";

// Keep the installed Better Auth, adapter, record validation and session owner.
// setup-env's existing secure-box codec and these database ports are synthetic.
const db = {
  hostedAuthRecord: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  hostedMember: { findUnique: vi.fn() },
};
// The exercised owners use only these explicit synthetic database methods.
const prisma = db as never;
const configuration = {
  baseURL: "https://synthetic.example.test", secret: "synthetic-better-auth-secret-for-tests-only",
  prisma,
};
const token = "s".repeat(32);
const memberId = "synthetic-member";
const sessionId = "synthetic-session";
const member = { id: memberId, suspendedAt: null, billingStatus: "not_started" };
const privateValue = "synthetic-private@example.test/Bearer-credential?query=secret";
const logs = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() };
const day = 86_400_000;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
  for (const level of ["error", "warn", "info", "log", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation(logs[level]);
  }
  db.hostedAuthRecord.findMany.mockResolvedValue([]);
  db.hostedAuthRecord.findUnique.mockResolvedValue(null);
  db.hostedMember.findUnique.mockResolvedValue(member);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function read(input: { credential?: string; transport?: "browser" | "native"; refresh?: boolean } = {}) {
  return readHostedAuthSession({ ...configuration, credential: token, transport: "native", ...input });
}

function expectQuiet() {
  for (const log of Object.values(logs)) expect(log).not.toHaveBeenCalled();
}

function expectMasked(error: unknown, original: unknown) {
  expect(error).not.toBe(original);
  expect(error).toBeInstanceOf(APIError);
  expect(error).toMatchObject({ status: "INTERNAL_SERVER_ERROR" });
  expect((error as APIError).body).toEqual({ code: "FAILED_TO_GET_SESSION", message: "Failed to get session" });
}

async function expectObserved(promise: Promise<unknown>, original: unknown, category: string) {
  const error: unknown = await promise.catch((failure: unknown) => failure);
  expectMasked(error, original);
  expect(db.hostedAuthRecord.findUnique).not.toHaveBeenCalled();
  expect(db.hostedMember.findUnique).not.toHaveBeenCalled();
  for (const level of ["warn", "info", "log", "debug"] as const) expect(logs[level]).not.toHaveBeenCalled();
  expect(JSON.stringify(Object.values(logs).map((log) => log.mock.calls))).not.toContain(privateValue);
  // Exact regression: the old owner reaches the same mask above, then fails
  // here with [] because its disabled library logger drops the observation.
  expect(logs.error.mock.calls).toEqual([["Hosted auth session read failed.", { observedErrorCategory: category }]]);
}

async function expectLookupFailure(error: unknown, category: string) {
  db.hostedAuthRecord.findMany.mockRejectedValue(error);
  await expectObserved(read(), error, category);
  expect(db.hostedAuthRecord.findMany).toHaveBeenCalledTimes(1);
}

function databaseError(kind: "known" | "initialization", code: string) {
  return kind === "known"
    ? new Prisma.PrismaClientKnownRequestError(privateValue, { code, clientVersion: privateValue, meta: { query: privateValue } })
    : new Prisma.PrismaClientInitializationError(privateValue, privateValue, code);
}

// One real authenticated record of each model is enough for these reads. The
// adapter still constructs selectors and checks every plaintext where clause.
async function seedSession() {
  const createdAt = new Date(Date.now() - 3 * day);
  const expiresAt = new Date(Date.now() + 27 * day); // Renewal is due at 29 days remaining.
  const primaryAuthenticatedAt = createdAt;
  const userRow = await sealAuthRecord("user", {
    id: memberId, email: "synthetic-member@example.test", emailVerified: true, name: "",
    createdAt, updatedAt: createdAt,
  }, configuration.prisma);
  let sessionRow = await sealAuthRecord("session", {
    id: sessionId, userId: memberId, token, expiresAt, primaryAuthenticatedAt,
    createdAt, updatedAt: createdAt,
  }, configuration.prisma);
  db.hostedAuthRecord.findMany.mockImplementation(async ({ where }: { where: { model: string } }) => {
    if (where.model === "session") return [sessionRow];
    if (where.model === "user") return [userRow];
    throw new Error("Unexpected synthetic database model.");
  });
  db.hostedAuthRecord.findUnique.mockImplementation(async () => sessionRow);
  db.hostedAuthRecord.updateMany.mockImplementation(async ({ data }: { data: HostedAuthRecord }) => {
    sessionRow = data;
    return { count: 1 };
  });
  return { expiresAt, primaryAuthenticatedAt };
}

function browserCredential(headers: Headers) {
  const prefix = "__Host-murph-auth-session=";
  const cookie = headers.getSetCookie().find((value) => value.startsWith(prefix));
  if (!cookie) throw new Error("Expected the installed library to issue a browser cookie.");
  return cookie.split(";")[0].slice(prefix.length);
}

describe("session failure observations before Better Auth masking", () => {
  const databaseCases = [
    ["P1001", "database_unreachable"], ["P1002", "database_timeout"], ["P1008", "database_timeout"],
    ["P2024", "database_pool_timeout"], ["P2034", "database_transaction_conflict"],
    ["P9999-private", "database_unknown"],
  ] as const;
  it.each(databaseCases.flatMap(([code, category]) =>
    (["known", "initialization"] as const).map((kind) => ({ code, category, kind })),
  ))("classifies a $kind database $code before masking", async ({ code, category, kind }) => {
    await expectLookupFailure(databaseError(kind, code), category);
  });

  it.each([
    { label: "type", error: new TypeError(privateValue), category: "native_type" },
    { label: "range", error: new RangeError(privateValue), category: "native_range" },
    { label: "syntax", error: new SyntaxError(privateValue), category: "native_syntax" },
    { label: "ordinary", error: new Error(privateValue), category: "native_error" },
    { label: "native with untrusted code", error: Object.assign(new Error(privateValue), { code: "ETIMEDOUT" }), category: "native_error" },
    { label: "other native", error: new URIError(privateValue), category: "unknown" },
    { label: "subclass", error: new (class extends TypeError {})(privateValue), category: "unknown" },
    { label: "nested database cause", error: new Error(privateValue, { cause: databaseError("known", "P1001") }), category: "native_error" },
  ])("bounds the $label error category", async ({ error, category }) => {
    await expectLookupFailure(error, category);
  });

  it.each([
    { label: "undefined", value: undefined }, { label: "null", value: null },
    { label: "string", value: privateValue }, { label: "number", value: 42 },
    { label: "boolean", value: false }, { label: "array", value: [privateValue] },
    { label: "plain object", value: { credential: privateValue } },
    { label: "spoofed database error", value: { name: "PrismaClientKnownRequestError", code: "P1001" } },
  ])("records only unknown for a thrown $label", async ({ value }) => {
    await expectLookupFailure(value, "unknown");
  });

  it("observes the pinned tracer's type error for a null-prototype rejection", async () => {
    // Better Auth's withSpan calls String(err?.message ?? err) before the
    // getSession catch. Its coercion throws; that is the value observed here.
    await expectLookupFailure(Object.create(null), "native_type");
  });

  it.each(["known", "initialization"] as const)("does not evaluate a %s database code getter", async (kind) => {
    const error = databaseError(kind, "P1001");
    const getter = vi.fn(() => { throw new Error(privateValue); });
    Object.defineProperty(error, kind === "known" ? "code" : "errorCode", { get: getter });
    await expectLookupFailure(error, "database_unknown");
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not coerce malformed database metadata or emit private fields", async () => {
    const coerce = vi.fn(() => { throw new Error(privateValue); });
    const error = databaseError("known", "P1001");
    Object.defineProperty(error, "code", { value: { toString: coerce, credential: privateValue } });
    Object.assign(error, {
      name: privateValue, stack: privateValue, url: privateValue, token: privateValue,
      identity: privateValue, credentials: privateValue, cause: { nested: privateValue },
    });
    await expectLookupFailure(error, "database_unknown");
    expect(coerce).not.toHaveBeenCalled();
  });

  it("observes a crypto-boundary error without replacing the library mask", async () => {
    await seedSession();
    // A malformed owner column reaches the real openAuthRecord guard.
    const row = await sealAuthRecord("session", {
      id: sessionId, userId: memberId, token, expiresAt: new Date(Date.now() + day),
      createdAt: new Date(), updatedAt: new Date(),
    }, configuration.prisma);
    db.hostedAuthRecord.findMany.mockResolvedValue([{ ...row, memberId: null }]);
    await expectObserved(read(), undefined, "native_type");
    expect(db.hostedAuthRecord.updateMany).not.toHaveBeenCalled();
  });

  it("observes an actual authenticated-record conflict during browser renewal", async () => {
    await seedSession();
    const issued = await read({ refresh: true });
    const credential = browserCredential(issued.headers);
    expectQuiet();
    await seedSession(); // Same credential, with renewal due again.
    for (const operation of Object.values(db.hostedAuthRecord)) operation.mockClear();
    db.hostedMember.findUnique.mockClear();
    db.hostedAuthRecord.updateMany.mockResolvedValueOnce({ count: 0 });
    await expectObserved(read({ credential, transport: "browser", refresh: true }), undefined, "auth_record_changed");
    expect(db.hostedAuthRecord.updateMany).toHaveBeenCalledTimes(1);
  });

  it("keeps the original failed outcome when structured console emission throws", async () => {
    const sinkFailure = new Error("synthetic telemetry failure");
    logs.error.mockImplementation(() => { throw sinkFailure; });
    await expectLookupFailure(databaseError("known", "P2024"), "database_pool_timeout");
  });

  it("preserves existing APIError passthrough without adding an observation", async () => {
    const error = new APIError("UNAUTHORIZED", { code: "SYNTHETIC_REJECTION", message: privateValue });
    db.hostedAuthRecord.findMany.mockRejectedValue(error);
    await expect(read()).rejects.toBe(error);
    expectQuiet();
  });

  it("preserves failures after getSession without adding an inner observation", async () => {
    await seedSession();
    const error = new Error(privateValue);
    db.hostedAuthRecord.findUnique.mockRejectedValueOnce(error);
    await expect(read()).rejects.toBe(error);
    expect(db.hostedMember.findUnique).not.toHaveBeenCalled();
    expectQuiet();
  });

  it("leaves library logging disabled on other hosted auth constructions", async () => {
    const error = databaseError("known", "P1001");
    db.hostedAuthRecord.findMany.mockRejectedValue(error);
    const auth = createHostedBetterAuth({ ...configuration, delivery: { email: async () => undefined } });
    const result: unknown = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    }).catch((failure: unknown) => failure);
    expectMasked(result, error);
    expectQuiet();
  });

  it("keeps anonymous native and invalid-cookie browser reads quiet", async () => {
    expect((await read()).session).toBeNull();
    expect((await read({ transport: "browser", credential: "invalid-synthetic-cookie" })).session).toBeNull();
    expect(db.hostedAuthRecord.findMany).toHaveBeenCalledTimes(1);
    expect(db.hostedAuthRecord.findUnique).not.toHaveBeenCalled();
    expect(db.hostedAuthRecord.updateMany).not.toHaveBeenCalled();
    expect(db.hostedMember.findUnique).not.toHaveBeenCalled();
    expectQuiet();
  });

  it("keeps authenticated reads and successful refresh quiet across both transports", async () => {
    const original = await seedSession();
    const native = await read();
    expect(native.session).toMatchObject({ sessionId, member, ...original });
    expect(native.headers.get("cache-control")).toBe("no-store");
    expect(db.hostedAuthRecord.updateMany).not.toHaveBeenCalled();
    const renewed = await read({ refresh: true });
    expect(renewed.session?.primaryAuthenticatedAt).toEqual(original.primaryAuthenticatedAt);
    expect(renewed.session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * day);
    expect(db.hostedAuthRecord.updateMany).toHaveBeenCalledTimes(1);
    const credential = browserCredential(renewed.headers);
    const browser = await read({ credential, transport: "browser" });
    expect(browser.session?.sessionId).toBe(sessionId);
    expect(browser.session?.expiresAt).toEqual(renewed.session?.expiresAt);
    const unchanged = await read({ credential, transport: "browser", refresh: true });
    expect(unchanged.session?.expiresAt).toEqual(renewed.session?.expiresAt);
    expect(db.hostedAuthRecord.updateMany).toHaveBeenCalledTimes(1);
    expectQuiet();
  });
});
