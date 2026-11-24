import {
  BOARD, COLOR, blockHeight, castShadow, displayLine, drawCover, drawLines, fitText, grow, onNight, requireDrawable, roundedRect, setShadow, textWidth, wrapText,
  type Ctx, type Image, type PictureLoader, type Rect, type Shadow, type TextStyle,
} from "./surface.js";
import type { RecapVideoEntry } from "./timeline.js";
import { RecapVideoRefusal, type RecapVideoBlock, type RecapVideoInput, type RecapVideoPage } from "./types.js";

/** Where a page is in its own time. */
export interface PageTime { localMs: number; lengthMs: number }

/**
 * One thing on a page. A piece with `arriveAt` fades in and rises as one
 * layer; `dynamic` pieces are drawn again on every frame; `direct` pieces
 * draw straight onto the frame and never arrive.
 */
export interface Piece {
  name: string;
  bounds: Rect;
  /** When it arrives, as a share of a five-second page. Null: there from the first frame. */
  arriveAt: number | null;
  dynamic?: boolean;
  direct?: boolean;
  paint(ctx: Ctx, time: PageTime): void;
}

export interface BuiltPage {
  ground: string;
  /** Paper pages draw their story bars in ink. */
  light: boolean;
  pieces: Piece[];
  /** How many lyric words are lit at a time, on the song page. */
  sungWords?: (localMs: number) => number;
}

/** Arrival beats on a five-second page, as shares of it: setup, picture, a pair's second print, payoff. */
/** `next`: on a page of words alone, how long each block follows the one before, as in the app. */
export const BEAT = { setup: 0.024, picture: 0.19, second: 0.24, payoff: 0.6, next: 0.18 } as const;

const FULL: Rect = { x: 0, y: 0, width: BOARD.width, height: BOARD.height };
const progress = (time: PageTime): number => Math.min(Math.max(time.localMs / time.lengthMs, 0), 1);

interface Ink { ink: string; soft: string; accent: string }
function inkFor(background: string): Ink {
  if (background === "paper") return { ink: COLOR.ink, soft: COLOR.muted, accent: COLOR.sienna };
  return { ink: COLOR.onNight, soft: onNight(0.75), accent: background === "sienna" ? onNight(0.75) : COLOR.tan };
}
const GROUND: Record<string, string> = { night: COLOR.night, paper: COLOR.ground, sage: COLOR.sage, sienna: COLOR.sienna, slate: COLOR.slate };

const mono = (size: number, tracking: number, color: string, lineHeight = size * 1.25): TextStyle => ({ font: "mono", size, lineHeight, tracking: size * tracking, color });

/** "A courtroom drama", as the app writes the show's treatment. */
export function withArticle(treatment: string): string {
  const trimmed = treatment.trim();
  const first = trimmed[0];
  if (!first) return "";
  const lower = trimmed.toLowerCase();
  if (/^(a|an|the) /u.test(lower)) return first.toUpperCase() + trimmed.slice(1);
  const second = trimmed[1] ?? "";
  const plain = second !== "" && second === second.toLowerCase() && second !== second.toUpperCase();
  const body = plain ? first.toLowerCase() + trimmed.slice(1) : trimmed;
  const vowel = "aeiou".includes(lower[0] ?? "x") && !["uni", "use", "usu", "one"].some(prefix => lower.startsWith(prefix));
  const an = vowel || ["8", "11", "18"].some(prefix => lower.startsWith(prefix));
  return `${an ? "An" : "A"} ${body}`;
}

/**
 * The two players in the one order the video uses everywhere. The app names
 * the other player first and puts the viewer on the left, and both players
 * receive this file, so the video takes the winner's seat: the winner is on
 * the left of the score and named last on the cover. An even game has no
 * winner, so its players go by name.
 */
export function billing(input: RecapVideoInput): [string, string] {
  const [one = "", two = "", ...more] = Object.keys(input.players);
  if (!one || !two || more.length > 0) throw new RecapVideoRefusal("unsupported_outcome", "A recap video is for a game between two players.");
  const { outcome } = input;
  if (outcome.kind === "won") {
    if (outcome.winnerId === outcome.loserId || ![one, two].includes(outcome.winnerId) || ![one, two].includes(outcome.loserId)) {
      throw new RecapVideoRefusal("unsupported_outcome", "The result names a player the game does not have.");
    }
    return [outcome.winnerId, outcome.loserId];
  }
  const name = (id: string): string => input.players[id]?.name ?? "";
  return name(one) < name(two) || (name(one) === name(two) && one < two) ? [one, two] : [two, one];
}

