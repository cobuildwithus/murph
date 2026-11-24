import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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

// MARK: Fonts. The app's own four files, and three it has no need of on a phone, all under private names so no system font can stand in for one.

/**
 * `typed` fills in the punishment slip. The app types it in American
 * Typewriter, which is Apple's and not ours to ship; Zilla Slab Medium stands
 * in for it (see `TYPED_SCALE` in `stakes.ts`).
 */
export type FontKey = "display" | "sans" | "sansBold" | "mono" | "typed";
/** What a phone draws from its own fonts: emoji, and letters the app's faces lack. */
type BorrowedKey = "letters" | "emoji";
const FONTS: Record<FontKey | BorrowedKey, { file: string; family: string }> = {
  display: { file: "FrauncesGame.ttf", family: "Murph Recap Display" },
  sans: { file: "DMSans-500.ttf", family: "Murph Recap Sans" },
  sansBold: { file: "DMSans-700.ttf", family: "Murph Recap Sans Bold" },
  mono: { file: "DMMono-500.ttf", family: "Murph Recap Mono" },
  typed: { file: "ZillaSlab-Medium.ttf", family: "Murph Recap Typed" },
  letters: { file: "NotoSans-Regular.ttf", family: "Murph Recap Letters" },
  emoji: { file: "NotoColorEmoji.ttf", family: "Murph Recap Emoji" },
};
const fontPath = (file: string): string => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
const coverage = new Map<FontKey | BorrowedKey, Set<number>>();

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
  for (const [key, font] of Object.entries(FONTS) as [FontKey | BorrowedKey, { file: string; family: string }][]) {
    const path = fontPath(font.file);
    if (!GlobalFonts.registerFromPath(path, font.family) || !GlobalFonts.has(font.family)) {
      throw new Error(`Recap video font ${font.file} could not be registered.`);
    }
    coverage.set(key, readCoverage(path));
  }
  registered = true;
}

/**
 * What the borrowed text face may draw: Latin, Greek and Cyrillic letters and
 * their marks, punctuation and common signs. Lines are broken at spaces and
 * set left to right, so alphabets that need more than that (Arabic, Hebrew,
 * Chinese, Japanese, Korean, Thai, the Indic scripts) are refused.
 */
const LETTER_RANGES: [number, number][] = [[0xa1, 0x52f], [0x1e00, 0x1fff], [0x2010, 0x2027], [0x2030, 0x205e], [0x20a0, 0x20bf], [0x2100, 0x214f], [0x2190, 0x22ff]];
/** What joins emoji into one picture. */
const EMOJI_JOINERS = new Set([0x200d, 0xfe0f]);

/** Whether a letter is drawn by the style's own face, not a borrowed one. */
const ownLetter = (letter: string, font: FontKey): boolean => coverage.get(font)?.has(letter.codePointAt(0) ?? 0) ?? false;
const emojiLetter = (code: number): boolean => coverage.get("emoji")?.has(code) ?? false;

function drawable(code: number, font: FontKey): boolean {
  if (coverage.get(font)?.has(code) || emojiLetter(code)) return true;
  return LETTER_RANGES.some(([from, to]) => code >= from && code <= to) && (coverage.get("letters")?.has(code) ?? false);
}

// MARK: Text

export interface TextStyle {
  font: FontKey;
  size: number;
  /** The display face is variable; the others are drawn at their file's weight. */
  weight?: number;
  italic?: boolean;
  /** From one line's top to the next. */
  lineHeight: number;
  /** How much of `lineHeight` is space the app adds between lines: none of it sits above the first line or under the last. */
  spacing?: number;
  /** Letter spacing in points. */
  tracking?: number;
  color: string;
}

const FILE_WEIGHT: Record<FontKey, number> = { display: 700, sans: 500, sansBold: 700, mono: 500, typed: 500 };
const BORROWED = [FONTS.letters.family, FONTS.emoji.family].map(name => `"${name}"`).join(", ");

