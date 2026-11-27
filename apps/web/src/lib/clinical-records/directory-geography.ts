export type DirectoryPoint = readonly [latitude: number, longitude: number];
export type LocationCell = { lat: number; lon: number };
export type PostalCentroidLookup = (postalCode: string | null) => DirectoryPoint | null;
export type DirectoryFacilityTuple = [
  name: string | null, city: string | null, state: string | null, postalCode: string | null,
  street: string[], aliases: string[], coordinate: DirectoryPoint | null,
];

export function milesBetween([lat, lon]: DirectoryPoint, [otherLat, otherLon]: DirectoryPoint): number {
  const radians = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * radians / 2) ** 2
    + Math.cos(lat * radians) * Math.cos(otherLat * radians) * Math.sin((otherLon - lon) * radians / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
