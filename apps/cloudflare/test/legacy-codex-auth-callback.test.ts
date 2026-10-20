import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postHostedCodexAuthUpdateForTest } from "#hosted-web-testing";
import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
} from "../src/runner-outbound/headers.ts";
import {
  createHostedExecutionTestEnv,
  TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
} from "./hosted-execution-fixtures.ts";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    hostedCodexAuthConnection: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: mocks.log,
}));

// Literal deployed wire shape: no new runtime OAuth port or producer is restored.
const CALLBACK_PATH = "/api/internal/hosted-runtime/codex-auth";
const MEMBER = "member_legacy_callback";
const AUTH_ATTEMPT = "hca_legacy_callback_0001";
const RUNTIME_ATTEMPT = "runtime_legacy_callback";
const DEVICE_CODE = {
  attemptId: AUTH_ATTEMPT,
  phase: "device_code",
  userCode: "SYNTHETIC-PRIVATE-CODE",
  verificationUrl: "https://auth.openai.com/codex/device",
};
const CONNECTED = { attemptId: AUTH_ATTEMPT, phase: "connected" };
const envSource = createHostedExecutionTestEnv();
const environment = readHostedExecutionEnvironment(envSource);
const env = {
  ...envSource,
  BUNDLES: { get: vi.fn(), put: vi.fn() },
};

type Connection = {
  memberId: string; attemptId: string; state: string;
  userCode: string | null; verificationUrl: string | null;
};
let connection: Connection;
let owner: {
  cutoverPhase: string; memberExists: boolean; userId: string;
  migrationPhase: string; phase: string; attemptId: string; generation: bigint;
};
let forwarded: Request;
let transformRequest: (request: Request) => Request;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "v1");
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON);
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  connection = {
    memberId: MEMBER, attemptId: AUTH_ATTEMPT, state: "connecting",
    userCode: null, verificationUrl: null,
  };
  owner = {
    cutoverPhase: "postgres", memberExists: true, userId: MEMBER,
    migrationPhase: "postgres", phase: "active",
    attemptId: RUNTIME_ATTEMPT, generation: 9n,
  };
  const nonces = new Set<unknown>();
  // Only database I/O is synthetic. Signature, nonce owner, active runtime
  // admission, strict parser, route and canonical application all remain real.
  mocks.prisma.$queryRaw.mockImplementation(async (query: TemplateStringsArray, ...values: unknown[]) => {
    if (query.join("").includes('INSERT INTO "hosted_web_internal_request_nonce"')) {
      if (nonces.has(values[0])) return [];
      nonces.add(values[0]);
      return [{ admitted: true }];
    }
    expect(query.join("")).toContain('gate.phase AS "cutoverPhase"');
    return [{ ...owner, memberExists: owner.memberExists && values[0] === owner.userId }];
  });
  mocks.prisma.hostedCodexAuthConnection.findUnique.mockImplementation(async ({ where }: {
    where: { memberId: string };
  }) => connection.memberId === where.memberId ? { ...connection } : null);
  mocks.prisma.hostedCodexAuthConnection.updateMany.mockImplementation(async ({ data, where }: {
    data: Partial<Connection>;
    where: { memberId: string; attemptId: string; state: string | { in: string[] } };
  }) => {
    const states = typeof where.state === "string" ? [where.state] : where.state.in;
    if (where.memberId !== connection.memberId || where.attemptId !== connection.attemptId
      || !states.includes(connection.state)) return { count: 0 };
    Object.assign(connection, data);
    return { count: 1 };
  });
  transformRequest = request => request;
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    forwarded = new Request(input, init);
    // Separate string-body requests avoid an unconsumed tee blocking cancel()
    // when Web rejects an oversized body, while retaining exact replay bytes.
    return postHostedCodexAuthUpdateForTest(transformRequest(new Request(input, init)));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function callback(payload: unknown, options: {
  userId?: string; headers?: Record<string, string>; rawBody?: string;
} = {}) {
  const url = new URL(CALLBACK_PATH, "https://web-control.worker");
  return handleRunnerWebControlRequest({
    env, environment, url, userId: options.userId ?? MEMBER,
    request: new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: RUNTIME_ATTEMPT,
        [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "9",
        ...options.headers,
      },
      body: options.rawBody ?? JSON.stringify(payload),
    }),
  });
}

