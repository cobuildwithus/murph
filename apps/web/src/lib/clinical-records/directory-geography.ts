import points from "./zcta-centroids.2026.json";

export type DirectoryPoint = readonly [latitude: number, longitude: number];
export type LocationCell = { lat: number; lon: number };
export type DirectoryFacilityTuple = [
  name: string | null, city: string | null, state: string | null, postalCode: string | null,
  street: string[], aliases: string[], upstreamId: string, coordinate: DirectoryPoint | null,
];

const centroids: Readonly<Record<string, readonly number[]>> = points;

export function postalCentroid(postalCode: string | null): DirectoryPoint | null {
  const zip = postalCode?.match(/^(\d{5})(?:-\d{4})?$/u)?.[1];
  const point = zip && centroids[zip];
  return point ? [point[0]!, point[1]!] : null;
}

export function milesBetween([lat, lon]: DirectoryPoint, [otherLat, otherLon]: DirectoryPoint): number {
  const radians = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * radians / 2) ** 2
    + Math.cos(lat * radians) * Math.cos(otherLat * radians) * Math.sin((otherLon - lon) * radians / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
