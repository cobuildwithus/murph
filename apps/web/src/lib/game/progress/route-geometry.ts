/** Mapbox polyline coordinates are [longitude, latitude], in degrees. */
export type Coordinate = [number, number];
export type Bbox = [number, number, number, number];
/** Two 2x images for the 354pt column: 7:4 card (rounded to a pixel) and 320pt drawer. */
export const MAP_SIZES = { card: { width: 708, height: 405 }, drawer: { width: 708, height: 640 } };
const RADIUS_M = 6_371_008.8;
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (angle: number) => angle * 180 / Math.PI;

export function distanceM(a: Coordinate, b: Coordinate): number {
  const h = Math.sin(radians(b[1] - a[1]) / 2) ** 2
    + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 2 * RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function decodePolyline(encoded: string): Coordinate[] {
  let index = 0, latitude = 0, longitude = 0;
  const read = () => {
    let value = 0, shift = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; value |= (byte & 31) << shift; shift += 5; } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  const points: Coordinate[] = [];
  while (index < encoded.length) { latitude += read(); longitude += read(); points.push([longitude / 1e5, latitude / 1e5]); }
  return points;
}

export function encodePolyline(points: readonly Coordinate[]): string {
  let latitude = 0, longitude = 0, encoded = '';
  const write = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 32) { encoded += String.fromCharCode((32 | (value & 31)) + 63); value >>= 5; }
    encoded += String.fromCharCode(value + 63);
  };
  for (const [lon, lat] of points) {
    const nextLat = Math.round(lat * 1e5), nextLon = Math.round(lon * 1e5);
    write(nextLat - latitude); write(nextLon - longitude); latitude = nextLat; longitude = nextLon;
  }
  return encoded;
}

/** How far along a route its map draws, to a thousandth: the map route draws there and the link's version hashes it, so one link is one picture. */
export const mapProgress = (progress: number) => Math.round(progress * 1000) / 1000;

/** Split by distance along the geometry, not by vertex count. */
export function cutPolyline(points: readonly Coordinate[], fraction: number): { walked: Coordinate[]; remaining: Coordinate[] } {
  if (fraction <= 0) return { walked: [points[0]!], remaining: [...points] };
  if (fraction >= 1) return { walked: [...points], remaining: [points.at(-1)!] };
  const lengths = points.slice(1).map((point, i) => distanceM(points[i]!, point));
  const target = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  let traveled = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (traveled + length >= target) {
      const part = length === 0 ? 0 : (target - traveled) / length;
      const a = points[i]!, b = points[i + 1]!;
      const cut: Coordinate = [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part];
      return { walked: [...points.slice(0, i + 1), cut], remaining: [cut, ...points.slice(i + 1)] };
    }
    traveled += length;
  }
  return { walked: [...points], remaining: [points.at(-1)!] };
}

export function greatCircle(a: Coordinate, b: Coordinate): Coordinate[] {
  const angle = distanceM(a, b) / RADIUS_M;
  if (angle === 0) return [a, b];
  return Array.from({ length: 65 }, (_, i): Coordinate => {
    const f = i / 64, left = Math.sin((1 - f) * angle) / Math.sin(angle), right = Math.sin(f * angle) / Math.sin(angle);
    const x = left * Math.cos(radians(a[1])) * Math.cos(radians(a[0])) + right * Math.cos(radians(b[1])) * Math.cos(radians(b[0]));
    const y = left * Math.cos(radians(a[1])) * Math.sin(radians(a[0])) + right * Math.cos(radians(b[1])) * Math.sin(radians(b[0]));
    const z = left * Math.sin(radians(a[1])) + right * Math.sin(radians(b[1]));
    return [degrees(Math.atan2(y, x)), degrees(Math.atan2(z, Math.hypot(x, y)))];
  });
}

const mercatorY = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + radians(Math.max(-85.051129, Math.min(85.051129, latitude))) / 2));
const latitudeAt = (y: number) => degrees(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

/** Fit in Mercator at the requested aspect, so Mapbox cannot add implicit padding. */
export function routeBbox(points: readonly Coordinate[], width: number, height: number): Bbox {
  const xs = points.map(point => radians(point[0])), ys = points.map(point => mercatorY(point[1]));
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 0.001) * 1.16;
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 0.001) * 1.16;
  const halfX = Math.max(spanX, spanY * width / height) / 2;
  const halfY = halfX * height / width;
  return [degrees(centerX - halfX), latitudeAt(centerY - halfY), degrees(centerX + halfX), latitudeAt(centerY + halfY)];
}

export function townPosition(point: Coordinate, bbox: Bbox): { x: number; y: number } {
  return { x: (point[0] - bbox[0]) / (bbox[2] - bbox[0]),
    y: (mercatorY(bbox[3]) - mercatorY(point[1])) / (mercatorY(bbox[3]) - mercatorY(bbox[1])) };
}

/** The same frame grown evenly in height to a canvas of width / height = aspect (never narrower than the frame). */
export function expandBbox(bbox: Bbox, aspect: number): Bbox {
  const top = mercatorY(bbox[3]), bottom = mercatorY(bbox[1]);
  const center = (top + bottom) / 2, half = Math.max(radians(bbox[2] - bbox[0]) / aspect, top - bottom) / 2;
  return [bbox[0], latitudeAt(center - half), bbox[2], latitudeAt(center + half)];
}
