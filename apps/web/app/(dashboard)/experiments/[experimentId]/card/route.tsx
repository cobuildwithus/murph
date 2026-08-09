import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "../../../../font-files";
import {
  EXPERIMENT_CARD_MAX_SIGNALS,
  parseExperimentCardData,
  type ExperimentCardChart,
  type ExperimentCardData,
  type ExperimentCardSignal,
} from "@/src/lib/experiments/share-card";
import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedOnboardingMutationOrigin,
} from "@/src/lib/hosted-onboarding/csrf";
import {
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 780 };
const MAX_CARD_REQUEST_BYTES = 64 * 1024;
const CONTENT_WIDTH = SIZE.width - 128;
const LOGO_HEIGHT = 52;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 197) / 44); // logo.svg viewBox is 197×44

const COLOR = {
  background: "#F4EEE1",
  panel: "rgba(255,252,246,0.72)",
  border: "rgba(120,110,86,0.20)",
  foreground: "#2D3436",
  muted: "#827C6C",
  faint: "rgba(45,52,54,0.42)",
  primary: "#5A6E32",
  baseline: "#B6A582",
  labelMuted: "rgba(45,52,54,0.5)",
};

const SENTIMENT_STYLE: Record<string, { text: string; chip: string }> = {
  positive: { text: "#506B2C", chip: "rgba(90,110,50,0.14)" },
  negative: { text: "#B0651F", chip: "rgba(176,101,31,0.15)" },
  neutral: { text: "#827C6C", chip: "rgba(130,124,108,0.14)" },
};

export async function GET(): Promise<Response> {
  return new Response("URL-encoded experiment cards are no longer available.", {
    headers: { "Cache-Control": "private, no-store" },
    status: 410,
  });
}

export const POST = withJsonError(async (request: Request): Promise<Response> => {
  assertHostedOnboardingMutationOrigin(request);
  await requireActiveHostedAppSessionFromRequest(request);
  const data = parseExperimentCardData(
    await readHostedOnboardingJsonObject(request, {
      limitBytes: MAX_CARD_REQUEST_BYTES,
      tooLargeErrorCode: "EXPERIMENT_CARD_BODY_TOO_LARGE",
      tooLargeErrorMessage: "Card data is too large.",
    }),
  );
  if (!data) {
    return invalidCardResponse(400);
  }

  const [fraunces400, fraunces600, dmSans400, logoSrc] = await Promise.all([
    readFile(fraunces400FontPath).then(toArrayBuffer),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
    readFile(logoSvgPath).then(
      (buffer) => `data:image/svg+xml;base64,${buffer.toString("base64")}`,
    ),
  ]);

  return new ImageResponse(<Card data={data} logoSrc={logoSrc} />, {
    ...SIZE,
    fonts: [
      { name: "Fraunces", data: fraunces400, weight: 400 },
      { name: "Fraunces", data: fraunces600, weight: 600 },
      { name: "DM Sans", data: dmSans400, weight: 400 },
    ],
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
});

function invalidCardResponse(status: 400): Response {
  return new Response("Invalid or missing card data.", {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

function Card({ data, logoSrc }: { data: ExperimentCardData; logoSrc: string }) {
  const signals = data.signals.slice(0, EXPERIMENT_CARD_MAX_SIGNALS);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: COLOR.background,
        paddingTop: 52,
        paddingBottom: 52,
        paddingLeft: 64,
        paddingRight: 64,
        fontFamily: "DM Sans",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              backgroundColor: COLOR.primary,
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 21,
              letterSpacing: "0.22em",
              color: COLOR.muted,
            }}
          >
            YOUR EXPERIMENT
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: titleFontSize(data.title),
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: COLOR.foreground,
          }}
        >
          {data.title}
        </div>
        {data.protocol ? (
          <div style={{ display: "flex", fontSize: 25, color: COLOR.muted }}>
            {data.protocol}
          </div>
        ) : null}
      </div>

      {/* Metric tiles */}
      {signals.length > 0 ? (
        <div style={{ display: "flex", gap: 18 }}>
          {signals.map((signal) => (
            <MetricTile key={signal.label} signal={signal} />
          ))}
        </div>
      ) : null}

      {/* Primary marker chart */}
      {data.chart ? <ChartBlock chart={data.chart} /> : null}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTopWidth: 1,
          borderTopStyle: "solid",
          borderTopColor: COLOR.border,
          marginTop: 28,
          paddingTop: 32,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori render, not a DOM image */}
        <img src={logoSrc} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="murph" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", fontSize: 22, color: COLOR.faint }}>
            Health experiments with friends.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              color: COLOR.primary,
              letterSpacing: "0.01em",
            }}
          >
            withmurph.ai
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ signal }: { signal: ExperimentCardSignal }) {
  const sentiment = resolveSentimentStyle(signal);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        gap: 14,
        paddingTop: 26,
        paddingBottom: 26,
        paddingLeft: 30,
        paddingRight: 30,
        backgroundColor: COLOR.panel,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: COLOR.border,
        borderRadius: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 17,
          letterSpacing: "0.13em",
          color: COLOR.labelMuted,
        }}
      >
        {signal.label.toUpperCase()}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 56,
            lineHeight: 1,
            color: COLOR.foreground,
          }}
        >
          {signal.value}
        </div>
        {signal.unit ? (
          <div style={{ display: "flex", fontSize: 23, color: COLOR.muted }}>
            {signal.unit}
          </div>
        ) : null}
      </div>
      {signal.delta ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: 8,
            paddingTop: 7,
            paddingBottom: 7,
            paddingLeft: 13,
            paddingRight: 14,
            borderRadius: 999,
            backgroundColor: sentiment.chip,
          }}
        >
          {signal.direction === "up" || signal.direction === "down" ? (
            <DeltaArrow direction={signal.direction} color={sentiment.text} />
          ) : null}
          <div style={{ display: "flex", fontSize: 22, color: sentiment.text }}>
            {signal.delta}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChartBlock({ chart }: { chart: ExperimentCardChart }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            fontSize: 17,
            letterSpacing: "0.13em",
            color: COLOR.labelMuted,
          }}
        >
          {chart.label.toUpperCase()}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {chart.baselineCount > 0 ? (
            <LegendItem color={COLOR.baseline} label="Baseline" />
          ) : null}
          <LegendItem color={COLOR.primary} label="Protocol" />
        </div>
      </div>
      <ResultChart chart={chart} />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 11,
          height: 11,
          borderRadius: 999,
          backgroundColor: color,
        }}
      />
      <div style={{ display: "flex", fontSize: 18, color: COLOR.muted }}>
        {label}
      </div>
    </div>
  );
}