/** "A courtroom drama, starring Ava and Leo": the other player first, as the app's cover names them. */
export function starringLine(input: RecapVideoInput): string {
  const [first, second] = billing(input), treatment = withArticle(input.show.treatment);
  return `${treatment ? `${treatment}, starring` : "Starring"} ${input.players[second]?.name ?? ""} and ${input.players[first]?.name ?? ""}`;
}

// MARK: Words

/**
 * A block of words, measured. `lines` is how many lines its shortenable part
 * takes, each `lineHeight` tall: a page with too many words for it cuts that
 * part short with an ellipsis, a line at a time, as the app's text is cut.
 */
interface Words { height: number; lines: number; lineHeight: number; paint(ctx: Ctx, x: number, top: number, width: number): void }

function headline(text: string, color: string, width: number, maxLines: number): Words {
  // The app sets it 37 points to a line with 5 between lines.
  const style: TextStyle = { font: "display", weight: 700, size: 30, lineHeight: 42, spacing: 5, color };
  const lines = wrapText(text, style, width, { pretty: true, keepHyphens: true, maxLines });
  return { height: blockHeight(lines.length, style), lines: lines.length, lineHeight: style.lineHeight, paint: (ctx, x, top, across) => drawLines(ctx, lines, style, x, top, across) };
}

function quote(said: NonNullable<RecapVideoBlock["quote"]>, ink: Ink, width: number, maxLines: number): Words {
  // Their own words run long sometimes: a longer line steps down, as in the app.
  const size = [...said.text].length > 70 ? 23 : 28;
  const words: TextStyle = { font: "display", weight: 400, italic: true, size, lineHeight: displayLine(size) + 4, spacing: 4, color: ink.ink };
  const who: TextStyle = { font: "sans", size: 16, lineHeight: 20.8, color: ink.soft };
  const lines = wrapText(`“${said.text}”`, words, width, { pretty: true, maxLines });
  const by = wrapText([said.who, said.date ?? ""].filter(Boolean).join(" · "), who, width, { maxLines: 2 });
  const saidHeight = blockHeight(lines.length, words);
  return {
    height: saidHeight + 6 + by.length * who.lineHeight, lines: lines.length, lineHeight: words.lineHeight,
    paint: (ctx, x, top, across) => {
      drawLines(ctx, lines, words, x, top, across);
      drawLines(ctx, by, who, x, top + saidHeight + 6, across);
    },
  };
}

/** A number blown up big over its label. The number keeps to one line, shrinking as the app shrinks it. */
function stat(value: string, label: string, ink: Ink, width: number, maxLines: number): Words {
  const big = fitText(value, { font: "display", weight: 700, size: 96, lineHeight: displayLine(96), tracking: -1.92, color: ink.ink }, width, { maxLines: 1, least: 0.4 });
  const small: TextStyle = { font: "sans", size: 17, lineHeight: 22.1, color: ink.soft };
  const under = label.trim() ? wrapText(label, small, width, { maxLines }) : [];
  return {
    height: big.style.lineHeight + (under.length > 0 ? 2 + under.length * small.lineHeight : 0), lines: under.length, lineHeight: small.lineHeight,
    paint: (ctx, x, top, across) => {
      drawLines(ctx, big.lines, big.style, x, top, across);
      drawLines(ctx, under, small, x, top + big.style.lineHeight + 2, across);
    },
  };
}

function words(block: RecapVideoBlock, ink: Ink, width: number, maxLines = Infinity): Words {
  if (block.kind === "headline" && block.text?.trim()) return headline(block.text, ink.ink, width, maxLines);
  if (block.kind === "kicker" && block.text?.trim()) {
    const style = mono(13, 0.3, ink.accent);
    const lines = wrapText(block.text.toUpperCase(), style, width, { maxLines });
    return { height: lines.length * style.lineHeight, lines: lines.length, lineHeight: style.lineHeight, paint: (ctx, x, top, across) => drawLines(ctx, lines, style, x, top, across) };
  }
  if (block.kind === "quote" && block.quote?.text.trim() && block.quote.who.trim()) return quote(block.quote, ink, width, maxLines);
  if (block.kind === "stat" && block.statValue?.trim()) return stat(block.statValue.trim(), block.text ?? "", ink, width, maxLines);
  throw new RecapVideoRefusal("unsupported_block", `No drawing for this ${block.kind} block.`);
}