export function applyText(ctx: Ctx, style: TextStyle): void {
  const weight = style.font === "display" ? style.weight ?? 700 : FILE_WEIGHT[style.font];
  // No italic is asked of the canvas: the display face has none, and `drawLines` slants it the way the app does.
  ctx.font = `${weight} ${style.size}px "${FONTS[style.font].family}", ${BORROWED}`;
  ctx.letterSpacing = `${style.tracking ?? 0}px`;
  // The display face at the axes the app pins it to: soft, wonky, optical size 36. Left alone, the canvas would follow the font size.
  ctx.fontVariationSettings = style.font === "display" ? `'wght' ${weight}, 'opsz' 36, 'SOFT' 100, 'WONK' 1` : "normal";
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

/** Refuses text the bundled fonts cannot draw, or cannot set correctly: it would come out as boxes, or in the wrong order. */
export function requireDrawable(text: string, style: TextStyle): void {
  registerRecapFonts();
  // A joiner belongs to the emoji before it. On its own, or after a letter, it would be an invisible mark the page was asked to show.
  let afterEmoji = false;
  for (const letter of text) {
    const code = letter.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0xa0) {
      afterEmoji = false;
      continue;
    }
    const joins: boolean = EMOJI_JOINERS.has(code) && afterEmoji;
    if (!joins && (EMOJI_JOINERS.has(code) || !drawable(code, style.font))) {
      throw new RecapVideoRefusal("unsupported_text", `The recap's fonts cannot draw U+${code.toString(16).toUpperCase().padStart(4, "0")}.`);
    }
    afterEmoji = joins || (emojiLetter(code) && !ownLetter(letter, style.font));
  }
}

/**
 * A line as the runs an italic style draws: the style's own letters lean, and
 * an emoji or a borrowed letter stands upright, even inside a word.
 */
export function slantRuns(line: string, font: FontKey): { text: string; leans: boolean }[] {
  const runs: { text: string; leans: boolean }[] = [];
  for (const letter of line) {
    const space = letter.trim() === "", last = runs.at(-1);
    // A space stays with the run before it, so a run never starts with one that its measure would lose.
    if (last && (space || last.leans === ownLetter(letter, font))) last.text += letter;
    else runs.push({ text: letter, leans: space || ownLetter(letter, font) });
  }
  return runs;
}

export interface WrapOptions {
  /** No short last line, as `text-wrap: pretty` and the app's text avoid one. */
  pretty?: boolean;
  /** Keep a hyphenated word on one line. */
  keepHyphens?: boolean;
}

/** What the app ends a line it cuts short with. */
export const ELLIPSIS = "…";

const letterSegments = new Intl.Segmenter("en", { granularity: "grapheme" });
/** A text's letters as a reader sees them, so a cut never splits an emoji or a letter from its accent. */
const lettersOf = (text: string): string[] => Array.from(letterSegments.segment(text), part => part.segment);

/** A word wider than the measure, broken between letters into pieces that each fit, as the app breaks one. */
function breakWord(word: string, style: TextStyle, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const letter of lettersOf(word)) {
    if (piece && textWidth(piece + letter, style) > maxWidth) {
      pieces.push(piece);
      piece = "";
    }
    piece += letter;
  }
  return piece ? [...pieces, piece] : pieces;
}

interface Unit { text: string; glue: string }
/** Units as one line reads: each joined to the one before it by its glue. */
const joinUnits = (items: readonly Unit[]): string => items.map((unit, index) => (index === 0 ? "" : unit.glue) + unit.text).join("");

/**
 * Breaks text into lines of units no wider than `maxWidth`. A single unit
 * wider than that is broken between its letters, or answers null when `whole`
 * asks for units kept whole (shrinking text tries a smaller size before it
 * breaks a word).
 */
