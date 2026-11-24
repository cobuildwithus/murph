import { artPiece, billing, face, FULL, mono, withArticle, type BuiltPage, type Piece } from "./pages.js";
import { slip, ticket, type Stake } from "./stakes.js";
import {
  BOARD, COLOR, ELLIPSIS, applyText, baselineIn, createCanvas, displayLine, drawCover, drawLines, ellipsize, fitText, grow, onNight, requireDrawable, roundedRect, scaleStyle, setShadow, textWidth, wrapText,
  type Image, type PictureLoader, type Rect, type TextStyle,
} from "./surface.js";
import { lyricWordStarts, songOriginMs } from "./timeline.js";
import { RecapVideoRefusal, type RecapVideoInput, type RecapVideoPage } from "./types.js";

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);
const ease = (part: number): number => 1 - (1 - clamp(part)) ** 3;
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// MARK: The song's one color, taken from its cover the way the app tints its lyrics.

function hsb(hue: number, saturation: number, brightness: number): string {
  const channel = (n: number): number => {
    const k = (n + hue * 6) % 6;
    return Math.round(255 * (brightness - brightness * saturation * Math.max(Math.min(k, 4 - k, 1), 0)));
  };
  return `rgb(${channel(5)},${channel(3)},${channel(1)})`;
}

export function songTint(cover: Image | null): { card: string; ink: string } {
  if (!cover) return { card: hsb(15 / 360, 0.62, 0.45), ink: hsb(15 / 360, 0.72, 0.16) };
  const side = 8, canvas = createCanvas(side, side), ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cover, 0, 0, side, side);
  const pixels = ctx.getImageData(0, 0, side, side).data;
  const sums = [0, 0, 0];
  for (let at = 0; at < pixels.length; at += 4) for (let channel = 0; channel < 3; channel++) sums[channel] = (sums[channel] ?? 0) + (pixels[at + channel] ?? 0);
  const [red = 0, green = 0, blue = 0] = sums.map(sum => sum / (side * side * 255));
  const high = Math.max(red, green, blue), low = Math.min(red, green, blue), spread = high - low;
  const saturation = high === 0 ? 0 : spread / high;
  if (saturation < 0.08) return { card: hsb(0, 0, 0.34), ink: hsb(0, 0, 0.11) };
  const raw = high === red ? ((green - blue) / spread) % 6 : high === green ? (blue - red) / spread + 2 : (red - green) / spread + 4;
  const hue = ((raw / 6) % 1 + 1) % 1;
  const tone = Math.min(Math.max(saturation * 1.4, 0.4), 0.7);
  return { card: hsb(hue, tone, 0.45), ink: hsb(hue, Math.min(tone + 0.1, 0.8), 0.16) };
}

// MARK: The theme song, like a song in a music app, without its buttons.

