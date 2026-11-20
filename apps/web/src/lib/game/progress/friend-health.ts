import "server-only";
import { ProgressReadTiming } from "./read-timing";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { readCompanionHealthSeries } from "../../device-sync/companion-numbers";
import { readHostedGroupBoardData } from "../../hosted-groups/group-store";
import { lastSettledStepDay } from "../../settled-step-day";
import { sharedHealthDays } from "../board-numbers";
import { healthSums, progressHealthDays } from "./health";
import { readFriendRooms, type FriendRoom } from "./friend-sharing";
import type { FriendSeries } from "./friends";

/** Friend health comes only from the existing pair-board grants, never another member's vault. */
export async function readFriendHealthSeries(input: {
  auth: HostedNativeMemberAuth; people: FriendSeries[]; rooms: FriendRoom[];
  metric: "steps" | "sleep"; timeZone: string; signal: AbortSignal; with?: string; timing?: ProgressReadTiming;
}) {
  const timing = input.timing ?? new ProgressReadTiming();
  const now = new Date(), memberId = input.auth.member.id, today = toLocalDayKey(now, input.timeZone);
  const through = input.metric === "steps" ? lastSettledStepDay(now, input.timeZone) : today;
  const friend = async (person: FriendSeries): Promise<FriendSeries> => {
    // Like the pair board, the most recent bound pair game chooses this person's room.
    const room = input.rooms.find(room => room.otherMemberId === person.memberId);
    if (!room) return { ...person, daily: null };
    timing.counts.boards++;
    const shared = await readHostedGroupBoardData({ ...room, viewerId: memberId, otherId: person.memberId, otherMetric: input.metric, now });
    const projection = shared?.people.find(entry => entry.memberId === person.memberId)?.projections[input.metric === "steps" ? 2 : 1];
    const days = projection && sharedHealthDays(input.metric, projection,
      { from: [person.joinedOn!, addDaysToIsoDate(today, -364)].sort().at(-1)!, through });
    return { ...person, daily: days?.map(day => ({ date: day.date, amount: input.metric === "sleep" ? day.value * 60 : day.value })) ?? null };
  };
  // Your replica and friends' boards are independent: read them together, six boards at a time.
  // Drawer totals use one friend. Sharing and the room-cap recheck still use the full cohort.
  const others = input.people.filter(person => !person.me && (!input.with || person.memberId === input.with));
  const [snapshot, friends] = await Promise.all([
    timing.measure("ownReplica", () => readCompanionHealthSeries(input.auth, input.signal, [input.metric])),
    timing.measure("friendBoards", async () => {
      const read: FriendSeries[] = [];
      for (let index = 0; index < others.length; index += 6) {
        read.push(...await Promise.all(others.slice(index, index + 6).map(friend)));
      }
      return read;
    }),
  ]);
  const people = input.people.map(person => {
    if (!person.me) return friends.find(read => read.memberId === person.memberId) ?? { ...person, daily: null };
    const raw = snapshot?.numbers[input.metric]?.daily;
    return { ...person, daily: raw ? healthSums(input.metric, progressHealthDays(input.metric, raw), person.joinedOn!, through) : null };
  });
  // A room gaining a bystander while decrypting cannot leak its former friend's values.
  const current = await timing.measure("rooms", () => readFriendRooms(memberId, input.people.filter(person => !person.me).map(person => person.memberId)));
  if (current.incomplete) return { people: [], rooms: [], incomplete: true };
  return { incomplete: false, rooms: current.rooms, people: people.map(person => person.me || current.rooms.some(room => room.otherMemberId === person.memberId
    && room.runtimeMemberId === input.rooms.find(previous => previous.otherMemberId === person.memberId)?.runtimeMemberId)
    ? person : { ...person, daily: null }) };
}