function breakUnits(text: string, style: TextStyle, maxWidth: number, options: WrapOptions, whole = false): Unit[][] | null {
  // A unit is what cannot be broken; `glue` is what joins it to the unit before it on a line.
  const units: Unit[] = [];
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const pieces = options.keepHyphens ? [word] : word.split(/(?<=[^-]-)(?=[^-])/u);
    for (const [index, piece] of pieces.entries()) {
      const glue = index === 0 ? " " : "";
      if (textWidth(piece, style) <= maxWidth) {
        units.push({ text: piece, glue });
        continue;
      }
      if (whole) return null;
      // Each piece but the last fills its line, so the word reads on from one line to the next.
      breakWord(piece, style, maxWidth).forEach((part, at) => units.push({ text: part, glue: at === 0 ? glue : "" }));
    }
  }
  const lines: Unit[][] = [];
  for (const unit of units) {
    const line = lines.at(-1);
    if (line && textWidth(joinUnits([...line, unit]), style) <= maxWidth) line.push(unit);
    else lines.push([unit]);
  }
  if (options.pretty && lines.length > 1) {
    const last = lines.at(-1) ?? [], before = lines.at(-2) ?? [];
    const moved = before.at(-1);
    // A last line under a third of the measure is an orphan: it takes a word from the line above.
    if (moved && before.length > 1 && textWidth(joinUnits(last), style) < maxWidth / 3 && textWidth(joinUnits([moved, ...last]), style) <= maxWidth) {
      before.pop();
      last.unshift(moved);
    }
  }
  return lines;
}

/** A line cut short at its end with an ellipsis so it fits `maxWidth`, letter by letter, as the app cuts one. */
export function ellipsize(text: string, style: TextStyle, maxWidth: number): string {
  if (textWidth(text, style) <= maxWidth) return text;
  const letters = lettersOf(text);
  const cut = (count: number): string => `${letters.slice(0, count).join("").trimEnd()}${ELLIPSIS}`;
  // The most letters that still fit beside the ellipsis.
  let fits = 0, over = letters.length;
  while (over - fits > 1) {
    const middle = Math.floor((fits + over) / 2);
    if (textWidth(cut(middle), style) <= maxWidth) fits = middle;
    else over = middle;
  }
  return cut(fits);
}

/** At most `maxLines` lines: past them, the last one shown runs on into the rest of the text and is cut short with an ellipsis. */
function clampLines(lines: Unit[][], style: TextStyle, maxWidth: number, maxLines: number): string[] {
  const shown = Math.max(1, Math.floor(maxLines));
  if (lines.length <= shown) return lines.map(joinUnits);
  return [...lines.slice(0, shown - 1).map(joinUnits), ellipsize(joinUnits(lines.slice(shown - 1).flat()), style, maxWidth)];
}

/**
 * Breaks text into lines no wider than `maxWidth`, and at most `maxLines` of
 * them, the last cut short with an ellipsis. A word wider than the measure
 * breaks between its letters. Words never cost the video.
 */
export function wrapText(text: string, style: TextStyle, maxWidth: number, options: WrapOptions & { maxLines?: number } = {}): string[] {
  requireDrawable(text, style);
  return clampLines(breakUnits(text, style, maxWidth, options) ?? [], style, maxWidth, options.maxLines ?? Infinity);
}

/** A style at a share of its size, its leading and spacing with it, as the app shrinks text. */
export const scaleStyle = (style: TextStyle, scale: number): TextStyle =>
  ({ ...style, size: style.size * scale, lineHeight: style.lineHeight * scale, ...(style.tracking === undefined ? {} : { tracking: style.tracking * scale }) });

export interface FitLimits {
  maxLines: number;
  /** The smallest share of its size the app lets this text shrink to. */
  least: number;
  maxHeight?: number;
}

/**
 * Sets text the way the app's shrinking text is set: at its own size when it
 * takes `maxLines` or fewer, else at the largest smaller size that does. Text
 * that fits at none of them is set at the smallest size and cut short with an
 * ellipsis, as the app cuts it.
 */
export function fitText(text: string, style: TextStyle, maxWidth: number, limits: FitLimits, options: WrapOptions = {}): { style: TextStyle; lines: string[]; cut: boolean } {
  requireDrawable(text, style);
  const fits = (lines: number, sized: TextStyle): boolean => lines <= limits.maxLines && lines * sized.lineHeight <= (limits.maxHeight ?? Infinity);
  for (let scale = 1; scale >= limits.least - 1e-9; scale -= 0.005) {
    const sized = scale === 1 ? style : scaleStyle(style, scale), lines = breakUnits(text, sized, maxWidth, options, true);
    if (lines && fits(lines.length, sized)) return { style: sized, lines: lines.map(joinUnits), cut: false };
  }
  const least = scaleStyle(style, limits.least);
  const room = Math.min(limits.maxLines, Math.floor((limits.maxHeight ?? Infinity) / least.lineHeight));
  const units = breakUnits(text, least, maxWidth, options) ?? [];
  return { style: least, lines: clampLines(units, least, maxWidth, room), cut: units.length > Math.max(1, room) };
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
  return top + (style.lineHeight - (style.spacing ?? 0) - (ascent + descent)) / 2 + ascent;
}