/**
 * Which block to shorten so a page's words fit, and to how many lines: the
 * tallest block that has a line to give up loses as many as `over` points
 * asks, one at least. Null when every block is down to its last line.
 */
function shorten(made: readonly (Words | null)[], over: number): { index: number; lines: number } | null {
  let index = -1;
  made.forEach((block, at) => {
    if (block && block.lines > 1 && (index === -1 || block.height > (made[index]?.height ?? 0))) index = at;
  });
  const block = made[index];
  if (!block) return null;
  return { index, lines: Math.max(1, block.lines - Math.max(1, Math.ceil(over / block.lineHeight))) };
}

function wordsPiece(name: string, arriveAt: number | null, made: Words, x: number, top: number, width: number): Piece {
  return { name, arriveAt, bounds: grow({ x, y: top, width, height: made.height }, 10), paint: ctx => made.paint(ctx, x, top, width) };
}

// MARK: Pictures

const PRINT_SHADOW: Shadow = { blur: 32, y: 16, color: "rgba(0,0,0,0.4)" };
const SCENE_SHADOW: Shadow = { blur: 30, y: 14, color: "rgba(40,22,10,0.4)" };

/** One of their posts: its photo, or the dark "missed" card the app prints when the photo is gone. */
interface Shot { image: Image | null; unfinished: boolean }
/** A print's paper border: its sides and top, and its deeper foot. */
interface Border { side: number; foot: number }
const LARGE: Border = { side: 10, foot: 34 }, SMALL: Border = { side: 7, foot: 22 }, TINY: Border = { side: 4, foot: 12 };
const shapeOf = (shot: Shot): number => shot.image ? shot.image.width / Math.max(shot.image.height, 1) : 3 / 4;

const UNFINISHED_TAG = mono(10, 0, onNight(0.88), 13);
const unfinishedTagWidth = (): number => textWidth("Didn't finish", UNFINISHED_TAG) + 15;

/** The largest print of a shot, border and all, that keeps the whole photo inside `maxWidth` by `maxHeight`. */
function printSize(shot: Shot, border: Border, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const shape = shapeOf(shot), width = Math.min(maxWidth - border.side * 2, (maxHeight - border.side - border.foot) * shape);
  return { width: width + border.side * 2, height: width / shape + border.side + border.foot };
}

/** A day given back wears its tag inside the photo, eight points in. A photo too small for it is drawn without it, not with the tag hanging off. */
const tagFits = (picture: { width: number; height: number }): boolean => picture.width >= unfinishedTagWidth() + 16 && picture.height >= 21 + 16;

/** A print: the whole photo on white paper, a little tilted. */
function paintPrint(ctx: Ctx, shot: Shot, box: Rect, border: Border, tilt: number): void {
  const picture: Rect = { x: border.side, y: border.side, width: box.width - border.side * 2, height: box.height - border.side - border.foot };
  ctx.save();
  ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
  ctx.rotate(tilt * Math.PI / 180);
  ctx.translate(-box.width / 2, -box.height / 2);
  setShadow(ctx, PRINT_SHADOW, tilt);
  ctx.fillStyle = COLOR.onNight;
  ctx.fillRect(0, 0, box.width, box.height);
  setShadow(ctx, null);
  if (shot.image) {
    ctx.drawImage(shot.image, picture.x, picture.y, picture.width, picture.height);
  } else {
    const dark = ctx.createRadialGradient(picture.x + picture.width / 2, picture.y + picture.height * 0.45, 0, picture.x + picture.width / 2, picture.y + picture.height * 0.45, 260);
    dark.addColorStop(0, "#2E2A26");
    dark.addColorStop(1, "#1B1815");
    ctx.fillStyle = dark;
    ctx.fillRect(picture.x, picture.y, picture.width, picture.height);
    const label = mono(11, 0.2, onNight(0.55));
    drawLines(ctx, ["MISSED"], label, picture.x, picture.y + (picture.height - label.lineHeight) / 2, picture.width);
  }
  if (shot.unfinished && tagFits(picture)) {
    // The app's tag on a day its player gave back, in the photo's bottom corner.
    const style = UNFINISHED_TAG, wide = unfinishedTagWidth(), tag: Rect = { x: picture.x + picture.width - 8 - wide, y: picture.y + picture.height - 8 - 21, width: wide, height: 21 };
    ctx.fillStyle = "rgba(28,25,21,0.58)";
    roundedRect(ctx, tag, 10.5);
    ctx.fill();
    ctx.strokeStyle = onNight(0.16);
    ctx.lineWidth = 1;
    roundedRect(ctx, { x: tag.x + 0.5, y: tag.y + 0.5, width: tag.width - 1, height: tag.height - 1 }, 10);
    ctx.stroke();
    drawLines(ctx, ["Didn't finish"], style, tag.x, tag.y + 4, tag.width);
  }
  ctx.restore();
}

