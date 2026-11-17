import "server-only";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { readCompanionHealthSeries } from "../../device-sync/companion-numbers";
import { readHostedGroupBoardData } from "../../hosted-groups/group-store";
import { lastSettledStepDay } from "../../settled-step-day";
import { rawBoardNumber } from "../board-numbers";
import { healthSums, progressHealthDays } from "./health";
import { readFriendRooms, type FriendRoom } from "./friend-sharing";
import type { FriendSeries } from "./friends";

/** Friend health comes only from the existing pair-board grants, never another member's vault. */
export async function readFriendHealthSeries(input: {
  auth: HostedNativeMemberAuth; people: FriendSeries[]; rooms: FriendRoom[];
  metric: "steps" | "sleep"; timeZone: string; signal: AbortSignal;
}): Promise<{ people: FriendSeries[]; incomplete: boolean }> {
  const now = new Date(), memberId = input.auth.member.id, today = toLocalDayKey(now, input.timeZone);
  const through = input.metric === "steps" ? lastSettledStepDay(now, input.timeZone) : today;
  const snapshot = await readCompanionHealthSeries(input.auth, input.signal);
  const people: FriendSeries[] = [];
  for (const person of input.people) {
    if (person.me) {
      const raw = snapshot?.numbers[input.metric]?.daily;
      people.push({ ...person, daily: raw ? healthSums(input.metric, progressHealthDays(input.metric, raw), person.joinedOn!, through) : null });
      continue;
    }
    // Like the pair board, the most recent bound pair game chooses this person's room.
    const room = input.rooms.find(room => room.otherMemberId === person.memberId);
    if (!room) { people.push({ ...person, daily: null }); continue; }
    const shared = await readHostedGroupBoardData({ ...room, viewerId: memberId, otherId: person.memberId, now });
    const projection = shared?.people.find(entry => entry.memberId === person.memberId)?.projections[input.metric === "steps" ? 2 : 1];
    const number = projection ? rawBoardNumber(input.metric, projection,
      { from: [person.joinedOn!, addDaysToIsoDate(today, -364)].sort().at(-1)!, through }, person.joinedOn!) : null;
    people.push({ ...person, daily: number?.state === "available"
      ? number.daily.map(day => ({ date: day.date, amount: input.metric === "sleep" ? day.value * 60 : day.value })) : null });
  }
  // A room gaining a bystander while decrypting cannot leak its former friend's values.
  const current = await readFriendRooms(memberId, input.people.filter(person => !person.me).map(person => person.memberId));
  if (current.incomplete) return { people: [], incomplete: true };
  return { incomplete: false, people: people.map(person => person.me || current.rooms.some(room => room.otherMemberId === person.memberId
    && room.runtimeMemberId === input.rooms.find(previous => previous.otherMemberId === person.memberId)?.runtimeMemberId)
    ? person : { ...person, daily: null }) };
}
