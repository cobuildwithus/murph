import { describe, expect, it } from "vitest";
import { type HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import { validateGameRecap } from "@/src/lib/game/recap";
import { recapPostedAt, gameLocalDate } from "@/src/lib/game/time";
import { isPairRecapShowEnabled } from "@/src/lib/game/access";

const players = ["Player A", "Murph"];
const scene = { kind: "scene" as const, scene: { cast: players, murph: true as const, prompt: "Two fictional athletes stand in a courtroom made of exercise mats, with a small friendly robot holding the referee clipboard." } };
const recap: HostedGameRecap = { treatment: "Courtroom drama", chatLine: "The game ended in a tie. The mat stayed busy.", pages: [
  { background: "night", blocks: [{ kind: "headline", text: "The Mat Takes the Stand" }, scene, { kind: "kicker", text: "Breakfast waits" }] },
  { background: "paper", blocks: [{ kind: "headline", text: "The clipboard watched" }, scene, { kind: "headline", text: "Both sides rested" }] },
  ...Array.from({ length: 3 }, () => ({ background: "paper" as const, blocks: [{ kind: "headline" as const, text: "The mat stayed busy" }] })),
] };
const check = (candidate = recap, count = 0) => validateGameRecap({ recap: candidate, players, show: true,
  entries: Array.from({ length: count }, (_, i) => ({ entryId: `photo-${i}`, playerName: players[0], kind: "photo", text: null, visibleToBoth: true })),
});
describe("pair show policy", () => {
  it("keeps all producers off by default and groups excluded regardless of roster size", () => {
    expect(isPairRecapShowEnabled(2, {})).toBe(false);
    expect(isPairRecapShowEnabled(2, { MURPH_GAME_RECAP_SHOW_ENABLED: "true" })).toBe(true);
    expect(isPairRecapShowEnabled(10, { MURPH_GAME_RECAP_SHOW_ENABLED: "true" })).toBe(false);
  });
  it("rejects normalized accepted treatment reuse", () => {
    expect(validateGameRecap({ recap, players, show: true, entries: [], usedTreatments: ["  COURTROOM   drama "] })).toContainEqual(expect.stringContaining("already used"));
  });
  it("accepts an exact cast including a player named Murph and a separate robot", () => expect(check()).toEqual([]));
  it("requires treatment, cover ordering, both players and unique exact names", () => {
    const bad = structuredClone(recap); delete bad.treatment;
    bad.pages[0].blocks.reverse(); bad.pages[0].blocks[1].scene!.cast = ["Player A", "Player A"];
    expect(check(bad)).toEqual(expect.arrayContaining([expect.stringContaining("treatment:"), expect.stringContaining("in that order"), expect.stringContaining("both players"), expect.stringContaining("unique")]));
  });
  it("allows a fourth scene only below three real photos", () => {
    const candidate = { ...recap, pages: [...recap.pages, recap.pages[1], recap.pages[1]] };
    expect(check(candidate, 2)).toEqual([]);
    expect(check(candidate, 3)).toContainEqual(expect.stringContaining("fourth requires"));
  });
  it("rejects crop treatment on real photos and mismatched setup/payoff order", () => {
    const candidate = structuredClone(recap);
    candidate.pages[2].blocks = [{ kind: "photo", entryIds: ["photo-0"], style: "fullBleed" }, { kind: "headline", text: "The mat stayed busy" }];
    expect(check(candidate, 1)).toEqual(expect.arrayContaining([expect.stringContaining("whole image"), expect.stringContaining("setup headline")]));
  });
});
describe("receipt times in frozen player zones", () => {
  it.each([
    ["2026-11-01T05:30:00Z", "America/New_York", "2026-11-01T01:30:00-04:00", "2026-10-31"],
    ["2026-11-01T06:30:00Z", "America/New_York", "2026-11-01T01:30:00-05:00", "2026-10-31"],
    ["2026-03-08T07:00:00Z", "America/New_York", "2026-03-08T03:00:00-04:00", "2026-03-08"],
    ["2026-11-10T00:00:00Z", "UTC", "2026-11-10T00:00:00+00:00", "2026-11-09"],
    ["2026-11-10T03:00:00Z", "UTC", "2026-11-10T03:00:00+00:00", "2026-11-10"],
    ["2026-11-10T00:00:00Z", "Asia/Tokyo", "2026-11-10T09:00:00+09:00", "2026-11-10"],
  ])("disambiguates %s in %s", (stamp, zone, local, date) => {
    expect(recapPostedAt(new Date(stamp), zone)).toEqual({ local, timeZone: zone, instant: new Date(stamp).toISOString() });
    expect(gameLocalDate(new Date(stamp), zone)).toBe(date);
  });
});

it('preserves accented, multiword and emoji names without disabling copy bans', () => {
  const names = ['Céleste Marín 🌿', 'He'];
  const candidate = structuredClone(recap);
  for (const page of candidate.pages) for (const block of page.blocks) if (block.scene) block.scene.cast = names;
  candidate.chatLine = 'Céleste Marín 🌿 won 7–6. He folded the towel.';
  candidate.pages[2].blocks[0].text = 'He folded the towel';
  const input = { recap: candidate, players: names, show: true, entries: [] };
  expect(validateGameRecap(input)).toEqual([]);
  candidate.pages[2].blocks[0].text = 'He left his towel 🧺';
  expect(validateGameRecap(input)).toEqual(expect.arrayContaining([expect.stringContaining('he/she/him/her'), expect.stringContaining('no emoji')]));
});

it('does not reject a repeated multiword accented name as repeated authored copy', () => {
  const candidate = structuredClone(recap);
  candidate.chatLine = 'The game ended in a tie 3–3. Céleste Marín Dupré balanced the tray.';
  const names = ['Céleste Marín Dupré', 'Noé'];
  for (const page of candidate.pages) for (const block of page.blocks) if (block.scene) block.scene.cast = names;
  expect(validateGameRecap({ recap: candidate, players: names, show: true, entries: [],
    priorChatLines: ['Céleste Marín Dupré carried the mat.'] })).toEqual([]);
});
