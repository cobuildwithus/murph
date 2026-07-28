import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EXPERIMENT_PROGRESS_CARD_DAY_CODES,
  experimentProgressCardSchema,
  type ExperimentProgressCardData,
  type ExperimentProgressCardMover,
} from "@murphai/contracts";
import {
  addCaptureWithLookup,
  deterministicContractId,
  findCaptureByLookup,
  ID_PREFIXES,
  isVaultError,
} from "@murphai/core";
import type {
  AssistantVaultImageResponseMedia,
} from "@murphai/operator-config/assistant-cli-contracts";
import sharp from "sharp";

import { MURPH_LOGO_SVG } from "./murph-logo-svg.js";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 780;
const CARD_CONTENT_TYPE = "image/png";
const CARD_SOURCE = "murph.experiment-progress-card";
const CARD_LOOKUP_ROLE = "media_1";
const CONTENT_LEFT = 64;
const CONTENT_RIGHT = CARD_WIDTH - CONTENT_LEFT;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const SERIF_FONT = "Fraunces, Georgia, serif";
const SANS_FONT = "DM Sans, Arial, sans-serif";
const LOGO_HEIGHT = 52;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 197) / 44);
const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(
  MURPH_LOGO_SVG,
).toString("base64")}`;

const COLOR = {
  background: "#F4EEE1",
  panel: "#FFFCF6",
  border: "#787056",
  foreground: "#2D3436",
  muted: "#827C6C",
  primary: "#5A6E32",
  positive: "#506B2C",
  negative: "#B0651F",
};

interface RenderedProgressCard {
  bytes: Uint8Array;
  filename: string;
  sha256: string;
}

export async function renderAndSaveExperimentProgressCard(input: {
  card: ExperimentProgressCardData;
  experimentId: string;
  vaultRoot: string;
}): Promise<
  AssistantVaultImageResponseMedia & { contentType: "image/png" }
> {
  const card = experimentProgressCardSchema.parse(input.card);
  const rendered = await renderExperimentProgressCard(card);
  const lookupKey =
    `murph.experiment-progress-card.capture.v1:${input.experimentId}:${card.asOf}:${rendered.sha256}`;
  const saved = await resolveSavedProgressCard({
    lookupKey,
    rendered,
    vaultRoot: input.vaultRoot,
  });

  return {
    alt: `${card.title} experiment progress`,
    contentType: CARD_CONTENT_TYPE,
    filename: path.posix.basename(saved.ref),
    kind: "vault_image",
    ref: saved.ref,
    sha256: rendered.sha256,
    sizeBytes: rendered.bytes.byteLength,
    source: CARD_SOURCE,
  };
}

async function renderExperimentProgressCard(
  card: ExperimentProgressCardData,
): Promise<RenderedProgressCard> {
  const cardIdentity = createHash("sha256")
    .update("murph.experiment-progress-card.render.v2")
    .update("\0")
    .update(JSON.stringify(card))
    .digest("hex");
  const filename = `experiment-progress-${cardIdentity.slice(0, 20)}.png`;
  const bytes = new Uint8Array(
    await sharp(Buffer.from(buildExperimentProgressCardSvg(card)))
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, filename, sha256 };
}

async function resolveSavedProgressCard(input: {
  lookupKey: string;
  rendered: RenderedProgressCard;
  vaultRoot: string;
}): Promise<{ ref: string }> {
  const existing = await findCaptureByLookup({
    lookupKey: input.lookupKey,
    vaultRoot: input.vaultRoot,
  });
  if (existing.status === "deleted") {
    throw new Error("Saved experiment progress card was deleted.");
  }
  if (existing.status === "live") {
    await assertSavedProgressCardMatches({
      bytes: input.rendered.bytes,
      ref: existing.attachmentRef,
      sha256: input.rendered.sha256,
      vaultRoot: input.vaultRoot,
    });
    return { ref: existing.attachmentRef };
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-progress-card-"));
  try {
    const sourcePath = path.join(tempRoot, input.rendered.filename);
    await writeFile(sourcePath, Buffer.from(input.rendered.bytes));
    try {
      const result = await addCaptureWithLookup({
        attachments: [{
          kind: "photo",
          role: CARD_LOOKUP_ROLE,
          sourcePath,
          targetName: input.rendered.filename,
        }],
        draft: {
          note: "Private progress-card image derived from experiment data.",
          occurredAt: new Date().toISOString(),
          source: "derived",
          tags: ["experiment", "progress-card", "private-image"],
          title: "Experiment progress card",
        },
        lookupAttachmentRole: CARD_LOOKUP_ROLE,
        lookupKey: input.lookupKey,
        rawImport: {
          importId: deterministicContractId(
            ID_PREFIXES.event,
            `murph.experiment-progress-card.raw-import.v1:${input.lookupKey}`,
          ),
          importedAt: new Date().toISOString(),
          importKind: "capture",
        },
        vaultRoot: input.vaultRoot,
      });
      const ref = result.event.attachments?.find(
        (attachment) => attachment.role === CARD_LOOKUP_ROLE,
      )?.relativePath ?? null;
      if (!ref) {
        throw new Error("Experiment progress card capture has no image attachment.");
      }
      return { ref };
    } catch (error) {
      if (!isVaultError(error) || error.code !== "CAPTURE_LOOKUP_EXISTS") {
        throw error;
      }
      const winner = await findCaptureByLookup({
        lookupKey: input.lookupKey,
        vaultRoot: input.vaultRoot,
      });
      if (winner.status !== "live") {
        throw new Error("Experiment progress card capture race did not produce a live image.");
      }
      await assertSavedProgressCardMatches({
        bytes: input.rendered.bytes,
        ref: winner.attachmentRef,
        sha256: input.rendered.sha256,
        vaultRoot: input.vaultRoot,
      });
      return { ref: winner.attachmentRef };
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function assertSavedProgressCardMatches(input: {
  bytes: Uint8Array;
  ref: string;
  sha256: string;
  vaultRoot: string;
}): Promise<void> {
  const savedBytes = new Uint8Array(
    await readFile(path.join(input.vaultRoot, input.ref)),
  );
  const savedSha256 = createHash("sha256").update(savedBytes).digest("hex");
  if (
    savedBytes.byteLength !== input.bytes.byteLength ||
    savedSha256 !== input.sha256
  ) {
    throw new Error("Saved experiment progress card bytes do not match the rendered card.");
  }
}

export function buildExperimentProgressCardSvg(
  card: ExperimentProgressCardData,
): string {
  const movers = card.movers.slice(0, 2);
  const status = card.phase.totalDays === null
    ? `Day ${card.phase.day}`
    : `Day ${card.phase.day} of ${card.phase.totalDays}`;
  const sessions = card.sessions.target === null
    ? `${card.sessions.logged} sessions logged`
    : `${card.sessions.logged} of ${card.sessions.target} sessions logged`;
  const assumed = (card.sessions.assumed ?? 0) > 0
    ? ` · ${card.sessions.assumed} assumed`
    : "";
  const accessibleTitle = `${card.title}. ${status}. ${sessions}${assumed}.`;
  const title = layoutCardTitle(card.title);
  const statusText = `${status} · ${sessions}${assumed}`;
  const statusY = title.lines.length === 1 ? 181 : 201;
  const moverTop = title.lines.length === 1 ? 220 : 230;
  const statusScale = fittedTextScale({
    fontSize: 24,
    maxWidth: CONTENT_WIDTH - 2,
    text: statusText,
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeSvg(accessibleTitle)}">`,
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${COLOR.background}"/>`,
    `<circle cx="72" cy="62" r="5" fill="${COLOR.primary}"/>`,
    `<text x="92" y="70" fill="${COLOR.muted}" font-family="${SANS_FONT}" font-size="21" letter-spacing="4.6">YOUR EXPERIMENT</text>`,
    ...title.lines.map((line, index) => {
      const y = title.lines.length === 1 ? 139 : 126 + index * 40;
      const scale = fittedTextScale({
        fontSize: title.fontSize,
        letterSpacing: -1.5,
        maxWidth: CONTENT_WIDTH,
        text: line,
      });
      return `<g data-role="title-line" transform="translate(${CONTENT_LEFT} ${y}) scale(${scale} 1)"><text x="0" y="0" fill="${COLOR.foreground}" font-family="${SERIF_FONT}" font-size="${title.fontSize}" font-weight="600" letter-spacing="-1.5">${escapeSvg(line)}</text></g>`;
    }),
    `<g transform="translate(66 ${statusY}) scale(${statusScale} 1)"><text x="0" y="0" fill="${COLOR.muted}" font-family="${SANS_FONT}" font-size="24">${escapeSvg(statusText)}</text></g>`,
    movers.length === 0
      ? renderEmptyMoverPanel(moverTop)
      : movers.map((mover, index) =>
          renderMoverPanel(mover, index, movers.length, moverTop)
        ).join(""),
    renderTimeline(card),
    renderConfounders(card),
    `<line x1="${CONTENT_LEFT}" y1="700" x2="${CONTENT_RIGHT}" y2="700" stroke="${COLOR.border}" stroke-opacity=".2"/>`,
    `<image id="murph-wordmark" href="${LOGO_DATA_URI}" x="${CONTENT_LEFT}" y="708" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" aria-label="murph"/>`,
    `<text x="${CONTENT_RIGHT}" y="727" text-anchor="end" fill="${COLOR.foreground}" fill-opacity=".42" font-family="${SANS_FONT}" font-size="22">Health experiments with friends.</text>`,
    `<text x="${CONTENT_RIGHT}" y="756" text-anchor="end" fill="${COLOR.primary}" font-family="${SANS_FONT}" font-size="19">withmurph.ai · as of ${escapeSvg(card.asOf)}</text>`,
    "</svg>",
  ].join("");
}

