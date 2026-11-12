import type { GameCheckInKind, GameInvitePreview, GameSchedule, GameStake } from "@/src/lib/game/contract";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The words an invite page, its link preview, and its card share. */
export const CLOSED_INVITE_TITLE = "This invite isn't available";

export function describeSchedule(schedule: GameSchedule): string {
  if ("count" in schedule) return `Any ${schedule.count} ${schedule.count === 1 ? "day" : "days"} total`;
  if (schedule.days.length === 7) return "Every day";
  if (schedule.days.length === 5 && schedule.days.every((day) => day < 5)) return "Weekdays";
  return [...schedule.days].sort((left, right) => left - right).map((day) => WEEKDAY_NAMES[day]).join(", ");
}

/** Over the stake, as the app's tickets say it; the link preview card sets it in capitals. */
export function describeStakeLabel(stake: GameStake): string {
  return stake.kind === "per_miss" ? "Each missed day" : stake.kind === "dare" ? "The loser has to" : "For the winner";
}

/** Prize and dare copy describes the whole-game outcome. */
export function describeStakeSentence(stake: GameStake): string {
  if (stake.kind === "per_miss") return `Every day you miss, you owe ${stake.item}.`;
  return stake.kind === "dare" ? `Loser has to ${stake.item}.` : `FOR THE WINNER: ${stake.item}.`;
}

/**
 * The line under the invite page's headline, as the app's invite card says it:
 * "Every day for a week. Starts once you say yes." A group names no start
 * unless one was picked; it may already be running.
 */
export function describeInviteTiming(preview: Extract<GameInvitePreview, { status: "open" }>): string {
  const { schedule } = preview.terms;
  const days = preview.lengthDays ?? 7;
  const length = days === 7 ? "a week" : days % 7 === 0 ? `${days / 7} weeks` : `${days} days`;
  const when = "count" in schedule
    ? `Any ${schedule.count} ${schedule.count === 1 ? "day" : "days"} in ${length}.`
    : `${describeSchedule(schedule)} for ${length}.`;
  if (preview.startsOn) return `${when} Starts ${describeStartDate(preview.startsOn)}.`;
  return preview.maxPlayers === 10 ? when : `${when} Starts once you say yes.`;
}

/** A required check-in, said before anyone accepts. Free choice needs no line. */
export function describeCheckIn(kind: GameCheckInKind | undefined): string | null {
  if (kind === "any") return null;
  return kind === "heart_rate" ? "Prove it with heart rate from a wearable." : "Prove it with a photo.";
}

/** A closed link, in the app's words. It never names anyone. */
export function closedInviteCopy(preview: Exclude<GameInvitePreview, { status: "open" }> | null): { title: string; detail: string } {
  if (preview?.status === "used") return { detail: "Someone already shook on it. Ask for a new one.", title: "This link is used up." };
  if (preview?.status === "expired") {
    if (preview.reason !== "cancelled") return { detail: "It wasn't shaken on in time. Ask for a new one.", title: "This invite ran out." };
    return { detail: "Ask for a new one.", title: "This invite was called off." };
  }
  return { detail: "Check the link, or ask for a new one.", title: "This link isn't available." };
}

/** "Oct 19" for a picked start date (YYYY-MM-DD), read as a calendar date. */
export function describeStartDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

/**
 * The link preview's title and description. Only an open invite names
 * anyone; a used, expired, or missing one says just that it isn't available,
 * the same rule the page follows.
 */
export function inviteShareCopy(preview: GameInvitePreview | null): { title: string; description: string } {
  if (preview?.status !== "open") return { description: "Ask for a new link.", title: CLOSED_INVITE_TITLE };
  if (preview.maxPlayers === 10) {
    return {
      description: [
        describeGroupTask(preview),
        ...preview.terms.stakes.map((stake) => `Winner gets ${stake.item}.`),
      ].join(" "),
      title: `${preview.inviterFirstName} started a ${preview.group?.word || "group"} challenge`,
    };
  }
  return {
    description: preview.terms.stakes.map(describeStakeSentence).join(" "),
    title: `${preview.inviterFirstName} challenged you`,
  };
}

function describeGroupTask(preview: Extract<GameInvitePreview, { status: "open" }>): string {
  const { schedule } = preview.terms;
  const days = preview.lengthDays ?? 7;
  const duration = days % 7 === 0
    ? `${plainNumber(days / 7)} ${days === 7 ? "week" : "weeks"}`
    : `${plainNumber(days)} ${days === 1 ? "day" : "days"}`;
  const task = (preview.terms.defaultTask ?? "").trim().replace(/[.!?]+$/u, "");
  if ("count" in schedule) {
    return `${task} on any ${plainNumber(schedule.count)} ${schedule.count === 1 ? "day" : "days"} over ${duration}.`;
  }
  const when = schedule.days.length === 7 ? "every day"
    : schedule.days.length === 5 && schedule.days.every((day) => day < 5) ? "every weekday"
    : `on ${new Intl.ListFormat("en", { type: "conjunction" }).format(
      [...schedule.days].sort((left, right) => left - right)
        .map((day) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day]),
    )}`;
  return `${task} ${when} for ${duration}.`;
}

function plainNumber(value: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][value] ?? String(value);
}
