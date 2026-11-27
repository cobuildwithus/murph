import type { ClientUnits } from "../../companion/client-info";
import { areaFrame } from "../../game/progress/area-art";
import { formatHeight } from "../../game/progress/format";
import { splitUnit, splitUnitMeters } from "./recorded-route";
import { formatHealthWinDistance } from "./shared";
import type { CardSpec, RecordedActivity } from "./types";

type DistanceUnit = keyof typeof splitUnitMeters;
type SplitRow = { label: string; seconds: number; text: string; partial?: true };
type RouteStat = { label: string; value: string; unit?: string };
export interface RouteCharts {
  activity_route: ReturnType<typeof areaFrame> & { type: "route_map"; paths: string[]; chips?: string[]; stats?: RouteStat[] };
  activity_splits: { type: "splits"; unit: DistanceUnit; line: string; splits: SplitRow[]; fastest: number | null };
}

const unitName = { mi: "mile", km: "km" } as const;

function clock(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const secondPart = String(rounded % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}:${secondPart}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${secondPart}`;
}

function distanceLabel(meters: number, unit: DistanceUnit): string {
  return `${formatHealthWinDistance(meters / splitUnitMeters[unit])} ${unit}`;
}

export function routeCards(activity: RecordedActivity, recorded: string, units: ClientUnits, word: string): CardSpec[] {
  const route = activity.route;
  if (!route?.paths) return [];
  const displayUnit = units === "metric" ? "km" : "mi";
  const distance = distanceLabel(route.distanceM, displayUnit);
  const pace = clock(activity.movingSec * splitUnitMeters[displayUnit] / route.distanceM);
  const paceLabel = `${pace} a ${unitName[displayUnit]}`;
  const duration = clock(activity.movingSec);
  const base = {
    title: { number: distance, measure: word }, filter: "Fitness", theme: "fitness", share: { caption_tips: [] },
  } as const;

  const unit = splitUnit(route.splits, displayUnit);
  const splits: SplitRow[] = route.splits.map(({ distanceM, seconds }, index) => {
    const text = clock(seconds);
    if (distanceM !== splitUnitMeters[unit]) return { label: distanceLabel(distanceM, unit), seconds, text, partial: true };
    return { label: `${unit === "mi" ? "Mile" : "Km"} ${index + 1}`, seconds, text };
  });
  const fullSplits = splits.filter(split => !split.partial);
  const fastest = fullSplits.length < 2 ? null : splits.indexOf(
    fullSplits.reduce((best, split) => split.seconds < best.seconds ? split : best),
  );
  const climb = formatHeight(route.climbM / 0.3048, units);
  const line = [duration, paceLabel, `${climb} up`];
  // No map when trimming left no path; the splits still tell the run.
  const map: CardSpec[] = [];
  if (route.paths.length) {
    const paceUnit = `/${displayUnit}`;
    const stats: RouteStat[] = [
      { label: "Distance", value: distance.split(" ")[0], unit: displayUnit },
      { label: "Pace", value: pace, unit: paceUnit },
      { label: "Time", value: duration },
    ];
    const [climbValue, climbUnit] = climb.split(" ");
    if (Number.parseInt(climbValue, 10) > 0) stats.push({ label: "Climb", value: climbValue, unit: climbUnit });
    // No heart rate here: it has its own card, which the member can hide or leave out.
    map.push({
      ...base, id: `activity:${activity.id}:activity_route`, kind: "activity_route",
      subtitle: `in ${duration}, ${paceLabel}`, source_note: recorded,
      chart: { type: "route_map", paths: [...route.paths], ...areaFrame(route.paths), chips: [distance, `${pace} ${paceUnit}`], stats },
    });
  }
  return [...map, {
    ...base, id: `activity:${activity.id}:activity_splits`, kind: "activity_splits",
    subtitle: fastest === null ? `in ${duration}, ${paceLabel}` : `fastest ${unitName[unit]} ${splits[fastest].text}`,
    source_note: `${recorded}. Splits by ${unitName[unit]}.`,
    chart: { type: "splits", unit, line: line.join(" · "), splits, fastest },
  }];
}