/** The display face's own line height at a size, as the app's text takes it when it sets none. */
export const displayLine = (size: number): number => Math.round(size * 1.2265);
/** How tall a block of lines is: the space between lines does not follow the last one. */
export const blockHeight = (lines: number, style: TextStyle): number => lines === 0 ? 0 : lines * style.lineHeight - (style.spacing ?? 0);

/** The app slants its upright display face by a fifth for italics. */
const SLANT = 0.2;

export type Align = "left" | "center";

/** Draws wrapped lines into a box `width` wide whose first line box starts at `top`. */
export function drawLines(ctx: Ctx, lines: string[], style: TextStyle, x: number, top: number, width: number, align: Align = "center"): void {
  applyText(ctx, style);
  lines.forEach((line, index) => {
    const offset = align === "center" ? (width - ctx.measureText(line).width) / 2 : 0, baseline = baselineIn(top + index * style.lineHeight, style);
    if (!style.italic) {
      ctx.fillText(line, x + offset, baseline);
      return;
    }
    // Only the display face's own letters lean: an emoji or a borrowed letter beside them stands upright, as on the phone.
    let left = x + offset;
    for (const run of slantRuns(line, style.font)) {
      ctx.save();
      if (run.leans) ctx.transform(1, 0, -SLANT, 1, SLANT * baseline, 0);
      ctx.fillText(run.text, left, baseline);
      ctx.restore();
      left += ctx.measureText(run.text).width;
    }
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

/** A picture's file and sides are at most this large, and a show's pictures this many pixels in all: about half a gigabyte decoded. */
const MAX_PICTURE_BYTES = 16_000_000, MAX_PICTURE_SIDE = 4096, MAX_SHOW_PIXELS = 120_000_000;

/** A JPEG's or a PNG's size, read from its header without decoding it. */
export function pictureSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // A start of frame carries the size; the three markers left out are tables.
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    } else {
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

export type PictureLoader = (path: string | undefined, what: string) => Promise<Image>;

/**
 * Loads one show's pictures, each file once. A picture is measured from its
 * header before it is decoded, so a small file that unpacks into gigabytes
 * is refused without being unpacked.
 */
export function createPictureLoader(): PictureLoader {
  const loaded = new Map<string, Promise<Image>>();
  let pixels = 0;
  const load = async (path: string, what: string): Promise<Image> => {
    const bytes = await stat(path).then(file => file.size <= MAX_PICTURE_BYTES ? readFile(path) : null, () => null);
    if (!bytes) throw new RecapVideoRefusal("missing_picture", `The file for ${what} could not be read.`);
    const size = pictureSize(bytes);
    if (!size || size.width < 1 || size.height < 1 || size.width > MAX_PICTURE_SIDE || size.height > MAX_PICTURE_SIDE) {
      throw new RecapVideoRefusal("unsupported_picture", `The file for ${what} is not a JPEG or PNG of a size a recap uses.`);
    }
    pixels += size.width * size.height;
    if (pixels > MAX_SHOW_PIXELS) throw new RecapVideoRefusal("unsupported_picture", "The show's pictures are larger than a recap's are.");
    try {
      return await loadImage(bytes);
    } catch {
      throw new RecapVideoRefusal("missing_picture", `The file for ${what} could not be read as a picture.`);
    }
  };
  return async (path, what) => {
    if (!path) throw new RecapVideoRefusal("missing_picture", `The recap has no file for ${what}.`);
    let picture = loaded.get(path);
    if (!picture) {
      picture = load(path, what);
      loaded.set(path, picture);
    }
    return picture;
  };
}

export { createCanvas };