export async function buildSong(page: RecapVideoPage, input: RecapVideoInput, load: PictureLoader): Promise<BuiltPage> {
  const song = page.song;
  if (!song) throw new RecapVideoRefusal("missing_song", "The song page has no song.");
  const coverId = input.show.pages.find(other => other.kind === "cover")?.id;
  const coverPath = coverId ? input.scenes[coverId] : undefined;
  const cover = coverPath ? await load(coverPath, "the cover") : null;
  const tint = songTint(cover);
  // The song's clock may already be running when its page opens on its cue.
  const songMs = input.score.songMs, lead = (page.cueMs ?? 0) - songOriginMs(input);

  const infoWidth = BOARD.width - 56, top = BOARD.top + 48;
  const titleStyle: TextStyle = { font: "display", weight: 700, size: 30, lineHeight: 37, color: COLOR.onNight };
  const genreStyle: TextStyle = { font: "sans", size: 16, lineHeight: 21, color: onNight(0.7) };
  const timeStyle: TextStyle = { font: "mono", size: 12, lineHeight: 16, color: onNight(0.75) };
  // The title takes two lines at most and shrinks a little before it would take a third; the genre keeps to one. Either is cut short past that, as the app cuts it.
  const fitted = fitText(song.title, titleStyle, infoWidth, { maxLines: 2, least: 0.8 }, { pretty: true }), title = fitted.lines;
  const treatment = withArticle(input.show.treatment);
  const genre = treatment ? wrapText(`${treatment} theme`, genreStyle, infoWidth, { maxLines: 1 }) : [];
  const titleHeight = title.length * fitted.style.lineHeight, genreHeight = genre.length * genreStyle.lineHeight;
  const infoHeight = 26 + titleHeight + 4 + genreHeight + 22 + 24 + 8 + 16;
  // The cover takes what its page has left.
  const side = Math.max(Math.min(infoWidth, BOARD.height - top - infoHeight - 174), 140);
  const sleeve: Rect = { x: (BOARD.width - side) / 2, y: top, width: side, height: side };
  const infoTop = top + side, scrubTop = infoTop + 26 + titleHeight + 4 + genreHeight + 22;
  const card: Rect = { x: 16, y: infoTop + infoHeight + 28, width: BOARD.width - 32, height: BOARD.height + 40 - (infoTop + infoHeight + 28) };
  // With the title at two lines and the genre at one, the lyrics always keep more than two rows.
  const pane: Rect = { x: card.x + 16, y: card.y + 16 + 32 + 12, width: card.width - 32, height: card.height - 32 - 32 - 12 };

  // Lyrics: every word placed once, lit from its own start.
  const lyricStyle: TextStyle = { font: "sansBold", size: 19, lineHeight: 25, tracking: -0.3, color: tint.ink };
  const space = textWidth("a a", lyricStyle) - textWidth("aa", lyricStyle);
  const starts = lyricWordStarts(song, songMs);
  const placed: { text: string; x: number; y: number; startMs: number }[] = [];
  const lineTops: number[] = [], lineStarts: number[] = [];
  let y = 0;
  song.lyrics.forEach((line, index) => {
    const timed = song.lines?.[index]?.words.map(word => word.text);
    const texts = timed && timed.length === starts[index]?.length ? timed : line.split(/\s+/u).filter(Boolean);
    lineTops.push(y);
    lineStarts.push(starts[index]?.[0] ?? songMs);
    let x = 0, rows = 1, cut = false;
    const first = placed.length;
    texts.forEach((text, at) => {
      if (cut) return;
      requireDrawable(text, lyricStyle);
      // A word wider than the card is cut short to fit it.
      const shown = ellipsize(text, lyricStyle, pane.width), width = textWidth(shown, lyricStyle);
      if (x > 0 && x + width > pane.width) {
        // The card shows the line being sung on two rows, as the app does. A longer one ends its second
        // row with an ellipsis, after the last word that leaves room for one; the words after it are not drawn.
        if (rows === 2) {
          const fits = (word: { text: string; x: number }): boolean => word.x + textWidth(`${word.text}${ELLIPSIS}`, lyricStyle) <= pane.width;
          while (placed.length > first + 1 && !fits(placed[placed.length - 1]!)) placed.pop();
          const last = placed.at(-1);
          if (last && !last.text.endsWith(ELLIPSIS)) last.text = fits(last) ? `${last.text}${ELLIPSIS}` : ellipsize(`${last.text}${ELLIPSIS}`, lyricStyle, pane.width - last.x);
          cut = true;
          return;
        }
        x = 0;
        y += lyricStyle.lineHeight;
        rows++;
      }
      placed.push({ text: shown, x, y, startMs: starts[index]?.[at] ?? songMs });
      x += width + space;
    });
    y += lyricStyle.lineHeight + 6;
  });
  if (placed.length === 0) throw new RecapVideoRefusal("missing_song", "The song has no lyrics.");

  const still: Piece = {
    name: "song", arriveAt: null, bounds: FULL,
    paint: ctx => {
      ctx.save();
      setShadow(ctx, { blur: 40, y: 18, color: "rgba(0,0,0,0.45)" });
      const sleeveFill = ctx.createLinearGradient(sleeve.x, sleeve.y, sleeve.x + side, sleeve.y + side);
      sleeveFill.addColorStop(0, "#8B5D3F");
      sleeveFill.addColorStop(1, "#3A2618");
      ctx.fillStyle = sleeveFill;
      roundedRect(ctx, sleeve, 8);
      ctx.fill();
      ctx.restore();
      if (cover) {
        ctx.save();
        roundedRect(ctx, sleeve, 8);
        ctx.clip();
        drawCover(ctx, cover, sleeve, { anchor: "top" });
        ctx.restore();
      }
      drawLines(ctx, title, fitted.style, 28, infoTop + 26, infoWidth, "left");
      drawLines(ctx, genre, genreStyle, 28, infoTop + 26 + titleHeight + 4, infoWidth, "left");
      ctx.fillStyle = onNight(0.3);
      roundedRect(ctx, { x: 28, y: scrubTop + 10, width: infoWidth, height: 4 }, 2);
      ctx.fill();
      ctx.fillStyle = tint.card;
      roundedRect(ctx, card, 16);
      ctx.fill();
      drawLines(ctx, ["Lyrics"], { font: "sansBold", size: 17, lineHeight: 32, color: COLOR.onNight }, card.x + 16, card.y + 16, pane.width, "left");
    },
  };
  const sungWords = (localMs: number): number => placed.filter(word => localMs + lead >= word.startMs).length;
  const moving: Piece = {
    name: "playback", arriveAt: null, direct: true, bounds: FULL,
    paint: (ctx, time) => {
      const sung = time.localMs + lead, part = clamp(sung / songMs);
      ctx.fillStyle = COLOR.onNight;
      roundedRect(ctx, { x: 28, y: scrubTop + 10, width: infoWidth * part, height: 4 }, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(28 + Math.min(Math.max(infoWidth * part - 6, 0), infoWidth - 12) + 6, scrubTop + 12, 6, 0, Math.PI * 2);
      ctx.fill();
      applyText(ctx, timeStyle);
      const timesBase = baselineIn(scrubTop + 24 + 8, timeStyle), left = `-${clock(Math.max(songMs - sung, 0) / 1000)}`;
      ctx.fillText(clock(sung / 1000), 28, timesBase);
      ctx.fillText(left, 28 + infoWidth - ctx.measureText(left).width, timesBase);
      // The line being sung is always on top; the next slides up as its first word comes.
      let now = 0;
      lineStarts.forEach((start, index) => {
        if (sung >= start - 150) now = index;
      });
      const before = lineTops[Math.max(now - 1, 0)] ?? 0, after = lineTops[now] ?? 0;
      const slide = now === 0 ? 1 : ease((sung - ((lineStarts[now] ?? 0) - 150)) / 300);
      const shift = before + (after - before) * slide;
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.x, pane.y, pane.width, pane.height);
      ctx.clip();
      applyText(ctx, lyricStyle);
      for (const word of placed) {
        ctx.fillStyle = sung >= word.startMs ? COLOR.onNight : tint.ink;
        ctx.fillText(word.text, pane.x + word.x, baselineIn(pane.y + word.y - shift, lyricStyle));
      }
      ctx.restore();
    },
  };
  return { ground: COLOR.night, light: false, pieces: [still, moving], sungWords };
}