function printPiece(name: string, arriveAt: number | null, shot: Shot, box: Rect, border: Border, tilt: number): Piece {
  return { name, arriveAt, bounds: grow(box, 84), paint: ctx => paintPrint(ctx, shot, box, border, tilt) };
}

/** A generated scene in its card, drifting closer through the page. */
function scenePiece(image: Image, box: Rect): Piece {
  return {
    name: "picture", arriveAt: BEAT.picture, dynamic: true, bounds: grow(box, 78),
    paint: (ctx, time) => {
      castShadow(ctx, box, 4, SCENE_SHADOW);
      ctx.save();
      roundedRect(ctx, box, 4);
      ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(box.x, box.y, box.width, box.height);
      drawCover(ctx, image, box, { zoom: 1 + 0.04 * progress(time) });
      ctx.restore();
    },
  };
}

/** The cover's scene across the top of the screen, fading into the night where the words sit. */
function artPiece(image: Image, share: number, fade: number, anchor: "middle" | "top"): Piece {
  // Whole points, so its foot is a whole pixel: a fractional foot is a partly covered row where the
  // clip blends both the picture and its fade, which leaves a faint light line above the words.
  const box: Rect = { x: 0, y: 0, width: BOARD.width, height: Math.floor(BOARD.height * share) };
  return {
    name: "art", arriveAt: null, direct: true, bounds: box,
    paint: (ctx, time) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      ctx.clip();
      drawCover(ctx, image, box, { zoom: 1 + 0.045 * progress(time), anchor });
      const top = ctx.createLinearGradient(0, 0, 0, 150);
      top.addColorStop(0, "rgba(28,25,21,0.75)");
      top.addColorStop(1, "rgba(28,25,21,0)");
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, box.width, 150);
      const foot = ctx.createLinearGradient(0, box.height - fade, 0, box.height);
      foot.addColorStop(0, "rgba(28,25,21,0)");
      foot.addColorStop(1, COLOR.night);
      ctx.fillStyle = foot;
      ctx.fillRect(0, box.height - fade, box.width, fade);
      ctx.restore();
    },
  };
}

/** A post's print, by its entry: a file, the "missed" card for a photo that is gone, or a refusal for one the show was never given. */
async function shotOf(id: string | undefined, input: RecapVideoInput, load: PictureLoader): Promise<Shot> {
  const file = id === undefined ? undefined : input.photos[id];
  return { image: file === null ? null : await load(file, "a photo"), unfinished: id !== undefined && (input.unfinished ?? []).includes(id) };
}

// MARK: Cover

/** The cover's title sizes, largest first, as the app steps them down. */
const COVER_TITLE_SIZES = [58, 48, 40, 34] as const;

/**
 * The cover's title as the app sets it: at the largest size that keeps it to
 * three lines, and at the smallest past that, cut short with an ellipsis.
 */
function coverTitle(title: string, width: number): { style: TextStyle; lines: string[] } {
  const styleAt = (size: number): TextStyle => ({ font: "display", weight: 700, size, lineHeight: size, tracking: -size * 0.02, color: COLOR.onNight });
  for (const size of COVER_TITLE_SIZES.slice(0, -1)) {
    const lines = wrapText(title, styleAt(size), width);
    if (lines.length <= 3) return { style: styleAt(size), lines };
  }
  const least = styleAt(COVER_TITLE_SIZES.at(-1) ?? 34);
  return { style: least, lines: wrapText(title, least, width, { maxLines: 3 }) };
}

