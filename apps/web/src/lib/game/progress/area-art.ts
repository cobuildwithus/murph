import { decodePolyline, latitudeAt, mercatorY, type Coordinate } from "./route-geometry";

const MAX_AREA_ZOOM = 15;

/** East can extend beyond 180 degrees to keep a date-line crossing continuous. */
export function routeBounds(points: readonly Coordinate[]) {
  if (points.length === 0) throw new RangeError("A route needs at least one point.");
  const longitudes = points.map(([lon]) => lon === 180 ? -180 : lon).sort((a, b) => a - b);
  let west = longitudes[0]!;
  let east = longitudes[longitudes.length - 1]!;
  // The shortest enclosing interval is the complement of the largest empty gap.
  let largestGap = west + 360 - east;
  for (let i = 1; i < longitudes.length; i++) {
    const previous = longitudes[i - 1]!;
    const next = longitudes[i]!;
    if (next - previous > largestGap) {
      largestGap = next - previous;
      west = next;
      east = previous + 360;
    }
  }
  const latitudes = points.map(([, lat]) => lat);
  return { west, south: Math.min(...latitudes), east, north: Math.max(...latitudes) };
}

function worldY(latitude: number) {
  return Math.max(0, Math.min(1, (1 - mercatorY(latitude) / Math.PI) / 2));
}

/** Prefer the same tile block throughout an area. Slide it only to include a crossed boundary. */
function tileOrigin(min: number, max: number, width: number) {
  return Math.max(Math.floor(min / width) * width, Math.ceil(max) - width);
}

function tileFrame(tiles: number, x: number, y: number) {
  return {
    west: x / tiles * 360 - 180,
    south: latitudeAt((1 - 2 * (y + 2) / tiles) * Math.PI),
    east: (x + 3) / tiles * 360 - 180,
    north: latitudeAt((1 - 2 * y / tiles) * Math.PI),
  };
}

/** Rebuild a public frame from its canonical northwest tile. Only longitude wraps. */
export function areaFrameFromKey(key: string) {
  const match = /^area:v1:([1-9]\d?)\/(0|[1-9]\d{0,4})\/(0|[1-9]\d{0,4})$/u.exec(key);
  if (!match) return null;
  const z = Number(match[1]), x = Number(match[2]), y = Number(match[3]);
  const tiles = 2 ** z;
  if (z > MAX_AREA_ZOOM || x >= tiles || y + 2 > tiles) return null;
  return tileFrame(tiles, x, y);
}

/** Fit the validated paths to three columns and two rows, with a minimum area at zoom 15. */
export function areaFrame(paths: readonly string[]) {
  const bounds = routeBounds(paths.flatMap(decodePolyline));
  const left = (bounds.west + 180) / 360;
  const right = (bounds.east + 180) / 360;
  const top = worldY(bounds.north);
  const bottom = worldY(bounds.south);
  for (let z = MAX_AREA_ZOOM; z >= 1; z--) {
    const tiles = 2 ** z;
    const x = tileOrigin(left * tiles, right * tiles, 3);
    const y = Math.min(tiles - 2, tileOrigin(top * tiles, bottom * tiles, 2));
    if (x > left * tiles || y > top * tiles) continue;
    return {
      frame: tileFrame(tiles, x, y),
      art: { key: `area:v1:${z}/${x}/${y}` },
    };
  }
  throw new RangeError("A route must fit within the map grid.");
}
