import type { AchievementContext, Candidate } from "./registry";

export function roundTotals({ measures }: AchievementContext): Candidate[] {
  return measures.filter(measure => !measure.pending).flatMap(measure => measure.rounds.flatMap(round => {
    const crossing = measure.points.find(([, total]) => total >= round.at);
    return crossing ? [{ key: `total:${measure.id}:${round.at}`, kind: measure.unit === "days" ? "days" : "total",
      measureId: measure.id, subjectMemberId: null, on: crossing[0], data: {
        value: round.at, face: round.face, title: round.title, detail: round.detail, page: "totals", evaluator: 1,
      } }] : [];
  }));
}

export function ladderRungs({ measures }: AchievementContext): Candidate[] {
  return measures.filter(measure => !measure.pending).flatMap(measure => measure.rungs.flatMap(rung => {
    const crossing = measure.points.find(([, total]) => total >= rung.at);
    return crossing ? [{ key: `rung:${measure.id}:${rung.id}`, kind: measure.unit === "seconds" ? "time" : "landmark",
      measureId: measure.id, subjectMemberId: null, on: crossing[0], data: {
        rung: { ...rung, on: crossing[0], toGo: null }, face: { drawing: rung.drawing ?? rung.id },
        title: rung.name, detail: measure.unit === "seconds" ? rung.atText : `${Math.ceil(rung.at).toLocaleString("en-US")} ${measure.noun}`,
        page: "totals", evaluator: 1,
      } }] : [];
  }));
}

export function streakRuns({ days }: AchievementContext): Candidate[] {
  let run = 0;
  let best = 0;
  const awards: Candidate[] = [];
  for (const day of days) {
    if (day.done) run++;
    else if (day.ended) run = 0;
    if (run <= best) continue;
    best = run;
    awards.push({ key: `streak:${run}`, kind: "streak", measureId: null, subjectMemberId: null, on: day.date,
      data: { value: run, face: { streak: run }, title: `${run} ${run === 1 ? "day" : "days"}`, detail: "your best run", page: "streak", evaluator: 1 } });
  }
  return awards;
}