async function buildCover(page: RecapVideoPage, input: RecapVideoInput, load: PictureLoader): Promise<BuiltPage> {
  const pieces: Piece[] = [];
  const scene = input.scenes[page.id];
  if (scene) pieces.push(artPiece(await load(scene, "the cover"), 0.69, 162, "middle"));
  const width = BOARD.width - 48, gap = 14;
  const title = page.blocks.find(block => block.kind === "headline")?.text;
  if (!title?.trim()) throw new RecapVideoRefusal("unsupported_page", "The cover has no title.");
  const { style: titleStyle, lines: titleLines } = coverTitle(title, width);
  const starringStyle: TextStyle = { font: "sans", size: 15, lineHeight: 19.5, color: onNight(0.72) };
  const starring = wrapText(starringLine(input), starringStyle, width, { maxLines: 3 });
  // The app's cover can open with a small label. The recap's writer never gives one, but a page that has it draws it.
  const labels = page.blocks.filter(block => block.kind === "kicker" && block.text?.trim()).map(block => words(block, inkFor("night"), width, 2));
  const height = labels.reduce((sum, label) => sum + label.height + gap, 0) + titleLines.length * titleStyle.lineHeight + gap + starring.length * starringStyle.lineHeight;
  // Three lines of title at most, so the words always leave the cover's top clear.
  const top = Math.max(BOARD.height - BOARD.bottom - 42 - height, BOARD.top + 48);
  if (!scene && page.fallback?.kind === "photo") {
    // Without its scene the cover stands its photo in, as a print in the room above the words, when there is room for one.
    const shot = await shotOf(page.fallback.entryIds[0], input, load), room = top - gap - 12 - BOARD.top;
    const size = printSize(shot, LARGE, 310, room);
    if (size.height >= 120 && size.width >= 80) pieces.push(printPiece("picture", null, shot, { x: (BOARD.width - size.width) / 2, y: BOARD.top + (room - size.height) / 2, ...size }, LARGE, -2));
  }
  pieces.push({
    // Whole from the first frame: it is the video's thumbnail.
    name: "words", arriveAt: null, bounds: FULL,
    paint: ctx => {
      let y = top;
      for (const label of labels) {
        label.paint(ctx, 24, y, width);
        y += label.height + gap;
      }
      drawLines(ctx, titleLines, titleStyle, 24, y, width);
      drawLines(ctx, starring, starringStyle, 24, y + titleLines.length * titleStyle.lineHeight + gap, width);
    },
  });
  return { ground: COLOR.night, light: false, pieces };
}

// MARK: Story pages: the setup above the picture, the payoff below, together in the middle.

type StoryItem =
  | { kind: "words"; block: RecapVideoBlock }
  | { kind: "scene"; image: Image }
  | { kind: "photo"; shot: Shot }
  | { kind: "pair"; shots: [Shot, Shot] }
  | { kind: "sheet"; shots: Shot[] };

async function sheetItem(block: RecapVideoBlock, input: RecapVideoInput, load: PictureLoader): Promise<StoryItem> {
  const ids = block.entryIds ?? [];
  // A day given back wears a tag wider than a sheet's small prints: not drawn, so refused.
  if (ids.length < 3 || ids.length > 9 || ids.some(id => (input.unfinished ?? []).includes(id))) {
    throw new RecapVideoRefusal("unsupported_block", "No drawing for a contact sheet of this many posts, or one with a day given back.");
  }
  const shots: Shot[] = [];
  for (const id of ids) shots.push(await shotOf(id, input, load));
  return { kind: "sheet", shots };
}

async function storyItems(page: RecapVideoPage, input: RecapVideoInput, load: PictureLoader): Promise<StoryItem[]> {
  const items: StoryItem[] = [];
  for (const block of page.blocks) {
    if (block.kind === "photo") items.push({ kind: "photo", shot: await shotOf(block.entryIds?.[0], input, load) });
    else if (block.kind === "photoPair") items.push({ kind: "pair", shots: [await shotOf(block.entryIds?.[0], input, load), await shotOf(block.entryIds?.[1], input, load)] });
    else if (block.kind === "contactSheet") items.push(await sheetItem(block, input, load));
    else items.push({ kind: "words", block });
  }
  if (page.kind === "scene") {
    const at = Math.min(Math.max(page.imageIndex ?? items.length, 0), items.length);
    const scene = input.scenes[page.id];
    // A scene that failed falls back to its photo, or to its words alone.
    if (scene) items.splice(at, 0, { kind: "scene", image: await load(scene, "a scene") });
    else if (page.fallback?.kind === "photo") items.splice(at, 0, { kind: "photo", shot: await shotOf(page.fallback.entryIds[0], input, load) });
  }
  if (items.filter(item => item.kind !== "words").length > 1) throw new RecapVideoRefusal("unsupported_page", "A page holds one picture.");
  return items;
}

