import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ admitted: true }]),
    $transaction: vi.fn(),
  },
  readHostedUsageDiagnostics: vi.fn(),
  withJsonError: vi.fn(
    (handler: (...args: never[]) => Promise<Response>) => handler,
  ),
  jsonOk: vi.fn((payload: unknown, status?: number) =>
    Response.json(payload, { status }),
  ),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));

vi.mock("@/src/lib/hosted-execution/usage-diagnostics", () => ({
  readHostedUsageDiagnostics: mocks.readHostedUsageDiagnostics,
}));

vi.mock("@/src/lib/hosted-onboarding/http", () => ({
  jsonOk: mocks.jsonOk,
  withJsonError: mocks.withJsonError,
}));

const originalKeyId = process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
const originalPublicJwk = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
const originalPublicKeyring =
  process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;
let privateJwk: JsonWebKey;

describe("hosted usage diagnostics route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK = JSON.stringify(publicJwk);
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON = JSON.stringify({
      v1: publicJwk,
    });
    mocks.readHostedUsageDiagnostics.mockResolvedValue({
      status: "unavailable", reason: "hosted_access_inactive",
    });
  });

  afterEach(() => {
    restoreEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", originalKeyId);
    restoreEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", originalPublicJwk);
    restoreEnv(
      "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
      originalPublicKeyring,
    );
  });

  it("verifies the callback signature, binds the member, and returns JSON-safe status", async () => {
    const { POST } = await import(
      "../app/api/internal/hosted-execution/usage/diagnostics/route"
    );
    const request = await createSignedRequest({
      body: "{}",
      memberId: "member_bound",
      nonce: "0123456789abcdef0123456789abcdef",
    });

    const response = await POST(request);

    await expect(response.json()).resolves.toEqual({
      status: "unavailable", reason: "hosted_access_inactive",
    });
    expect(mocks.readHostedUsageDiagnostics).toHaveBeenCalledWith({
      memberId: "member_bound", request: {},
    });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("passes bounded options under the signed identity", async () => {
    const { POST } = await import("../app/api/internal/hosted-execution/usage/diagnostics/route");
    await POST(await createSignedRequest({
      body: JSON.stringify({ days: 31, limit: 20 }), memberId: "member_bound",
      nonce: "fedcba9876543210fedcba9876543210",
    }));
    expect(mocks.readHostedUsageDiagnostics).toHaveBeenCalledWith({
      memberId: "member_bound", request: { days: 31, limit: 20 },
    });
  });

  it("rejects a modified unsigned body", async () => {
    const { POST } = await import("../app/api/internal/hosted-execution/usage/diagnostics/route");
    const signed = await createSignedRequest({ body: "{}", memberId: "member_bound",
      nonce: "0123456789abcdef0123456789abcdef" });
    await expect(POST(new Request(signed.url, {
      method: "POST", headers: signed.headers, body: '{"days":31}',
    }))).rejects.toThrow();
    expect(mocks.readHostedUsageDiagnostics).not.toHaveBeenCalled();
  });

  it("rejects model-supplied fields instead of accepting a member id", async () => {
    const { POST } = await import(
      "../app/api/internal/hosted-execution/usage/diagnostics/route"
    );

    await expect(POST(await createSignedRequest({
      body: JSON.stringify({ memberId: "member_other" }),
      memberId: "member_bound",
      nonce: "abcdef0123456789abcdef0123456789",
    }))).rejects.toThrow();
    expect(mocks.readHostedUsageDiagnostics).not.toHaveBeenCalled();
  });
});

async function createSignedRequest(input: {
  body: string;
  memberId: string;
  nonce: string;
}): Promise<Request> {
  const path = "/api/internal/hosted-execution/usage/diagnostics";
  const timestamp = new Date().toISOString();
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    key,
    encodeHostedExecutionSignedRequestPayload({
      method: "POST",
      nonce: input.nonce,
      path,
      payload: input.body,
      search: "",
      timestamp,
      userId: input.memberId,
    }),
  );

  return new Request(`https://example.test${path}`, {
    body: input.body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_NONCE_HEADER]: input.nonce,
      [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "v1",
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature)
        .toString("base64url"),
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
      [HOSTED_EXECUTION_USER_ID_HEADER]: input.memberId,
    },
    method: "POST",
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
