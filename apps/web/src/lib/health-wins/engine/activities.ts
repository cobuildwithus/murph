import { BANK, ladder } from "../../game/progress/bank";
import type { EXERCISES } from "../../game/progress/registry";
import { addDays, weekdayOf } from "../../game/time";
import { isMetric, metricInfo } from "./metrics";
import { cardDateKey, cardText, dayNumber, formatDuration, formatNumber, formatWinDate, formatWinMonth, isDate } from "./shared";
import type { Candidate, Experiment, Game, GameStreakDay, HealthWinsInput, Metric, Session, SessionType } from "./types";

type ExperimentBar = { label: "Before" | "During"; start: string; end: string; mean: number };
type TimeRung = { id: string; name: string; seconds: number };
type SkylineLandmark = { id: string; name: string; height: number; heightUnit: "ft" };
type GameStreak = NonNullable<Game["bestStreak"]>;

export interface ActivityCharts {
  experiment_result: {
    type: "two_bars";
    barWidth: "thin";
    metric: Metric;
    unit: string;
    series: [ExperimentBar, ExperimentBar];
    adherence: Experiment["adherence"];
    expectedDirection: Experiment["expectedDirection"];
    overlap?: string;
  };
  game_climb: {
    type: "skyline";
    exercise: string;
    total: number;
    unit: string;
    landmarksPassed: readonly SkylineLandmark[];
    next: (SkylineLandmark & { toGo: number }) | null;
  } | {
    type: "ladder";
    exercise: "planks";
    unit: "seconds";
    total: number;
    rungsPassed: TimeRung[];
    next: (TimeRung & { toGo: number }) | null;
  };
  game_streak: { type: "week_dots" } & GameStreak;
  sessions: {
    type: "sessions";
    sessionType: SessionType;
    series: { date: string; minutes: number }[];
    totalMinutes: number;
  };
}

// Checked against the Progress registry without loading its server-side evaluators.
const exerciseNames = {
  pushups: "pushups", pullups: "pull-ups", squats: "squats", planks: "planks", abs: "ab exercises",
  lunges: "lunges", situps: "sit-ups", crunches: "crunches", burpees: "burpees", walk: "walking",
  run: "running", meditation: "meditation", stretching: "stretching", yoga: "yoga",
} satisfies Record<keyof typeof EXERCISES, string>;

const sessionNames: Record<SessionType, { plural: string; activity: string }> = {
  run: { plural: "runs", activity: "running" },
  walk: { plural: "walks", activity: "walking" },
  sauna: { plural: "sauna sessions", activity: "sauna time" },
  hiit: { plural: "HIIT sessions", activity: "HIIT" },
  basketball: { plural: "basketball sessions", activity: "basketball" },
  other: { plural: "other sessions", activity: "activity" },
};

function validWindow(window: Experiment["intervention"]): boolean {
  return isDate(window.start) && isDate(window.end) && window.start <= window.end;
}

function experimentHeadline(experiment: Experiment, runningBlock: boolean) {
  if (runningBlock) {
    const { done } = experiment.adherence;
    const days = dayNumber(experiment.intervention.end) - dayNumber(experiment.intervention.start) + 1;
    const weeks = days / 7;
    return {
      number: `${formatNumber(done, 0)} ${done === 1 ? "run" : "runs"}`,
      measure: Number.isInteger(weeks)
        ? `in ${weeks} ${weeks === 1 ? "week" : "weeks"}`
        : `in ${days} ${days === 1 ? "day" : "days"}`,
    };
  }
  const timing = /^(.+?)\s+((?:before|after) (?:bed(?:time)?|breakfast|lunch|dinner))$/iu.exec(experiment.title);
  return { number: timing?.[1] ?? experiment.title, measure: timing?.[2] ?? "" };
}

function experimentOutcome(metric: Metric, before: number, during: number): string | null {
  const { label, direction, trendStep } = metricInfo(metric);
  const step = metric === "rhr_bpm" || metric === "sleep_score" ? 2 : trendStep ?? 1;
  const change = during - before;
  if (change * direction <= -step) return null;
  const subject = metric === "distance_km" ? "Distance on foot" : label[0].toUpperCase() + label.slice(1);
  if (Math.abs(change) < step) {
    return `${metric === "sleep_score" ? "Sleep" : subject} stayed about the same.`;
  }
  const verb = metric === "steps" || metric === "floors" ? "were" : "was";
  return `${subject} ${verb} ${during > before ? "higher" : "lower"} during the experiment.`;
}

