import { afterEach, describe, expect, it, vi } from "vitest";

import { areaFrame, isAreaArtKey, routeBounds } from "../src/lib/game/progress/area-art";
import { encodePolyline, type Coordinate } from "../src/lib/game/progress/route-geometry";

describe("public area frames", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the same three-by-two grid frame for different paths in the same patch of ocean", () => {
    const first = encodePolyline([[-134.999, -0.002], [-134.998, -0.004]]);
    const second = encodePolyline([[-134.981, -0.005], [-134.980, -0.006]]);
    const area = areaFrame([first]);
    expect(areaFrame([second])).toEqual(area);
    expect(areaFrame([second, first])).toEqual(area);
    expect(isAreaArtKey(area.art!.key)).toBe(true);
    const nearby = areaFrame([encodePolyline([[-134.91, -0.002], [-134.912, -0.004]])]);
    expect(nearby.frame).not.toEqual(area.frame);
    expect(nearby.art!.key).not.toBe(area.art!.key);
    expect(area.art!.key).toMatch(/^area:v2:[A-Za-z0-9_-]{43}$/u);
    const tiles = 2 ** 15;
    expect(area.frame.west).toBe(4095 / tiles * 360 - 180);
    expect(area.frame.east).toBe(4098 / tiles * 360 - 180);
    expect(area.frame.north).toBeCloseTo(0, 12);
    expect(area.frame.south).toBeCloseTo(Math.atan(Math.sinh(-4 * Math.PI / tiles)) * 180 / Math.PI, 12);
  });

  it("derives the handle from the server key while keeping the geographic frame fixed", () => {
    const paths = [encodePolyline([[-134.999, -0.002], [-134.998, -0.004]])];
    const frameWith = (byte: number) => {
      vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
      vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "v1:" + Buffer.alloc(32, byte).toString("base64"));
      return areaFrame(paths);
    };
    const first = frameWith(41), second = frameWith(42);
    expect(second.frame).toEqual(first.frame);
    expect(isAreaArtKey(second.art!.key)).toBe(true);
    expect(second.art!.key).not.toBe(first.art!.key);
    expect(frameWith(41)).toEqual(first);
  });

  it("zooms out just far enough to enclose all segments", () => {
    const sections: Coordinate[][] = [
      [[-135.002, -0.002], [-135.001, -0.003]],
      [[-134.960, -0.008], [-134.959, -0.009]],
    ];
    const { frame } = areaFrame(sections.map(encodePolyline));
    expect(frame.east - frame.west).toBe(3 * 360 / 2 ** 14);
    for (const [lon, lat] of sections.flat()) {
      expect(lon).toBeGreaterThanOrEqual(frame.west);
      expect(lon).toBeLessThanOrEqual(frame.east);
      expect(lat).toBeGreaterThanOrEqual(frame.south);
      expect(lat).toBeLessThanOrEqual(frame.north);
    }
  });

  it("uses the local longitude interval when an ocean path crosses the date line", () => {
    const points: Coordinate[] = [[179.999, -0.003], [-180, -0.002], [-179.999, -0.001]];
    const { frame, art } = areaFrame([encodePolyline(points)]);
    expect(routeBounds(points)).toEqual({ west: 179.999, south: -0.003, east: 180.001, north: -0.001 });
    expect(frame.west).toBeLessThanOrEqual(179.999);
    expect(frame.east).toBeGreaterThanOrEqual(180.001);
    expect(frame.east - frame.west).toBe(3 * 360 / 2 ** 15);
    expect(areaFrame([encodePolyline([...points].reverse())])).toEqual({ frame, art });
  });

  it("uses the outermost public tile row at the Mercator latitude limit", () => {
    const { frame } = areaFrame([encodePolyline([[-135, 89.9], [-135.001, 89.901]])]);
    expect(frame.east - frame.west).toBe(3 * 360 / 2 ** 15);
    expect(frame.north).toBeCloseTo(85.05113, 5);
    expect(frame.south).toBeLessThan(frame.north);
  });
});
