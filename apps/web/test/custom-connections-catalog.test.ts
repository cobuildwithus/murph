import { describe, expect, it } from "vitest";
import { approveTools, approvedSnapshot, digest, reconcileTools } from "../src/lib/custom-connections/catalog";

const tool = { name: "read_notes", title: "Read notes", description: "Read saved notes", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } };
describe("custom connection approval snapshots", () => {
  it("starts all tools off and refuses tools without an explicit read-only claim", () => {
    const tools = reconcileTools([], [tool, { ...tool, name: "write_notes", annotations: {} }]);
    expect(tools.map((item) => item.state)).toEqual(["off", "not_allowed"]);
    expect(() => approveTools(tools, { write_notes: true })).toThrow();
    expect(approvedSnapshot(approveTools(tools, { read_notes: true }))).toEqual([tool]);
  });
  it.each(["title", "description", "inputSchema", "annotations"])("suspends an approved change to %s", (field) => {
    const approved = approveTools(reconcileTools([], [tool]), { read_notes: true });
    const changed = { ...tool, [field]: field === "annotations" ? { readOnlyHint: true, idempotentHint: true }
      : field === "inputSchema" ? { type: "object", required: ["id"] } : "Changed" };
    const next = reconcileTools(approved, [changed]);
    expect(next[0]?.state).toBe("needs_look");
    expect(approvedSnapshot(next)).toEqual([]);
    expect(digest(approvedSnapshot(approveTools(next, { read_notes: true })))).not.toBe(digest(approvedSnapshot(approved)));
  });
  it("drops removed tools, retains unchanged approvals, and has order-independent catalog hashes", () => {
    const second = { ...tool, name: "read_folders" };
    const first = approveTools(reconcileTools([], [tool, second]), { read_notes: true, read_folders: true });
    expect(reconcileTools(first, [tool])).toHaveLength(1);
    expect(reconcileTools(first, [tool])[0]?.state).toBe("on");
    expect(digest(approvedSnapshot(first))).toBe(digest(approvedSnapshot([...first].reverse())));
    expect(() => reconcileTools([], [tool, tool])).toThrow();
  });
});

describe("tool definition size", () => {
  it("locks a definition too large to carry in every turn, and bounds the approved total", async () => {
    const { approveTools, reconcileTools } = await import("../src/lib/custom-connections/catalog");
    const big = { name: "big", inputSchema: { type: "object", description: "x".repeat(30_000) }, annotations: { readOnlyHint: true } };
    expect(reconcileTools([], [big])[0]?.state).toBe("not_allowed");
    const medium = (index: number) => ({ name: `tool_${index}`, inputSchema: { type: "object", description: "x".repeat(15_000) }, annotations: { readOnlyHint: true } });
    const tools = reconcileTools([], [0, 1, 2, 3, 4].map(medium));
    expect(() => approveTools(tools, { tool_0: true, tool_1: true, tool_2: true, tool_3: true })).not.toThrow();
    expect(() => approveTools(tools, { tool_0: true, tool_1: true, tool_2: true, tool_3: true, tool_4: true })).toThrow();
  });
});
