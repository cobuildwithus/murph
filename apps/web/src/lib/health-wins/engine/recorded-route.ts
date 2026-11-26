import { invalidGameRequest } from "../../game/http/errors";
import { routeBounds } from "../../game/progress/area-art";
import { decodePolyline, distanceM, encodePolyline, type Coordinate } from "../../game/progress/route-geometry";
import type { RecordedActivity, RecordedActivityKind, RecordedRouteSummary } from "./types";

export const splitUnitMeters = { km: 1000, mi: 1609.344 } as const;
type SplitUnit = keyof typeof splitUnitMeters;

export function splitUnit(splits: RecordedRouteSummary["splits"], preferred: SplitUnit): SplitUnit {
  const first = splits[0].distanceM;
  if (first === splitUnitMeters.km) return "km";
  // A lone partial below a kilometre fits either unit. Use the presentation preference.
  return first > splitUnitMeters.km ? "mi" : preferred;
}

function validateSplits(route: RecordedRouteSummary, movingSec: number) {
  const { splits } = route;
  const invalid = () => invalidGameRequest("Check the recorded splits.");
  if (splits.length === 0 || splits.length > 100) throw invalid();
  const full = splitUnitMeters[splitUnit(splits, "km")];
  let totalDistance = 0, totalSeconds = 0;
  for (const [index, split] of splits.entries()) {
    const last = index === splits.length - 1;
    if (!Number.isFinite(split.distanceM) || split.distanceM <= 0 || split.distanceM > full
      || (!last && split.distanceM !== full) || !Number.isInteger(split.seconds) || split.seconds <= 0) throw invalid();
    totalDistance += split.distanceM;
    totalSeconds += split.seconds;
  }
  // Repeated decimal mile lengths can land a few ulps outside the inclusive 1% boundary.
  const toleranceM = route.distanceM * (0.01 + Number.EPSILON * splits.length);
  if (Math.abs(totalDistance - route.distanceM) > toleranceM || totalSeconds > movingSec + 1) throw invalid();
}

function validatePaths(paths: string[], movingDistance: number) {
  const invalid = () => invalidGameRequest("Check the recorded paths.");
  const maxPoints = 1000;
  if (paths.length > 8) throw invalid();
  // Privacy trimming can leave nothing to draw: the run still has its distance and splits.
  if (paths.length === 0) return;
  const points: Coordinate[] = [];
  for (const path of paths) {
    // At precision five each legal coordinate delta occupies at most six characters.
    if (path.length > (maxPoints - points.length) * 12) throw invalid();
    const segment = decodePolyline(path);
    if (segment.length === 0 || points.length + segment.length > maxPoints
      || encodePolyline(segment) !== path) throw invalid();
    let length = 0;
    for (const [index, point] of segment.entries()) {
      const [lon, lat] = point;
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90
        || point.some(degrees => Math.round(degrees * 1e5) % 10 !== 0)) throw invalid();
      if (index > 0) length += distanceM(segment[index - 1], point);
      points.push(point);
    }
    // Allow the displacement of two rounded endpoints on the grid, or 1% on a long route.
    if (length > movingDistance + Math.max(16, movingDistance / 100)) throw invalid();
  }
  const { west, south, east, north } = routeBounds(points);
  if (distanceM([west, south], [east, north]) > movingDistance) throw invalid();
}

export function validateRecordedRoute(route: NonNullable<RecordedActivity["route"]>, kind: RecordedActivityKind, movingSec: number) {
  if ((kind !== "run" && kind !== "walk") || !Number.isFinite(route.distanceM) || route.distanceM <= 0
    || route.distanceM > 100_000 || !Number.isFinite(route.climbM) || route.climbM < 0 || route.climbM > 3000) {
    throw invalidGameRequest("Check the recorded route summary.");
  }
  const secondsPerKm = movingSec * 1000 / route.distanceM;
  const [min, max] = kind === "run" ? [150, 1200] : [300, 2400];
  if (secondsPerKm < min || secondsPerKm > max) throw invalidGameRequest("Check the recorded pace.");
  validateSplits(route, movingSec);
  if (route.paths !== undefined) validatePaths(route.paths, route.distanceM);
}
