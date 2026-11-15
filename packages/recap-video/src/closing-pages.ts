import { artPiece, face, FULL, mono, withArticle, type BuiltPage, type Piece } from "./pages.js";
import {
  BOARD, COLOR, applyText, baselineIn, createCanvas, drawCover, drawLines, grow, loadPicture, onNight, requireDrawable, roundedRect, setShadow, textWidth, wrapText,
  type Ctx, type Image, type Rect, type TextStyle,
} from "./surface.js";
import { lyricWordStarts } from "./timeline.js";
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

export async function buildSong(page: RecapVideoPage, input: RecapVideoInput): Promise<BuiltPage> {
  const song = page.song;
  if (!song) throw new RecapVideoRefusal("missing_song", "The song page has no song.");
  const coverId = input.show.pages.find(other => other.kind === "cover")?.id;
  const coverPath = coverId ? input.scenes[coverId] : undefined;
  const cover = coverPath ? await loadPicture(coverPath, "the cover") : null;
  const tint = songTint(cover);
  const songMs = input.soundtrack.songMs;

  const infoWidth = BOARD.width - 56, top = BOARD.top + 48;
  const titleStyle: TextStyle = { font: "display", weight: 700, size: 30, lineHeight: 37, color: COLOR.onNight };
  const genreStyle: TextStyle = { font: "sans", size: 16, lineHeight: 21, color: onNight(0.7) };
  const timeStyle: TextStyle = { font: "mono", size: 12, lineHeight: 16, color: onNight(0.75) };
  const title = wrapText(song.title, titleStyle, infoWidth, { pretty: true });
  const treatment = withArticle(input.show.treatment);
  const genre = wrapText(treatment ? `${treatment} theme` : "Theme song", genreStyle, infoWidth);
  const titleHeight = title.length * titleStyle.lineHeight, genreHeight = genre.length * genreStyle.lineHeight;
  const infoHeight = 26 + titleHeight + 4 + genreHeight + 22 + 24 + 8 + 16;
  // The cover takes what its page has left.
  const side = Math.max(Math.min(infoWidth, BOARD.height - top - infoHeight - 174), 140);
  const sleeve: Rect = { x: (BOARD.width - side) / 2, y: top, width: side, height: side };
  const infoTop = top + side, scrubTop = infoTop + 26 + titleHeight + 4 + genreHeight + 22;
  const card: Rect = { x: 16, y: infoTop + infoHeight + 28, width: BOARD.width - 32, height: BOARD.height + 40 - (infoTop + infoHeight + 28) };
  const pane: Rect = { x: card.x + 16, y: card.y + 16 + 32 + 12, width: card.width - 32, height: card.height - 32 - 32 - 12 };
  if (pane.height < 60) throw new RecapVideoRefusal("does_not_fit", "The song's title leaves no room for its lyrics.");

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
    let x = 0;
    texts.forEach((text, at) => {
      requireDrawable(text, lyricStyle);
      const width = textWidth(text, lyricStyle);
      if (width > pane.width) throw new RecapVideoRefusal("does_not_fit", "A lyric word is wider than the lyrics card.");
      if (x > 0 && x + width > pane.width) {
        x = 0;
        y += lyricStyle.lineHeight;
      }
      placed.push({ text, x, y, startMs: starts[index]?.[at] ?? songMs });
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
      drawLines(ctx, title, titleStyle, 28, infoTop + 26, infoWidth, "left");
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
  const sungWords = (localMs: number): number => placed.filter(word => localMs >= word.startMs).length;
  const moving: Piece = {
    name: "playback", arriveAt: null, direct: true, bounds: FULL,
    paint: (ctx, time) => {
      const sung = time.localMs, part = clamp(sung / songMs);
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

interface Stake { height: number; bounds: (top: number) => Rect; paint(ctx: Ctx, top: number): void }

/** The prize, as the winner's gold ticket. */
async function ticket(title: string, owes: string, iconPath: string | undefined): Promise<Stake> {
  const width = 256, height = 170, pad = 20, tilt = -3;
  const icon = iconPath ? await loadPicture(iconPath, "the prize's icon") : null;
  const label = mono(11, 0.24, COLOR.ticketInk, 14), small = mono(11, 0.2, COLOR.ticketInk, 14);
  const prize: TextStyle = { font: "display", weight: 600, size: 26, lineHeight: 32, color: COLOR.ticketInk };
  const good = "GOOD FOR ONE", star = 5, starGap = textWidth("  ", label);
  if (wrapText(title, prize, width - 44).length !== 1 || wrapText(owes.toUpperCase(), small, width - 44).length !== 1) {
    throw new RecapVideoRefusal("does_not_fit", "The prize does not fit its ticket.");
  }
  const rows = [14, ...(icon ? [46] : []), 32, 14];
  const inner = rows.reduce((sum, row) => sum + row, 0) + 4 * (rows.length - 1);
  return {
    height: height + pad * 2,
    bounds: top => grow({ x: (BOARD.width - width) / 2, y: top + pad, width, height }, 16),
    paint: (ctx, top) => {
      const x = (BOARD.width - width) / 2, y = top + pad;
      ctx.save();
      ctx.translate(BOARD.width / 2, top + pad + height / 2);
      ctx.rotate(tilt * Math.PI / 180);
      ctx.translate(-BOARD.width / 2, -(top + pad + height / 2));
      ctx.save();
      // Scalloped corners: the ticket less a 12-point bite at each.
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      for (const [cx, cy] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]] as const) {
        ctx.moveTo(cx + 12, cy);
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      }
      ctx.clip("evenodd");
      // A 123-degree gradient, as CSS lays one across the box.
      const angle = 123 * Math.PI / 180, dx = Math.sin(angle), dy = -Math.cos(angle);
      const reach = (Math.abs(width * dx) + Math.abs(height * dy)) / 2, cx = x + width / 2, cy = y + height / 2;
      const gold = ctx.createLinearGradient(cx - dx * reach, cy - dy * reach, cx + dx * reach, cy + dy * reach);
      gold.addColorStop(0, "#EBD18B");
      gold.addColorStop(0.55, "#D9B969");
      gold.addColorStop(1, "#C59D4E");
      ctx.fillStyle = gold;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
      ctx.strokeStyle = "rgba(59,42,18,0.55)";
      ctx.lineWidth = 1.5;
      roundedRect(ctx, { x: x + 8.75, y: y + 8.75, width: width - 17.5, height: height - 17.5 }, 6.25);
      ctx.stroke();
      ctx.strokeStyle = "rgba(59,42,18,0.4)";
      ctx.lineWidth = 0.75;
      roundedRect(ctx, { x: x + 13.375, y: y + 13.375, width: width - 26.75, height: height - 26.75 }, 4.625);
      ctx.stroke();
      let row = y + (height - inner) / 2;
      // "✦  GOOD FOR ONE  ✦", the stars drawn so no font has to carry them.
      const goodWidth = textWidth(good, label), lineWidth = goodWidth + (star + starGap) * 2, lineLeft = x + (width - lineWidth) / 2;
      for (const starX of [lineLeft + star / 2, lineLeft + lineWidth - star / 2 - label.size * 0.24]) {
        ctx.fillStyle = COLOR.ticketInk;
        ctx.beginPath();
        for (let point = 0; point < 8; point++) {
          const radius = point % 2 === 0 ? star / 2 + 1 : 1.1, turn = point * Math.PI / 4 - Math.PI / 2;
          ctx.lineTo(starX + Math.cos(turn) * radius, row + 7 + Math.sin(turn) * radius);
        }
        ctx.closePath();
        ctx.fill();
      }
      applyText(ctx, label);
      ctx.fillText(good, lineLeft + star + starGap, baselineIn(row, label));
      row += 14 + 4;
      if (icon) {
        const iconWidth = 46 * icon.width / icon.height;
        ctx.drawImage(icon, x + (width - iconWidth) / 2, row, iconWidth, 46);
        row += 46 + 4;
      }
      drawLines(ctx, [title], prize, x, row, width);
      row += 32 + 4;
      ctx.globalAlpha = 0.75;
      drawLines(ctx, [owes.toUpperCase()], small, x, row, width);
      ctx.restore();
    },
  };
}

/** The last screen's words, in the third person: both players receive this file. */
export function posterWords(input: RecapVideoInput): { title: string; owes: string } {
  const { outcome, stake } = input;
  if (outcome.kind !== "won") throw new RecapVideoRefusal("unsupported_outcome", "No drawing yet for an even game's last screen.");
  if (stake.kind !== "prize") throw new RecapVideoRefusal("unsupported_stake", `No drawing yet for a ${stake.kind} stake.`);
  const winner = input.players[outcome.winnerId], loser = input.players[outcome.loserId];
  if (!winner || !loser) throw new RecapVideoRefusal("unsupported_outcome", "The result names a player the game does not have.");
  return { title: `${winner.name} wins.`, owes: `${loser.name} owes ${winner.name}` };
}

export async function buildPoster(_page: RecapVideoPage, input: RecapVideoInput): Promise<BuiltPage> {
  const { outcome, stake } = input, said = posterWords(input);
  if (outcome.kind !== "won" || stake.kind !== "prize") throw new RecapVideoRefusal("unsupported_stake", "No drawing yet for this last screen.");
  const pieces: Piece[] = [];
  const coverId = input.show.pages.find(other => other.kind === "cover")?.id;
  const coverPath = coverId ? input.scenes[coverId] : undefined;
  if (coverPath) pieces.push(artPiece(await loadPicture(coverPath, "the cover"), 0.555, 222, "top"));

  const width = BOARD.width - 48;
  const digits: TextStyle = { font: "display", weight: 600, size: 80, lineHeight: 96, tracking: -2.4, color: COLOR.onNight };
  const titleStyle: TextStyle = { font: "display", weight: 600, size: 44, lineHeight: 53, tracking: -0.88, color: COLOR.onNight };
  const scores = [String(input.scores[outcome.winnerId] ?? ""), String(input.scores[outcome.loserId] ?? "")] as const;
  if (scores.some(score => !/^\d{1,3}$/u.test(score))) throw new RecapVideoRefusal("unsupported_outcome", "The result has no score to show.");
  const faces = [await face(input, outcome.winnerId), await face(input, outcome.loserId)] as const;
  const title = wrapText(said.title, titleStyle, width);
  if (title.length !== 1) throw new RecapVideoRefusal("does_not_fit", "The winner's name is too long for the last screen.");
  const prize = await ticket(stake.title, said.owes, stake.iconPath);
  const mark = mono(13, 0.3, COLOR.tan, 16), markTop = BOARD.height - 64 - 16;
  const height = 96 + 20 + 53 + 16 + prize.height;
  // The score sits on the cover's foot, and rises when the stake needs the room.
  const rest = BOARD.top + (BOARD.height - BOARD.top - BOARD.bottom) * 0.39;
  const top = Math.max(Math.min(rest, markTop - 20 - height), BOARD.top + 61);
  if (top + height > markTop - 8) throw new RecapVideoRefusal("does_not_fit", "The last screen's stake is too tall for it.");

  const numbersWidth = textWidth(scores[0], digits) + 10 + 16 + 10 + textWidth(scores[1], digits);
  const rowWidth = 64 + 18 + numbersWidth + 18 + 64, rowLeft = (BOARD.width - rowWidth) / 2;
  pieces.push({
    name: "score", arriveAt: 0.03, bounds: grow({ x: 24, y: top, width, height: 96 }, 10),
    paint: ctx => {
      const avatar = (drawFace: (typeof faces)[number], x: number): void => {
        ctx.fillStyle = COLOR.onNight;
        ctx.beginPath();
        ctx.arc(x + 32, top + 48, 32, 0, Math.PI * 2);
        ctx.fill();
        drawFace(ctx, x + 2, top + 18, 60);
      };
      avatar(faces[0], rowLeft);
      avatar(faces[1], rowLeft + rowWidth - 64);
      let x = rowLeft + 64 + 18;
      applyText(ctx, digits);
      ctx.fillText(scores[0], x, baselineIn(top, digits));
      x += textWidth(scores[0], digits) + 10;
      ctx.fillStyle = onNight(0.45);
      roundedRect(ctx, { x, y: top + 45, width: 16, height: 6 }, 3);
      ctx.fill();
      applyText(ctx, digits);
      ctx.fillText(scores[1], x + 16 + 10, baselineIn(top, digits));
    },
  });
  pieces.push({ name: "title", arriveAt: 0.16, bounds: grow({ x: 24, y: top + 116, width, height: 53 }, 10), paint: ctx => drawLines(ctx, title, titleStyle, 24, top + 116, width) });
  const stakeTop = top + 116 + 53 + 16;
  pieces.push({ name: "stake", arriveAt: 0.3, bounds: prize.bounds(stakeTop), paint: ctx => prize.paint(ctx, stakeTop) });
  // The footer: the address alone, in the cover's label style.
  pieces.push({ name: "footer", arriveAt: 0.5, bounds: grow({ x: 0, y: markTop, width: BOARD.width, height: 16 }, 8), paint: ctx => drawLines(ctx, ["WITHMURPH.AI"], mark, 0, markTop, BOARD.width) });
  return { ground: COLOR.night, light: false, pieces };
}
