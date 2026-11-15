import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";

import { RecapVideoRefusal } from "./types.js";

export type Ctx = SKRSContext2D;
export type { Canvas, Image };

/** The app's recap page on an iPhone Pro, in points; the video is twice that in pixels. */
export const BOARD = { width: 402, height: 874, top: 62, bottom: 34 } as const;
export const SCALE = 2;
export const VIDEO_WIDTH = BOARD.width * SCALE;
export const VIDEO_HEIGHT = BOARD.height * SCALE;

export const COLOR = {
  night: "#1C1915", onNight: "#FFFCF6", ground: "#FFFFFF", ink: "#2D3436", muted: "#736A58", cream: "#F5F0E8",
  sienna: "#8B5D3F", slate: "#4F6B78", sage: "#5A6E32", tan: "#D4A17D", ticketInk: "#3B2A12",
} as const;
export const onNight = (alpha: number): string => `rgba(255,252,246,${alpha})`;

export interface Rect { x: number; y: number; width: number; height: number }

// MARK: Fonts. The app's own files under private names, so no system font can stand in for one.

export type FontKey = "display" | "sans" | "sansBold" | "mono";
const FONTS: Record<FontKey, { file: string; family: string }> = {
  display: { file: "FrauncesGame.ttf", family: "Murph Recap Display" },
  sans: { file: "DMSans-500.ttf", family: "Murph Recap Sans" },
  sansBold: { file: "DMSans-700.ttf", family: "Murph Recap Sans Bold" },
  mono: { file: "DMMono-500.ttf", family: "Murph Recap Mono" },
};
const fontPath = (file: string): string => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
const coverage = new Map<FontKey, Set<number>>();

/** The code points a font file can draw, from its `cmap`. */
function readCoverage(file: string): Set<number> {
  const bytes = readFileSync(file);
  const covered = new Set<number>();
  const tables = bytes.readUInt16BE(4);
  for (let table = 0; table < tables; table++) {
    const record = 12 + table * 16;
    if (bytes.toString("latin1", record, record + 4) !== "cmap") continue;
    const cmap = bytes.readUInt32BE(record + 8);
    for (let at = 0; at < bytes.readUInt16BE(cmap + 2); at++) {
      const sub = cmap + bytes.readUInt32BE(cmap + 4 + at * 8 + 4);
      const format = bytes.readUInt16BE(sub);
      if (format === 4) {
        const segments = bytes.readUInt16BE(sub + 6) / 2;
        const ends = sub + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
        for (let segment = 0; segment < segments; segment++) {
          const end = bytes.readUInt16BE(ends + segment * 2), start = bytes.readUInt16BE(starts + segment * 2);
          const delta = bytes.readUInt16BE(deltas + segment * 2), offset = bytes.readUInt16BE(offsets + segment * 2);
          for (let code = start; code <= end && code !== 0xffff; code++) {
            const glyph = offset === 0 ? (code + delta) & 0xffff : bytes.readUInt16BE(offsets + segment * 2 + offset + (code - start) * 2);
            if (glyph !== 0) covered.add(code);
          }
        }
      } else if (format === 12) {
        for (let group = 0; group < bytes.readUInt32BE(sub + 12); group++) {
          const start = bytes.readUInt32BE(sub + 16 + group * 12), end = bytes.readUInt32BE(sub + 20 + group * 12);
          for (let code = start; code <= end; code++) covered.add(code);
        }
      }
    }
  }
  return covered;
}

let registered = false;
export function registerRecapFonts(): void {
  if (registered) return;
  for (const [key, font] of Object.entries(FONTS) as [FontKey, { file: string; family: string }][]) {
    const path = fontPath(font.file);
    if (!GlobalFonts.registerFromPath(path, font.family) || !GlobalFonts.has(font.family)) {
      throw new Error(`Recap video font ${font.file} could not be registered.`);
    }
    coverage.set(key, readCoverage(path));
  }
  registered = true;
}

// MARK: Text

export interface TextStyle {
  font: FontKey;
  size: number;
  /** The display face is variable; the others are drawn at their file's weight. */
  weight?: number;
  italic?: boolean;
  lineHeight: number;
  /** Letter spacing in points. */
  tracking?: number;
  color: string;
}