function ResultChart({ chart }: { chart: ExperimentCardChart }) {
  const width = CONTENT_WIDTH;
  const height = 162;
  const padX = 7;
  const padTop = 16;
  const padBottom = 14;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padTop - padBottom;
  const bottom = padTop + innerHeight;

  const { values } = chart;
  const count = values.length;
  const scaleValues =
    chart.baselineAvg !== undefined ? [...values, chart.baselineAvg] : values;
  let min = Math.min(...scaleValues);
  let max = Math.max(...scaleValues);
  if (max - min < 0.001) {
    max += 1;
    min -= 1;
  }
  const headroom = (max - min) * 0.16;
  min -= headroom;
  max += headroom;

  const xAt = (index: number) =>
    padX + (count <= 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth);
  const yAt = (value: number) =>
    padTop + (1 - (value - min) / (max - min)) * innerHeight;

  const points = values.map((value, index) => ({
    x: round(xAt(index)),
    y: round(yAt(value)),
  }));
  const last = points[count - 1];
  const boundary = Math.min(Math.max(chart.baselineCount, 0), count);

  // One smooth Catmull-Rom spline shared by the area fill and both line
  // colours, so the baseline → protocol handoff stays seamless.
  const segments = buildSmoothSegments(points);
  const areaPath = `M ${points[0].x} ${bottom} L ${points[0].x} ${points[0].y} ${segments.join(
    " ",
  )} L ${last.x} ${bottom} Z`;

  const baselineSegments = Math.max(0, boundary - 1);
  const baselineLinePath =
    baselineSegments >= 1
      ? `M ${points[0].x} ${points[0].y} ${segments.slice(0, baselineSegments).join(" ")}`
      : null;

  const activeStart = Math.max(0, boundary - 1);
  const activeLinePath =
    activeStart <= count - 2
      ? `M ${points[activeStart].x} ${points[activeStart].y} ${segments
          .slice(activeStart)
          .join(" ")}`
      : null;

  const dividerX =
    boundary > 0 && boundary < count ? round(xAt(boundary - 0.5)) : null;
  const baselineY =
    chart.baselineAvg !== undefined ? round(yAt(chart.baselineAvg)) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "flex" }}
    >
      <path d={areaPath} fill="rgba(90,110,50,0.11)" />
      {baselineY !== null ? (
        <path
          d={`M ${padX} ${baselineY} L ${padX + innerWidth} ${baselineY}`}
          stroke="rgba(45,52,54,0.26)"
          strokeWidth={1.5}
          strokeDasharray="2 5"
          fill="none"
        />
      ) : null}
      {dividerX !== null ? (
        <path
          d={`M ${dividerX} ${padTop - 6} L ${dividerX} ${bottom}`}
          stroke="rgba(45,52,54,0.2)"
          strokeWidth={1.5}
          strokeDasharray="3 4"
          fill="none"
        />
      ) : null}
      {baselineLinePath ? (
        <path
          d={baselineLinePath}
          stroke={COLOR.baseline}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      {activeLinePath ? (
        <path
          d={activeLinePath}
          stroke={COLOR.primary}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      <circle
        cx={last.x}
        cy={last.y}
        r={6}
        fill={COLOR.primary}
        stroke={COLOR.background}
        strokeWidth={3}
      />
    </svg>
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
      ? "M8 2.5 L13.5 12 L2.5 12 Z"
      : "M8 13.5 L2.5 4 L13.5 4 Z";

  return (
    <svg width="15" height="15" viewBox="0 0 16 16" style={{ display: "flex" }}>
      <path d={path} fill={color} />
    </svg>
  );
}

// Catmull-Rom spline expressed as cubic Bézier segments — one `C` per point
// pair — giving the line a smoothly rounded shape instead of sharp corners.
function buildSmoothSegments(points: { x: number; y: number }[]): string[] {
  const segments: string[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? points[index + 1];
    const cp1x = round(p1.x + (p2.x - p0.x) / 6);
    const cp1y = round(p1.y + (p2.y - p0.y) / 6);
    const cp2x = round(p2.x - (p3.x - p1.x) / 6);
    const cp2y = round(p2.y - (p3.y - p1.y) / 6);
    segments.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
  }
  return segments;
}

function resolveSentimentStyle(signal: ExperimentCardSignal) {
  if (signal.sentiment) {
    return SENTIMENT_STYLE[signal.sentiment];
  }
  if (signal.direction === "up") {
    return SENTIMENT_STYLE.positive;
  }
  if (signal.direction === "down") {
    return SENTIMENT_STYLE.negative;
  }
  return SENTIMENT_STYLE.neutral;
}

function titleFontSize(title: string): number {
  if (title.length > 30) {
    return 52;
  }
  if (title.length > 22) {
    return 62;
  }
  if (title.length > 15) {
    return 72;
  }
  return 76;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}
