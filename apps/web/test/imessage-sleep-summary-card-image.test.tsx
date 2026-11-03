import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sleepSummaryResponseCardV1Schema } from "@murphai/contracts";
import { SleepSummaryCardImage, getSleepSummaryCardImageSize } from "../src/components/imessage/sleep-summary-card-image";

const mocks = vi.hoisted(() => ({ reads: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => { mocks.reads(); return actual.readFile(...args); } };
});
const complete = sleepSummaryResponseCardV1Schema.parse({
  kind: "sleep_summary", version: 1, localDate: "2026-11-03", bedtime: "00:18", wakeTime: "08:02", totalSleepMinutes: 436,
  score: 85, stages: { deepMinutes: 141, remMinutes: 118, lightMinutes: 177 }, awakeMinutes: 28, efficiencyPercent: 94,
  hrv: { milliseconds: 66, method: "rmssd" }, restingHeartRate: 45, wakeUps: 3,
});
const totalOnly = { ...complete, bedtime: null, wakeTime: null, score: null, stages: null, awakeMinutes: null, efficiencyPercent: null, hrv: null, restingHeartRate: null, wakeUps: null };
const variants = [
  { name: "complete", card: complete },
  { name: "apple-watch", card: { ...complete, score: null, hrv: { milliseconds: 66, method: "sdnn" as const }, wakeUps: null } },
  { name: "total-only", card: totalOnly },
  { name: "tiny-stages", card: { ...complete, stages: { deepMinutes: 1, remMinutes: 1, lightMinutes: 434 }, awakeMinutes: 1 } },
];
const encode = (value: unknown) => `${Buffer.from(JSON.stringify(value)).toString("base64url")}.png`;
beforeEach(() => mocks.reads.mockClear());

describe("sleep card image route", () => {
  it.each(variants)("renders a real 1200-wide PNG with shared fonts for $name", async ({ name, card }) => {
    const { GET } = await import("../app/imessage/card/v1/[payload]/route");
    const payload = encode({ schemaVersion: 8, card });
    const response = await GET(new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`), { params: Promise.resolve({ payload }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(getSleepSummaryCardImageSize(card).height);
    const artifactDir = process.env.MURPH_SLEEP_CARD_RENDER_DIR;
    if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await writeFile(path.join(artifactDir, `${name}.png`), png); }
  });
  it.each([
    { schemaVersion: 7, card: complete }, { schemaVersion: 8, card: { ...complete, provider: "synthetic" } },
    { schemaVersion: 8, card: { ...complete, wakeTime: null } }, { schemaVersion: 8, card: { ...complete, totalSleepMinutes: 0 } },
    { schemaVersion: 8, card: complete, extra: true }, { schemaVersion: 8, card: { ...complete, hrv: { milliseconds: 66, method: "sdnn", extra: true } } },
  ])("rejects malformed envelope before reading fonts", async (value) => {
    const { GET } = await import("../app/imessage/card/v1/[payload]/route");
    const payload = encode(value);
    const response = await GET(new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`), { params: Promise.resolve({ payload }) });
    expect(response.status).toBe(404);
    expect(mocks.reads).not.toHaveBeenCalled();
  });
  it("rejects query-bearing and malformed paths before fonts", async () => {
    const { GET } = await import("../app/imessage/card/v1/[payload]/route");
    for (const [payload, query] of [[encode({ schemaVersion: 8, card: complete }), "?preview=1"], ["invalid.png", ""], ["a".repeat(2048) + ".png", ""]]) {
      expect((await GET(new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}${query}`), { params: Promise.resolve({ payload: payload! }) })).status).toBe(404);
    }
    expect(mocks.reads).not.toHaveBeenCalled();
  });
  it("omits missing rows and keeps the native badge footprint empty", () => {
    const full = renderToStaticMarkup(<SleepSummaryCardImage card={complete} />);
    expect(full).toContain("Sleep score 85");
    expect(full).toContain("12:18 AM");
    expect(full).toContain("Heart rate variability");
    expect(full).not.toMatch(/<img|—/u);
    const sparse = renderToStaticMarkup(<SleepSummaryCardImage card={totalOnly} />);
    expect(sparse).toContain("ASLEEP");
    // The heading already shows the total, so the asleep block names itself only.
    expect(sparse).not.toContain(">7h 16m<");
    const noRem = renderToStaticMarkup(<SleepSummaryCardImage card={{ ...complete, stages: { deepMinutes: 141, remMinutes: 0, lightMinutes: 295 } }} />);
    expect(noRem).not.toContain('data-sleep-segment="REM"');
    expect(sparse).not.toMatch(/Sleep score|sleep-metrics|AM|PM|DEEP|AWAKE/u);
    expect(getSleepSummaryCardImageSize(totalOnly).height).toBeLessThan(getSleepSummaryCardImageSize(complete).height);
  });
});