function renderEmptyMoverPanel(top: number): string {
  return [
    `<rect x="${CONTENT_LEFT}" y="${top}" width="${CONTENT_WIDTH}" height="232" rx="24" fill="${COLOR.panel}" fill-opacity=".72" stroke="${COLOR.border}" stroke-opacity=".2"/>`,
    `<text x="${CARD_WIDTH / 2}" y="${top + 123}" text-anchor="middle" fill="${COLOR.muted}" font-family="${SERIF_FONT}" font-size="30">Markers are still settling — keep logging.</text>`,
  ].join("");
}

function renderMoverPanel(
  mover: ExperimentProgressCardMover,
  index: number,
  moverCount: number,
  top: number,
): string {
  const x = index === 0 ? CONTENT_LEFT : 610;
  const width = moverCount === 1 ? CONTENT_WIDTH : 526;
  const sentiment = resolveMoverSentiment(mover.sentiment);
  const arrow = mover.direction === "up"
    ? "↑"
    : mover.direction === "down"
      ? "↓"
      : "—";
  const deltaText = `${arrow} ${mover.changePct} · ${mover.delta}`;
  const label = mover.label.toUpperCase();
  const labelScale = fittedTextScale({
    fontSize: 17,
    letterSpacing: 2.2,
    maxWidth: width - 60,
    text: label,
  });
  const valueFontSize = moverValueFontSize(mover.value, mover.unit);
  const valueWidth = estimatedTextWidth(mover.value, valueFontSize)
    + (mover.unit
      ? 10 + estimatedTextWidth(mover.unit, 23)
      : 0);
  const valueScale = roundSvgNumber(
    Math.min(1, (width - 72) / Math.max(1, valueWidth)),
  );
  const deltaScale = fittedTextScale({
    fontSize: 21,
    maxWidth: width - 96,
    text: deltaText,
  });
  const deltaWidth = estimatedTextWidth(deltaText, 21) * deltaScale;
  const chipWidth = Math.min(
    width - 60,
    Math.max(190, 36 + deltaWidth),
  );

  return [
    `<rect x="${x}" y="${top}" width="${width}" height="232" rx="24" fill="${COLOR.panel}" fill-opacity=".72" stroke="${COLOR.border}" stroke-opacity=".2"/>`,
    `<g transform="translate(${x + 30} ${top + 43}) scale(${labelScale} 1)"><text x="0" y="0" fill="${COLOR.foreground}" fill-opacity=".5" font-family="${SANS_FONT}" font-size="17" letter-spacing="2.2">${escapeSvg(label)}</text></g>`,
    `<g transform="translate(${x + 30} ${top + 124}) scale(${valueScale} 1)"><text x="0" y="0" fill="${COLOR.foreground}" font-family="${SERIF_FONT}" font-size="${valueFontSize}" font-weight="600"><tspan>${escapeSvg(mover.value)}</tspan>${mover.unit ? `<tspan dx="10" fill="${COLOR.muted}" font-family="${SANS_FONT}" font-size="23" font-weight="400">${escapeSvg(mover.unit)}</tspan>` : ""}</text></g>`,
    `<rect x="${x + 30}" y="${top + 155}" width="${chipWidth}" height="44" rx="22" fill="${sentiment.color}" fill-opacity="${sentiment.chipOpacity}"/>`,
    `<g transform="translate(${x + 48} ${top + 184}) scale(${deltaScale} 1)"><text x="0" y="0" fill="${sentiment.color}" font-family="${SANS_FONT}" font-size="21">${escapeSvg(deltaText)}</text></g>`,
  ].join("");
}

