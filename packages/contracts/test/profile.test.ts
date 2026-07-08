import { describe, expect, it } from "vitest";

import {
  createEmptyProfileDocument,
  parseProfileDocument,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  renderProfileDocument,
  setProfileDisplayName,
} from "../src/profile.ts";

describe("profile document", () => {
  it("round-trips an empty document with a null display name", () => {
    const document = createEmptyProfileDocument(new Date("2026-07-01T00:00:00.000Z"));
    const parsed = parseProfileDocument({ text: renderProfileDocument(document) });

    expect(parsed.frontmatter.displayName).toBeNull();
    expect(parsed.frontmatter.docType).toBe("profile");
  });

  it("round-trips a set display name, including names that need quoting", () => {
    for (const displayName of ["Theo", "Dr. J \"Big\" O'Neil", "Ana Maria"]) {
      const document = setProfileDisplayName(
        createEmptyProfileDocument(new Date("2026-07-01T00:00:00.000Z")),
        { displayName, now: new Date("2026-07-02T00:00:00.000Z") },
      );
      const parsed = parseProfileDocument({ text: renderProfileDocument(document) });

      expect(parsed.frontmatter.displayName).toBe(displayName);
      expect(parsed.frontmatter.updatedAt).toBe("2026-07-02T00:00:00.000Z");
    }
  });

  it("rejects blank and oversized display names", () => {
    const document = createEmptyProfileDocument();
    expect(() => setProfileDisplayName(document, { displayName: "  " })).toThrow();
    expect(() =>
      setProfileDisplayName(document, {
        displayName: "a".repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH + 1),
      })
    ).toThrow();
  });

  it("rejects display names with control characters, matching the vault-share delivery rule", () => {
    const document = createEmptyProfileDocument();
    for (const displayName of ["Theo\nOdin", "Theo\tOdin", "Theo\u0000Odin", "Theo\u007fOdin"]) {
      expect(() => setProfileDisplayName(document, { displayName })).toThrow();
    }
  });
});
