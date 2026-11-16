import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Server, createMcpHandler } from "@modelcontextprotocol/server";

// Real PostgreSQL, Better Auth OTP issuance, WebAuthn verification and routes.
// Only the SMS provider, KMS, the Worker callback signature and the remote MCP
// server are synthetic.
const mocks = vi.hoisted(() => ({ codes: new Map<string, string>(), fetch: vi.fn(), memberId: "" }));
vi.mock("../src/lib/hosted-crypto/domain-root-store", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-crypto/domain-root-store")>(),
  provisionActiveHostedDomainRootEnvelopeForUserOnly: async () => undefined,
  prepareHostedDomainRootForWeb: async ({ userId }: { userId: string }) => ({ domain: "control", userId, rootKeyId: "synthetic-root" }),
  revalidatePreparedHostedDomainRootForWebTx: async () => ({ rootKeyId: "synthetic-root", root: Promise.resolve({ rootKey: Buffer.alloc(32, 7) }) }),
}));
vi.mock("../src/lib/better-auth/twilio-verify", () => ({ hostedAuthSmsVerification: () => sms }));
vi.mock("../src/lib/custom-connections/guarded-fetch", async (original) => ({
  ...await original<typeof import("../src/lib/custom-connections/guarded-fetch")>(), guardedConnectionFetch: mocks.fetch,
}));
vi.mock("../src/lib/custom-connections/access", async (original) => ({
  ...await original<typeof import("../src/lib/custom-connections/access")>(), requireConnectionCallback: async () => mocks.memberId,
}));

import { POST as authenticateRoute } from "../app/api/settings/approval-passkeys/authenticate/route";
import { POST as initialOptionsRoute } from "../app/api/settings/approval-passkeys/initial-options/route";
import { POST as registerRoute } from "../app/api/settings/approval-passkeys/register/route";
import { POST as challengeRoute } from "../app/api/settings/custom-connections/requests/[requestId]/challenge/route";
import { POST as decisionRoute } from "../app/api/settings/custom-connections/requests/[requestId]/route";
import { prepareHostedAuthOtpMember } from "../src/lib/better-auth/member";
import { commitHostedAuthOtp, type HostedAuthOtp } from "../src/lib/better-auth/otp-transaction";
import { sendHostedAuthOtp } from "../src/lib/better-auth/send-otp";
import { prepareHostedAuthSmsOtp } from "../src/lib/better-auth/sms-otp";
import { approveTools, approvedSnapshot, digest, reconcileTools } from "../src/lib/custom-connections/catalog";
import { handleConnectionMcp } from "../src/lib/custom-connections/gateway";
import { createHostedLinqParticipantContact } from "../src/lib/hosted-onboarding/linq-participant-contact";
import { getPrisma } from "../src/lib/prisma";
import { authenticator } from "./approval-webauthn-fixture";
import { syntheticSmsVerification } from "./support/better-auth-sms-verification";

let sms = syntheticSmsVerification(mocks.codes);
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("The first-passkey proof requires an isolated local test database.");
  }
}
const baseURL = "https://www.withmurph.ai";
const secret = Buffer.alloc(32, 31).toString("base64url");
const read = { name: "list_notes", title: "Read notes", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } };
const write = { name: "add_note", title: "Leave a note", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } };
const NOTE = { text: "Try the lentil soup on Sunday." };

