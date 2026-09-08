import { describe, expect, it } from "vitest";
import {
  parseJournalIcon,
  parseJournalTiming,
  readJournalIcon,
  readJournalTiming,
} from "../src/journal-presentation.js";

describe("Journal presentation metadata", () => {
  it("accepts catalog icons and rejects arbitrary assets and prototype keys", () => {
    expect(parseJournalIcon("travel")).toBe("travel");
    for (const value of ["__proto__", "constructor", "https://example.test/icon.svg", null]) {
      expect(parseJournalIcon(value)).toBeNull();
    }
    expect(readJournalIcon(["journal-icon-travel", "journal-icon-travel"])).toBe("travel");
    expect(readJournalIcon(["journal-icon-travel", "journal-icon-meal"])).toBeNull();
    expect(readJournalIcon(["journal-icon-missing", "unrelated"])).toBeNull();
  });

  it("preserves missing and conflicting timing without inventing a clock time", () => {
    expect(readJournalTiming(["unrelated"])).toBeNull();
    expect(readJournalTiming(["timing-evening"])).toBe("evening");
    expect(readJournalTiming(["timing-evening", "timing-evening"])).toBe("evening");
    expect(readJournalTiming(["timing-timed", "timing-all-day"])).toBe("unknown");
    expect(parseJournalTiming("morning")).toBe("morning");
    expect(parseJournalTiming("noon")).toBeNull();
    expect(parseJournalTiming(null)).toBeNull();
  });
});
