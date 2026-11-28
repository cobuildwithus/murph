import { number, rowDay, type Observation } from "./model";

export function specimen(row: Observation) {
  return String(row.panel_id || row.draw_id || row.collected_at || "");
}

export function labDraw(row: Observation, value: number | null) {
  return {
    date: rowDay(row),
    collected: String(row.collected_at ?? ""),
    specimen: specimen(row),
    reported: String(row.report_timestamp ?? row.reported_at ?? ""),
    revision: number(row.revision) ?? 0,
    value,
  };
}
export type LabDraw = ReturnType<typeof labDraw>;

// Resolve corrections within each specimen before choosing an acquisition date.
export function resolvedDraws(rows: LabDraw[]) {
  const groups = new Map<string, LabDraw[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.date, row.specimen || row.date]);
    const group = groups.get(key);
    const order = group
      ? row.revision - group[0].revision || row.reported.localeCompare(group[0].reported)
      : 1;
    if (order > 0) groups.set(key, [row]);
    else if (order === 0) group!.push(row);
  }
  return [...groups.values()].flatMap((group) => {
    const row = group[0];
    return row.value !== null && group.every((r) => r.value === row.value && r.collected === row.collected)
      ? group
      : [];
  });
}
export function latestDraw(rows: LabDraw[], requireSameSpecimen = false) {
  const sorted = resolvedDraws(rows).sort(
    (a, b) => b.date.localeCompare(a.date) || b.collected.localeCompare(a.collected),
  );
  const first = sorted[0];
  if (!first) return null;
  const tied = sorted.filter((r) => r.date === first.date && r.collected === first.collected);
  return tied.every((r) => r.value === first.value && (!requireSameSpecimen || r.specimen === first.specimen))
    ? first
    : null;
}