function resolveMoverSentiment(
  sentiment: ExperimentProgressCardMover["sentiment"],
): { chipOpacity: string; color: string } {
  if (sentiment === "positive") {
    return { chipOpacity: ".14", color: COLOR.positive };
  }
  if (sentiment === "negative") {
    return { chipOpacity: ".15", color: COLOR.negative };
  }
  return { chipOpacity: ".14", color: COLOR.muted };
}

function moverValueFontSize(value: string, unit: string | null): number {
  const length = value.length + (unit?.length ?? 0);
  if (length > 20) return 38;
  if (length > 14) return 44;
  if (length > 10) return 50;
  return 58;
}

function renderTimeline(card: ExperimentProgressCardData): string {
  const cells = card.weeks.flatMap((week) => [...week.cells]);
  const gap = 4;
  const timelineStartX = 254;
  const timelineWidth = 852;
  const cellWidth = Math.max(
    10,
    Math.min(
      22,
      Math.floor(
        (timelineWidth - Math.max(0, cells.length - 1) * gap)
          / Math.max(1, cells.length),
      ),
    ),
  );
  const confounderDates = new Set(card.confounders.map((entry) => entry.date));
  const dates = card.weeks.flatMap((week) =>
    [...week.cells].map((_, index) => addDays(week.start, index))
  );
  const totalWidth = cells.length * cellWidth + Math.max(0, cells.length - 1) * gap;
  const startX = timelineStartX + timelineWidth - totalWidth;
  const rects = cells.map((code, index) => {
    const style = timelineCellStyle(code);
    const x = startX + index * (cellWidth + gap);
    const isToday = dates[index] === card.asOf;
    const marker = confounderDates.has(dates[index] ?? "")
      ? `<circle cx="${x + cellWidth / 2}" cy="526" r="3" fill="${COLOR.negative}"/>`
      : "";
    return `${marker}<rect x="${x}" y="542" width="${cellWidth}" height="20" rx="5" fill="${style.fill}" stroke="${isToday ? COLOR.foreground : style.stroke}" stroke-width="${isToday ? 2 : 1}"${style.dashed ? ' stroke-dasharray="3 2"' : ""}/>`;
  }).join("");

  return [
    `<rect x="${CONTENT_LEFT}" y="480" width="${CONTENT_WIDTH}" height="112" rx="20" fill="${COLOR.panel}" fill-opacity=".5" stroke="${COLOR.border}" stroke-opacity=".16"/>`,
    `<text x="94" y="550" fill="${COLOR.foreground}" fill-opacity=".5" font-family="${SANS_FONT}" font-size="17" letter-spacing="2.2">SESSIONS</text>`,
    rects,
  ].join("");
}

