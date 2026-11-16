import { describe, expect, it } from "vitest";
import { approveTools, approvedSnapshot, approvedTool, canonical, digest, normalizeTools, reconcileTools, storedToolsSchema, toolKind, type StoredTool, type ToolDefinition } from "../src/lib/custom-connections/catalog";

const tool = { name: "read_notes", title: "Read notes", description: "Read saved notes", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } };
const write = { name: "add_note", title: "Leave a note", description: "Adds a note to a folder.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  annotations: { destructiveHint: false, idempotentHint: false }, outputSchema: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] } };
const oversized = (base: object) => ({ ...base, inputSchema: { type: "object", description: "x".repeat(30_000) } });
describe("custom connection approval snapshots", () => {
  it("starts every tool off and lets the member turn on reads and writes, never an oversized one", () => {
    const tools = reconcileTools([], [tool, write, { ...oversized(write), name: "big_write" }]);
    expect(tools.map((item) => item.state)).toEqual(["off", "off", "not_allowed"]);
    expect(() => approveTools(tools, { big_write: true }, "Notes")).toThrow();
    const approved = approveTools(tools, { read_notes: true, add_note: true }, "Notes");
    expect(approvedSnapshot(approved, "Notes").map((item) => item.name)).toEqual(["add_note", "read_notes"]);
    expect(approvedSnapshot(approved, "Notes").find((item) => item.name === "read_notes")).toEqual(tool);
  });
  it.each(["title", "description", "inputSchema", "annotations"])("suspends an approved change to %s", (field) => {
    const approved = approveTools(reconcileTools([], [tool]), { read_notes: true }, "Notes");
    const changed = { ...tool, [field]: field === "annotations" ? { readOnlyHint: true, idempotentHint: true }
      : field === "inputSchema" ? { type: "object", required: ["id"] } : "Changed" };
    const next = reconcileTools(approved, [changed]);
    expect(next[0]?.state).toBe("needs_look");
    expect(approvedSnapshot(next, "Notes")).toEqual([]);
    expect(digest(approvedSnapshot(approveTools(next, { read_notes: true }, "Notes"), "Notes"))).not.toBe(digest(approvedSnapshot(approved, "Notes")));
  });
  it("drops removed tools, retains unchanged approvals, and has order-independent catalog hashes", () => {
    const second = { ...tool, name: "read_folders" };
    const first = approveTools(reconcileTools([], [tool, second]), { read_notes: true, read_folders: true }, "Notes");
    expect(reconcileTools(first, [tool])).toHaveLength(1);
    expect(reconcileTools(first, [tool])[0]?.state).toBe("on");
    expect(digest(approvedSnapshot(first, "Notes"))).toBe(digest(approvedSnapshot([...first].reverse(), "Notes")));
    expect(() => reconcileTools([], [tool, tool])).toThrow();
  });
});

describe("changes Murph asks for first", () => {
  const approvedWrite = () => approveTools(reconcileTools([], [tool, write]), { read_notes: true, add_note: true }, "Notes");
  it("serves a write as a request for the member's OK: same name and inputs, Murph's line first, no remote output schema or hints", () => {
    const served = approvedSnapshot(approvedWrite(), "Notes").find((item) => item.name === "add_note") as ToolDefinition;
    expect(served).toEqual({
      name: "add_note", title: "Leave a note", inputSchema: write.inputSchema,
      description: "Changes things in Notes. Calling this doesn't do it yet: it returns a link for the member to confirm on a Murph page. Send them the link and say what it will do. Calling again with the same inputs tells you whether it happened.\n\nAdds a note to a folder.",
    });
  });
  it("keeps one stored remote definition, so a remote output schema change still suspends approval", () => {
    const next = reconcileTools(approvedWrite(), [tool, { ...write, outputSchema: { type: "object", properties: { id: { type: "number" } } } }]);
    expect(next.find((item) => item.definition.name === "add_note")?.state).toBe("needs_look");
    expect(approvedSnapshot(next, "Notes").map((item) => item.name)).toEqual(["read_notes"]);
    expect(approvedTool(next, "add_note")).toBeUndefined();
  });
  it("gives the catalog token everything the gateway serves, including the server's name in a write", () => {
    const tools = approvedWrite();
    expect(digest(approvedSnapshot(tools, "Notes"))).not.toBe(digest(approvedSnapshot(tools, "Recipes")));
    const readsOnly = approveTools(tools, { add_note: false }, "Notes");
    expect(digest(approvedSnapshot(readsOnly, "Notes"))).toBe(digest(approvedSnapshot(readsOnly, "Recipes")));
  });
  it("derives eligibility from the stored definition alone", () => {
    expect([tool, write, oversized(tool), oversized(write)].map((item) => toolKind(item as ToolDefinition))).toEqual(["read", "write", "oversized", "oversized"]);
  });
  it("keys canonical arguments by sorted keys while keeping array order and JSON types", () => {
    expect(canonical({ b: 1, a: [2, "1", true, null] })).toBe(canonical({ a: [2, "1", true, null], b: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: "1" }));
    expect(canonical({ a: true })).not.toBe(canonical({ a: "true" }));
  });
});

/** The rules the previous Web runs, for deploy skew: it only ever approves and serves reads. */
const oldWeb = {
  snapshot: (tools: StoredTool[]) => tools.filter((item) => item.state === "on" && item.definition.annotations?.readOnlyHint === true).map((item) => item.definition),
  refresh(previous: StoredTool[], definitions: object[]): StoredTool[] {
    return storedToolsSchema.parse(definitions.map((definition) => {
      const hash = digest(definition);
      const old = previous.find((item) => item.definition.name === (definition as { name: string }).name);
      const locked = (definition as ToolDefinition).annotations?.readOnlyHint !== true || Buffer.byteLength(canonical(definition)) > 24_576;
      const state = locked ? "not_allowed" : old?.digest === hash ? old.state : old?.state === "on" || old?.state === "needs_look" ? "needs_look" : "off";
      return { definition, digest: hash, state };
    }));
  },
  approve(tools: StoredTool[], choices: Record<string, boolean>): StoredTool[] {
    for (const [name, enabled] of Object.entries(choices)) {
      const found = tools.find((item) => item.definition.name === name);
      if (!found || (enabled && found.definition.annotations?.readOnlyHint !== true)) throw new Error("not_mcp");
    }
    return tools.map((item) => Object.hasOwn(choices, item.definition.name)
      ? { ...item, state: item.state === "not_allowed" ? "not_allowed" as const : choices[item.definition.name] ? "on" as const : "off" as const } : item);
  },
};
describe("older Web and newer Web on the same stored catalog", () => {
  const definitions = [tool, write, { ...oversized(tool), name: "big_read" }, { ...oversized(write), name: "big_write" }];
  const states = (tools: StoredTool[]) => Object.fromEntries(tools.map((item) => [item.definition.name, item.state]));
  it("turns a v1 lock on a write into off, never on, and keeps oversized definitions locked", () => {
    const v1 = oldWeb.approve(oldWeb.refresh([], definitions), { read_notes: true });
    expect(states(v1)).toEqual({ read_notes: "on", add_note: "not_allowed", big_read: "not_allowed", big_write: "not_allowed" });
    expect(states(normalizeTools(v1))).toEqual({ read_notes: "on", add_note: "off", big_read: "not_allowed", big_write: "not_allowed" });
    expect(states(reconcileTools(v1, definitions))).toEqual({ read_notes: "on", add_note: "off", big_read: "not_allowed", big_write: "not_allowed" });
    expect(approvedSnapshot(v1, "Notes").map((item) => item.name)).toEqual(["read_notes"]);
    expect(() => approveTools(v1, { big_read: true }, "Notes")).toThrow();
    expect(() => approveTools(v1, { big_write: true }, "Notes")).toThrow();
    expect(states(approveTools(v1, { add_note: true }, "Notes")).add_note).toBe("on");
  });
  it("never enables a write across v1, v2, v1 and v2 again without the member", () => {
    let stored = oldWeb.refresh([], definitions);
    for (let round = 0; round < 2; round += 1) {
      stored = reconcileTools(stored, definitions);
      expect(states(stored).add_note).toBe("off");
      stored = oldWeb.refresh(stored, definitions);
      expect(states(stored).add_note).toBe("not_allowed");
      expect(oldWeb.snapshot(stored)).toEqual([]);
    }
    expect(approvedSnapshot(stored, "Notes")).toEqual([]);
  });
  it("keeps approved reads usable and oversized ones locked through an old status-only save of a new approval", () => {
    const v2 = approveTools(reconcileTools([], definitions), { read_notes: true, add_note: true }, "Notes");
    // Old Web turning the connection on saves the parsed catalog unchanged and recomputes its token from reads.
    const saved = storedToolsSchema.parse(JSON.parse(JSON.stringify(oldWeb.approve(storedToolsSchema.parse(v2), {}))));
    expect(digest(oldWeb.snapshot(saved))).toBe(digest(oldWeb.snapshot(v2)));
    expect(oldWeb.snapshot(saved).map((item) => item.name)).toEqual(["read_notes"]);
    expect(approvedTool(saved, "read_notes")).toBeDefined();
    // The member's own approval of the write survives; old Web never served it, and refresh there relocks it.
    expect(approvedTool(saved, "add_note")).toBeDefined();
    expect(approvedTool(saved, "big_read")).toBeUndefined();
    expect(states(oldWeb.refresh(saved, definitions)).add_note).toBe("not_allowed");
    expect(states(reconcileTools(oldWeb.refresh(saved, definitions), definitions)).add_note).toBe("off");
  });
});

describe("tool definition size", () => {
  it("locks a definition too large to carry in every turn, and bounds the approved total", () => {
    const big = { name: "big", inputSchema: { type: "object", description: "x".repeat(30_000) }, annotations: { readOnlyHint: true } };
    expect(reconcileTools([], [big])[0]?.state).toBe("not_allowed");
    const medium = (index: number) => ({ name: `tool_${index}`, inputSchema: { type: "object", description: "x".repeat(15_000) }, annotations: { readOnlyHint: true } });
    const tools = reconcileTools([], [0, 1, 2, 3, 4].map(medium));
    expect(() => approveTools(tools, { tool_0: true, tool_1: true, tool_2: true, tool_3: true }, "Notes")).not.toThrow();
    expect(() => approveTools(tools, { tool_0: true, tool_1: true, tool_2: true, tool_3: true, tool_4: true }, "Notes")).toThrow();
  });
  it("applies the size lock when serving, whatever the stored state says", () => {
    const stored = storedToolsSchema.parse([{ definition: oversized(write), digest: digest(oversized(write)), state: "on" }]);
    expect(approvedSnapshot(stored, "Notes")).toEqual([]);
    expect(approvedTool(stored, "add_note")).toBeUndefined();
    expect(normalizeTools(stored)[0]?.state).toBe("not_allowed");
  });
});
