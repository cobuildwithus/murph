import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({}) }));

const { connectionDisplayName, connectionSlug } = await import("../src/lib/custom-connections/store");

describe("custom connection names", () => {
  it("uses the server's own short name, never one that reads as Murph", () => {
    expect(connectionDisplayName("Notes", "notes.example.com")).toBe("Notes");
    expect(connectionDisplayName("  Family\u0000 notes \n", "notes.example.com")).toBe("Family notes");
    expect(connectionDisplayName("Murph Official", "notes.example.com")).toBe("notes.example.com");
    expect(connectionDisplayName(undefined, "notes.example.com")).toBe("notes.example.com");
    expect(connectionDisplayName("x".repeat(80), "notes.example.com")).toHaveLength(40);
  });

  it("turns a name into a safe tool prefix", () => {
    expect(connectionSlug("Notes")).toBe("notes");
    expect(connectionSlug("notes.example.com")).toBe("notes_example_com");
    expect(connectionSlug("Café Notes!")).toBe("cafe_notes");
    expect(connectionSlug("123 notes")).toBe("s_123_notes");
    expect(connectionSlug("!!!")).toBe("service");
    expect(connectionSlug("Codex")).toBe("svc_codex");
    expect(connectionSlug("connected apps")).toBe("svc_connected_apps");
    expect(connectionSlug("a".repeat(40))).toHaveLength(24);
    expect(connectionSlug("Notes")).toMatch(/^[a-z][a-z0-9_]{0,23}$/u);
  });
});
