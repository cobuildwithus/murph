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
