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

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const CARD_CONTENT_TYPE = "image/png";
const CARD_SOURCE = "murph.experiment-progress-card";
const CARD_LOOKUP_ROLE = "media_1";

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
    .update("murph.experiment-progress-card.render.v1")
    .update("\0")
    .update(JSON.stringify(card))
    .digest("hex");
  const filename = `experiment-progress-${cardIdentity.slice(0, 20)}.png`;
  const bytes = new Uint8Array(
    await sharp(Buffer.from(buildProgressCardSvg(card)))
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

function buildProgressCardSvg(card: ExperimentProgressCardData): string {
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

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    '<rect width="1200" height="630" fill="#F4EEE1"/>',
    '<circle cx="72" cy="64" r="6" fill="#5A6E32"/>',
    '<text x="92" y="71" fill="#7B756A" font-family="Arial, sans-serif" font-size="20" letter-spacing="4">YOUR EXPERIMENT</text>',
    `<text x="64" y="132" fill="#2C322F" font-family="Georgia, serif" font-size="${titleFontSize(card.title)}" font-weight="700">${escapeSvg(card.title)}</text>`,
    `<text x="66" y="170" fill="#7B756A" font-family="Arial, sans-serif" font-size="22">${escapeSvg(`${status} · ${sessions}${assumed}`)}</text>`,
    movers.length === 0
      ? '<rect x="64" y="210" width="1072" height="250" rx="20" fill="#FFFCF6" fill-opacity=".7" stroke="#B7AE98" stroke-opacity=".35"/>' +
        '<text x="600" y="345" text-anchor="middle" fill="#7B756A" font-family="Georgia, serif" font-size="30">Markers are still settling — keep logging.</text>'
      : movers.map((mover, index) =>
          renderMoverPanel(mover, index, movers.length)
        ).join(""),
    renderTimeline(card),
    renderConfounders(card),
    '<text x="64" y="610" fill="#5A6E32" font-family="Georgia, serif" font-size="24" font-weight="700">murph</text>',
    `<text x="1136" y="610" text-anchor="end" fill="#7B756A" font-family="Arial, sans-serif" font-size="18">${escapeSvg(card.asOf)}</text>`,
    "</svg>",
  ].join("");
}

function renderMoverPanel(
  mover: ExperimentProgressCardMover,
  index: number,
  moverCount: number,
): string {
  const x = index === 0 ? 64 : 610;
  const width = moverCount === 1 ? 1072 : 526;
  const color = mover.sentiment === "positive"
    ? "#4F6B2C"
    : mover.sentiment === "negative"
      ? "#A6692F"
      : "#7B756A";
  const arrow = mover.direction === "up" ? "↑" : mover.direction === "down" ? "↓" : "—";
  const value = mover.unit ? `${mover.value} ${mover.unit}` : mover.value;
  return [
    `<rect x="${x}" y="210" width="${width}" height="250" rx="20" fill="#FFFCF6" fill-opacity=".7" stroke="#B7AE98" stroke-opacity=".35"/>`,
    `<text x="${x + 34}" y="252" fill="#7B756A" font-family="Arial, sans-serif" font-size="17" letter-spacing="2">${escapeSvg(mover.label.toUpperCase())}</text>`,
    `<text x="${x + 34}" y="354" fill="${color}" font-family="Georgia, serif" font-size="78" font-weight="700">${arrow} ${escapeSvg(mover.changePct)}</text>`,
    `<text x="${x + 36}" y="420" fill="#2C322F" font-family="Arial, sans-serif" font-size="28">${escapeSvg(value)}</text>`,
    `<text x="${x + width - 34}" y="420" text-anchor="end" fill="${color}" font-family="Arial, sans-serif" font-size="24">${escapeSvg(mover.delta)}</text>`,
  ].join("");
}

function renderTimeline(card: ExperimentProgressCardData): string {
  const cells = card.weeks.flatMap((week) => [...week.cells]);
  const gap = 4;
  const timelineStartX = 206;
  const timelineWidth = 930;
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
      ? `<circle cx="${x + cellWidth / 2}" cy="493" r="3" fill="#A6692F"/>`
      : "";
    return `${marker}<rect x="${x}" y="508" width="${cellWidth}" height="18" rx="4" fill="${style.fill}" stroke="${isToday ? "#2C322F" : style.stroke}" stroke-width="${isToday ? 2 : 1}"${style.dashed ? ' stroke-dasharray="3 2"' : ""}/>`;
  }).join("");
  return [
    '<text x="64" y="523" fill="#7B756A" font-family="Arial, sans-serif" font-size="16" letter-spacing="2">SESSIONS</text>',
    rects,
  ].join("");
}

function renderConfounders(card: ExperimentProgressCardData): string {
  return card.confounders.map((entry, index) => {
    const x = index % 2 === 0 ? 64 : 610;
    const y = index < 2 ? 556 : 580;
    const text = `${entry.date} · ${entry.label}`;
    return [
      `<circle cx="${x + 4}" cy="${y - 5}" r="4" fill="#A6692F"/>`,
      `<text x="${x + 16}" y="${y}" fill="#7B756A" font-family="Arial, sans-serif" font-size="${confounderFontSize(text)}">${escapeSvg(text)}</text>`,
    ].join("");
  }).join("");
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
      return { fill: "#D7D0C2", stroke: "#D7D0C2" };
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

function titleFontSize(title: string): number {
  if (title.length > 54) return 38;
  if (title.length > 38) return 44;
  return 52;
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
