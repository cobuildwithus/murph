import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ callback: vi.fn(), active: vi.fn(), read: vi.fn(), upstream: vi.fn(), update: vi.fn() }));
vi.mock("../src/lib/custom-connections/access", () => ({ requireConnectionCallback: mocks.callback, connectionMemberActive: mocks.active }));
vi.mock("../src/lib/custom-connections/store", () => ({ readConnection: mocks.read }));
vi.mock("../src/lib/custom-connections/upstream", () => ({ withConnectionClient: mocks.upstream }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedMcpConnection: { updateMany: mocks.update } }) }));
import { handleConnectionMcp } from "../src/lib/custom-connections/gateway";
import { approveTools, digest, approvedSnapshot, reconcileTools } from "../src/lib/custom-connections/catalog";
import { ConnectionError } from "../src/lib/custom-connections/errors";

const tools = approveTools(reconcileTools([], [{ name: "read_notes", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]), { read_notes: true });
const row = { id: "cc_synthetic", memberId: "member-a", status: "on", generation: 3, catalog: digest(approvedSnapshot(tools)), tools };
const coordinates = { id: row.id, generation: "3", catalog: row.catalog };
const request = (method: string, params?: unknown) => new Request("https://www.withmurph.ai/api/internal/custom-connections/cc_synthetic/3/catalog/mcp", {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});
beforeEach(() => { mocks.callback.mockResolvedValue("member-a"); mocks.active.mockResolvedValue(true); mocks.read.mockResolvedValue(row); mocks.update.mockResolvedValue({ count: 1 }); });
afterEach(() => vi.resetAllMocks());
describe("stateless custom connection gateway", () => {
  it("serves approved tools locally as JSON for the legacy Codex protocol", async () => {
    const response = await handleConnectionMcp(request("tools/list"), coordinates);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).result.tools).toEqual(approvedSnapshot(tools));
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it.each(["off", "needs_sign_in", "stale_generation", "stale_catalog", "other_member", "inactive"])("denies %s before upstream I/O", async (kind) => {
    if (kind === "inactive") mocks.active.mockResolvedValue(false);
    else if (kind === "other_member") mocks.read.mockRejectedValue(new ConnectionError("not_found", 404));
    else mocks.read.mockResolvedValue({ ...row, ...(kind === "stale_generation" ? { generation: 4 } : kind === "stale_catalog" ? { catalog: "new" } : { status: kind }) });
    const response = await handleConnectionMcp(request("tools/call", { name: "read_notes", arguments: {} }), coordinates);
    expect(response.status).toBe(404);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it.each(["off", "needs_look", "not_allowed"])("denies %s tools even on a live connection", async (state) => {
    mocks.read.mockResolvedValue({ ...row, tools: tools.map((tool) => ({ ...tool, state })) });
    const response = await handleConnectionMcp(request("tools/call", { name: "read_notes", arguments: {} }), coordinates);
    expect((await response.json()).result.isError).toBe(true);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("refuses JSON-RPC batches before any upstream call", async () => {
    const one = { jsonrpc: "2.0", method: "tools/call", params: { name: "read_notes", arguments: {} } };
    const batch = new Request("https://www.withmurph.ai/api/internal/custom-connections/cc_synthetic/3/catalog/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: ` ${JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ ...one, id: index })))}`,
    });
    const response = await handleConnectionMcp(batch, coordinates);
    expect(response.status).toBe(400);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("maps auth failure and raw provider exceptions to safe owned tool results", async () => {
    for (const error of [new ConnectionError("needs_sign_in"), new Error("access_token=synthetic-secret")]) {
      mocks.upstream.mockRejectedValue(error);
      const response = await handleConnectionMcp(request("tools/call", { name: "read_notes", arguments: {} }), coordinates);
      const text = await response.text();
      expect(text).not.toContain("synthetic-secret");
      expect(JSON.parse(text).result.isError).toBe(true);
      if (error instanceof ConnectionError) expect(text).toContain("This connection needs to be signed in again in Murph's settings.");
    }
  });
  it("refuses oversized results and exposes no remote response headers", async () => {
    mocks.upstream.mockResolvedValue({ content: [{ type: "text", text: "x".repeat(262144) }] });
    const response = await handleConnectionMcp(request("tools/call", { name: "read_notes", arguments: {} }), coordinates);
    expect((await response.json()).result.isError).toBe(true);
    expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-type"]);
  });
  it("does not forward remote protocol metadata or input requests", async () => {
    mocks.upstream.mockResolvedValue({ content: [{ type: "text", text: "Synthetic note" }], _meta: { credential: "synthetic-secret" } });
    const response = await handleConnectionMcp(request("tools/call", { name: "read_notes", arguments: {} }), coordinates);
    expect(await response.text()).not.toContain("synthetic-secret");
    mocks.upstream.mockResolvedValue({ resultType: "input_required", inputRequests: [{ method: "roots/list" }] });
    const refused = await handleConnectionMcp(request("tools/call", { name: "read_notes", arguments: {} }), coordinates);
    expect((await refused.json()).result.isError).toBe(true);
  });

});