describe("deployed old runtime -> new Worker -> authenticated Web callback", () => {
  it("preserves device-code and terminal outcomes, exact duplicate receipts and nonce replay rejection", async () => {
    const device = await callback(DEVICE_CODE);
    expect(device.status).toBe(200);
    expect(await device.json()).toEqual({ applied: true, status: "applied" });
    expect(connection).toMatchObject({ state: "connecting", userCode: DEVICE_CODE.userCode });
    expect(forwarded.headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(MEMBER);
    expect(forwarded.headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
    expect(await (await callback(CONNECTED)).json()).toEqual({ applied: true, status: "applied" });
    expect(connection).toMatchObject({ state: "connected", userCode: null, verificationUrl: null });
    expect(await (await callback(CONNECTED)).json()).toEqual({ applied: true, status: "already_applied" });
    expect(await (await callback(DEVICE_CODE)).json()).toEqual({ applied: true, status: "already_applied" });
    const writes = mocks.prisma.hostedCodexAuthConnection.updateMany.mock.calls.length;
    expect((await postHostedCodexAuthUpdateForTest(new Request(forwarded))).status).toBe(401);
    expect(mocks.prisma.hostedCodexAuthConnection.updateMany).toHaveBeenCalledTimes(writes);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(DEVICE_CODE.userCode);
  });

  it.each([
    ["connecting", "failed", "connect_error"],
    ["disconnecting", "failed", "disconnect_error"],
    ["disconnecting", "disconnected", "disconnected"],
  ])("retains %s -> %s callback application", async (state, phase, result) => {
    connection.state = state;
    const payload = { attemptId: AUTH_ATTEMPT, phase };
    expect(await (await callback(payload)).json()).toEqual({ applied: true, status: "applied" });
    expect(connection.state).toBe(result);
    expect(await (await callback(payload)).json()).toEqual({ applied: true, status: "already_applied" });
  });

  it.each(["member", "attempt"])("supersedes an update for a different auth %s", async kind => {
    if (kind === "attempt") connection.attemptId = "hca_replacement_attempt1";
    else connection.memberId = "member_other_callback";
    const before = { ...connection };
    expect(await (await callback(CONNECTED)).json()).toEqual({ applied: false, status: "superseded" });
    expect(connection).toEqual(before);
  });

  it.each(["attempt", "generation", "member", "retiring", "draining"])(
    "rejects stale runtime authority (%s) before the canonical store",
    async kind => {
      if (kind === "attempt") owner.attemptId = "runtime_replacement";
      if (kind === "generation") owner.generation = 10n;
      if (kind === "member") owner.userId = "member_other_callback";
      if (kind === "retiring") owner.phase = "retiring";
      if (kind === "draining") owner.cutoverPhase = "draining";
      const response = await callback(CONNECTED);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "HOSTED_RUNTIME_OWNER_STALE" } });
      expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
      expect(mocks.prisma.hostedCodexAuthConnection.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([HOSTED_RUNTIME_ATTEMPT_ID_HEADER, HOSTED_RUNTIME_LEASE_GENERATION_HEADER])(
    "requires %s at both Worker and Web boundaries",
    async header => {
      expect((await callback(CONNECTED, { headers: { [header]: "" } })).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      transformRequest = request => { request.headers.delete(header); return request; };
      expect((await callback(CONNECTED)).status).toBe(401);
      expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([HOSTED_EXECUTION_SIGNATURE_HEADER, HOSTED_EXECUTION_USER_ID_HEADER, HOSTED_RUNTIME_LEASE_GENERATION_HEADER])(
    "rejects tampered signed authority (%s)",
    async header => {
      transformRequest = request => { request.headers.set(header, "tampered"); return request; };
      expect((await callback(CONNECTED)).status).toBe(401);
      expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(["body", "query"])("rejects a tampered signed %s", async kind => {
    transformRequest = request => {
      if (kind === "body") return new Request(request, { body: JSON.stringify(DEVICE_CODE) });
      const url = new URL(request.url);
      url.searchParams.set("runtimeGeneration", "10");
      return new Request(url, request);
    };
    expect((await callback(CONNECTED)).status).toBe(401);
    expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { ...CONNECTED, phase: "pending" },
    { ...CONNECTED, attemptId: "hca_short" },
    { ...CONNECTED, unexpected: "SYNTHETIC-PRIVATE-FIELD" },
    { ...DEVICE_CODE, userCode: "x".repeat(129) },
    { ...DEVICE_CODE, verificationUrl: "https://auth.openai.com.example.test/device" },
    { ...DEVICE_CODE, verificationUrl: "http://auth.openai.com/device" },
  ])("rejects invalid legacy wire input %# without canonical effects", async payload => {
    expect((await callback(payload)).status).toBe(400);
    expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
  });

  it("enforces the original 4096-byte body boundary before canonical application", async () => {
    const body = JSON.stringify(DEVICE_CODE).padEnd(4_096, " ");
    expect((await callback(null, { rawBody: body })).status).toBe(200);
    mocks.prisma.hostedCodexAuthConnection.updateMany.mockClear();
    expect((await callback(null, { rawBody: `${body} ` })).status).toBe(413);
    expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
  });

  it("returns failure when the canonical update fails, without a success receipt or retry", async () => {
    mocks.prisma.hostedCodexAuthConnection.updateMany.mockRejectedValueOnce(new Error("Synthetic canonical write failed."));
    const response = await callback(CONNECTED);
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("applied");
    expect(connection.state).toBe("connecting");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.prisma.hostedCodexAuthConnection.updateMany).toHaveBeenCalledOnce();
  });

  it.each(["unknown_key", "malformed_json"])("does not log private malformed input (%s)", async kind => {
    const privateText = "TEST-42";
    const rawBody = kind === "unknown_key"
      ? JSON.stringify({ ...CONNECTED, [privateText]: true })
      : privateText;
    expect((await callback(null, { rawBody })).status).toBe(400);
    for (const calls of [mocks.log.mock.calls, vi.mocked(console.warn).mock.calls, vi.mocked(console.error).mock.calls]) {
      expect(JSON.stringify(calls)).not.toContain(privateText);
    }
    expect(mocks.prisma.hostedCodexAuthConnection.updateMany).not.toHaveBeenCalled();
  });
});