// MARK: The last screen: the cover runs down behind the final score, then who won and what was played for.

/**
 * The last screen's words. The winner's screen says "You win." and the
 * loser's names the winner; both players receive this file, so a won game is
 * told in the third person. An even game's words already speak to both.
 */
export function posterWords(input: RecapVideoInput): { title: string; line?: string; caption?: string } {
  const { outcome, stake } = input, [first, second] = billing(input);
  const name = (id: string): string => input.players[id]?.name ?? "";
  if (outcome.kind === "won") {
    if (stake.kind === "prize") return { title: `${name(first)} wins.`, line: `${name(second)} owes ${name(first)}` };
    if (stake.kind === "punishment") return { title: `${name(first)} wins.` };
    throw new RecapVideoRefusal("unsupported_stake", `A won game is played for a prize or a punishment, not ${stake.kind}.`);
  }
  if (stake.kind === "bothWin" && outcome.everyDay) return { title: "You both win.", line: "You both get", caption: "You both did every day." };
  if (stake.kind === "none") return { title: "Dead even.", caption: outcome.everyDay ? "You both did every day, so nobody owes anything." : "Nobody owes anything." };
  throw new RecapVideoRefusal("unsupported_stake", `An even game owes nothing, or earns both players a prize when neither missed a day, not ${stake.kind}.`);
}

