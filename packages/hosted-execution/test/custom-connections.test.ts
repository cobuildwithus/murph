import { expect, it } from "vitest";
import { hostedCustomConnectionsManifestSchema } from "../src/custom-connections.ts";

const entry = { id: "cc_notes", slug: "notes", generation: 1, catalog: "a".repeat(43) };

it("strips future manifest and entry fields without dropping valid connections", () => {
  expect(hostedCustomConnectionsManifestSchema.parse({
    future: { version: 2 }, connections: [{ ...entry, future: "ignored" }],
  })).toEqual({ connections: [entry] });
});

it("preserves known-field bounds and uniqueness while stripping unknown fields", () => {
  for (const override of [
    { id: "" }, { id: "x".repeat(129) }, { id: "invalid/id" },
    { slug: "" }, { slug: "x".repeat(65) }, { slug: "Uppercase" },
    { generation: 0 }, { generation: -1 }, { generation: 1.5 },
    { generation: Number.MAX_SAFE_INTEGER + 1 }, { generation: "1" },
    { catalog: "a".repeat(42) }, { catalog: "a".repeat(44) }, { catalog: "/".repeat(43) },
  ]) {
    expect(hostedCustomConnectionsManifestSchema.safeParse({ connections: [{ ...entry, ...override, future: true }] }).success).toBe(false);
  }
  for (const connections of [
    [entry, { ...entry, slug: "other" }],
    [entry, { ...entry, id: "cc_other" }],
    Array.from({ length: 101 }, (_, index) => ({ ...entry, id: `cc_${index}`, slug: `notes_${index}` })),
  ]) expect(hostedCustomConnectionsManifestSchema.safeParse({ connections }).success).toBe(false);
  expect(hostedCustomConnectionsManifestSchema.parse({ connections: [] })).toEqual({ connections: [] });
  expect(hostedCustomConnectionsManifestSchema.parse({ connections: [{ ...entry, generation: Number.MAX_SAFE_INTEGER }] }).connections).toHaveLength(1);
});
