import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPERIMENT_PROGRESS_CARD_DAY_CODES,
  experimentProgressCardSchema,
} from "@murphai/contracts";
import { initializeVault } from "@murphai/core";
import sharp from "sharp";
import { test } from "vitest";

import {
  buildExperimentProgressCardSvg,
  renderAndSaveExperimentProgressCard,
} from "../src/commands/experiment-progress-card-image.js";
import { MURPH_LOGO_SVG } from "../src/commands/murph-logo-svg.js";

const CARD = experimentProgressCardSchema.parse({
  v: 2,
  title: "Morning light & recovery <check>",
  asOf: "2026-07-27",
  phase: {
    day: 18,
    totalDays: 28,
  },
  sessions: {
    logged: 15,
    assumed: 2,
    target: 20,
  },
  weeks: [
    {
      start: "2026-07-06",
      cells: [
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.baseline,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.baseline,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.partial,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.missed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.assumed,
      ].join(""),
    },
    {
      start: "2026-07-13",
      cells: [
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.assumed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.partial,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.noEvidence,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
      ].join(""),
    },
    {
      start: "2026-07-20",
      cells: [
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
        EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed,
      ].join(""),
    },
  ],
  movers: [
    {
      label: "Resting heart rate",
      changePct: "8%",
      value: "54",
      unit: "bpm",
      delta: "4 bpm",
      direction: "down",
      sentiment: "positive",
    },
    {
      label: "Deep sleep",
      changePct: "12%",
      value: "1h 24m",
      unit: null,
      delta: "9 min",
      direction: "up",
      sentiment: "positive",
    },
  ],
  confounders: [
    {
      date: "2026-07-18",
      label: "Late flight & short sleep",
    },
    {
      date: "2026-07-24",
      label: "Strength training",
    },
  ],
});

const BOUNDARY_CARD = experimentProgressCardSchema.parse({
  ...CARD,
  title: "W".repeat(80),
  weeks: [
    { start: "2026-06-15", cells: "BBBBBBB" },
    { start: "2026-06-22", cells: "CCCCCCC" },
    { start: "2026-06-29", cells: "AAAAAAA" },
    { start: "2026-07-06", cells: "PPPPPPP" },
    { start: "2026-07-13", cells: "MMMMMMM" },
    { start: "2026-07-20", cells: "NNNNNNN" },
  ],
  movers: [
    {
      label: "W".repeat(40),
      changePct: "W".repeat(8),
      value: "W".repeat(16),
      unit: "W".repeat(12),
      delta: "W".repeat(20),
      direction: "down",
      sentiment: "negative",
    },
    {
      label: "M".repeat(40),
      changePct: "M".repeat(8),
      value: "M".repeat(16),
      unit: "M".repeat(12),
      delta: "M".repeat(20),
      direction: "up",
      sentiment: "positive",
    },
  ],
  confounders: [
    { date: "2026-07-18", label: "W".repeat(60) },
    { date: "2026-07-19", label: "M".repeat(60) },
    { date: "2026-07-20", label: "W".repeat(60) },
    { date: "2026-07-21", label: "M".repeat(60) },
  ],
});

const DIRECTION_UNAVAILABLE_CARD = experimentProgressCardSchema.parse({
  ...CARD,
  moverSentimentContext: "direction_unavailable",
  movers: CARD.movers.map((mover) => ({
    ...mover,
    sentiment: "neutral" as const,
  })),
});