/** The score's row: its digits' own line, at 80 points. */
const SCORE_HEIGHT = displayLine(80);

/** The final score between the two faces. Long numbers share the row and shrink, as the app's do. */
function scoreRow(scores: readonly [string, string], width: number): { styles: [TextStyle, TextStyle]; widths: [number, number]; left: number; total: number } {
  const digits: TextStyle = { font: "display", weight: 600, size: 80, lineHeight: SCORE_HEIGHT, tracking: -2.4, color: COLOR.onNight };
  const room = width - (64 + 18) * 2 - 16 - 10 * 2, ideal = scores.map(score => textWidth(score, digits)) as [number, number];
  const given: [number, number] = [ideal[0], ideal[1]];
  if (ideal[0] + ideal[1] > room) {
    // The narrower number takes up to half the room and the wider one what is left.
    const narrow = ideal[0] <= ideal[1] ? 0 : 1, wide = 1 - narrow;
    given[narrow] = Math.min(ideal[narrow] ?? 0, room / 2);
    given[wide] = room - (given[narrow] ?? 0);
  }
  const scales = given.map((share, at) => Math.min(share / (ideal[at] ?? 1), 1));
  const styles = scales.map(scale => scale === 1 ? digits : scaleStyle(digits, scale)) as [TextStyle, TextStyle];
  const widths = scores.map((score, at) => textWidth(score, styles[at] ?? digits)) as [number, number];
  const total = 64 + 18 + widths[0] + 10 + 16 + 10 + widths[1] + 18 + 64;
  return { styles, widths, left: (BOARD.width - total) / 2, total };
}

async function stakeOf(input: RecapVideoInput, said: ReturnType<typeof posterWords>): Promise<Stake | null> {
  const { stake, outcome } = input;
  if (stake.kind === "none") return null;
  if (stake.kind === "punishment") return slip(stake.title, input.players[outcome.kind === "won" ? outcome.loserId : ""]?.name ?? "");
  return ticket(stake.title, said.line ?? "");
}

