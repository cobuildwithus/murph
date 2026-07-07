import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  decodeExperimentProgressCard,
  type ExperimentProgressCardConfounder,
  type ExperimentProgressCardData,
  type ExperimentProgressCardMover,
} from "@murphai/contracts";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
} from "../../../../../font-files";

export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };
const LOGO_HEIGHT = 26;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 197) / 44); // logo.svg viewBox is 197×44

const COLOR = {
  background: "#F4EEE1",
  panel: "rgba(255,253,249,0.55)",
  border: "rgba(120,110,86,0.16)",
  hairline: "rgba(120,110,86,0.18)",
  foreground: "#2C322F",
  muted: "#7B756A",
  faint: "rgba(44,50,47,0.40)",
  label: "rgba(44,50,47,0.45)",
  primary: "#5A6E32",
  confounder: "#A6692F",
};

const SENTIMENT_TEXT: Record<string, string> = {
  positive: "#4F6B2C",
  negative: "#A6692F",
  neutral: "#7B756A",
};

/**
 * Single-hue intensity ramp for the session timeline — a quiet data strip, not
 * a sticker grid. Baseline days stay neutral; logged days fill green; assumed
 * days use a softer dashed green; missed and unlogged days read as faint
 * outlines so the eye lands on the markers instead.
 */
const CELL_STYLE: Record<
  string,
  { fill: string; border: string; dashed?: boolean }
> = {
  C: { fill: COLOR.primary, border: COLOR.primary },
  A: { fill: "rgba(90,110,50,0.18)", border: "rgba(90,110,50,0.55)", dashed: true },
  P: { fill: "rgba(90,110,50,0.40)", border: "rgba(90,110,50,0.40)" },
  M: { fill: "transparent", border: "rgba(44,50,47,0.22)" },
  B: { fill: "rgba(120,110,86,0.16)", border: "rgba(120,110,86,0.16)" },
  N: { fill: "transparent", border: "rgba(120,110,86,0.28)" },
  S: { fill: "transparent", border: "rgba(120,110,86,0.22)", dashed: true },
  O: { fill: "transparent", border: "transparent" },
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ payload: string }> },
): Promise<Response> {
  const { payload } = await context.params;
  const data = payload.endsWith(".png")
    ? decodeExperimentProgressCard(payload.slice(0, -".png".length))
    : null;

  if (!data) {
    return new Response("Not found.", { status: 404 });
  }

  const [fraunces400, fraunces600, dmSans400, logoSrc] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
    readFile(join(process.cwd(), "public", "logo.svg")).then(
      (buffer) => `data:image/svg+xml;base64,${buffer.toString("base64")}`,
    ),
  ]);

  const image = new ImageResponse(<Card data={data} logoSrc={logoSrc} />, {
    ...SIZE,
    fonts: [
      { name: "Fraunces", data: fraunces400, weight: 400 },
      { name: "Fraunces", data: fraunces600, weight: 600 },
      { name: "DM Sans", data: dmSans400, weight: 400 },
    ],
    headers: {
      // The snapshot is baked into the URL, so each URL renders deterministically.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });

  return await toStaticLikePngResponse(image);
}

async function toStaticLikePngResponse(image: Response): Promise<Response> {
  // Linq's media fetcher handles static image responses but silently drops the
  // streamed ImageResponse shape, so expose the generated card like a file.
  const body = await image.arrayBuffer();
  const headers = new Headers(image.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Content-Disposition", 'inline; filename="experiment-progress-card.png"');
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Type", "image/png");

  return new Response(body, {
    headers,
    status: image.status,
    statusText: image.statusText,
  });
}

function Card({ data, logoSrc }: { data: ExperimentProgressCardData; logoSrc: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: COLOR.background,
        paddingTop: 48,
        paddingBottom: 36,
        paddingLeft: 68,
        paddingRight: 68,
        fontFamily: "DM Sans",
      }}
    >
      <Header data={data} logoSrc={logoSrc} />
      <MarkersBand movers={data.movers} />
      <SessionsStrip data={data} />
    </div>
  );
}

function Header({
  data,
  logoSrc,
}: {
  data: ExperimentProgressCardData;
  logoSrc: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: titleFontSize(data.title),
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: COLOR.foreground,
          }}
        >
          {data.title}
        </div>
        <div style={{ display: "flex", fontSize: 21, color: COLOR.muted }}>
          {statusLine(data)}
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- satori render, not a DOM image */}
      <img src={logoSrc} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="murph" />
    </div>
  );
}

function MarkersBand({ movers }: { movers: ExperimentProgressCardMover[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexGrow: 1,
        gap: 22,
        marginTop: 30,
      }}
    >
      {movers.length === 0 ? (
        <EmptyMarkers />
      ) : (
        movers.map((mover) => <MarkerPanel key={mover.label} mover={mover} />)
      )}
    </div>
  );
}

function MarkerPanel({ mover }: { mover: ExperimentProgressCardMover }) {
  const sentiment = SENTIMENT_TEXT[mover.sentiment] ?? COLOR.muted;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexGrow: 1,
        flexBasis: 0,
        paddingTop: 36,
        paddingBottom: 38,
        paddingLeft: 40,
        paddingRight: 40,
        backgroundColor: COLOR.panel,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: COLOR.border,
        borderRadius: 18,
      }}
    >
      {/* Three zones spread top → bottom: marker name, the headline change, and
          where it stands now with the raw gain. */}
      <div
        style={{
          display: "flex",
          fontSize: 18,
          letterSpacing: "0.16em",
          color: COLOR.label,
        }}
      >
        {mover.label.toUpperCase()}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {mover.direction === "up" || mover.direction === "down" ? (
          <DeltaArrow direction={mover.direction} color={sentiment} />
        ) : null}
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 92,
            lineHeight: 0.9,
            letterSpacing: "-0.02em",
            color: sentiment,
          }}
        >
          {mover.changePct}
        </div>
      </div>

      <NowAndChange mover={mover} color={sentiment} />
    </div>
  );
}

