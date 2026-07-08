import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { dmSans400FontPath, fraunces600FontPath } from "../font-files";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600 };

/**
 * Loads the shared assets every Murph hero OG image needs: the Fraunces 600 +
 * DM Sans 400 fonts and the canonical hero photo as a data URI. Kept in one
 * place so route-level opengraph-image files stay thin.
 */
export async function loadMurphHeroOgAssets(): Promise<{
  fonts: OgFont[];
  heroDataUri: string;
}> {
  const [heroDataUri, fraunces600Data, dmSans400Data] = await Promise.all([
    readFile(join(process.cwd(), "public", "hero.jpg")).then(
      (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`
    ),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);

  return {
    heroDataUri,
    fonts: [
      { name: "Fraunces", data: fraunces600Data, weight: 600 },
      { name: "DM Sans", data: dmSans400Data, weight: 400 },
    ],
  };
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}

/**
 * The shared 1200x630 hero frame: warm hero photo, dark gradient for legibility,
 * and a bottom bar with a mono eyebrow, Fraunces headline, DM Sans subtext, and
 * the dot-grid murph lockup. Used by every shareable Murph surface so previews
 * read as one system (see DESIGN.md).
 */
export function MurphHeroOg(props: {
  heroDataUri: string;
  eyebrow: string;
  headline: string;
  subtext: string;
  /** Lower this for long dynamic headlines (experiment/biomarker titles). */
  headlineFontSize?: number;
}) {
  const headlineFontSize = props.headlineFontSize ?? 82;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: "#D9C39B",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og (Satori) renders raw <img>; next/image is unsupported here */}
      <img
        src={props.heroDataUri}
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(180deg, rgba(26,31,22,0.15) 0%, rgba(26,31,22,0.60) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 48,
          right: 48,
          bottom: 44,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 820,
          }}
        >
          <div
            style={{
              fontFamily: "DM Sans",
              fontWeight: 400,
              fontSize: 20,
              lineHeight: 1,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#DCC199",
            }}
          >
            {props.eyebrow}
          </div>
          <div
            style={{
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: headlineFontSize,
              lineHeight: 0.98,
              letterSpacing: "-0.04em",
              color: "#FAF8F4",
              whiteSpace: "pre-wrap",
            }}
          >
            {props.headline}
          </div>
          <div
            style={{
              fontFamily: "DM Sans",
              fontWeight: 400,
              fontSize: 26,
              lineHeight: 1.4,
              color: "rgba(250,248,244,0.85)",
              maxWidth: 660,
            }}
          >
            {props.subtext}
          </div>
        </div>

        <MurphLockup />
      </div>
    </div>
  );
}

function MurphLockup() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <DotGrid />
      <div
        style={{
          fontFamily: "Fraunces",
          fontWeight: 600,
          fontSize: 48,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: "#FAF8F4",
        }}
      >
        murph
      </div>
    </div>
  );
}

function DotGrid() {
  const rows = [
    { sizes: [4, 4, 5, 5, 4, 4] },
    { sizes: [4, 4, 7, 7, 4, 4] },
    { sizes: [4, 5, 8, 9, 5, 4] },
    { sizes: [4, 4, 5, 5, 4, 4] },
  ];

  const dotColor = (size: number) => {
    if (size <= 4) return { bg: "#5C6B4F", opacity: 0.35 };
    if (size <= 5) return { bg: "#C4956A", opacity: 0.55 };
    if (size <= 7) return { bg: "#A07A4E", opacity: 1 };
    return { bg: "#C4956A", opacity: 1 };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {row.sizes.map((s, ci) => {
            const c = dotColor(s);
            return (
              <div
                key={ci}
                style={{
                  width: s,
                  height: s,
                  borderRadius: "50%",
                  backgroundColor: c.bg,
                  opacity: c.opacity,
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