export async function buildPoster(_page: RecapVideoPage, input: RecapVideoInput, load: PictureLoader): Promise<BuiltPage> {
  const said = posterWords(input), [first, second] = billing(input);
  const pieces: Piece[] = [];
  const coverId = input.show.pages.find(other => other.kind === "cover")?.id;
  const coverPath = coverId ? input.scenes[coverId] : undefined;
  if (coverPath) pieces.push(artPiece(await load(coverPath, "the cover"), 0.555, 222, "top"));

  const width = BOARD.width - 48;
  const scores = [String(input.scores[first] ?? ""), String(input.scores[second] ?? "")] as const;
  if (scores.some(score => !/^\d{1,3}$/u.test(score))) throw new RecapVideoRefusal("unsupported_outcome", "The result has no score to show.");
  const row = scoreRow(scores, width);
  const faces = [await face(input, first, load), await face(input, second, load)] as const;
  // Two lines at most, shrinking before a third, as the app sets it.
  const title = fitText(said.title, { font: "display", weight: 600, size: 44, lineHeight: displayLine(44), tracking: -0.88, color: COLOR.onNight }, width, { maxLines: 2, least: 0.7 });
  const titleHeight = title.lines.length * title.style.lineHeight;
  const stake = await stakeOf(input, said);
  const captionStyle: TextStyle = stake ? { font: "sans", size: 14, lineHeight: 18.2, color: onNight(0.72) } : { font: "sans", size: 16, lineHeight: 20.8, color: onNight(0.72) };
  const caption = said.caption ? wrapText(said.caption, captionStyle, width) : [];
  // Under a ticket the caption sits 12 points down; with nothing owed it follows the title by 10.
  const stakeHeight = stake ? 16 + stake.height : 0, captionHeight = caption.length > 0 ? (stake ? 12 : 10) + caption.length * captionStyle.lineHeight : 0;
  const mark = mono(13, 0.3, COLOR.tan, 16), markTop = BOARD.height - 64 - 16;
  const height = SCORE_HEIGHT + 20 + titleHeight + stakeHeight + captionHeight;
  // The score sits on the cover's foot, and rises when the stake needs the room. Each part is
  // bounded (a two-line title, a three-line prize or dare), so the stack always clears the footer.
  const rest = BOARD.top + (BOARD.height - BOARD.top - BOARD.bottom) * 0.39;
  const top = Math.max(Math.min(rest, markTop - 20 - height), BOARD.top + 61);

  pieces.push({
    name: "score", arriveAt: 0.03, bounds: grow({ x: 24, y: top, width, height: SCORE_HEIGHT }, 10),
    paint: ctx => {
      const avatar = (drawFace: (typeof faces)[number], x: number): void => {
        ctx.fillStyle = COLOR.onNight;
        ctx.beginPath();
        ctx.arc(x + 32, top + SCORE_HEIGHT / 2, 32, 0, Math.PI * 2);
        ctx.fill();
        drawFace(ctx, x + 2, top + SCORE_HEIGHT / 2 - 30, 60);
      };
      avatar(faces[0], row.left);
      avatar(faces[1], row.left + row.total - 64);
      // A shrunk number keeps to the middle of the row.
      const number = (text: string, style: TextStyle, x: number): void => {
        applyText(ctx, style);
        ctx.fillText(text, x, baselineIn(top + (SCORE_HEIGHT - style.lineHeight) / 2, style));
      };
      let x = row.left + 64 + 18;
      number(scores[0], row.styles[0], x);
      x += row.widths[0] + 10;
      ctx.fillStyle = onNight(0.45);
      roundedRect(ctx, { x, y: top + SCORE_HEIGHT / 2 - 3, width: 16, height: 6 }, 3);
      ctx.fill();
      number(scores[1], row.styles[1], x + 16 + 10);
    },
  });
  const titleTop = top + SCORE_HEIGHT + 20;
  pieces.push({ name: "title", arriveAt: 0.16, bounds: grow({ x: 24, y: titleTop, width, height: titleHeight }, 10), paint: ctx => drawLines(ctx, title.lines, title.style, 24, titleTop, width) });
  const stakeTop = titleTop + titleHeight + (stake ? 16 : 0), captionTop = stakeTop + (stake?.height ?? 0) + (stake ? 12 : 10);
  if (stake) pieces.push({ name: "stake", arriveAt: 0.3, bounds: stake.bounds(stakeTop), paint: ctx => stake.paint(ctx, stakeTop) });
  // What an even game says in place of a stake arrives on the stake's beat; a ticket's caption arrives with its ticket.
  if (caption.length > 0) {
    pieces.push({ name: stake ? "caption" : "stake", arriveAt: 0.3, bounds: grow({ x: 24, y: captionTop, width, height: caption.length * captionStyle.lineHeight }, 10), paint: ctx => drawLines(ctx, caption, captionStyle, 24, captionTop, width) });
  }
  // The footer: the address alone, in the cover's label style.
  pieces.push({ name: "footer", arriveAt: 0.5, bounds: grow({ x: 0, y: markTop, width: BOARD.width, height: 16 }, 8), paint: ctx => drawLines(ctx, ["WITHMURPH.AI"], mark, 0, markTop, BOARD.width) });
  return { ground: COLOR.night, light: false, pieces };
}

export { billing };
