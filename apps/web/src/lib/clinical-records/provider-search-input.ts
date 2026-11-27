import { RequestInputError } from "@murphai/hosted-execution/request-input";
import type { LocationCell } from "./directory-geography";

export function readLocationCell(value: unknown): LocationCell | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || !("lat" in value) || !("lon" in value)
    || Object.keys(value).length !== 2) throw new RequestInputError("Invalid provider search.");
  const { lat, lon } = value;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isInteger(lat * 10)
    || !Number.isInteger(lon * 10) || lat < 17 || lat > 72 || Math.abs(lon) > 180
    || (lon > -64 && lon < 172)) throw new RequestInputError("Invalid provider search.");
  return { lat, lon };
}
