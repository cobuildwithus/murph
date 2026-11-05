import { describe, expect, it } from "vitest";
import { compareGroupRematch } from "../src/lib/game/rematch";
import { effectiveTermWords, type StoredTerms, type TermWords } from "../src/lib/game/rules";

const terms: StoredTerms = { v: 1, versions: [{ n: 4, fromDay: 0, checkInKind: "any", schedule: { days: [0, 2, 4] }, stakes: [{ key: "prize", kind: "prize" }] }] };
const words: TermWords = { v: 1, groupWord: "Crew", versions: [
  { n: 1, defaultTask: "Walk", tasks: [{ seat: 1, text: "Private original task" }], stakes: [{ key: "prize", item: "Choose lunch" }] },
  { n: 3, defaultTask: "Read", tasks: [{ seat: 1, text: "Private revised task" }], stakes: [{ key: "prize", item: "Choose dinner" }] },
] };

describe("canonical group rematch comparison", () => {
  it("inherits v1 at v2 and v3 at v4 without creating word versions", () => {
    expect(effectiveTermWords(words, 2)).toBe(words.versions[0]);
    expect(effectiveTermWords(words, 4)).toBe(words.versions[1]);
  });
  it("normalizes a different starter and effective override-or-default assignments", () => {
    const rematch = { terms, lengthDays: 12, words: { ...words, versions: [{ ...words.versions[1], n: 1, tasks: [{ seat: 0, text: "Private revised task" }, { seat: 1, text: "Read" }] }] } };
    expect(compareGroupRematch({ terms, words, lengthDays: 12 }, rematch, 1, [0, 1])).toMatchObject({ sameGame: true, changes: [], individualTasksChanged: false });
    rematch.words.versions[0].tasks[1].text = "Hidden replacement";
    const changed = compareGroupRematch({ terms, words, lengthDays: 12 }, rematch, 1, [0, 1]);
    expect(changed).toMatchObject({ sameGame: false, individualTasksChanged: true });
    expect(JSON.stringify(changed)).not.toMatch(/Private|Hidden replacement/u);
  });
  it("compares shared task, prize, schedule, duration and check-in kind without internal keys", () => {
    const comparison = compareGroupRematch({ terms, words, lengthDays: 12 }, { lengthDays: 14,
      terms: { v: 1, versions: [{ ...terms.versions[0], checkInKind: "photo", schedule: { count: 5 } }] },
      words: { ...words, versions: [{ ...words.versions[1], defaultTask: "Stretch", stakes: [{ key: "prize", item: "Choose a film" }] }] },
    }, 0, [0, 1]);
    expect(comparison.sameGame).toBe(false);
    expect(comparison.changes.map(change => change.field)).toEqual(["defaultTask", "prize", "schedule", "lengthDays", "checkInKind"]);
    expect(JSON.stringify(comparison)).not.toContain('"key"');
  });
});