function experimentCandidates(inputs: readonly Experiment[], today: string): Candidate[] {
  const experiments = inputs.map(experiment => ({
    ...experiment,
    title: cardText(experiment.title),
  }));
  const candidates: Candidate[] = [];
  // One intervention can have several measured outcomes. Its privacy applies to all of them.
  const privateSlugs = new Set(experiments
    .filter(experiment => experiment.sensitiveCategory || !isMetric(experiment.metric))
    .map(experiment => experiment.slug));
  const shareable = (experiment: Experiment) => !privateSlugs.has(experiment.slug) && !!experiment.title;
  const scheduled = experiments.filter(experiment => validWindow(experiment.intervention));
  for (const experiment of scheduled) {
    const { slug, title, metric, baseline, intervention, baselineMean, interventionMean, adherence, expectedDirection } = experiment;
    if (!shareable(experiment) || !slug.trim() || intervention.end > today ||
        !validWindow(baseline) || baseline.end >= intervention.start ||
        !Number.isSafeInteger(adherence.done) || adherence.done < 0 ||
        !Number.isSafeInteger(adherence.target) || adherence.target < 0) continue;
    const { unit, min, max } = metricInfo(metric);
    if (![baselineMean, interventionMean].every(value => Number.isFinite(value) && value >= min && value <= max)) continue;
    const outcome = experimentOutcome(metric, baselineMean, interventionMean);
    if (!outcome) continue;

    // Unfinished concurrent experiments can also affect the interpretation of a finished one.
    const concurrent = scheduled.filter(other => other.slug !== slug &&
      other.intervention.start <= intervention.end && intervention.start <= other.intervention.end);
    if (concurrent.some(other => !shareable(other))) continue;
    const overlap = [...new Set(concurrent.map(other => other.title))].sort().join(", ");
    const runningBlock = /\brun(?:ning)?\s+(?:\w+\s+)?block\b/iu.test(title);
    const nightly = /\b(?:bedtime|before bed|nightly|each night)\b/iu.test(title);
    const countUnit = runningBlock ? "run" : nightly ? "night" : "";
    const counted = (n: number) => formatNumber(n, 0) + (countUnit ? ` ${countUnit}${n === 1 ? "" : "s"}` : "");
    const progress = adherence.target > 0 && adherence.done <= adherence.target
      ? `${formatNumber(adherence.done, 0)} of ${counted(adherence.target)} logged`
      : `${counted(adherence.done)} logged against a target of ${formatNumber(adherence.target, 0)}`;
    candidates.push({
      date: intervention.end, effect: 0, noise: 1,
      card: {
        kind: "experiment_result", id: `experiment_result:${slug}:${cardDateKey(intervention.start)}:${metric}`, filter: "Experiments",
        title: experimentHeadline(experiment, runningBlock),
        subtitle: `${outcome} ${progress}.${overlap ? ` Ran alongside ${overlap}.` : ""}`,
        source_note: `Experiment log · ${formatWinDate(baseline.start, today)} through ${formatWinDate(intervention.end, today)}`,
        chart: {
          type: "two_bars", barWidth: "thin", metric, unit, expectedDirection, adherence: { done: adherence.done, target: adherence.target },
          series: [
            { label: "Before", start: baseline.start, end: baseline.end, mean: baselineMean },
            { label: "During", start: intervention.start, end: intervention.end, mean: interventionMean },
          ],
          ...(overlap ? { overlap } : {}),
        },
      },
    });
  }
  return candidates;
}

function nonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function gameSeconds(total: number, unit: string): number | null {
  switch (unit.trim().toLowerCase()) {
    case "s": case "sec": case "secs": case "second": case "seconds": return total;
    case "min": case "mins": case "minute": case "minutes": return total * 60;
    case "h": case "hr": case "hrs": case "hour": case "hours": return total * 3600;
    default: return null;
  }
}

function gameAmount(total: number, unit: string, exercise: string, name: string): string {
  const key = unit.trim().toLowerCase().replace(/[\s-]/g, "");
  if (key === exercise || key === name.replace(/[\s-]/g, "") || key === "rep" || key === "reps") {
    return formatNumber(total, 0);
  }
  const precision = ["mi", "mile", "miles", "steps", "bpm"].includes(key) ? 0 : 1;
  return `${formatNumber(total, precision)} ${unit.trim()}`;
}

