import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Server, createMcpHandler } from "@modelcontextprotocol/server";
import type { HostedAppSession } from "../src/lib/hosted-onboarding/app-session";

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => {
  const tables = { connections: [] as Record<string, unknown>[], requests: [] as Record<string, unknown>[] };
  const failures = { claim: false, settle: false, resultSeal: false };
  function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([key, condition]) => {
      // Member activity belongs to the access owner; its own tests cover it.
      if (key === "member") return true;
      if (key === "OR") return (condition as Record<string, unknown>[]).some((branch) => matches(row, branch));
      const value = row[key];
      if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
      if (condition && typeof condition === "object") {
        const test = condition as { in?: unknown[]; gt?: Date; not?: unknown };
        if (test.in) return test.in.includes(value);
        if (test.gt) return value instanceof Date && value > test.gt;
        return value !== test.not;
      }
      return value === condition;
    });
  }
  function apply(row: Record<string, unknown>, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value ? (row[key] as number) + (value as { increment: number }).increment : value;
    }
  }
  const copy = <T,>(value: T): T => structuredClone(value);
  const db = {
    hostedMcpConnection: {
      findFirst: async ({ where }: { where: Row }) => copy(tables.connections.find((row) => matches(row, where)) ?? null),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hits = tables.connections.filter((row) => matches(row, where));
        hits.forEach((row) => apply(row, data));
        return { count: hits.length };
      },
    },
    hostedMcpActionRequest: {
      findFirst: async ({ where, include }: { where: Row; include?: unknown }) => {
        const found = tables.requests.filter((row) => matches(row, where))
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0];
        if (!found) return null;
        return copy(include ? { ...found, connection: tables.connections.find((row) => row.id === found.connectionId) } : found);
      },
      count: async ({ where }: { where: Row }) => tables.requests.filter((row) => matches(row, where)).length,
      create: async ({ data }: { data: Row }) => {
        const row = { status: "waiting", resultEncrypted: null, decidedAt: null, ...data };
        tables.requests.push(row);
        return copy(row);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (failures.claim && data.status === "unknown" && data.decidedAt) throw new Error("connection reset during commit");
        if (failures.settle && where.status === "unknown") throw new Error("database unavailable");
        const hits = tables.requests.filter((row) => matches(row, where));
        hits.forEach((row) => apply(row, data));
        return { count: hits.length };
      },
    },
    $queryRaw: async () => [],
    $transaction: async <T,>(operation: (tx: unknown) => Promise<T>) => operation(db),
  };
  return { db, tables, failures, fetch: vi.fn(), callback: vi.fn(), active: vi.fn(), sessionCurrent: vi.fn() };
});
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../src/lib/custom-connections/guarded-fetch", async (original) => ({ ...await original<typeof import("../src/lib/custom-connections/guarded-fetch")>(), guardedConnectionFetch: mocks.fetch }));
vi.mock("../src/lib/custom-connections/access", () => ({ requireConnectionCallback: mocks.callback, connectionMemberActive: mocks.active }));
vi.mock("../src/lib/hosted-onboarding/app-session", () => ({ assertHostedAppSessionCurrentTx: mocks.sessionCurrent }));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({ activeHostedPersonAccessWhere: () => ({ suspendedAt: null }) }));
vi.mock("../src/lib/custom-connections/secrets", async (original) => {
  const real = await original<typeof import("../src/lib/custom-connections/secrets")>();
  return { ...real, sealActionSecret: async (...args: Parameters<typeof real.sealActionSecret>) => {
    if (mocks.failures.resultSeal && args[2] === "result") throw new Error("key service unavailable");
    return real.sealActionSecret(...args);
  } };
});

import { decideActionRequest, readActionRequestView } from "../src/lib/custom-connections/action-requests";
import { approveTools, approvedSnapshot, digest, reconcileTools, type StoredTool } from "../src/lib/custom-connections/catalog";
import { handleConnectionMcp } from "../src/lib/custom-connections/gateway";
import { openActionSecret, sealConnectionSecret } from "../src/lib/custom-connections/secrets";

const read = { name: "list_notes", title: "Read notes", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } };
const write = { name: "add_note", title: "Leave a note", description: "Adds a note to a folder.",
  inputSchema: { type: "object", properties: { folder: { type: "string" }, text: { type: "string" }, tags: { type: "array" } }, required: ["text"] },
  outputSchema: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] } };
