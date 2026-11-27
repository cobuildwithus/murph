import type { DirectoryPoint } from "./directory-geography";
import points from "./zcta-centroids.2026.json";

// Import this lookup only where ZIPs are resolved, so other directory readers skip its parse.
const centroids: Readonly<Record<string, readonly number[]>> = points;

export function postalCentroid(postalCode: string | null): DirectoryPoint | null {
  const zip = postalCode?.match(/^(\d{5})(?:-\d{4})?$/u)?.[1];
  const point = zip && centroids[zip];
  return point ? [point[0]!, point[1]!] : null;
}