const FILE_WEIGHT: Record<FontKey, number> = { display: 700, sans: 500, sansBold: 700, mono: 500 };

export function applyText(ctx: Ctx, style: TextStyle): void {
  const weight = style.font === "display" ? style.weight ?? 700 : FILE_WEIGHT[style.font];
  ctx.font = `${style.italic ? "italic " : ""}${weight} ${style.size}px "${FONTS[style.font].family}"`;
  ctx.letterSpacing = `${style.tracking ?? 0}px`;
  // Optical size is pinned to the file's default, as the app draws this face; left alone, the canvas would follow the font size.
  ctx.fontVariationSettings = style.font === "display" ? `'wght' ${weight}, 'opsz' 9` : "normal";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = style.color;
}

let measurer: Ctx | null = null;
function measureCtx(): Ctx {
  registerRecapFonts();
  measurer ??= createCanvas(4, 4).getContext("2d");
  return measurer;
}

/** A line's width as a browser lays it out: every letter carries its spacing, the last one too. */
export function textWidth(text: string, style: TextStyle): number {
  const ctx = measureCtx();
  applyText(ctx, style);
  return ctx.measureText(text).width;
}

/** Refuses text the bundled fonts cannot draw: an emoji or another script would come out as boxes. */
export function requireDrawable(text: string, style: TextStyle): void {
  registerRecapFonts();
  const covered = coverage.get(style.font);
  for (const letter of text) {
    const code = letter.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0xa0) continue;
    if (!covered?.has(code)) {
      throw new RecapVideoRefusal("unsupported_text", `The recap's fonts cannot draw U+${code.toString(16).toUpperCase().padStart(4, "0")}.`);
    }
  }
}

export interface WrapOptions {
  /** No short last line, as `text-wrap: pretty` and the app's text avoid one. */
  pretty?: boolean;
  /** Keep a hyphenated word on one line. */
  keepHyphens?: boolean;
}

/** Breaks text into lines no wider than `maxWidth`. A single unit wider than that is a refusal. */
export function wrapText(text: string, style: TextStyle, maxWidth: number, options: WrapOptions = {}): string[] {
  requireDrawable(text, style);
  // A unit is what cannot be broken; `glue` is what joins it to the unit before it on a line.
  const units: { text: string; glue: string }[] = [];
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const pieces = options.keepHyphens ? [word] : word.split(/(?<=[^-]-)(?=[^-])/u);
    pieces.forEach((piece, index) => units.push({ text: piece, glue: index === 0 ? " " : "" }));
  }
  const join = (items: { text: string; glue: string }[]): string => items.map((unit, index) => (index === 0 ? "" : unit.glue) + unit.text).join("");
  const lines: { text: string; glue: string }[][] = [];
  for (const unit of units) {
    const line = lines.at(-1);
    if (line && textWidth(join([...line, unit]), style) <= maxWidth) line.push(unit);
    else lines.push([unit]);
  }
  for (const line of lines) {
    if (textWidth(join(line), style) > maxWidth) throw new RecapVideoRefusal("does_not_fit", "A word is wider than its page.");
  }
  if (options.pretty && lines.length > 1) {
    const last = lines.at(-1) ?? [], before = lines.at(-2) ?? [];
    const moved = before.at(-1);
    // A last line under a third of the measure is an orphan: it takes a word from the line above.
    if (moved && before.length > 1 && textWidth(join(last), style) < maxWidth / 3 && textWidth(join([moved, ...last]), style) <= maxWidth) {
      before.pop();
      last.unshift(moved);
    }
  }
  return lines.map(join);
}

export interface TextMetrics { ascent: number; descent: number }
const metricsCache = new Map<string, TextMetrics>();
/** A face's ascent and descent in whole points, as browsers round them for a line box. */
export function fontMetrics(style: TextStyle): TextMetrics {
  const ctx = measureCtx();
  applyText(ctx, style);
  const key = `${ctx.font}|${ctx.fontVariationSettings}`;
  let metrics = metricsCache.get(key);
  if (!metrics) {
    const measured = ctx.measureText("x");
    metrics = { ascent: Math.round(measured.fontBoundingBoxAscent), descent: Math.round(measured.fontBoundingBoxDescent) };
    metricsCache.set(key, metrics);
  }
  return metrics;
}