const NOTE = { folder: "Recipes", text: "Try the lentil soup on Sunday.", tags: ["dinner", "weekend"] };
const session = { member: { id: "member-a" }, sessionId: "browser-session", authProof: {} } as HostedAppSession;
const authority = { request: new Request("https://www.withmurph.ai/api/settings/custom-connections/requests/car_x", { method: "POST" }), session };
const sent: unknown[] = [];

function approved(definitions: object[] = [read, write]): StoredTool[] {
  return approveTools(reconcileTools([], definitions), Object.fromEntries(definitions.map((item) => [(item as { name: string }).name, true])), "Notes");
}
function connection(overrides: Row = {}): Row {
  const tools = approved();
  return { id: "cc_notes", memberId: "member-a", slug: "notes", name: "Notes", serverUrl: "https://notes.example.com/mcp", status: "on", auth: "none",
    generation: 3, revision: 1, tools, catalog: digest(approvedSnapshot(tools, "Notes")), credentialsEncrypted: null, tokenVersion: 0,
    refreshClaim: null, refreshExpiresAt: null, createdAt: new Date(), lastUsedAt: null, ...overrides };
}
const stored = () => mocks.tables.connections[0]!;
function setConnection(overrides: Row) { Object.assign(stored(), overrides); }
function coordinates() {
  return { id: String(stored().id), generation: String(stored().generation), catalog: String(stored().catalog) };
}
async function callGateway(args: unknown, name = "add_note") {
  const response = await handleConnectionMcp(new Request("https://www.withmurph.ai/api/internal/custom-connections/cc_notes/3/catalog/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), coordinates());
  return (await response.json()).result as { content: { text: string }[]; isError?: boolean };
}
function linkIn(result: { content: { text: string }[] }): string {
  const id = /\/settings\/connections\/confirm\/(car_[0-9a-f]{32})\. /u.exec(result.content[0]!.text)?.[1];
  if (!id) throw new Error("No link in the gateway's answer.");
  return id;
}
async function requested(args: unknown = NOTE): Promise<string> { return linkIn(await callGateway(args)); }

/** A real SDK server for the connection; every tools/call that reaches it is recorded. */
function serve(onCall: (args: Record<string, unknown>) => unknown, options: { beforeSetup?: () => void | Promise<void>; respond?: (body: { id?: unknown; method?: string }, init?: RequestInit) => Promise<Response> | undefined } = {}) {
  const handler = createMcpHandler(() => {
    const server = new Server({ name: "notes", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", () => ({ tools: [read, write] }) as never);
    server.setRequestHandler("tools/call", async (rpc) => onCall(rpc.params.arguments ?? {}) as never);
    return server;
  });
  let setUp = false;
  mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (body.method === "tools/call") sent.push(body.params);
    else if (!setUp && options.beforeSetup) { setUp = true; await options.beforeSetup(); }
    return await options.respond?.(body, init) ?? handler.fetch(new Request(url, init));
  });
}

beforeEach(() => {
  mocks.tables.connections.splice(0, Infinity, connection());
  mocks.tables.requests.length = 0;
  sent.length = 0;
  Object.assign(mocks.failures, { claim: false, settle: false, resultSeal: false });
  mocks.callback.mockResolvedValue("member-a"); mocks.active.mockResolvedValue(true); mocks.sessionCurrent.mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());

describe("Murph asks first: the gateway's request", () => {
  it("lists and calls a write through the real SDK client: a valid link result, a stored request and no server call", async () => {
    const client = new Client({ name: "codex-like", version: "1" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL("https://www.withmurph.ai/api/internal/custom-connections/cc_notes/3/catalog/mcp"), {
      fetch: async (url, init) => handleConnectionMcp(new Request(url, init), coordinates()),
    }));
    try {
      const listed = (await client.listTools()).tools.find((item) => item.name === "add_note");
      expect(listed?.outputSchema).toBeUndefined();
      // The remote output schema requires noteId; served as is, the client would refuse this text-only answer.
      const result = await client.callTool({ name: "add_note", arguments: NOTE });
      expect(result.isError).toBeFalsy();
      const text = (result.content as { text: string }[])[0]!.text;
      expect(text).toMatch(/^Not done yet\. The member has to confirm this first: https:\/\/www\.withmurph\.ai\/settings\/connections\/confirm\/car_[0-9a-f]{32}\. Send them the link and say what it will do\.$/u);
    } finally { await client.close(); }
    expect(mocks.fetch).not.toHaveBeenCalled();
    const [request] = mocks.tables.requests;
    expect(request).toMatchObject({ memberId: "member-a", connectionId: "cc_notes", generation: 3, toolName: "add_note", status: "waiting", decidedAt: null });
    expect(String(request!.lookupKey)).toMatch(/^hbidx:custom-connection-action:v1:[0-9a-f]{64}$/u);
    expect(String(request!.argumentsEncrypted)).not.toContain("lentil");
    expect(await openActionSecret("member-a", String(request!.id), "arguments", String(request!.argumentsEncrypted))).toEqual(NOTE);
    expect((request!.expiresAt as Date).getTime() - (request!.createdAt as Date).getTime()).toBe(3_600_000);
  });
  it("reuses one request for the same action, whatever the key order, and not for different arrays or types", async () => {
    const first = await requested();
    expect(await requested({ tags: ["dinner", "weekend"], text: NOTE.text, folder: "Recipes" })).toBe(first);
    expect(await requested({ ...NOTE, tags: ["weekend", "dinner"] })).not.toBe(first);
    expect(await requested({ ...NOTE, folder: 7 })).not.toBe(await requested({ ...NOTE, folder: "7" }));
    expect(mocks.tables.requests).toHaveLength(4);
  });
  it("treats a reconnected account or a reapproved definition as a different action", async () => {
    const first = await requested();
    setConnection({ generation: 4 });
    const afterReconnect = await requested();
    expect(afterReconnect).not.toBe(first);
    const changed = approved([read, { ...write, description: "Adds a note, with a reminder." }]);
    setConnection({ tools: changed, catalog: digest(approvedSnapshot(changed, "Notes")) });
    expect(await requested()).not.toBe(afterReconnect);
    expect(new Set(mocks.tables.requests.map((row) => row.lookupKey)).size).toBe(3);
  });
  it.each([
    ["done", /^Already done\. The member confirmed this at 20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ\.$/u],
    ["declined", /^The member said no to this at .+Z, so nothing was done\. The same request can be made again after .+Z\.$/u],
    ["unknown", /^It's not known whether this happened\. The member confirmed it at .+Z, and Notes may or may not have done it\. Ask them to check Notes before trying again\.$/u],
  ] as const)("answers a %s request within the hour and makes no new one", async (status, expected) => {
    const id = await requested();
    Object.assign(mocks.tables.requests[0]!, { status, decidedAt: new Date(Date.now() - 50 * 60_000) });
    const again = await callGateway(NOTE);
    expect(again.isError).toBeFalsy();
    expect(again.content[0]!.text).toMatch(expected);
    expect(mocks.tables.requests.map((row) => row.id)).toEqual([id]);
  });
  it.each([
    ["a failed request", { status: "failed", decidedAt: new Date() }],
    ["an expired one", { expiresAt: new Date(Date.now() - 1) }],
    ["one decided over an hour ago", { status: "done", decidedAt: new Date(Date.now() - 61 * 60_000) }],
  ])("asks again after %s", async (_case, change) => {
    const id = await requested();
    Object.assign(mocks.tables.requests[0]!, change);
    expect(await requested()).not.toBe(id);
  });
  it("admits at most 20 waiting requests, reuses one before refusing, and doesn't count expired ones", async () => {
    for (let index = 0; index < 20; index += 1) await requested({ text: `note ${index}` });
    const full = await callGateway({ text: "one more" });
    expect(full.isError).toBe(true);
    expect(full.content[0]!.text).toContain("already has 20 requests");
    expect(await requested({ text: "note 7" })).toBe(String(mocks.tables.requests[7]!.id));
    mocks.tables.requests[0]!.expiresAt = new Date(Date.now() - 1);
    await requested({ text: "one more" });
    expect(mocks.tables.requests).toHaveLength(21);
  });
  it("refuses inputs over 16 KiB, and writes that are off, changed or locked, storing nothing", async () => {
    expect((await callGateway({ text: "x".repeat(16_400) })).isError).toBe(true);
    for (const state of ["off", "needs_look", "not_allowed"]) {
      setConnection({ tools: approved().map((tool) => ({ ...tool, state })) });
      expect((await callGateway(NOTE)).isError).toBe(true);
    }
    expect(mocks.tables.requests).toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("Murph asks first: the member's answer", () => {
  it("sends the stored request once, after consuming it as unknown, and keeps the server's reply encrypted", async () => {
    const id = await requested();
    serve(() => {
      // Consumed before anything left Web.
      expect(mocks.tables.requests[0]).toMatchObject({ status: "unknown", decidedAt: expect.any(Date) });
      return { content: [{ type: "text", text: "Saved to Recipes." }] };
    });
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "done", text: "Saved to Recipes." });
    expect(sent).toEqual([expect.objectContaining({ name: "add_note", arguments: NOTE })]);
    expect(mocks.tables.requests[0]).toMatchObject({ status: "done" });
    expect(String(mocks.tables.requests[0]!.resultEncrypted)).not.toContain("Saved");
    expect(stored().lastUsedAt).toBeInstanceOf(Date);
    // Already used: the same page, another tab or a retry gets the outcome, never a second send.
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "done", text: "Saved to Recipes." });
    expect(await decideActionRequest(authority, id, "decline")).toEqual({ status: "done", text: "Saved to Recipes." });
    expect(sent).toHaveLength(1);
    expect((await callGateway(NOTE)).content[0]!.text).toMatch(/^Already done\./u);
  });
  it("runs exactly once when two confirmations race", async () => {
    const id = await requested();
    serve(() => ({ content: [{ type: "text", text: "Saved." }] }));
    const outcomes = await Promise.all([decideActionRequest(authority, id, "confirm"), decideActionRequest(authority, id, "confirm")]);
    expect(sent).toHaveLength(1);
    // The loser reads whatever the winner has stored so far, never a second run.
    expect(outcomes.map((outcome) => outcome.status)).toContain("done");
    expect(outcomes.every((outcome) => outcome.status === "done" || outcome.status === "unknown")).toBe(true);
  });
  it.each([
    ["declined", "decline", { status: "declined" }],
    ["expired", "confirm", { status: "expired" }],
  ] as const)("sends nothing for a %s request", async (kind, decision, expected) => {
    const id = await requested();
    serve(() => ({ content: [] }));
    if (kind === "declined") expect(await decideActionRequest(authority, id, "decline")).toEqual({ status: "declined" });
    else mocks.tables.requests[0]!.expiresAt = new Date(Date.now() - 1);
    expect(await decideActionRequest(authority, id, decision)).toEqual(expected);
    expect(await decideActionRequest(authority, id, "confirm")).toEqual(expected);
    expect(sent).toEqual([]);
  });
  it("treats another member's request, or a made-up id, as not found", async () => {
    const id = await requested();
    serve(() => ({ content: [] }));
    const other = { ...authority, session: { ...session, member: { id: "member-b" } } as HostedAppSession };
    await expect(decideActionRequest(other, id, "confirm")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(decideActionRequest(authority, "car_x", "confirm")).rejects.toMatchObject({ status: 404 });
    expect(await readActionRequestView("member-b", id)).toBeNull();
    expect(mocks.tables.requests[0]).toMatchObject({ status: "waiting" });
    expect(sent).toEqual([]);
  });
  it("needs the browser session to be current in the transaction that consumes the request", async () => {
    const id = await requested();
    serve(() => ({ content: [] }));
    mocks.sessionCurrent.mockRejectedValue(new Error("session revoked"));
    await expect(decideActionRequest(authority, id, "confirm")).rejects.toThrow("session revoked");
    expect(mocks.tables.requests[0]).toMatchObject({ status: "waiting" });
    expect(sent).toEqual([]);
  });
  it("never sends when the claim's commit can't be confirmed", async () => {
    const id = await requested();
    serve(() => ({ content: [] }));
    mocks.failures.claim = true;
    await expect(decideActionRequest(authority, id, "confirm")).rejects.toThrow();
    expect(sent).toEqual([]);
  });
  it.each([
    ["turned off", { status: "off" }, "off"],
    ["signed out", { status: "needs_sign_in" }, "signed_out"],
    ["reconnected", { generation: 4 }, "changed"],
    ["turned this action off", { tools: approved().map((tool) => tool.definition.name === "add_note" ? { ...tool, state: "off" } : tool) }, "changed"],
  ] as const)("fails without sending when the member %s since Murph asked", async (_case, change, reason) => {
    const id = await requested();
    serve(() => ({ content: [] }));
    setConnection(change);
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "failed", reason });
    expect(sent).toEqual([]);
    expect(mocks.tables.requests[0]).toMatchObject({ status: "failed" });
    expect(await readActionRequestView("member-a", id)).toMatchObject({ outcome: { status: "failed", reason } });
    // A failure proven before sending isn't reused: once the connection is back, the same call asks again.
    mocks.tables.connections.splice(0, 1, connection());
    expect(await requested()).not.toBe(id);
  });
  it.each([
    ["approval is revoked", () => setConnection({ tools: approved().map((tool) => ({ ...tool, state: "off" })) })],
    ["the connection is reconnected", () => setConnection({ generation: 4 })],
    ["the definition changes", () => setConnection({ tools: approved([read, { ...write, title: "Leave a longer note" }]) })],
  ])("sends nothing when %s during slow setup", async (_case, change) => {
    const id = await requested();
    serve(() => ({ content: [] }), { beforeSetup: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); change(); } });
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "failed", reason: "changed" });
    expect(mocks.fetch).toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
  it("fails without sending when the server can't be reached for setup", async () => {
    const id = await requested();
    mocks.fetch.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "failed", reason: "unreachable" });
    expect(sent).toEqual([]);
  });
});

