import type {
  ScheduleCell,
  ScheduleCellKind,
} from "@/src/types/experiments";

type CountedScheduleCellKind = Exclude<ScheduleCellKind, "baseline">;

export function countScheduleCellOccurrences(
  cell: ScheduleCell,
  kind: CountedScheduleCellKind,
): number {
  if (cell.occurrences) {
    return cell.occurrences[kind];
  }
  return cell.kind === kind ? 1 : 0;
}

export function countScheduleOccurrences(
  cells: readonly ScheduleCell[],
  kind: CountedScheduleCellKind,
): number {
  return cells.reduce(
    (total, cell) => total + countScheduleCellOccurrences(cell, kind),
    0,
  );
}
