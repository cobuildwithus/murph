import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPERIMENT_PROGRESS_CARD_DAY_CODES,
  experimentProgressCardSchema,
} from "@murphai/contracts";
import {
  deleteEvent,
  findCaptureByLookup,
  initializeVault,
} from "@murphai/core";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import sharp from "sharp";
import { afterEach, test, vi } from "vitest";

const progressCardFsMock = vi.hoisted(() => ({
  failTempRemoval: false,
  failTempWrite: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (
        progressCardFsMock.failTempRemoval &&
        /(?:^|[\\/])murph-progress-card-[^\\/]+$/u.test(String(args[0]))
      ) {
        throw Object.assign(new Error("private temp removal failure"), {
          code: "EACCES",
        });
      }
      return await actual.rm(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (
        progressCardFsMock.failTempWrite &&
        String(args[0]).includes("murph-progress-card-")
      ) {
        throw Object.assign(new Error("private temp write failure"), {
          code: "EACCES",
        });
      }
      return await actual.writeFile(...args);
    },
  };
});

import {
  buildExperimentProgressCardSvg,
  renderAndSaveExperimentProgressCard,
} from "../src/commands/experiment-progress-card-image.js";
import { MURPH_LOGO_SVG } from "../src/commands/murph-logo-svg.js";

afterEach(() => {
  progressCardFsMock.failTempRemoval = false;
  progressCardFsMock.failTempWrite = false;
});

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

test("progress-card validation exposes only its public field and does not write", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-progress-card-validation-"),
  );
  const privateMarker = "private-progress-card-title";
  try {
    let captured: unknown;
    try {
      await renderAndSaveExperimentProgressCard({
        card: {
          ...CARD,
          phase: {
            ...CARD.phase,
            day: 0,
          },
          title: privateMarker,
        },
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFR",
        vaultRoot,
      });
    } catch (error) {
      captured = error;
    }

    assert.ok(captured instanceof VaultCliError);
    assert.equal(captured.code, "progress_card_validation_failed");
    assert.deepEqual(captured.context, {
      issues: [{
        code: "too_small",
        publicPath: ["phase"],
      }],
      retryable: false,
      stage: "validation",
    });
    const encoded = JSON.stringify(captured.context);
    assert.equal(encoded.includes(privateMarker), false);
    assert.equal(encoded.includes(vaultRoot), false);
    assert.deepEqual(await readdir(vaultRoot), []);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("progress-card capture deletion reports a terminal conflict without exposing paths", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-progress-card-conflict-"),
  );
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFQ";
  try {
    await initializeVault({ vaultRoot });
    const input = { card: CARD, experimentId, vaultRoot };
    const media = await renderAndSaveExperimentProgressCard(input);
    const lookup = await findCaptureByLookup({
      lookupKey:
        `murph.experiment-progress-card.capture.v1:${experimentId}:${CARD.asOf}:${media.sha256}`,
      vaultRoot,
    });
    assert.equal(lookup.status, "live");
    if (lookup.status !== "live") {
      assert.fail("expected the saved progress card to have a live capture lookup");
    }
    await deleteEvent({ eventId: lookup.eventId, vaultRoot });

    let captured: unknown;
    try {
      await renderAndSaveExperimentProgressCard(input);
    } catch (error) {
      captured = error;
    }

    assert.ok(captured instanceof VaultCliError);
    assert.equal(captured.code, "progress_card_capture_conflict");
    assert.equal(captured.context?.stage, "conflict");
    assert.equal(captured.context?.retryable, false);
    assert.equal(captured.context?.hint, undefined);
    const encoded = JSON.stringify({
      code: captured.code,
      context: captured.context,
      message: captured.message,
    });
    assert.equal(encoded.includes("final review"), false);
    for (const forbidden of [experimentId, media.ref, vaultRoot]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("progress-card persistence reports a stable integrity stage without exposing paths", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-progress-card-integrity-"),
  );
  const privateMarker = "private-corrupt-progress-card-marker";
  try {
    await initializeVault({ vaultRoot });
    const input = {
      card: CARD,
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFP",
      vaultRoot,
    };
    const media = await renderAndSaveExperimentProgressCard(input);
    await writeFile(path.join(vaultRoot, media.ref), privateMarker);

    let captured: unknown;
    try {
      await renderAndSaveExperimentProgressCard(input);
    } catch (error) {
      captured = error;
    }

    assert.ok(captured instanceof VaultCliError);
    assert.equal(captured.code, "progress_card_integrity_failed");
    assert.equal(captured.context?.stage, "integrity");
    assert.equal(captured.context?.retryable, false);
    assert.equal(captured.context?.hint, undefined);
    const encoded = JSON.stringify({
      code: captured.code,
      context: captured.context,
      message: captured.message,
    });
    assert.equal(encoded.includes("final review"), false);
    for (const forbidden of [privateMarker, media.ref, vaultRoot]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("progress-card cleanup failure explains deterministic recovery after persistence", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-progress-card-cleanup-recovery-"),
  );
  const input = {
    card: CARD,
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFS",
    vaultRoot,
  };
  try {
    await initializeVault({ vaultRoot });
    progressCardFsMock.failTempRemoval = true;

    let captured: unknown;
    try {
      await renderAndSaveExperimentProgressCard(input);
    } catch (error) {
      captured = error;
    }

    assert.ok(captured instanceof VaultCliError);
    assert.equal(captured.code, "progress_card_cleanup_failed");
    assert.equal(captured.context?.stage, "filesystem");
    assert.equal(captured.context?.retryable, true);
    assert.match(captured.message, /was saved/u);
    assert.match(captured.message, /same command again/u);
    assert.doesNotMatch(captured.message, /private temp removal failure/u);
    assert.equal(captured.message.includes(vaultRoot), false);

    progressCardFsMock.failTempRemoval = false;
    const recovered = await renderAndSaveExperimentProgressCard(input);
    const lookup = await findCaptureByLookup({
      lookupKey:
        `murph.experiment-progress-card.capture.v1:${input.experimentId}:${CARD.asOf}:${recovered.sha256}`,
      vaultRoot,
    });
    assert.equal(lookup.status, "live");
    if (lookup.status !== "live") {
      assert.fail("expected the saved progress card to remain recoverable");
    }
    assert.equal(recovered.ref, lookup.attachmentRef);
  } finally {
    progressCardFsMock.failTempRemoval = false;
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("progress-card cleanup failure does not replace a pre-persistence failure", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-progress-card-primary-failure-"),
  );
  try {
    await initializeVault({ vaultRoot });
    progressCardFsMock.failTempWrite = true;
    progressCardFsMock.failTempRemoval = true;

    let captured: unknown;
    try {
      await renderAndSaveExperimentProgressCard({
        card: CARD,
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFT",
        vaultRoot,
      });
    } catch (error) {
      captured = error;
    }

    assert.ok(captured instanceof VaultCliError);
    assert.equal(captured.code, "permission_denied");
    assert.notEqual(captured.code, "progress_card_cleanup_failed");
    assert.equal(captured.context?.stage, "filesystem");
    assert.equal(captured.context?.retryable, false);
    const encoded = JSON.stringify({
      context: captured.context,
      message: captured.message,
    });
    assert.doesNotMatch(encoded, /private temp write failure|private temp removal failure/u);
    assert.equal(encoded.includes(vaultRoot), false);
  } finally {
    progressCardFsMock.failTempRemoval = false;
    progressCardFsMock.failTempWrite = false;
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
