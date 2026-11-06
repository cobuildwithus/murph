import { currentTerms, effectiveTermWords, type StoredTerms, type TermWords } from "./rules";

/** Swap the new starter with the original starter without moving other seats. */
export function rematchSeat(seat: number, starterSeat: number): number {
  return seat === 0 ? starterSeat : seat === starterSeat ? 0 : seat;
}

type Rules = { terms: StoredTerms; words: TermWords; lengthDays: number };

/** Compare canonical assignments first; only shared scalar changes leave Web. */
export function compareGroupRematch(previous: Rules, rematch: Rules, starterSeat: number, addressedSeats: readonly number[]) {
  const project = (rules: Rules) => {
    const version = currentTerms(rules.terms);
    const words = effectiveTermWords(rules.words, version.n);
    return { words, shared: {
      defaultTask: words.defaultTask ?? "",
      prize: version.stakes.map(stake => ({ kind: stake.kind, item: words.stakes.find(value => value.key === stake.key)?.item ?? "" })),
      schedule: "days" in version.schedule ? { days: [...version.schedule.days].sort((a, b) => a - b) } : version.schedule,
      lengthDays: rules.lengthDays, checkInKind: version.checkInKind ?? "photo",
    } };
  };
  const before = project(previous);
  const after = project(rematch);
  const task = (words: TermWords["versions"][number], seat: number) => words.tasks.find(value => value.seat === seat)?.text ?? words.defaultTask ?? "";
  const individualTasksChanged = addressedSeats.some(seat => task(before.words, rematchSeat(seat, starterSeat)) !== task(after.words, seat));
  const changes = Object.entries(after.shared).flatMap(([field, value]) => {
    const prior = before.shared[field as keyof typeof before.shared];
    return JSON.stringify(prior) === JSON.stringify(value) ? [] : [{ field, previous: prior, current: value }];
  });
  return { sameGame: changes.length === 0 && !individualTasksChanged, changes, individualTasksChanged };
}