/** A picture laid out in the room its page's words leave: its size, and its pieces once it has a place. */
interface Picture { width: number; height: number; pieces(x: number, y: number): Piece[] }

function pairPicture(shots: [Shot, Shot], room: number): Picture {
  // Two prints share the column, 14 points apart.
  const sizes = shots.map(shot => printSize(shot, SMALL, (BOARD.width - 48 - 14) / 2, room));
  const height = Math.max(...sizes.map(size => size.height));
  return {
    width: sizes.reduce((sum, size) => sum + size.width, 0) + 14, height,
    pieces: (x, y) => {
      let left = x;
      return shots.map((shot, at) => {
        const size = sizes[at] ?? { width: 0, height: 0 }, box = { x: left, y: y + (height - size.height) / 2, ...size };
        left += size.width + 14;
        return printPiece(at === 0 ? "picture" : "second picture", at === 0 ? BEAT.picture : BEAT.second, shot, box, SMALL, at === 0 ? -3 : 3);
      });
    },
  };
}

/**
 * Three to nine posts, three to a row, each whole in its square. Rows share
 * the room as the app's do: full rows take up to a third of the width each,
 * and a short last row takes what is left, so its prints come out larger.
 */
function sheetPicture(shots: Shot[], room: number): Picture {
  const gap = 12, across = 342, rows = Math.ceil(shots.length / 3), last = shots.length - (rows - 1) * 3;
  const full = Math.min((across - gap * 2) / 3, (room - gap * (rows - 1)) / rows);
  const short = last === 3 ? full : Math.min((across - gap * (last - 1)) / last, room - gap * (rows - 1) - full * (rows - 1));
  const height = full * (rows - 1) + short + gap * (rows - 1);
  const cells = shots.map((shot, at) => {
    const row = Math.floor(at / 3), side = row === rows - 1 ? short : full, count = row === rows - 1 ? last : 3;
    const left = (across - (side * count + gap * (count - 1))) / 2 + (at % 3) * (side + gap), size = printSize(shot, TINY, Math.min(side, 310), side);
    return { shot, size, x: left + (side - size.width) / 2, y: row * (full + gap) + (side - size.height) / 2 };
  });
  return {
    width: across, height,
    pieces: (x, y) => [{
      name: "picture", arriveAt: BEAT.picture, bounds: grow({ x, y, width: across, height }, 84),
      paint: ctx => cells.forEach(cell => paintPrint(ctx, cell.shot, { x: x + cell.x, y: y + cell.y, ...cell.size }, TINY, 0)),
    }],
  };
}

function picture(item: Exclude<StoryItem, { kind: "words" }>, room: number): Picture {
  if (item.kind === "scene") {
    const height = Math.min(456, room);
    return { width: height * 3 / 4, height, pieces: (x, y) => [scenePiece(item.image, { x, y, width: height * 3 / 4, height })] };
  }
  if (item.kind === "photo") {
    const size = printSize(item.shot, LARGE, 310, room);
    return { ...size, pieces: (x, y) => [printPiece("picture", BEAT.picture, item.shot, { x, y, ...size }, LARGE, -2)] };
  }
  return item.kind === "pair" ? pairPicture(item.shots, room) : sheetPicture(item.shots, room);
}

/** The least a picture is squeezed to before the page's words give up lines instead: a sheet's squares are small by design. */
const leastHeight = (item: Exclude<StoryItem, { kind: "words" }>): number => item.kind === "sheet" ? 60 * Math.ceil(item.shots.length / 3) : 120;
const tooSmall = (item: Exclude<StoryItem, { kind: "words" }>, made: Picture): boolean => made.height < leastHeight(item) || made.width < 80;

