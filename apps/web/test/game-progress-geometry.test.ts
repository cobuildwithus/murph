import { describe, expect, it } from 'vitest';
import { cutPolyline, decodePolyline, distanceM, encodePolyline, greatCircle, routeBbox, townPosition, type Coordinate } from '../src/lib/game/progress/route-geometry';

describe('Progress route geometry', () => {
  const points: Coordinate[] = [[0, 0], [1, 0], [4, 0]];
  it.each([0, 0.25, 0.5, 1])('cuts fraction %s by distance with a shared endpoint', fraction => {
    const result = cutPolyline(points, fraction);
    expect(result.walked.at(-1)).toEqual(result.remaining[0]);
    expect(result.walked.at(-1)![0]).toBeCloseTo(4 * fraction);
    expect(result.walked[0]).toEqual(points[0]);
    expect(result.remaining.at(-1)).toEqual(points.at(-1));
  });
  it('uses the Mapbox precision-five polyline contract', () => {
    const published = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    expect(decodePolyline(published)).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
    expect(encodePolyline(decodePolyline(published))).toBe(published);
  });
  it.each([[0, 0, 0], [0, 1, 111195], [51.5074, 40.7128, 5570229]])('measures a great circle (%s, %s)', (latA, latB, expected) => {
    const a: Coordinate = latA === 51.5074 ? [-0.1278, latA] : [0, latA];
    const b: Coordinate = latA === 51.5074 ? [-74.006, latB] : [0, latB];
    expect(distanceM(a, b)).toBeCloseTo(expected, -2);
    const path = greatCircle(a, b);
    expect(path[0]![0]).toBeCloseTo(a[0]); expect(path.at(-1)![1]).toBeCloseTo(b[1]);
  });
  it.each([[708, 354], [354, 320]])('places labels using the same Mercator viewport (%s × %s)', (w, h) => {
    const bbox = routeBbox([[-122.42, 37.77], [-117.16, 32.72]], w, h);
    expect(townPosition([bbox[0], bbox[3]], bbox)).toEqual({ x: 0, y: 0 });
    expect(townPosition([bbox[2], bbox[1]], bbox)).toEqual({ x: 1, y: 1 });
    const middle = townPosition([(bbox[0] + bbox[2]) / 2, 35.245], bbox);
    expect(middle.x).toBeCloseTo(0.5); expect(middle.y).toBeGreaterThan(0.5);
  });
});