test("progress-card renderer retains the authenticated card brand language", async () => {
  const svg = buildExperimentProgressCardSvg(CARD);

  assert.match(svg, /width="1200" height="780"/u);
  assert.match(svg, /fill="#F4EEE1"/u);
  assert.match(svg, /font-family="Fraunces, Georgia, serif"/u);
  assert.match(svg, /font-family="DM Sans, Arial, sans-serif"/u);
  assert.match(svg, /id="murph-wordmark"[^>]* y="708"[^>]* height="52"/u);
  assert.match(svg, /Health experiments with friends\./u);
  assert.match(svg, />withmurph\.ai<\/text>/u);
  assert.doesNotMatch(svg, /as of 2026-07-27/u);
  assert.match(svg, /RESTING HEART RATE/u);
  assert.match(svg, /DEEP SLEEP/u);
  assert.match(
    svg,
    /data-role="mover-change"[^>]*><text[^>]*>↓ 8%<\/text>/u,
  );
  assert.match(
    svg,
    /data-role="mover-detail"[^>]*><text[^>]*><tspan[^>]*>54 bpm<\/tspan><tspan[^>]*>4 bpm<\/tspan>/u,
  );
  assert.match(svg, /CONFOUNDERS/u);
  assert.match(svg, /Jul 18 · Late flight &amp; short sleep/u);
  assert.match(svg, /Jul 24 · Strength training/u);
  assert.doesNotMatch(svg, /2026-07-18/u);
  assert.doesNotMatch(svg, /2026-07-24/u);
  assert.match(svg, /Late flight &amp; short sleep/u);
  assert.match(svg, /Morning light &amp; recovery &lt;check&gt;/u);
  assert.doesNotMatch(svg, />murph<\/text>/u);

  const webLogo = await readFile(
    fileURLToPath(
      new URL("../../../apps/web/public/logo.svg", import.meta.url),
    ),
    "utf8",
  );
  assert.equal(MURPH_LOGO_SVG, webLogo);

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 780);
  await assertBackgroundRegion(png, {
    height: 8,
    left: 0,
    top: 772,
    width: 1200,
  });

  const boundedSvg = buildExperimentProgressCardSvg(BOUNDARY_CARD);
  assert.equal(
    boundedSvg.match(/data-role="title-line"/gu)?.length,
    2,
  );
  assert.doesNotMatch(boundedSvg, /textLength=/u);
  assert.match(
    boundedSvg,
    /data-role="mover-change"[^>]*scale\([^)]* 1\)"><text[^>]*font-size="64"[^>]*>↓ WWWWWWWW<\/text>/u,
  );
  assert.match(
    boundedSvg,
    /data-role="mover-detail"[^>]*scale\([^)]* 1\)"><text[^>]*font-size="18"><tspan[^>]*>WWWWWWWWWWWWWWWW WWWWWWWWWWWW<\/tspan>/u,
  );

  const boundedPng = await sharp(Buffer.from(boundedSvg)).png().toBuffer();
  await assertBackgroundRegion(boundedPng, {
    height: 112,
    left: 1138,
    top: 91,
    width: 62,
  });
  await assertBackgroundRegion(boundedPng, {
    height: 220,
    left: 596,
    top: 236,
    width: 8,
  });
  await assertBackgroundRegion(boundedPng, {
    height: 220,
    left: 1138,
    top: 236,
    width: 62,
  });
  await assertBackgroundRegion(boundedPng, {
    height: 54,
    left: 596,
    top: 636,
    width: 8,
  });
});

test("progress-card renderer makes unavailable direction context visible and accessible", async () => {
  const svg = buildExperimentProgressCardSvg(DIRECTION_UNAVAILABLE_CARD);

  assert.match(
    svg,
    /aria-label="[^"]*Direction context unavailable · mover sentiment is neutral\."/u,
  );
  assert.match(
    svg,
    /data-role="mover-sentiment-context"[^>]*>Direction context unavailable · mover sentiment is neutral\.<\/text>/u,
  );
  assert.doesNotMatch(svg, /Health experiments with friends\./u);

  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-progress-card-direction-unavailable-"),
  );
  try {
    await initializeVault({ vaultRoot });
    const media = await renderAndSaveExperimentProgressCard({
      card: DIRECTION_UNAVAILABLE_CARD,
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
      vaultRoot,
    });
    assert.equal(
      media.alt,
      "Morning light & recovery <check> experiment progress. Direction context unavailable · mover sentiment is neutral.",
    );
    const healthyMedia = await renderAndSaveExperimentProgressCard({
      card: CARD,
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFN",
      vaultRoot,
    });
    assert.equal(
      healthyMedia.alt,
      "Morning light & recovery <check> experiment progress",
    );
    assert.doesNotMatch(healthyMedia.alt ?? "", /Direction context unavailable/u);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

async function assertBackgroundRegion(
  image: Buffer,
  region: { height: number; left: number; top: number; width: number },
): Promise<void> {
  const pixels = await sharp(image)
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer();
  for (let offset = 0; offset < pixels.byteLength; offset += 3) {
    const pixel = [...pixels.subarray(offset, offset + 3)];
    if (pixel[0] !== 0xf4 || pixel[1] !== 0xee || pixel[2] !== 0xe1) {
      assert.deepEqual(pixel, [0xf4, 0xee, 0xe1]);
    }
  }
}
