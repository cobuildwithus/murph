import { buildPoster, buildSong } from "./closing-pages.js";
import { buildStoryPage, type BuiltPage, type Piece } from "./pages.js";
import {
  BOARD, COLOR, SCALE, VIDEO_HEIGHT, VIDEO_WIDTH, beginLayer, createCanvas, createLayer, createPictureLoader, onNight, registerRecapFonts, roundedRect,
  type Canvas, type Ctx, type Layer, type Rect,
} from "./surface.js";
import { RECAP_VIDEO_FPS, buildRecapVideoTimeline, entryIndexAt, type RecapVideoEntryKind, type RecapVideoTimeline } from "./timeline.js";
import type { RecapVideoInput } from "./types.js";

/** How long a piece takes to arrive, and how far it rises. */
const ARRIVE_MS = 420;
const RISE = 14;
const ease = (part: number): number => 1 - (1 - Math.min(Math.max(part, 0), 1)) ** 3;

/** What is on screen at a time, for checks that read structure instead of pixels. */
export interface RecapVideoFrameState {
  pageIndex: number;
  pageId: string;
  kind: RecapVideoEntryKind;
  localMs: number;
  /** Each piece's opacity, zero before it arrives and one once it has, and the room it was laid out in, in points. */
  pieces: { name: string; opacity: number; box: Rect }[];
  /** The story bars, each from empty to full. */
  bars: number[];
  /** Lyric words lit so far, on the song page. */
  sungWords?: number;
}

export interface RecapVideoRenderer {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly timeline: RecapVideoTimeline;
  /** Draws the frame at `ms` and returns the canvas it is on. */
  drawFrame(ms: number): Canvas;
  frameState(ms: number): RecapVideoFrameState;
}

/** A piece arrives over 420 ms from its beat; a page shorter than five seconds plays its beats sooner. */
function arrival(piece: Piece, localMs: number, lengthMs: number): number {
  if (piece.arriveAt === null) return 1;
  return ease((localMs - piece.arriveAt * Math.min(lengthMs, 5000)) / ARRIVE_MS);
}

function paintBars(ctx: Ctx, count: number, index: number, part: number, light: boolean): void {
  const left = 20, gap = 4, width = (BOARD.width - 40 - gap * (count - 1)) / count;
  for (let bar = 0; bar < count; bar++) {
    const x = left + bar * (width + gap), filled = bar < index ? 1 : bar === index ? part : 0;
    ctx.fillStyle = light ? "rgba(45,52,54,0.16)" : onNight(0.3);
    roundedRect(ctx, { x, y: BOARD.top, width, height: 3 }, 2);
    ctx.fill();
    if (filled <= 0) continue;
    ctx.save();
    roundedRect(ctx, { x, y: BOARD.top, width, height: 3 }, 2);
    ctx.clip();
    ctx.fillStyle = light ? COLOR.ink : COLOR.onNight;
    roundedRect(ctx, { x, y: BOARD.top, width: width * filled, height: 3 }, 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Lays out every page of a recap once. After that a frame is a function of
 * its time alone, so frames can be drawn in any order.
 */
export async function createRecapVideoRenderer(input: RecapVideoInput): Promise<RecapVideoRenderer> {
  registerRecapFonts();
  const timeline = buildRecapVideoTimeline(input);
  const pages: BuiltPage[] = [], load = createPictureLoader();
  for (const entry of timeline.entries) {
    pages.push(entry.kind === "song" ? await buildSong(entry.page, input, load) : entry.kind === "poster" ? await buildPoster(entry.page, input, load) : await buildStoryPage(entry, input, load));
  }
  const canvas = createCanvas(VIDEO_WIDTH, VIDEO_HEIGHT), ctx = canvas.getContext("2d");
  // One page's layers at a time: frames come in order, and a page's layers are not needed once it has passed.
  let layered = -1;
  const layers = new Map<Piece, { layer: Layer; drawn: boolean }>();
  const layerFor = (piece: Piece): { layer: Layer; drawn: boolean } => {
    let held = layers.get(piece);
    if (!held) {
      held = { layer: createLayer(piece.bounds), drawn: false };
      layers.set(piece, held);
    }
    return held;
  };
  const at = (ms: number) => {
    const pageIndex = entryIndexAt(timeline, ms), entry = timeline.entries[pageIndex], page = pages[pageIndex];
    if (!entry || !page) throw new Error("The recap video has no page at that time.");
    return { pageIndex, entry, page, localMs: ms - entry.fromMs, lengthMs: entry.toMs - entry.fromMs };
  };
  return {
    width: VIDEO_WIDTH, height: VIDEO_HEIGHT, fps: RECAP_VIDEO_FPS, timeline,
    drawFrame(ms) {
      const { pageIndex, page, localMs, lengthMs } = at(ms);
      if (layered !== pageIndex) {
        layers.clear();
        layered = pageIndex;
      }
      const time = { localMs, lengthMs };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = page.ground;
      ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (const piece of page.pieces) {
        if (piece.direct) {
          ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
          piece.paint(ctx, time);
          continue;
        }
        const part = arrival(piece, localMs, lengthMs);
        if (part <= 0) continue;
        const held = layerFor(piece);
        if (piece.dynamic || !held.drawn) {
          piece.paint(beginLayer(held.layer), time);
          held.drawn = true;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = part;
        ctx.drawImage(held.layer.canvas, held.layer.left, held.layer.top + (1 - part) * RISE * SCALE);
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      paintBars(ctx, pages.length, pageIndex, Math.min(Math.max(localMs / lengthMs, 0), 1), page.light);
      return canvas;
    },
    frameState(ms) {
      const { pageIndex, entry, page, localMs, lengthMs } = at(ms);
      return {
        pageIndex, pageId: entry.page.id, kind: entry.kind, localMs,
        pieces: page.pieces.filter(piece => !piece.direct).map(piece => ({ name: piece.name, opacity: arrival(piece, localMs, lengthMs), box: piece.bounds })),
        bars: pages.map((_, bar) => bar < pageIndex ? 1 : bar === pageIndex ? Math.min(Math.max(localMs / lengthMs, 0), 1) : 0),
        ...(page.sungWords ? { sungWords: page.sungWords(localMs) } : {}),
      };
    },
  };
}