type Climb = { subtitle: string; chart: ActivityCharts["game_climb"] };

const plankLadder = ladder("time", "plank");
const firstHeightRung = ladder("height", "")[0];
const heightLandmarks = new Map(BANK.filter(entry => entry.kind === "height").map(entry => [entry.id, entry]));

function skylineLandmark({ id, height }: Game["landmarksPassed"][number]): SkylineLandmark {
  return { id, name: heightLandmarks.get(id)?.name ?? "Landmark", height, heightUnit: "ft" };
}

function plankClimb(seconds: number): Climb {
  const rungs = plankLadder.map(({ id, name, at }) => ({ id, name, seconds: at }));
  const rungsPassed = rungs.filter(rung => rung.seconds <= seconds);
  const last = rungsPassed.at(-1);
  const next = rungs[rungsPassed.length];
  let subtitle = last
    ? `latest time milestone, ${last.name.replace(/^(The|A) /u, article => article.toLowerCase())}`
    : "time planked so far";
  if (next?.id === "sunlight-earth" && seconds >= next.seconds * 0.9) {
    subtitle = "nearly as long as sunlight takes to reach Earth";
  } else if (last?.id === "sunlight-earth") {
    subtitle = seconds === last.seconds ? "as long as sunlight takes to reach Earth" : "longer than sunlight takes to reach Earth";
  }
  return { subtitle, chart: {
    type: "ladder", exercise: "planks", total: seconds, unit: "seconds", rungsPassed,
    next: next ? { ...next, toGo: next.seconds - seconds } : null,
  } };
}

function skylineClimb(game: Game): Climb | null {
  const { exercise, total, unit, landmarksPassed, next } = game;
  if (!landmarksPassed.every(landmark => nonnegative(landmark.height))) return null;
  if (next && (!nonnegative(next.height) || !nonnegative(next.toGo))) return null;

  const highest = landmarksPassed.reduce<(typeof landmarksPassed)[number] | null>(
    (best, row) => !best || row.height > best.height ? row : best, null);
  const place = highest && heightLandmarks.get(highest.id);
  let subtitle = "game total so far";
  if (place) {
    const takesArticle = /(?:Sign|Building|Monument|Needle|Arch|[Tt]owers?|Matterhorn|Taj Mahal)$|^(?:Great Pyramid|Statue of Liberty)/u;
    const article = takesArticle.test(place.name) ? "the " : "";
    const verb = place.id === firstHeightRung?.id ? "climb" : "climb past";
    subtitle = `enough to ${verb} ${article}${place.name}`;
  }
  return { subtitle, chart: {
    type: "skyline", exercise, unit, total,
    landmarksPassed: landmarksPassed.map(skylineLandmark),
    next: next ? { ...skylineLandmark(next), toGo: next.toGo } : null,
  } };
}

function gameClimb(game: Game, name: string, today: string): Candidate | null {
  const { exercise, total, unit } = game;
  if (!Number.isFinite(total) || total <= 0 || !unit.trim() || cardText(unit) !== unit.trim()) return null;
  const seconds = gameSeconds(total, unit);
  if (seconds !== null && !Number.isFinite(seconds)) return null;
  const climb = exercise === "planks" && seconds !== null ? plankClimb(seconds) : skylineClimb(game);
  if (!climb) return null;
  const amount = seconds === null ? gameAmount(total, unit, exercise, name)
    : seconds < 60 ? `${formatNumber(seconds, 0)} sec` : formatDuration(seconds / 60);
  return {
    date: today, eventDate: game.latestDay && isDate(game.latestDay) && game.latestDay <= today ? game.latestDay : undefined,
    effect: 0, noise: 1,
    card: {
      kind: "game_climb", id: `game_climb:${exercise}`, filter: "Challenges",
      title: { number: amount, measure: climb.chart.type === "ladder" ? "planked" : name },
      ...climb,
      source_note: `Game totals as of ${formatWinDate(today, today)}`,
    },
  };
}

