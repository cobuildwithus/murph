import { execFileSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "../src/index.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { gameGroupMissedCheckInPolicySchema } from "../src/game-group-missed.ts";
import { buildGameMissedDayInstructions } from "../src/game-chat-notifications.ts";

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