function renderConfounders(card: ExperimentProgressCardData): string {
  if (card.confounders.length === 0) {
    return "";
  }

  return [
    `<text x="${CONTENT_LEFT}" y="628" fill="${COLOR.foreground}" fill-opacity=".5" font-family="${SANS_FONT}" font-size="16" letter-spacing="2.1">CONFOUNDERS</text>`,
    ...card.confounders.map((entry, index) => {
      const x = index % 2 === 0 ? CONTENT_LEFT : 610;
      const y = index < 2 ? 658 : 685;
      const text = `${entry.date} · ${entry.label}`;
      const fontSize = confounderFontSize(text);
      const scale = fittedTextScale({
        fontSize,
        maxWidth: 510,
        text,
      });
      return [
        `<circle cx="${x + 4}" cy="${y - 6}" r="4" fill="${COLOR.negative}"/>`,
        `<g transform="translate(${x + 16} ${y}) scale(${scale} 1)"><text x="0" y="0" fill="${COLOR.muted}" font-family="${SANS_FONT}" font-size="${fontSize}">${escapeSvg(text)}</text></g>`,
      ].join("");
    }),
  ].join("");
}

function timelineCellStyle(code: string): {
  dashed?: boolean;
  fill: string;
  stroke: string;
} {
  switch (code) {
    case EXPERIMENT_PROGRESS_CARD_DAY_CODES.completed:
      return { fill: "#5A6E32", stroke: "#5A6E32" };
    case EXPERIMENT_PROGRESS_CARD_DAY_CODES.assumed:
      return { dashed: true, fill: "#DDE2CF", stroke: "#758553" };
    case EXPERIMENT_PROGRESS_CARD_DAY_CODES.partial:
      return { fill: "#A8B28A", stroke: "#A8B28A" };
    case EXPERIMENT_PROGRESS_CARD_DAY_CODES.baseline:
      return { fill: "#B6A582", stroke: "#B6A582" };
    case EXPERIMENT_PROGRESS_CARD_DAY_CODES.scheduled:
      return { dashed: true, fill: "transparent", stroke: "#B7AE98" };
    case EXPERIMENT_PROGRESS_CARD_DAY_CODES.outOfWindow:
      return { fill: "transparent", stroke: "transparent" };
    default:
      return { fill: "transparent", stroke: "#B7AE98" };
  }
}