/**
 * Where the marker stands now and how much it moved — the raw gain that the
 * percent headline expresses in relative terms. No baseline figure; people read
 * "now 1h 50m, up 18 min" far quicker than "from 1h 32m".
 */
function NowAndChange({
  mover,
  color,
}: {
  mover: ExperimentProgressCardMover;
  color: string;
}) {
  const now = mover.unit ? `${mover.value} ${mover.unit}` : mover.value;

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
      <div
        style={{
          display: "flex",
          fontSize: 32,
          lineHeight: 1,
          color: COLOR.foreground,
        }}
      >
        {now}
      </div>
      <div style={{ display: "flex", fontSize: 24, lineHeight: 1, color }}>
        {mover.delta}
      </div>
    </div>
  );
}

function EmptyMarkers() {
  return (
    <div
      style={{
        display: "flex",
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 40,
        paddingRight: 40,
        backgroundColor: COLOR.panel,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: COLOR.border,
        borderRadius: 18,
        fontFamily: "Fraunces",
        fontSize: 30,
        color: COLOR.muted,
      }}
    >
      Markers are still settling — keep logging.
    </div>
  );
}

function SessionsStrip({ data }: { data: ExperimentProgressCardData }) {
  const days = flattenDays(data);
  const confounderDates = new Set(data.confounders.map((entry) => entry.date));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        paddingTop: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 16,
            letterSpacing: "0.16em",
            color: COLOR.label,
          }}
        >
          SESSIONS
        </div>
        <div style={{ display: "flex", fontSize: 19, color: COLOR.muted }}>
          {sessionsLine(data)}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 5 }}>
        {days.map((day) => (
          <TimelineCell
            key={day.date}
            code={day.code}
            isToday={day.date === data.asOf}
            hasConfounder={confounderDates.has(day.date)}
          />
        ))}
      </div>

      {data.confounders.length > 0 ? (
        <ConfounderLine confounders={data.confounders} />
      ) : null}
    </div>
  );
}

function TimelineCell({
  code,
  isToday,
  hasConfounder,
}: {
  code: string;
  isToday: boolean;
  hasConfounder: boolean;
}) {
  const style = CELL_STYLE[code] ?? CELL_STYLE.O;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 30,
          height: 26,
          borderRadius: 6,
          backgroundColor: style.fill,
          borderWidth: isToday ? 2 : 1,
          borderStyle: style.dashed ? "dashed" : "solid",
          borderColor: isToday ? COLOR.foreground : style.border,
        }}
      />
      <div
        style={{
          display: "flex",
          width: 5,
          height: 5,
          borderRadius: 999,
          backgroundColor: hasConfounder ? COLOR.confounder : "transparent",
        }}
      />
    </div>
  );
}

function ConfounderLine({
  confounders,
}: {
  confounders: ExperimentProgressCardConfounder[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 20,
        rowGap: 6,
        marginTop: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 7,
          height: 7,
          borderRadius: 999,
          backgroundColor: COLOR.confounder,
          marginRight: 2,
        }}
      />
      {confounders.map((entry, index) => (
        <div
          key={`${entry.date}-${entry.label}-${index}`}
          style={{ display: "flex", fontSize: 17, color: COLOR.muted }}
        >
          {`${monthDayLabel(entry.date)} · ${entry.label}`}
        </div>
      ))}
    </div>
  );
}

function DeltaArrow({
  direction,
  color,
}: {
  direction: "up" | "down";
  color: string;
}) {
  const path =
    direction === "up"
      ? "M8 3 L13 11.5 L3 11.5 Z"
      : "M8 13 L3 4.5 L13 4.5 Z";

  return (
    <svg width="30" height="30" viewBox="0 0 16 16" style={{ display: "flex" }}>
      <path d={path} fill={color} />
    </svg>
  );
}

interface TimelineDay {
  date: string;
  code: string;
}

/** Flatten the weekly grid into one continuous run timeline. */
function flattenDays(data: ExperimentProgressCardData): TimelineDay[] {
  const firstStart = data.weeks[0]?.start;
  if (!firstStart) {
    return [];
  }

  const days: TimelineDay[] = [];
  let index = 0;
  for (const week of data.weeks) {
    for (const code of week.cells.split("")) {
      days.push({ date: addDays(firstStart, index), code });
      index += 1;
    }
  }
  return days;
}

function statusLine(data: ExperimentProgressCardData): string {
  return data.phase.totalDays
    ? `Day ${data.phase.day} of ${data.phase.totalDays}`
    : `Day ${data.phase.day}`;
}

function sessionsLine(data: ExperimentProgressCardData): string {
  const assumed = data.sessions.assumed ?? 0;
  if (data.sessions.target) {
    const base = `${data.sessions.logged} of ${data.sessions.target}`;
    return assumed > 0 ? `${base} (${assumed} assumed)` : `${base} logged`;
  }

  return assumed > 0
    ? `${data.sessions.logged} logged (${assumed} assumed)`
    : `${data.sessions.logged} logged`;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Add days to a strict YYYY-MM-DD date without timezone drift. */
function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function monthDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number);
  return `${MONTH_LABELS[month - 1]} ${day}`;
}

function titleFontSize(title: string): number {
  if (title.length > 38) {
    return 42;
  }
  if (title.length > 26) {
    return 50;
  }
  return 58;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}
