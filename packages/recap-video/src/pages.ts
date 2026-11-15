import {
  BOARD, COLOR, castShadow, drawCover, drawLines, grow, loadPicture, onNight, requireDrawable, roundedRect, setShadow, textWidth, wrapText,
  type Ctx, type Image, type Rect, type Shadow, type TextStyle,
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

/** Arrival beats on a five-second page: setup, picture, a pair's second print, payoff. */
export const BEAT = { setup: 0.024, picture: 0.19, second: 0.24, payoff: 0.6 } as const;

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

// MARK: Words

interface Words { height: number; paint(ctx: Ctx, x: number, top: number, width: number): void }

function headline(text: string, color: string, width: number): Words {
  const style: TextStyle = { font: "display", weight: 700, size: 30, lineHeight: 41, color };
  const lines = wrapText(text, style, width, { pretty: true, keepHyphens: true });
  return { height: lines.length * style.lineHeight, paint: (ctx, x, top, across) => drawLines(ctx, lines, style, x, top, across) };
}

function words(block: RecapVideoBlock, ink: Ink, width: number): Words {
  if (block.kind === "headline" && block.text) return headline(block.text, ink.ink, width);
  if (block.kind === "kicker" && block.text) {
    const style = mono(13, 0.3, ink.accent);
    const lines = wrapText(block.text.toUpperCase(), style, width);
    return { height: lines.length * style.lineHeight, paint: (ctx, x, top, across) => drawLines(ctx, lines, style, x, top, across) };
  }
  if (block.kind === "quote" && block.quote?.text && block.quote.who) {
    // Their own words run long sometimes: a longer line steps down, as in the app.
    const size = block.quote.text.length > 70 ? 23 : 28;
    const said: TextStyle = { font: "display", weight: 400, italic: true, size, lineHeight: size + 10, color: ink.ink };
    const who: TextStyle = { font: "sans", size: 16, lineHeight: 20.8, color: ink.soft };
    const lines = wrapText(`“${block.quote.text}”`, said, width, { pretty: true });
    const by = wrapText([block.quote.who, block.quote.date ?? ""].filter(Boolean).join(" · "), who, width);
    const saidHeight = lines.length * said.lineHeight;
    return {
      height: saidHeight + 6 + by.length * who.lineHeight,
      paint: (ctx, x, top, across) => {
        drawLines(ctx, lines, said, x, top, across);
        drawLines(ctx, by, who, x, top + saidHeight + 6, across);
      },
    };
  }
  throw new RecapVideoRefusal("unsupported_block", `No drawing for a ${block.kind} block.`);
}

function wordsPiece(name: string, arriveAt: number | null, made: Words, x: number, top: number, width: number): Piece {
  return { name, arriveAt, bounds: grow({ x, y: top, width, height: made.height }, 10), paint: ctx => made.paint(ctx, x, top, width) };
}

// MARK: Pictures

const PRINT_SHADOW: Shadow = { blur: 32, y: 16, color: "rgba(0,0,0,0.4)" };
const SCENE_SHADOW: Shadow = { blur: 30, y: 14, color: "rgba(40,22,10,0.4)" };

/** A real photo as a print: the whole picture on white paper, a little tilted. */
function printPiece(name: string, arriveAt: number, image: Image, box: Rect, border: { side: number; foot: number }, tilt: number): Piece {
  return {
    name, arriveAt, bounds: grow(box, 84),
    paint: ctx => {
      ctx.save();
      ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
      ctx.rotate(tilt * Math.PI / 180);
      ctx.translate(-box.width / 2, -box.height / 2);
      setShadow(ctx, PRINT_SHADOW, tilt);
      ctx.fillStyle = COLOR.onNight;
      ctx.fillRect(0, 0, box.width, box.height);
      setShadow(ctx, null);
      ctx.drawImage(image, border.side, border.side, box.width - border.side * 2, box.height - border.side - border.foot);
      ctx.restore();
    },
  };
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
  const box: Rect = { x: 0, y: 0, width: BOARD.width, height: BOARD.height * share };
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

// MARK: Cover

async function buildCover(page: RecapVideoPage, input: RecapVideoInput): Promise<BuiltPage> {
  const pieces: Piece[] = [];
  const scene = input.scenes[page.id];
  if (scene) pieces.push(artPiece(await loadPicture(scene, "the cover"), 0.69, 162, "middle"));
  const width = BOARD.width - 48, gap = 14;
  const title = page.blocks.find(block => block.kind === "headline")?.text;
  if (!title) throw new RecapVideoRefusal("unsupported_page", "The cover has no title.");
  const titleStyle: TextStyle = { font: "display", weight: 700, size: 58, lineHeight: 58, tracking: -1.16, color: COLOR.onNight };
  const titleLines = wrapText(title, titleStyle, width);
  const starringStyle: TextStyle = { font: "sans", size: 15, lineHeight: 19.5, color: onNight(0.72) };
  const names = Object.values(input.players).map(player => player.name);
  const treatment = withArticle(input.show.treatment);
  const starring = wrapText(`${treatment ? `${treatment}, starring` : "Starring"} ${names.join(" and ")}`, starringStyle, width);
  // The app's cover can open with a small label. The recap's writer never gives one, but a page that has it draws it.
  const labels = page.blocks.filter(block => block.kind === "kicker" && block.text).map(block => words(block, inkFor("night"), width));
  const height = labels.reduce((sum, label) => sum + label.height + gap, 0) + titleLines.length * titleStyle.lineHeight + gap + starring.length * starringStyle.lineHeight;
  const top = BOARD.height - BOARD.bottom - 42 - height;
  if (top < BOARD.top + 48) throw new RecapVideoRefusal("does_not_fit", "The cover's title is too long for its page.");
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
  | { kind: "photo"; image: Image }
  | { kind: "pair"; images: [Image, Image] };

async function storyItems(page: RecapVideoPage, input: RecapVideoInput): Promise<StoryItem[]> {
  const photo = (id: string | undefined): Promise<Image> => loadPicture(id ? input.photos[id] : undefined, "a photo");
  const items: StoryItem[] = [];
  for (const block of page.blocks) {
    if (block.kind === "photo") items.push({ kind: "photo", image: await photo(block.entryIds?.[0]) });
    else if (block.kind === "photoPair") items.push({ kind: "pair", images: [await photo(block.entryIds?.[0]), await photo(block.entryIds?.[1])] });
    else items.push({ kind: "words", block });
  }
  if (page.kind === "scene") {
    const at = Math.min(Math.max(page.imageIndex ?? 0, 0), items.length);
    const scene = input.scenes[page.id];
    // A scene that failed falls back to its photo, or to its words alone.
    if (scene) items.splice(at, 0, { kind: "scene", image: await loadPicture(scene, "a scene") });
    else if (page.fallback?.kind === "photo") items.splice(at, 0, { kind: "photo", image: await photo(page.fallback.entryIds[0]) });
  }
  if (items.filter(item => item.kind !== "words").length > 1) throw new RecapVideoRefusal("unsupported_page", "A page holds one picture.");
  return items;
}

async function buildStory(page: RecapVideoPage, input: RecapVideoInput): Promise<BuiltPage> {
  const column: Rect = { x: 24, y: BOARD.top + 48, width: BOARD.width - 48, height: BOARD.height - BOARD.top - 48 - BOARD.bottom - 26 };
  const gap = 22, ink = inkFor(page.background);
  const items = await storyItems(page, input);
  if (items.length === 0) throw new RecapVideoRefusal("unsupported_page", "A page has nothing to show.");
  const made = items.map(item => item.kind === "words" ? words(item.block, ink, column.width) : null);
  // A picture takes the room the words leave.
  const room = Math.max(column.height - made.reduce((sum, block) => sum + (block?.height ?? 0), 0) - gap * (items.length - 1), 0);
  const pictureAt = items.findIndex(item => item.kind !== "words");
  const sizes = items.map((item, index): { width: number; height: number; prints?: { width: number; height: number }[] } => {
    if (item.kind === "words") return { width: column.width, height: made[index]?.height ?? 0 };
    if (item.kind === "scene") {
      const height = Math.min(456, room);
      return { width: height * 3 / 4, height };
    }
    const pair = item.kind === "pair", images = item.kind === "pair" ? item.images : [item.image];
    const prints = images.map(image => {
      const shape = image.width / image.height;
      const width = Math.min(pair ? (BOARD.width - 62) / 2 - 14 : 290, (room - (pair ? 29 : 44)) * shape);
      return { width: width + (pair ? 14 : 20), height: width / shape + (pair ? 29 : 44) };
    });
    return { width: prints.reduce((sum, print) => sum + print.width, 0) + 14 * (prints.length - 1), height: Math.max(...prints.map(print => print.height)), prints };
  });
  const picture = sizes[pictureAt];
  if (picture && (picture.height < 120 || picture.width < 80)) throw new RecapVideoRefusal("does_not_fit", "The page's words leave no room for its picture.");
  const total = sizes.reduce((sum, size) => sum + size.height, 0) + gap * (items.length - 1);
  if (total > column.height + 0.5) throw new RecapVideoRefusal("does_not_fit", "The page's words are too long for it.");
  const pieces: Piece[] = [];
  let y = column.y + (column.height - total) / 2, wordsSeen = 0;
  items.forEach((item, index) => {
    const size = sizes[index] ?? { width: 0, height: 0 };
    const x = column.x + (column.width - size.width) / 2;
    if (item.kind === "words") {
      // Words before the picture are the setup; after it, the payoff. Without a picture the first block opens the page.
      const setup = pictureAt === -1 ? wordsSeen === 0 : index < pictureAt;
      const block = made[index];
      if (block) pieces.push(wordsPiece(setup ? "setup" : "payoff", setup ? BEAT.setup : BEAT.payoff, block, column.x, y, column.width));
      wordsSeen++;
    } else if (item.kind === "scene") {
      pieces.push(scenePiece(item.image, { x, y, width: size.width, height: size.height }));
    } else if (item.kind === "photo") {
      pieces.push(printPiece("picture", BEAT.picture, item.image, { x, y, width: size.width, height: size.height }, { side: 10, foot: 34 }, -2));
    } else {
      let left = x;
      item.images.forEach((image, at) => {
        const print = size.prints?.[at] ?? { width: 0, height: 0 };
        const box = { x: left, y: y + (size.height - print.height) / 2, width: print.width, height: print.height };
        pieces.push(printPiece(at === 0 ? "picture" : "second picture", at === 0 ? BEAT.picture : BEAT.second, image, box, { side: 7, foot: 22 }, at === 0 ? -3 : 3));
        left += print.width + 14;
      });
    }
    y += size.height + gap;
  });
  return { ground: GROUND[page.background] ?? COLOR.night, light: page.background === "paper", pieces };
}

// MARK: Faces

/** A profile photo filling its circle from the middle, or the player's initial on sage. */
async function face(input: RecapVideoInput, memberId: string): Promise<(ctx: Ctx, x: number, y: number, size: number) => void> {
  const player = input.players[memberId];
  if (!player) throw new RecapVideoRefusal("unsupported_page", "A page names a player the game does not have.");
  const photo = player.avatarPath ? await loadPicture(player.avatarPath, "a profile photo") : null;
  const initial = [...player.name.trim()][0]?.toUpperCase() ?? "";
  if (!photo) requireDrawable(initial, { font: "sans", size: 10, lineHeight: 10, color: COLOR.onNight });
  return (ctx, x, y, size) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (photo) {
      drawCover(ctx, photo, { x, y, width: size, height: size });
    } else {
      ctx.fillStyle = COLOR.sage;
      ctx.fillRect(x, y, size, size);
      const style: TextStyle = { font: "sans", size: size * 0.42, lineHeight: size * 0.42, color: COLOR.onNight };
      drawLines(ctx, [initial], style, x, y + (size - style.lineHeight) / 2, size);
    }
    ctx.restore();
  };
}

// MARK: Most likely to

async function buildLikely(page: RecapVideoPage, input: RecapVideoInput): Promise<BuiltPage> {
  const card = page.card;
  if (!card) throw new RecapVideoRefusal("unsupported_page", "A Most likely to page has no card.");
  const column: Rect = { x: 30, y: BOARD.top + 40, width: BOARD.width - 60, height: BOARD.height - BOARD.top - 40 - BOARD.bottom - 26 };
  const gap = 18, drawFace = await face(input, card.memberId);
  const nameStyle = mono(13, 0.3, COLOR.muted);
  const leadStyle: TextStyle = { font: "display", weight: 400, italic: true, size: 24, lineHeight: 31.2, color: COLOR.muted };
  const titleStyle: TextStyle = { font: "display", weight: 700, size: 42, lineHeight: 46, tracking: -0.42, color: COLOR.ink };
  const lineStyle: TextStyle = { font: "sans", size: 18, lineHeight: 31, color: COLOR.muted };
  const name = wrapText((input.players[card.memberId]?.name ?? "").toUpperCase(), nameStyle, column.width);
  const lead = wrapText("Most likely to", leadStyle, column.width);
  const title = wrapText(card.title, titleStyle, column.width);
  const line = wrapText(card.line, lineStyle, 310);
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
    { name: "line", at: 0.36, height: line.length * lineStyle.lineHeight, paint: (ctx, top) => drawLines(ctx, line, lineStyle, column.x + (column.width - 310) / 2, top, 310) },
  ];
  const total = parts.reduce((sum, part) => sum + part.height, 0) + gap * (parts.length - 1);
  if (total > column.height) throw new RecapVideoRefusal("does_not_fit", "The card's words are too long for its page.");
  let y = column.y + (column.height - total) / 2;
  const pieces = parts.map((part): Piece => {
    const top = y;
    y += part.height + gap;
    return { name: part.name, arriveAt: part.at, bounds: grow({ x: column.x, y: top, width: column.width, height: part.height }, part.name === "face" ? 72 : 10), paint: ctx => part.paint(ctx, top) };
  });
  return { ground: COLOR.ground, light: true, pieces };
}

export async function buildStoryPage(entry: RecapVideoEntry, input: RecapVideoInput): Promise<BuiltPage> {
  if (entry.kind === "cover") return buildCover(entry.page, input);
  if (entry.kind === "superlative") return buildLikely(entry.page, input);
  return buildStory(entry.page, input);
}

export { artPiece, face, FULL, mono };