async function buildStory(page: RecapVideoPage, input: RecapVideoInput, load: PictureLoader): Promise<BuiltPage> {
  const column: Rect = { x: 24, y: BOARD.top + 48, width: BOARD.width - 48, height: BOARD.height - BOARD.top - 48 - BOARD.bottom - 26 };
  const gap = 22, ink = inkFor(page.background);
  const items = await storyItems(page, input, load);
  if (items.length === 0) throw new RecapVideoRefusal("unsupported_page", "A page has nothing to show.");
  const pictureAt = items.findIndex(item => item.kind !== "words");
  const shown = items[pictureAt], kept = shown && shown.kind !== "words" ? shown : null;
  // A page with more words than room cuts its longest block short, as the app's text is cut, until
  // its words fit and leave its picture its least size. Every block has at least one line left.
  const budgets = items.map(() => Infinity);
  let made: (Words | null)[], laid: Picture | null, heights: number[], total: number;
  for (;;) {
    made = items.map((item, index) => item.kind === "words" ? words(item.block, ink, column.width, budgets[index]) : null);
    // A picture takes the room the words leave.
    const room = Math.max(column.height - made.reduce((sum, block) => sum + (block?.height ?? 0), 0) - gap * (items.length - 1), 0);
    laid = kept ? picture(kept, room) : null;
    heights = items.map((_, index) => index === pictureAt ? laid?.height ?? 0 : made[index]?.height ?? 0);
    total = heights.reduce((sum, height) => sum + height, 0) + gap * (items.length - 1);
    const over = Math.max(total - column.height, kept && laid && tooSmall(kept, laid) ? leastHeight(kept) - laid.height : 0);
    const cut = over > 0.5 ? shorten(made, over) : null;
    if (!cut) break;
    budgets[cut.index] = cut.lines;
  }
  const pieces: Piece[] = [];
  let y = column.y + (column.height - total) / 2;
  items.forEach((_, index) => {
    const block = made[index];
    if (block) {
      // Words before the picture are the setup and words after it the payoff. Without a picture each block follows the one before.
      const beat = pictureAt === -1 ? { name: index === 0 ? "setup" : "next", at: BEAT.setup + BEAT.next * index } : index < pictureAt ? { name: "setup", at: BEAT.setup } : { name: "payoff", at: BEAT.payoff };
      pieces.push(wordsPiece(beat.name, beat.at, block, column.x, y, column.width));
    } else if (laid) {
      pieces.push(...laid.pieces(column.x + (column.width - laid.width) / 2, y));
    }
    y += (heights[index] ?? 0) + gap;
  });
  return { ground: GROUND[page.background] ?? COLOR.night, light: page.background === "paper", pieces };
}

// MARK: Faces

/** A profile photo filling its circle from the middle, or the player's initial on their color, as the app's avatar draws them. */
async function face(input: RecapVideoInput, memberId: string, load: PictureLoader): Promise<(ctx: Ctx, x: number, y: number, size: number) => void> {
  const player = input.players[memberId];
  if (!player) throw new RecapVideoRefusal("unsupported_page", "A page names a player the game does not have.");
  const photo = player.avatarPath ? await load(player.avatarPath, "a profile photo") : null;
  const initial = [...player.name].find(letter => letter.trim() !== "")?.toUpperCase() ?? "?";
  if (!photo) requireDrawable(initial, { font: "sansBold", size: 10, lineHeight: 10, color: COLOR.cream });
  // Sage for the player whose seat the video takes, sienna for the other: the app's two player colors.
  const color = billing(input)[0] === memberId ? COLOR.sage : COLOR.sienna;
  return (ctx, x, y, size) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (photo) {
      drawCover(ctx, photo, { x, y, width: size, height: size });
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, size, size);
      const letter = Math.floor(size * (size <= 40 ? 0.43 : 0.375) + 0.5);
      const style: TextStyle = { font: "sansBold", size: letter, lineHeight: letter, color: COLOR.cream };
      drawLines(ctx, [initial], style, x, y + (size - style.lineHeight) / 2, size);
    }
    ctx.restore();
  };
}

// MARK: Most likely to

