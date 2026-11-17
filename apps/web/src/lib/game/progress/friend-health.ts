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
  const friend = async (person: FriendSeries): Promise<FriendSeries> => {
    // Like the pair board, the most recent bound pair game chooses this person's room.
    const room = input.rooms.find(room => room.otherMemberId === person.memberId);
    if (!room) return { ...person, daily: null };
    const shared = await readHostedGroupBoardData({ ...room, viewerId: memberId, otherId: person.memberId, now });
    const projection = shared?.people.find(entry => entry.memberId === person.memberId)?.projections[input.metric === "steps" ? 2 : 1];
    const number = projection ? rawBoardNumber(input.metric, projection,
      { from: [person.joinedOn!, addDaysToIsoDate(today, -364)].sort().at(-1)!, through }, person.joinedOn!) : null;
    return { ...person, daily: number?.state === "available"
      ? number.daily.map(day => ({ date: day.date, amount: input.metric === "sleep" ? day.value * 60 : day.value })) : null };
  };
  // Your replica and friends' boards are independent: read them together, six boards at a time.
  const others = input.people.filter(person => !person.me);
  const [snapshot, friends] = await Promise.all([readCompanionHealthSeries(input.auth, input.signal), (async () => {
    const read: FriendSeries[] = [];
    for (let index = 0; index < others.length; index += 6) read.push(...await Promise.all(others.slice(index, index + 6).map(friend)));
    return read;
  })()]);
  const people = input.people.map(person => {
    if (!person.me) return friends.find(read => read.memberId === person.memberId)!;
    const raw = snapshot?.numbers[input.metric]?.daily;
    return { ...person, daily: raw ? healthSums(input.metric, progressHealthDays(input.metric, raw), person.joinedOn!, through) : null };
  });
  // A room gaining a bystander while decrypting cannot leak its former friend's values.
  const current = await readFriendRooms(memberId, input.people.filter(person => !person.me).map(person => person.memberId));
  if (current.incomplete) return { people: [], incomplete: true };
  return { incomplete: false, people: people.map(person => person.me || current.rooms.some(room => room.otherMemberId === person.memberId
    && room.runtimeMemberId === input.rooms.find(previous => previous.otherMemberId === person.memberId)?.runtimeMemberId)
    ? person : { ...person, daily: null }) };
}
