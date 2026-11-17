import { readFile } from "node:fs/promises";

import { loadImage } from "@napi-rs/canvas";

import { mono } from "./pages.js";
import { stakeArtFile } from "./stake-art.js";
import {
  BOARD, COLOR, applyText, baselineIn, displayLine, drawLines, fitText, grow, requireDrawable, roundedRect, setShadow, textWidth,
  type Ctx, type Image, type Rect, type TextStyle,
} from "./surface.js";
import { RecapVideoRefusal } from "./types.js";

/** What the last screen shows under its title: its height in the stack, where it draws, and how. */
export interface Stake { height: number; bounds(top: number): Rect; paint(ctx: Ctx, top: number): void }

const turned = (ctx: Ctx, x: number, y: number, degrees: number): void => {
  ctx.translate(x, y);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.translate(-x, -y);
};

// MARK: The prize, as a gold ticket (the app's `GameBigTicket`, 256 points wide in its 280-point slot).

const TICKET = { width: 256, height: 170, pad: 20, tilt: -3, inset: 16, gap: 4, kicker: 14 } as const;

/** A four-point star, drawn so no font has to carry one. */
function star(ctx: Ctx, x: number, y: number, size: number): void {
  ctx.beginPath();
  for (let point = 0; point < 8; point++) {
    const radius = point % 2 === 0 ? size / 2 + 1 : 1.1, turn = point * Math.PI / 4 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(turn) * radius, y + Math.sin(turn) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

function paintTicketPaper(ctx: Ctx, x: number, y: number): void {
  const { width, height } = TICKET;
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
  // Gold falling from the top left corner to the bottom right.
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
}

/**
 * The app's drawing for a prize, chosen from its words as the app chooses
 * it. The drawings are 96 by 64 points; each is read at four times that so
 * it stays sharp on the ticket.
 */
async function prizeArt(prize: string): Promise<Image> {
  const drawing = (await readFile(stakeArtFile(prize), "utf8")).replace('width="96" height="64"', 'width="384" height="256"');
  return loadImage(Buffer.from(drawing));
}

/**
 * The gold ticket: "GOOD FOR ONE", the prize's drawing, the prize, and
 * `line` under it. The ticket's print shares its 138 points of height as the
 * app's does: the prize is offered half of it, which is one line, and shrinks
 * to fit; the drawing takes what is left, up to its 104 by 73. A prize too
 * long for that is cut short by the app, and refused here.
 */
export async function ticket(title: string, line: string): Promise<Stake> {
  const { width, height, pad, inset, gap, kicker } = TICKET;
  const icon = await prizeArt(title);
  const label = mono(11, 0.24, COLOR.ticketInk, kicker), small = mono(11, 0.2, COLOR.ticketInk, kicker);
  const good = "GOOD FOR ONE", starSize = 5, starGap = textWidth("  ", label);
  // The app's line names one player; this one names both, so two long names get a little smaller before the ticket is refused.
  const under = fitText(line.toUpperCase(), small, width - 44, { maxLines: 1, least: 0.75 });
  const print = height - inset * 2, shared = print - gap * 3 - kicker * 2;
  const prizeStyle: TextStyle = { font: "display", weight: 600, size: 34, lineHeight: displayLine(34), color: COLOR.ticketInk };
  const prize = fitText(title, prizeStyle, width - 48, { maxLines: 1, least: 0.6, maxHeight: shared / 2 });
  const prizeHeight = prize.lines.length * prize.style.lineHeight;
  const fit = Math.min(Math.min(73, shared - prizeHeight) / icon.height, 104 / icon.width), art = { width: icon.width * fit, height: icon.height * fit };
  const inner = kicker + gap + art.height + gap + prizeHeight + gap + kicker;
  return {
    height: height + pad * 2,
    bounds: top => grow({ x: (BOARD.width - width) / 2, y: top + pad, width, height }, 16),
    paint: (ctx, top) => {
      const x = (BOARD.width - width) / 2, y = top + pad;
      ctx.save();
      turned(ctx, BOARD.width / 2, y + height / 2, TICKET.tilt);
      paintTicketPaper(ctx, x, y);
      let row = y + (height - inner) / 2;
      // "✦  GOOD FOR ONE  ✦"
      const lineWidth = textWidth(good, label) + (starSize + starGap) * 2, lineLeft = x + (width - lineWidth) / 2;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = COLOR.ticketInk;
      for (const starX of [lineLeft + starSize / 2, lineLeft + lineWidth - starSize / 2 - label.size * 0.24]) star(ctx, starX, row + 7, starSize);
      applyText(ctx, label);
      ctx.fillText(good, lineLeft + starSize + starGap, baselineIn(row, label));
      ctx.globalAlpha = 1;
      row += kicker + gap;
      ctx.drawImage(icon, x + (width - art.width) / 2, row, art.width, art.height);
      row += art.height + gap;
      drawLines(ctx, prize.lines, prize.style, x, row, width);
      row += prizeHeight + gap;
      ctx.globalAlpha = 0.75;
      drawLines(ctx, under.lines, under.style, x, row + (kicker - under.style.lineHeight) / 2, width);
      ctx.restore();
    },
  };
}

// MARK: The punishment, as the loser's pink slip (the app's `GamePinkSlip`).

const SLIP = { width: 342, padTop: 24, padSide: 22, padBottom: 20, tilt: -2, red: "#8E2340", stampRed: "#C2182B", typedInk: "#28305C", pen: "#2C47A8", rule: "rgba(142,35,64,0.45)" } as const;
const slipLabel = (): TextStyle => mono(10, 0.16, SLIP.red, 13);
/**
 * The slip is typed in Zilla Slab Medium a tenth larger than the app's
 * sizes. At that size its words are as wide as the app's American Typewriter
 * (within one percent over 39 dares and names), so a dare breaks onto the
 * same lines, and its letters stand 0.95 as tall.
 */
const TYPED_SCALE = 1.106;
const typed = (size: number, lineHeight: number, color: string = SLIP.typedInk): TextStyle => ({ font: "typed", size: size * TYPED_SCALE, lineHeight, color });

/** The signature: a quick loop-de-loop in pen, in a 96 by 32 box. */
function scribble(ctx: Ctx, x: number, y: number): void {
  const curves: number[][] = [
    [7, 17, 10, 8, 13, 5], [15, 3, 16, 5, 15, 9], [13, 16, 10, 22, 9, 26], [9, 28, 10, 28, 12, 26], [16, 21], [17, 19, 19, 18, 20, 19], [21, 21, 17, 24, 19, 25],
    [21, 26, 24, 22, 26, 19], [27, 18, 28, 18, 28, 19], [27, 22, 27, 25, 29, 25], [31, 25, 33, 22, 34, 20], [35, 18, 37, 17, 38, 19], [39, 22, 37, 25, 39, 25],
    [42, 25, 44, 21, 47, 20], [51, 19, 56, 20, 62, 18], [68, 16, 74, 14, 82, 13],
  ];
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 24);
  for (const [a = 0, b = 0, c, d, e, f] of curves) {
    if (c === undefined || d === undefined || e === undefined || f === undefined) ctx.lineTo(x + a, y + b);
    else ctx.bezierCurveTo(x + a, y + b, x + c, y + d, x + e, y + f);
  }
  ctx.strokeStyle = SLIP.pen;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

/** A form number, the same for the same dare, as the app counts it. */
const formNumber = (dare: string): string => String([...dare].reduce((sum, letter) => (sum * 31 + (letter.codePointAt(0) ?? 0)) % 9973, 0)).padStart(4, "0");

/** "LOSER" in a red rubber-stamp box, knocked a little off true. */
function paintStamp(ctx: Ctx, right: number, top: number): void {
  const style: TextStyle = { font: "display", weight: 800, size: 30, lineHeight: 36, tracking: 1.8, color: SLIP.stampRed };
  const wide = textWidth("LOSER", style) + 24, tall = style.lineHeight + 4, x = right - wide, y = top;
  ctx.save();
  turned(ctx, x + wide / 2, y + tall / 2, -10);
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = SLIP.stampRed;
  ctx.lineWidth = 3;
  roundedRect(ctx, { x: x - 1.5, y: y - 1.5, width: wide + 3, height: tall + 3 }, 6);
  ctx.stroke();
  drawLines(ctx, ["LOSER"], style, x + 12, y + 2, wide - 24, "left");
  ctx.restore();
}

/** The dare on its line: one line at full size, or smaller on up to three ruled lines, as the app sets it. */
function dareLines(dare: string, width: number): { style: TextStyle; lines: string[]; ruled: boolean } {
  const big = typed(27, 33);
  requireDrawable(dare, big);
  if (textWidth(dare, big) <= width) return { style: big, lines: [dare], ruled: false };
  return { ...fitText(dare, typed(21, 30.5), width, { maxLines: 3, least: 0.7 }), ruled: true };
}

/**
 * The loser's slip: NOTICE over a form number, WHO and HAS TO typed in, a
 * scribbled signature and the LOSER stamp, a little askew on its cream copy.
 */
export function slip(dare: string, who: string): Stake {
  const { width, padTop, padSide, padBottom } = SLIP, inner = width - padSide * 2, x = (BOARD.width - width) / 2, left = x + padSide;
  const label = slipLabel(), rule = (ctx: Ctx, from: number, to: number, y: number): void => {
    ctx.fillStyle = SLIP.rule;
    ctx.fillRect(from, y - 1, to - from, 1);
  };
  const name = fitText(who, typed(21, 26), inner - 40 - 10 - 4, { maxLines: 1, least: 0.6 });
  const has = dareLines(dare, inner - 4), hasHeight = has.lines.length * (has.ruled ? 30.5 : 33) + (has.ruled ? 0 : 1);
  const notice: TextStyle = { font: "display", weight: 800, size: 26, lineHeight: 31, tracking: 2.08, color: SLIP.red };
  const number = formNumber(dare), numberStyle = typed(15, 19, SLIP.stampRed);
  const height = padTop + 39 + 16 + 27 + 14 + 13 + 2 + hasHeight + 14 + 30 + padBottom;
  return {
    height: height + 16,
    bounds: top => grow({ x, y: top + 8, width, height }, 40),
    paint: (ctx, top) => {
      const y = top + 8;
      // The cream copy underneath peeks out, turned the other way.
      ctx.save();
      turned(ctx, x + width / 2 + 6, y + height / 2 + 8, 1.5);
      setShadow(ctx, { blur: 14, y: 6, color: "rgba(45,52,54,0.08)" }, 1.5);
      ctx.fillStyle = COLOR.onNight;
      roundedRect(ctx, { x: x + 6, y: y + 8, width, height }, 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      turned(ctx, x + width / 2, y + height / 2, SLIP.tilt);
      // The paper, less a row of punched holes along its top.
      const paper = ctx.createLinearGradient(0, y, 0, y + height);
      paper.addColorStop(0, "#FAD2D8");
      paper.addColorStop(0.5, "#F6C4CC");
      paper.addColorStop(1, "#F0B4BF");
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      for (let hole = 0; hole < 30; hole++) {
        const cx = x + 9 + (width - 18 - 5) * hole / 29 + 2.5;
        ctx.moveTo(cx + 2.5, y + 11.5);
        ctx.arc(cx, y + 11.5, 2.5, 0, Math.PI * 2);
      }
      setShadow(ctx, { blur: 24, y: 12, color: "rgba(142,35,64,0.18)" }, SLIP.tilt);
      ctx.fillStyle = paper;
      ctx.fill("evenodd");
      setShadow(ctx, null);
      // NOTICE, and the form's number, over a heavy rule.
      let row = y + padTop;
      drawLines(ctx, ["NOTICE"], notice, left, row, inner, "left");
      const numberWidth = textWidth(number, numberStyle), noWidth = textWidth("NO.", label), noticeBase = baselineIn(row, notice);
      applyText(ctx, numberStyle);
      ctx.fillText(number, left + inner - numberWidth, noticeBase);
      applyText(ctx, label);
      ctx.fillText("NO.", left + inner - numberWidth - 5 - noWidth, noticeBase);
      ctx.fillStyle = SLIP.red;
      ctx.fillRect(left, row + 39 - 2.5, inner, 2.5);
      row += 39 + 16;
      // The typewriter's ink bleeds a little into the paper.
      const bleed = (): void => setShadow(ctx, { blur: 1, y: 0, color: "rgba(40,48,92,0.4)" });
      drawLines(ctx, ["WHO"], label, left, row + 27 - 6 - label.lineHeight, 40, "left");
      bleed();
      drawLines(ctx, name.lines, name.style, left + 54, row + 26 - name.style.lineHeight, inner - 54, "left");
      setShadow(ctx, null);
      rule(ctx, left + 50, left + inner, row + 27);
      row += 27 + 14;
      drawLines(ctx, ["HAS TO"], label, left, row, inner, "left");
      row += 13 + 2;
      bleed();
      has.lines.forEach((line, index) => drawLines(ctx, [line], has.style, left + 4, row + index * (has.ruled ? 30.5 : 33) + ((has.ruled ? 30.5 : 33) - has.style.lineHeight) / 2, inner - 4, "left"));
      setShadow(ctx, null);
      if (has.ruled) has.lines.forEach((_, index) => rule(ctx, left, left + inner, row + (index + 1) * 30.5));
      else rule(ctx, left, left + inner, row + 34);
      row += hasHeight + 14;
      // Signed, on the right-hand part of the form.
      const signed = left + inner - 180, signedLabel = textWidth("SIGNED", label);
      drawLines(ctx, ["SIGNED"], label, signed, row + 30 - 5 - label.lineHeight, signedLabel, "left");
      scribble(ctx, signed + signedLabel + 10 + 6, row + 30 - 32 + 7);
      rule(ctx, signed + signedLabel + 10, left + inner, row + 30);
      paintStamp(ctx, x + width - 18, y + 52);
      ctx.restore();
    },
  };
}