function streakCalendar(start: string, end: string, days: readonly GameStreakDay[], today: string): GameStreakDay[] {
  const states = new Map(days.map(day => [day.date, day.state]));
  const monday = addDays(start, -weekdayOf(start));
  const length = dayNumber(end) - dayNumber(monday) + 7 - weekdayOf(end);
  return Array.from({ length }, (_, index) => {
    const date = addDays(monday, index);
    return { date, state: date <= today ? states.get(date) ?? "no_game" : "no_game" };
  });
}

function gameStreak(bestStreak: GameStreak, today: string): Candidate | null {
  if (!validWindow(bestStreak) || bestStreak.end > today) return null;
  const { days, start, end, missedOn, calendar } = bestStreak;
  if (!Number.isSafeInteger(days) || days <= 0) return null;
  if (missedOn !== null && (!isDate(missedOn) || missedOn > today)) return null;

  return {
    date: end, effect: 0, noise: 1,
    card: {
      kind: "game_streak", id: "game_streak", filter: "Challenges",
      title: { number: formatNumber(days, 0), measure: days === 1 ? "day" : "days" },
      subtitle: "posted in every game, best run yet",
      source_note: `Game streak log · ${formatWinDate(start, today)} through ${formatWinDate(end, today)}`,
      chart: {
        type: "week_dots", days, start, end, missedOn,
        ...(calendar && { calendar: streakCalendar(start, end, calendar, today) }),
      },
    },
  };
}

function streakKey({ days, start, end, missedOn }: GameStreak): string {
  return `${days}:${start}:${end}:${missedOn}`;
}

function gameCandidates(input: HealthWinsInput, today: string): Candidate[] {
  const games = (input.games ?? []).filter(game => Object.hasOwn(exerciseNames, game.exercise));
  const climbs = games.map(game => gameClimb(game, exerciseNames[game.exercise as keyof typeof exerciseNames], today));
  const summaries = input.gameStreak === undefined ? games.map(game => game.bestStreak) : [input.gameStreak];
  const streaks = summaries.filter(streak => streak !== null);
  // Older callers can repeat the same streak per exercise. Prefer its calendar when available.
  const withCalendar = new Set(streaks.filter(streak => streak.calendar).map(streakKey));
  const candidates = streaks.filter(streak => streak.calendar || !withCalendar.has(streakKey(streak)))
    .map(streak => gameStreak(streak, today));
  return [...climbs, ...candidates].filter(card => card !== null);
}

function sessionCandidates(sessions: readonly Session[], today: string): Candidate[] {
  const groups = new Map<SessionType, ActivityCharts["sessions"]["series"]>();
  const month = today.slice(0, 7);
  for (const { type, date, minutes } of sessions) {
    if (!Object.hasOwn(sessionNames, type) || !isDate(date) || !date.startsWith(month) ||
        date > today || !Number.isFinite(minutes) || minutes <= 0) continue;
    const series = groups.get(type) ?? [];
    series.push({ date, minutes });
    groups.set(type, series);
  }
  const candidates: Candidate[] = [];
  for (const [type, series] of groups) {
    if (series.length < 3) continue;
    series.sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
    const totalMinutes = series.reduce((sum, session) => sum + session.minutes, 0);
    if (!Number.isFinite(totalMinutes)) continue;
    const longest = series.reduce((max, session) => Math.max(max, session.minutes), 0);
    const { plural, activity } = sessionNames[type];
    candidates.push({
      date: series[series.length - 1].date, effect: 0, noise: 1,
      card: {
        kind: "sessions", id: `sessions:${type}:${month}`, filter: "Fitness",
        title: { number: `${formatNumber(series.length, 0)} ${plural}`, measure: `in ${formatWinMonth(today)}` },
        subtitle: `${formatDuration(totalMinutes)} of ${activity}, the longest ${longest === 60 ? "a full hour" : formatDuration(longest)}`,
        source_note: `Session log · ${formatWinDate(`${month}-01`, today)} through ${formatWinDate(today, today)}`,
        chart: { type: "sessions", sessionType: type, totalMinutes, series },
      },
    });
  }
  return candidates;
}

export function activityCandidates(input: HealthWinsInput): Candidate[] {
  const { today } = input.member;
  return [
    ...experimentCandidates(input.experiments ?? [], today),
    ...gameCandidates(input, today),
    ...sessionCandidates(input.sessions ?? [], today),
  ];
}
