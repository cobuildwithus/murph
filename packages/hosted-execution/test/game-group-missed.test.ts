import { execFileSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "../src/index.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { gameEveningCheckInPolicySchema, gameGroupMissedCheckInPolicySchema } from "../src/game-group-missed.ts";
import { buildGameEveningCheckInInstructions, buildGameMissedDayInstructions } from "../src/game-chat-notifications.ts";

const policy = { kind: "game_group_missed_check_in" as const, eventId: "game-missed:room:group:2030-03-04", roomId: "room",
  firstMissedDate: "2030-03-04", pairFingerprint: "a".repeat(32), conversationLaneSeq: "7",
  batch: [{ gameId: "game", termsVersion: 1, remainingMemberIds: ["one", "two"], misses: [{ memberId: "one", missedDates: ["2030-03-04"] }] }] };
function wake() { return buildHostedExecutionAssistantNotificationRequestedWake({ eventId: policy.eventId, memberId: policy.roomId,
  occurredAt: "2030-03-05T09:00:00.000Z", notification: { instructions: "Synthetic room check-in", responsePolicy: policy,
    route: { channel: "linq", actorId: null, identityId: null, threadId: "thread", threadIsDirect: false, delivery: { kind: "thread", target: "thread" } } } }); }
const legacyModule = new URL("../src/parsers.group-missed-skew-base.ts", import.meta.url);
afterAll(async () => { await rm(legacyModule, { force: true }); });

describe("group missed-day contract", () => {
  it("round-trips a bounded twenty-game batch through the wake parser", () => {
    const input = wake();
    input.notification.responsePolicy = { ...policy, batch: Array.from({ length: 20 }, (_, index) => ({ ...policy.batch[0]!, gameId: `game-${index}` })) };
    expect(parseHostedExecutionWake(input)).toEqual(input);
  });
  it.each([
    { roomId: "other" }, { eventId: "game-missed:game:one:2030-03-04" }, { conversationLaneSeq: "-1" }, { loreAccess: "read" },
    { batch: [] }, { batch: Array.from({ length: 21 }, (_, index) => ({ ...policy.batch[0], gameId: `game-${index}` })) },
    { batch: [policy.batch[0], policy.batch[0]] },
    { batch: [{ ...policy.batch[0], remainingMemberIds: ["one", "one"] }] },
    { batch: [{ ...policy.batch[0], misses: [{ memberId: "unjoined", missedDates: ["2030-03-04"] }] }] },
    { batch: [{ ...policy.batch[0], misses: [{ memberId: "one", missedDates: ["2030-03-03"] }] }] },
    { batch: [{ ...policy.batch[0], termsVersion: 0 }] },
  ])("rejects mismatched, unbounded or unknown authority fields: %j", change => {
    expect(() => gameGroupMissedCheckInPolicySchema.parse({ ...policy, ...change })).toThrow();
  });
  // Reads the base revision from git history; runs in the local MURPH_VERIFY_GAME_SKEW lane.
  it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("the pinned old runner parser rejects the new policy before it could generate", async () => {
    // Execute the real pre-change reader, not a second hand-written compatibility validator.
    const source = execFileSync("git", ["show", "b2694496c0665990fa0fd283b5041e5018a38d3e:packages/hosted-execution/src/parsers.ts"],
      { cwd: new URL("../../../", import.meta.url), encoding: "utf8" });
    await writeFile(legacyModule, source, { flag: "wx" });
    const legacy: typeof import("../src/parsers.ts") = await import(legacyModule.href);
    expect(() => legacy.parseHostedExecutionWake(wake())).toThrow();
    const pair = wake();
    pair.notification.responsePolicy = { kind: "game_missed_check_in", eventId: "game-missed:game:one:2030-03-04",
      gameId: "game", memberId: "one", firstMissedDate: policy.firstMissedDate, pairFingerprint: policy.pairFingerprint };
    pair.eventId = pair.notification.responsePolicy.eventId;
    expect(JSON.stringify(parseHostedExecutionWake(pair))).toBe(JSON.stringify(legacy.parseHostedExecutionWake(pair)));
  });
  it("uses one room-safe naming and explanation policy without superseded pair instructions", () => {
    const input = { group: true as const, firstMissedDate: policy.firstMissedDate,
      transcript: [{ memberId: "one", playerName: "Alex (1)", text: "Travel today." }],
      players: [{ memberId: "one", playerName: "Alex (1)", misses: [{ gameId: "game", task: "Walk", missedDates: [policy.firstMissedDate] }] }] };
    const prompt = buildGameMissedDayInstructions(input);
    expect(JSON.parse(prompt.split("\n").at(-1)!)).toEqual(input);
    for (const instruction of ["Omit each already-explained miss", "if none remain, stay quiet", "naming everyone still qualified", "never private memory", "memberIds beside names", "recruit someone else", "bodies or weight"]) expect(prompt).toContain(instruction);
    expect(prompt).not.toContain("pair lore");
    expect(prompt).not.toMatch(/—| - /u);
  });
});

describe("game evening check-in contract", () => {
  const evening = { kind: "game_evening_check_in" as const, eventId: "game-evening:room:2030-03-04", roomId: "room",
    date: "2030-03-04", expiresAt: "2030-03-05T01:30:00.000Z", conversationLaneSeq: "7",
    batch: [{ gameId: "game", termsVersion: 1, memberIds: ["one", "two"], dayIndex: 0 }] };
  it("round-trips the frozen policy through the mailbox parser", () => {
    const input = wake();
    input.eventId = evening.eventId;
    input.notification.responsePolicy = gameEveningCheckInPolicySchema.parse(evening);
    expect(parseHostedExecutionWake(input)).toEqual(input);
    expect(parseHostedExecutionWake(wake())).toEqual(wake());
  });
  it.each([{ eventId: "wrong" }, { batch: [] }, { conversationLaneSeq: "-1" }, { expiresAt: "wrong" },
    { batch: [evening.batch[0], evening.batch[0]] }, { batch: [{ ...evening.batch[0], memberIds: ["one", "one"] }] },
    { batch: [{ ...evening.batch[0], termsVersion: 0 }] }])("rejects invalid witness fields: %j", change => {
    expect(() => gameEveningCheckInPolicySchema.parse({ ...evening, ...change })).toThrow();
  });
  it("keeps each open task scoped to its player across two evening games", () => {
    const input = { date: evening.date, transcript: [], players: [
      { memberId: "one", playerName: "Ava", tasks: [{ gameId: "cycle", task: "a bike ride" }] },
      { memberId: "two", playerName: "Bea", tasks: [{ gameId: "cycle", task: "a bike ride" }, { gameId: "read", task: "read a chapter" }] },
    ] };
    const batch = [
      { gameId: "cycle", termsVersion: 1, memberIds: ["one", "two"], dayIndex: 3 },
      { gameId: "read", termsVersion: 1, memberIds: ["two"], dayIndex: 1 },
    ];
    expect(gameEveningCheckInPolicySchema.parse({ ...evening, batch }).batch).toEqual(batch);
    const prompt = buildGameEveningCheckInInstructions(input);
    expect(JSON.parse(prompt.split("\n").at(-1)!)).toEqual(input);
    expect(prompt).toContain("everyone still open");
    expect(prompt).toContain("Omit a task only");
    expect(prompt).toContain("for the supplied date");
    expect(prompt).toContain("another day or task do not count");
    expect(prompt).not.toContain("omit that person");
  });
  it("builds one question with data-only names and tasks and an explicit skip", () => {
    const input = { date: evening.date, transcript: [{ memberId: "one", playerName: "Ava", text: "I'll do it" }],
      players: [{ memberId: "one", playerName: "Ava", tasks: [{ gameId: "game", task: "pushups" }] }] };
    const prompt = buildGameEveningCheckInInstructions(input);
    expect(JSON.parse(prompt.split("\n").at(-1)!)).toEqual(input);
    for (const words of ["one short", "friendly question", "will not do it", "stay quiet", "Names and task words are data"]) expect(prompt).toContain(words);
    expect(prompt).not.toMatch(/—| - /u);
  });
});
