import { afterEach, describe, expect, it, vi } from "vitest";
import { Server, WebStandardStreamableHTTPServerTransport, createMcpHandler } from "@modelcontextprotocol/server";
import type { HostedMcpConnection } from "@prisma/client";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), updates: vi.fn() }));
vi.mock("../src/lib/custom-connections/guarded-fetch", async (original) => ({ ...await original<typeof import("../src/lib/custom-connections/guarded-fetch")>(), guardedConnectionFetch: mocks.fetch }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedMcpConnection: { updateMany: mocks.updates } }) }));
vi.mock("../src/lib/custom-connections/secrets", () => ({ openConnectionSecret: async (_member: string, _id: string, _generation: number, _field: string, value: string) => JSON.parse(value),
  sealConnectionSecret: async (_member: string, _id: string, _generation: number, _field: string, value: unknown) => JSON.stringify(value) }));
import { listConnectionTools, withConnectionClient } from "../src/lib/custom-connections/upstream";
const row: HostedMcpConnection = { id: "cc_synthetic", memberId: "member-a", slug: "notes", name: "Notes", serverUrl: "https://notes.example.com/mcp", status: "on", auth: "none", generation: 1, revision: 0, tools: [], catalog: "catalog", credentialsEncrypted: null, tokenVersion: 0, refreshClaim: null, refreshExpiresAt: null, createdAt: new Date(), lastUsedAt: null };
function server() {
  const result = new Server({ name: "notes", version: "1" }, { capabilities: { tools: {} } });
  result.setRequestHandler("tools/list", () => ({ tools: [{ name: "read_notes", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] }));
  result.setRequestHandler("tools/call", () => ({ content: [{ type: "text", text: "Synthetic note" }] }));
  return result;
}
afterEach(() => vi.resetAllMocks());
describe("request-scoped upstream SDK lifecycle", () => {
  it("initializes, lists, calls and closes a JSON SDK server without unsupported client capabilities", async () => {
    const handler = createMcpHandler(server);
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const request = new Request(url, init);
      return handler.fetch(request);
    });
    expect((await listConnectionTools(row))[0]?.name).toBe("read_notes");
    expect(await withConnectionClient(row, (client) => client.callTool({ name: "read_notes", arguments: {} }))).toMatchObject({ content: [{ text: "Synthetic note" }] });
    for (const [, init] of mocks.fetch.mock.calls) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (body?.method === "initialize") expect(body.params.capabilities).toEqual({});
    }
  });
  it("preserves a legacy upstream session and reads a POST SSE result", async () => {
    const upstream = server();
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => "synthetic-session" });
    await upstream.connect(transport);
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (body?.method === "discover") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
      return transport.handleRequest(new Request(url, init));
    });
    try {
      expect((await listConnectionTools(row))[0]?.name).toBe("read_notes");
      expect(mocks.fetch.mock.calls.some(([, init]) => new Headers(init?.headers).get("mcp-session-id") === "synthetic-session")).toBe(true);
    } finally { await upstream.close(); }
  });
  it("refuses remote sampling, roots and elicitation requests", async () => {
    const upstream = server();
    upstream.setRequestHandler("tools/call", async () => {
      const attempts = await Promise.allSettled([
        Promise.resolve().then(() => upstream.listRoots()),
        Promise.resolve().then(() => upstream.createMessage({ messages: [], maxTokens: 1 })),
        Promise.resolve().then(() => upstream.elicitInput({ message: "Synthetic question", requestedSchema: { type: "object", properties: {} } })),
      ]);
      expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
      return { content: [{ type: "text", text: "Capabilities refused" }] };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => "synthetic-session" });
    await upstream.connect(transport);
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (body?.method === "discover") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
      return transport.handleRequest(new Request(url, init));
    });
    try {
      expect(await withConnectionClient(row, (client) => client.callTool({ name: "read_notes", arguments: {} })))
        .toMatchObject({ content: [{ text: "Capabilities refused" }] });
    } finally { await upstream.close(); }
  });
  it("never marks a no-sign-in service as needing sign-in when it refuses a request", async () => {
    mocks.fetch.mockImplementation(async () => new Response("no", { status: 401 }));
    await expect(withConnectionClient(row, (client) => client.callTool({ name: "read_notes", arguments: {} }))).rejects.toThrow("refused the request");
    expect(mocks.updates).not.toHaveBeenCalled();
  });
  it("refuses a result that echoes the member's token", async () => {
    const echo = new Server({ name: "notes", version: "1" }, { capabilities: { tools: {} } });
    echo.setRequestHandler("tools/list", () => ({ tools: [] }));
    echo.setRequestHandler("tools/call", () => ({ content: [{ type: "text", text: "your token is synthetic-member-access" }] }));
    const handler = createMcpHandler(() => echo);
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => handler.fetch(new Request(url, init)));
    const signedIn = { ...row, auth: "oauth", credentialsEncrypted: JSON.stringify({ discovery: {}, tokens: { access_token: "synthetic-member-access", token_type: "Bearer" }, expiresAt: Date.now() + 3_600_000 }) };
    await expect(withConnectionClient(signedIn, (client) => client.callTool({ name: "read_notes", arguments: {} }))).rejects.toThrow("sign-in token");
  });
  it("connects to a server that only speaks the 2026-07-28 revision", async () => {
    const handler = createMcpHandler(server, { legacy: "reject" });
    mocks.fetch.mockImplementation(async (url: string | URL, init?: RequestInit) => handler.fetch(new Request(url, init)));
    expect((await listConnectionTools(row))[0]?.name).toBe("read_notes");
  });
});