describe.skipIf(!enabled)("a first passkey for an MCP write in PostgreSQL", () => {
  const calls: unknown[] = [];
  let ip = "";
  beforeEach(() => {
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true");
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL);
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
    vi.stubEnv("VERCEL", "1");
    ip = `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 24).match(/.{4}/gu)!.join(":")}`;
    mocks.codes.clear();
    sms = syntheticSmsVerification(mocks.codes);
    calls.length = 0;
    // The member's own MCP server; every tools/call that reaches it is recorded.
    const handler = createMcpHandler(() => {
      const server = new Server({ name: "notes", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler("tools/list", () => ({ tools: [read, write] }) as never);
      server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "Saved." }] }) as never);
      return server;
    });
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (body.method === "tools/call") calls.push(body.params);
      return handler.fetch(new Request(url, init));
    });
  });
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  /** An active member, signed in with a real code, with no passkey and one enabled write. */
  async function withMember(kind: "email" | "phone", run: (f: { cookie: string; requestId: string }) => Promise<void>) {
    const prisma = getPrisma();
    const value = kind === "email" ? `first-passkey-${randomUUID()}@example.test` : "+12025550188";
    const contact = createHostedLinqParticipantContact({ kind, value });
    if (!contact) throw new Error("Invalid synthetic contact");
    let code = "";
    await sendHostedAuthOtp({ baseURL, secret, prisma, contact, smsVerification: sms, delivery: { email: async (input) => { code = input.code; } } });
    const otp: HostedAuthOtp = kind === "email" ? { kind, address: value, code } : { kind, phoneNumber: value, code: mocks.codes.get(value)!,
      verificationId: await prepareHostedAuthSmsOtp({ prisma, phoneNumber: value, code: mocks.codes.get(value)!, verification: sms }) };
    const issued = await commitHostedAuthOtp({ baseURL, secret, prisma, ...await prepareHostedAuthOtpMember({ prisma, contact }), otp });
    mocks.memberId = issued.memberId;
    try {
      await prisma.hostedMember.update({ where: { id: issued.memberId }, data: { billingStatus: "active" } });
      const tools = approveTools(reconcileTools([], [read, write]), { list_notes: true, add_note: true }, "Notes");
      const catalog = digest(approvedSnapshot(tools, "Notes"));
      await prisma.hostedMcpConnection.create({ data: { id: "cc_first_passkey", memberId: issued.memberId, slug: "notes", name: "Notes",
        serverUrl: "https://notes.example.com/mcp", status: "on", generation: 3, revision: 1, tools: JSON.parse(JSON.stringify(tools)), catalog } });
      // Murph asks for the write; the gateway only records it and links the member to it.
      const asked = await handleConnectionMcp(new Request(`${baseURL}/api/internal/custom-connections/cc_first_passkey/3/${catalog}/mcp`, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_note", arguments: NOTE } }),
      }), { id: "cc_first_passkey", generation: "3", catalog });
      const text: string = (await asked.json()).result.content[0].text;
      const requestId = /\/settings\/connections\/confirm\/(car_[0-9a-f]{32})\. /u.exec(text)?.[1];
      if (!requestId) throw new Error("The gateway did not link a request.");
      const cookie = issued.headers.getSetCookie().find((entry) => entry.startsWith("murph-auth-session="))!.split(";")[0]!;
      await run({ cookie, requestId });
    } finally { await prisma.hostedMember.deleteMany({ where: { id: issued.memberId } }); }
  }
  function post(cookie: string, path: string, body: unknown = {}) {
    return new Request(`${baseURL}${path}`, { method: "POST", body: JSON.stringify(body), headers: {
      origin: baseURL, cookie, "content-type": "application/json", "x-vercel-forwarded-for": ip,
    } });
  }
  const confirmPath = (id: string) => `/api/settings/custom-connections/requests/${id}`;
  const params = (requestId: string) => ({ params: Promise.resolve({ requestId }) });
  async function challenge(cookie: string, requestId: string): Promise<{ token: string; message: string }> {
    const response = await challengeRoute(post(cookie, `${confirmPath(requestId)}/challenge`), params(requestId));
    expect(response.status).toBe(200);
    return response.json();
  }
  const status = async (requestId: string) => (await getPrisma().hostedMcpActionRequest.findUniqueOrThrow({ where: { id: requestId } })).status;

  it("refuses an email-code session a first passkey, so its confirmation never reaches the server", () => withMember("email", async ({ cookie, requestId }) => {
    const asked = await challenge(cookie, requestId);
    expect(await (await authenticateRoute(post(cookie, "/api/settings/approval-passkeys/authenticate", { token: asked.token }))).json()).toEqual({ method: "initial" });
    const options = await initialOptionsRoute(post(cookie, "/api/settings/approval-passkeys/initial-options"));
    expect(options.status).toBe(403);
    expect(await options.json()).toMatchObject({ error: { code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED",
      message: "Sign in with your phone or Telegram, then add your Murph passkey." } });
    // A key the session made up cannot be registered, nor sign the confirmation.
    const key = authenticator();
    const registered = await registerRoute(post(cookie, "/api/settings/approval-passkeys/register", { initialToken: asked.token, response: key.registration() }));
    expect(registered.status).toBe(403);
    expect(await getPrisma().hostedMemberApprovalCredentials.count({ where: { memberId: mocks.memberId } })).toBe(0);
    const confirmed = await decisionRoute(post(cookie, confirmPath(requestId), { decision: "confirm",
      authorization: { method: "passkey", token: asked.token, assertion: key.assertion({ customMessage: asked.message }) } }), params(requestId));
    expect(confirmed.status).toBe(409);
    expect(await confirmed.json()).toMatchObject({ error: { code: "SENSITIVE_ACTION_SETUP_REQUIRED" } });
    expect(calls).toEqual([]);
    expect(await status(requestId)).toBe("waiting");
  }));

  it("lets a phone-code session add its first passkey and confirm the write once", () => withMember("phone", async ({ cookie, requestId }) => {
    const first = await challenge(cookie, requestId);
    expect(await (await authenticateRoute(post(cookie, "/api/settings/approval-passkeys/authenticate", { token: first.token }))).json()).toEqual({ method: "initial" });
    const options = await initialOptionsRoute(post(cookie, "/api/settings/approval-passkeys/initial-options"));
    expect(options.status).toBe(200);
    const setup: { token: string; options: { challenge: string } } = await options.json();
    const key = authenticator();
    expect((await registerRoute(post(cookie, "/api/settings/approval-passkeys/register", {
      initialToken: setup.token, response: key.registration(true, setup.options.challenge) }))).status).toBe(200);
    // Registration approves nothing: confirming signs a fresh challenge for this exact request.
    expect(calls).toEqual([]);
    const asked = await challenge(cookie, requestId);
    expect(await (await authenticateRoute(post(cookie, "/api/settings/approval-passkeys/authenticate", { token: asked.token }))).json()).toMatchObject({ method: "passkey" });
    const decision = { decision: "confirm", authorization: { method: "passkey", token: asked.token, assertion: key.assertion({ customMessage: asked.message }) } };
    const confirmed = await decisionRoute(post(cookie, confirmPath(requestId), decision), params(requestId));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ outcome: { status: "done" } });
    expect(calls).toEqual([expect.objectContaining({ name: "add_note", arguments: NOTE })]);
    const again = await decisionRoute(post(cookie, confirmPath(requestId), decision), params(requestId));
    expect(await again.json()).toMatchObject({ outcome: { status: "done" } });
    expect(calls).toHaveLength(1);
  }));
});