describe("Murph asks first: after the call leaves Web", () => {
  const rpcResult = (body: { id?: unknown }, result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
  const cases: [string, NonNullable<Parameters<typeof serve>[1]>["respond"]][] = [
    ["a 403", (body) => body.method === "tools/call" ? Promise.resolve(new Response("no", { status: 403 })) : undefined],
    ["a dropped connection", (body) => body.method === "tools/call" ? Promise.reject(new TypeError("fetch failed")) : undefined],
    ["a broken response stream", (body) => body.method === "tools/call" ? Promise.resolve(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":')); controller.error(new Error("socket hang up")); },
    }), { headers: { "content-type": "application/json" } })) : undefined],
    ["an invalid result", (body) => body.method === "tools/call" ? Promise.resolve(rpcResult(body, { content: "Saved." })) : undefined],
    ["an oversized result", (body) => body.method === "tools/call" ? Promise.resolve(rpcResult(body, { content: [{ type: "text", text: "x".repeat(300_000) }] })) : undefined],
  ];
  it.each(cases)("reads %s as unknown after exactly one send", async (_case, respond) => {
    const id = await requested();
    serve(() => ({ content: [] }), { respond });
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    expect(sent).toHaveLength(1);
    expect(mocks.tables.requests[0]).toMatchObject({ status: "unknown" });
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    expect((await callGateway(NOTE)).content[0]!.text).toMatch(/^It's not known whether this happened\./u);
    expect(sent).toHaveLength(1);
    expect(mocks.tables.requests).toHaveLength(1);
  });
  it("reads a server error result as unknown, with the server's own words", async () => {
    const id = await requested();
    serve(() => ({ isError: true, content: [{ type: "text", text: "Folder is full; saved part of the note." }] }));
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown", text: "Folder is full; saved part of the note." });
    expect(await readActionRequestView("member-a", id)).toMatchObject({ outcome: { status: "unknown", text: "Folder is full; saved part of the note." } });
    expect(sent).toHaveLength(1);
  });
  it("reads a reply carrying the member's token as unknown and never stores it", async () => {
    const credentials = { discovery: {}, tokens: { access_token: "synthetic-member-access", token_type: "Bearer" }, expiresAt: Date.now() + 3_600_000 };
    setConnection({ auth: "oauth", credentialsEncrypted: await sealConnectionSecret("member-a", "cc_notes", 3, "credentials", credentials) });
    const id = await requested();
    serve(() => ({ content: [{ type: "text", text: "your token is synthetic-member-access" }] }));
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    expect(JSON.stringify(mocks.tables.requests)).not.toContain("synthetic-member-access");
    expect(sent).toHaveLength(1);
  });
  it("answers a 401 to the write itself instead of refreshing and sending it again, while a read still refreshes", async () => {
    const issuer = "https://login.example.com";
    const credentials = { discovery: { authorizationServerUrl: issuer, resourceMetadata: { resource: "https://notes.example.com/mcp", authorization_servers: [issuer] },
      authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
        code_challenge_methods_supported: ["S256"], response_types_supported: ["code"], authorization_response_iss_parameter_supported: true } },
      client: { client_id: "synthetic-client", issuer }, tokens: { access_token: "old-access", refresh_token: "rotation-0", token_type: "Bearer", issuer }, expiresAt: Date.now() + 3_600_000 };
    setConnection({ auth: "oauth", credentialsEncrypted: await sealConnectionSecret("member-a", "cc_notes", 3, "credentials", credentials) });
    const handler = createMcpHandler(() => {
      const server = new Server({ name: "notes", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "Done on the server." }] }));
      return server;
    });
    const refreshes: string[] = [];
    let refuseNextCall = true;
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (String(url) === `${issuer}/token`) {
        refreshes.push(String(url));
        return Response.json({ access_token: "new-access", refresh_token: "rotation-1", token_type: "Bearer", expires_in: 3600 });
      }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (body.method === "tools/call") {
        sent.push(body.params);
        if (refuseNextCall) { refuseNextCall = false; return new Response("expired", { status: 401 }); }
      }
      return handler.fetch(new Request(url, init));
    });
    // A read keeps today's behavior: the first 401 refreshes the token and sends the read again.
    expect((await callGateway({}, "list_notes")).content[0]!.text).toBe("Done on the server.");
    expect(sent).toHaveLength(2);
    expect(refreshes).toHaveLength(1);
    expect(stored().tokenVersion).toBe(1);
    // A confirmed write that meets the same 401 is never refreshed for and never sent twice.
    sent.length = 0;
    refuseNextCall = true;
    const id = await requested();
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    expect(sent).toHaveLength(1);
    expect(refreshes).toHaveLength(1);
  });
  it.each([
    ["the result can't be encrypted", "resultSeal"],
    ["the outcome can't be saved", "settle"],
  ] as const)("stays unknown when %s after the server did it, and never sends again", async (_case, failure) => {
    const id = await requested();
    serve(() => ({ content: [{ type: "text", text: "Saved." }] }));
    mocks.failures[failure] = true;
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    mocks.failures[failure] = false;
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    expect((await callGateway(NOTE)).content[0]!.text).toMatch(/^It's not known whether this happened\./u);
    expect(sent).toHaveLength(1);
  });
  it("leaves a request consumed by a lost process unknown, and never runs it", async () => {
    const id = await requested();
    serve(() => ({ content: [] }));
    // The claim committed, then the process went away before anything else happened.
    Object.assign(mocks.tables.requests[0]!, { status: "unknown", decidedAt: new Date() });
    expect(await decideActionRequest(authority, id, "confirm")).toEqual({ status: "unknown" });
    expect(await readActionRequestView("member-a", id)).toMatchObject({ outcome: { status: "unknown" } });
    expect((await callGateway(NOTE)).content[0]!.text).toMatch(/^It's not known whether this happened\./u);
    expect(sent).toEqual([]);
  });
});

describe("Murph asks first: the confirm page's view", () => {
  it("opens the stored inputs only while the member can act on them", async () => {
    const id = await requested();
    expect(await readActionRequestView("member-a", id)).toEqual({
      askedAt: (mocks.tables.requests[0]!.createdAt as Date).toISOString(), host: "notes.example.com", id,
      inputs: NOTE, outcome: { status: "waiting" }, server: "Notes", title: "Leave a note",
    });
    await decideActionRequest(authority, id, "decline");
    const decided = await readActionRequestView("member-a", id);
    expect(decided).toMatchObject({ outcome: { status: "declined" }, title: "Leave a note" });
    expect(decided).not.toHaveProperty("inputs");
    mocks.tables.requests[0]!.status = "waiting";
    mocks.tables.requests[0]!.expiresAt = new Date(Date.now() - 1);
    expect(await readActionRequestView("member-a", id)).toMatchObject({ outcome: { status: "expired" } });
    expect(await readActionRequestView("member-a", "not-a-request")).toBeNull();
  });
});