async function buildLikely(page: RecapVideoPage, input: RecapVideoInput, load: PictureLoader): Promise<BuiltPage> {
  const card = page.card;
  if (!card?.title.trim() || !card.line.trim()) throw new RecapVideoRefusal("unsupported_page", "A Most likely to page has no card.");
  const column: Rect = { x: 30, y: BOARD.top + 40, width: BOARD.width - 60, height: BOARD.height - BOARD.top - 40 - BOARD.bottom - 26 };
  const gap = 18, drawFace = await face(input, card.memberId, load);
  const nameStyle = mono(13, 0.3, COLOR.muted);
  const leadStyle: TextStyle = { font: "display", weight: 400, italic: true, size: 24, lineHeight: displayLine(24), color: COLOR.muted };
  const titleStyle: TextStyle = { font: "display", weight: 700, size: 42, lineHeight: 46, tracking: -0.42, color: COLOR.ink };
  const lineStyle: TextStyle = { font: "sans", size: 18, lineHeight: 31, spacing: 8, color: COLOR.muted };
  const name = wrapText((input.players[card.memberId]?.name ?? "").toUpperCase(), nameStyle, column.width, { maxLines: 1 });
  const lead = wrapText("Most likely to", leadStyle, column.width);
  // A card with more words than its page cuts the longer of its title and its line short, as the app's text is cut, until they fit.
  let title: string[] = [], line: string[] = [], titleLines = Infinity, lineLines = Infinity;
  for (;;) {
    title = wrapText(card.title, titleStyle, column.width, { maxLines: titleLines });
    line = wrapText(card.line, lineStyle, 310, { maxLines: lineLines });
    const over = 168 + name.length * nameStyle.lineHeight + 14 + leadStyle.lineHeight + title.length * titleStyle.lineHeight + 3 + blockHeight(line.length, lineStyle) + gap * 5 - column.height;
    const cut = over > 0 ? shorten([
      { height: title.length * titleStyle.lineHeight, lines: title.length, lineHeight: titleStyle.lineHeight, paint: () => {} },
      { height: blockHeight(line.length, lineStyle), lines: line.length, lineHeight: lineStyle.lineHeight, paint: () => {} },
    ], over) : null;
    if (!cut) break;
    if (cut.index === 0) titleLines = cut.lines;
    else lineLines = cut.lines;
  }
  const parts: { name: string; at: number; height: number; paint(ctx: Ctx, top: number): void }[] = [
    { name: "face", at: 0.024, height: 168, paint: (ctx, top) => {
      const x = column.x + (column.width - 168) / 2;
      ctx.save();
      setShadow(ctx, { blur: 28, y: 12, color: "rgba(40,30,20,0.18)" });
      ctx.fillStyle = COLOR.cream;
      ctx.beginPath();
      ctx.arc(x + 84, top + 84, 84, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawFace(ctx, x + 6, top + 6, 156);
    } },
    { name: "name", at: 0.06, height: name.length * nameStyle.lineHeight + 14, paint: (ctx, top) => drawLines(ctx, name, nameStyle, column.x, top, column.width) },
    { name: "lead", at: 0.12, height: leadStyle.lineHeight, paint: (ctx, top) => drawLines(ctx, lead, leadStyle, column.x, top, column.width) },
    { name: "title", at: 0.18, height: title.length * titleStyle.lineHeight, paint: (ctx, top) => drawLines(ctx, title, titleStyle, column.x, top, column.width) },
    { name: "rule", at: 0.26, height: 3, paint: (ctx, top) => {
      ctx.fillStyle = COLOR.sienna;
      ctx.fillRect(column.x + (column.width - 44) / 2, top, 44, 3);
    } },
    { name: "line", at: 0.36, height: blockHeight(line.length, lineStyle), paint: (ctx, top) => drawLines(ctx, line, lineStyle, column.x + (column.width - 310) / 2, top, 310) },
  ];
  const total = parts.reduce((sum, part) => sum + part.height, 0) + gap * (parts.length - 1);
  let y = column.y + (column.height - total) / 2;
  const pieces = parts.map((part): Piece => {
    const top = y;
    y += part.height + gap;
    return { name: part.name, arriveAt: part.at, bounds: grow({ x: column.x, y: top, width: column.width, height: part.height }, part.name === "face" ? 72 : 10), paint: ctx => part.paint(ctx, top) };
  });
  return { ground: COLOR.ground, light: true, pieces };
}

export async function buildStoryPage(entry: RecapVideoEntry, input: RecapVideoInput, load: PictureLoader): Promise<BuiltPage> {
  if (entry.kind === "cover") return buildCover(entry.page, input, load);
  if (entry.kind === "superlative") return buildLikely(entry.page, input, load);
  return buildStory(entry.page, input, load);
}

export { artPiece, face, FULL, mono };