/** Where a line's baseline sits in a line box that starts at `top`. */
export function baselineIn(top: number, style: TextStyle): number {
  const { ascent, descent } = fontMetrics(style);
  return top + (style.lineHeight - (ascent + descent)) / 2 + ascent;
}

export type Align = "left" | "center";

/** Draws wrapped lines into a box `width` wide whose first line box starts at `top`. */
export function drawLines(ctx: Ctx, lines: string[], style: TextStyle, x: number, top: number, width: number, align: Align = "center"): void {
  applyText(ctx, style);
  lines.forEach((line, index) => {
    const offset = align === "center" ? (width - ctx.measureText(line).width) / 2 : 0;
    ctx.fillText(line, x + offset, baselineIn(top + index * style.lineHeight, style));
  });
}

// MARK: Layers. A piece is drawn once into its own surface, then placed on each frame with its opacity and rise.

export interface Layer { canvas: Canvas; ctx: Ctx; left: number; top: number }

/** A surface covering `bounds` (in points), aligned to whole pixels so a resting piece is copied exactly. */
export function createLayer(bounds: Rect): Layer {
  const left = Math.floor(bounds.x * SCALE), top = Math.floor(bounds.y * SCALE);
  const canvas = createCanvas(Math.max(Math.ceil((bounds.x + bounds.width) * SCALE) - left, 1), Math.max(Math.ceil((bounds.y + bounds.height) * SCALE) - top, 1));
  return { canvas, ctx: canvas.getContext("2d"), left, top };
}

/** Clears a layer and points its drawing at page coordinates. */
export function beginLayer(layer: Layer): Ctx {
  const { ctx } = layer;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.setTransform(SCALE, 0, 0, SCALE, -layer.left, -layer.top);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

export const grow = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 });

// MARK: Drawing

export interface Shadow { blur: number; y: number; color: string }

/** Sets a CSS-style shadow. A canvas shadow ignores the transform, so the scale and any tilt are applied here. */
export function setShadow(ctx: Ctx, shadow: Shadow | null, tiltDegrees = 0): void {
  if (!shadow) {
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  const tilt = tiltDegrees * Math.PI / 180;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * SCALE;
  ctx.shadowOffsetX = -Math.sin(tilt) * shadow.y * SCALE;
  ctx.shadowOffsetY = Math.cos(tilt) * shadow.y * SCALE;
}

export function roundedRect(ctx: Ctx, rect: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, Math.min(radius, rect.width / 2, rect.height / 2));
}

/** A box's shadow alone, outside the box: what CSS draws under a see-through or clipped box. */
export function castShadow(ctx: Ctx, rect: Rect, radius: number, shadow: Shadow): void {
  ctx.save();
  const reach = shadow.blur * 2 + Math.abs(shadow.y);
  ctx.beginPath();
  ctx.rect(rect.x - reach, rect.y - reach, rect.width + reach * 2, rect.height + reach * 2);
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.clip("evenodd");
  setShadow(ctx, shadow);
  ctx.fillStyle = "#000";
  roundedRect(ctx, rect, radius);
  ctx.fill();
  ctx.restore();
}

/** Fills `rect` with a picture as `object-fit: cover` does, scaled about the box's middle by `zoom`. */
export function drawCover(ctx: Ctx, image: Image, rect: Rect, options: { zoom?: number; anchor?: "middle" | "top" } = {}): void {
  const fit = Math.max(rect.width / image.width, rect.height / image.height);
  const width = image.width * fit, height = image.height * fit;
  const x = rect.x + (rect.width - width) / 2, y = options.anchor === "top" ? rect.y : rect.y + (rect.height - height) / 2;
  const zoom = options.zoom ?? 1, middleX = rect.x + rect.width / 2, middleY = rect.y + rect.height / 2;
  ctx.drawImage(image, middleX + (x - middleX) * zoom, middleY + (y - middleY) * zoom, width * zoom, height * zoom);
}

export async function loadPicture(path: string | undefined, what: string): Promise<Image> {
  if (!path) throw new RecapVideoRefusal("missing_picture", `The recap has no file for ${what}.`);
  try {
    return await loadImage(path);
  } catch {
    throw new RecapVideoRefusal("missing_picture", `The file for ${what} could not be read as a picture.`);
  }
}

export { createCanvas };
