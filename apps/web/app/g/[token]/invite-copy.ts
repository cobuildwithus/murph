import type { GameInvitePreview, GameSchedule, GameStake } from "@/src/lib/game/contract";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The words an invite page, its link preview, and its card share. */
export const CLOSED_INVITE_TITLE = "This invite isn't available";

export function describeSchedule(schedule: GameSchedule): string {
  if ("count" in schedule) return `Any ${schedule.count} ${schedule.count === 1 ? "day" : "days"} total`;
  if (schedule.days.length === 7) return "Every day";
  return [...schedule.days].sort((left, right) => left - right).map((day) => WEEKDAY_NAMES[day]).join(", ");
}

export function describeStakeLabel(stake: GameStake): string {
  return stake.kind === "per_miss" ? "Each missed day" : stake.kind === "dare" ? "Loser has to" : "FOR THE WINNER";
}

/** Prize and dare copy describes the whole-game outcome. */
export function describeStakeSentence(stake: GameStake): string {
  if (stake.kind === "per_miss") return `Every day you miss, you owe ${stake.item}.`;
  return stake.kind === "dare" ? `Loser has to ${stake.item}.` : `FOR THE WINNER: ${stake.item}.`;
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
  return {
    description: preview.terms.stakes.map(describeStakeSentence).join(" "),
    title: `${preview.inviterFirstName} challenged you`,
  };
}