function addDays(date: string, days: number): string {
  const stamp = new Date(`${date}T00:00:00.000Z`);
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}

function layoutCardTitle(title: string): {
  fontSize: number;
  lines: string[];
} {
  const fontSize = titleFontSize(title);
  const oneLineScale = fittedTextScale({
    fontSize,
    letterSpacing: -1.5,
    maxWidth: CONTENT_WIDTH,
    text: title,
  });
  if (oneLineScale >= 0.82) {
    return { fontSize, lines: [title] };
  }
  return {
    fontSize: Math.min(44, Math.max(36, fontSize)),
    lines: splitTitleIntoTwoLines(title),
  };
}

function splitTitleIntoTwoLines(title: string): [string, string] {
  const characters = [...title];
  const targetWeight = estimatedTextUnits(title) / 2;
  let cumulativeWeight = 0;
  let bestAnyIndex = 1;
  let bestAnyDistance = Number.POSITIVE_INFINITY;
  let bestWhitespaceIndex: number | null = null;
  let bestWhitespaceDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < characters.length; index += 1) {
    cumulativeWeight += estimatedCharacterUnits(characters[index - 1] ?? "");
    const distance = Math.abs(cumulativeWeight - targetWeight);
    if (distance < bestAnyDistance) {
      bestAnyDistance = distance;
      bestAnyIndex = index;
    }
    if (
      /\s/u.test(characters[index - 1] ?? "")
      && distance < bestWhitespaceDistance
    ) {
      bestWhitespaceDistance = distance;
      bestWhitespaceIndex = index;
    }
  }

  const splitIndex = bestWhitespaceIndex ?? bestAnyIndex;
  const first = characters.slice(0, splitIndex).join("").trimEnd();
  const second = characters.slice(splitIndex).join("").trimStart();
  if (!first || !second) {
    const fallbackIndex = Math.max(1, Math.floor(characters.length / 2));
    return [
      characters.slice(0, fallbackIndex).join(""),
      characters.slice(fallbackIndex).join(""),
    ];
  }
  return [first, second];
}

function fittedTextScale(input: {
  fontSize: number;
  letterSpacing?: number;
  maxWidth: number;
  text: string;
}): number {
  const width = estimatedTextWidth(
    input.text,
    input.fontSize,
    input.letterSpacing ?? 0,
  );
  const safeMaxWidth = Math.max(1, input.maxWidth - 12);
  return roundSvgNumber(
    Math.min(1, safeMaxWidth / Math.max(1, width)),
  );
}

function estimatedTextWidth(
  text: string,
  fontSize: number,
  letterSpacing = 0,
): number {
  const characters = [...text];
  return estimatedTextUnits(text) * fontSize
    + Math.max(0, characters.length - 1) * letterSpacing;
}

function estimatedTextUnits(text: string): number {
  return [...text].reduce(
    (total, character) => total + estimatedCharacterUnits(character),
    0,
  );
}

function estimatedCharacterUnits(character: string): number {
  if (/\s/u.test(character)) return 0.34;
  if (/[MW@#%&]/u.test(character)) return 1.2;
  if (/[A-Z]/u.test(character)) return 0.78;
  if (/[0-9]/u.test(character)) return 0.63;
  if (/[ilIjtfr1.,:;!'|]/u.test(character)) return 0.36;
  if (/[-_+()\[\]{}\/\\]/u.test(character)) return 0.5;
  if (character.codePointAt(0)! > 0x2ff) return 1.05;
  return 0.58;
}

function roundSvgNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function titleFontSize(title: string): number {
  if (title.length > 54) return 40;
  if (title.length > 38) return 46;
  if (title.length > 30) return 52;
  if (title.length > 22) return 62;
  if (title.length > 15) return 72;
  return 76;
}

function confounderFontSize(text: string): number {
  if (text.length > 54) return 12;
  if (text.length > 42) return 13;
  if (text.length > 30) return 14;
  return 16;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
