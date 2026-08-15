// Palette shared with the default homepage OG image (app/opengraph-image.tsx)
// so every Murph share card reads as one system.
const INK = "#1f2422";
const GREEN = "#5a6e32";
const MUTED = "#736a58";

/**
 * The shared 1200x630 Murph share frame: warm cream backdrop with the dot-grid
 * texture, the murph lockup top-left, a green eyebrow, a Fraunces headline, and
 * a DM Sans subtext, balanced by an oversized brand mark on the right. Matches
 * the default homepage OG image so every shareable surface reads as one system
 * (see DESIGN.md).
 *
 * Pure inline-style JSX with no node imports so it renders identically under
 * satori (the opengraph-image routes) and in the DOM (the /design catalog
 * share-preview studies). Asset loading lives in ./og-shared.
 */
export function MurphHeroOg(props: {
  logoDataUri: string;
  /** Omit for the quietest frame: headline and subtext only. */
  eyebrow?: string;
  headline: string;
  subtext: string;
  /** Lower this for long dynamic headlines (experiment/biomarker titles). */
  headlineFontSize?: number;
}) {
  const headlineFontSize = props.headlineFontSize ?? 78;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 90% 0%, #e7ddc8 0%, #f0e9db 40%, #f5f0e8 70%)",
      }}
    >
      <DotTexture />
      {/* Light wash keeping the left-side text crisp over the texture */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 28% 45%, rgba(245, 240, 232, 0.92) 0%, rgba(245, 240, 232, 0.55) 40%, rgba(245, 240, 232, 0) 70%)",
        }}
      />
      {/* Warm corner tone, bottom-left */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 5% 100%, rgba(224, 210, 183, 0.6) 0%, rgba(224, 210, 183, 0) 45%)",
        }}
      />

      {/* Oversized brand mark balancing the right side */}
      <BrandMark />

      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og (Satori) renders raw <img>; next/image is unsupported here */}
      <img
        src={props.logoDataUri}
        alt=""
        width={152}
        height={34}
        style={{ position: "absolute", top: 64, left: 72, display: "flex" }}
      />

      {/* Eyebrow + headline + subtext */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 72,
          width: 620,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {props.eyebrow ? (
          <div
            style={{
              fontFamily: "DM Sans",
              fontWeight: 400,
              fontSize: 20,
              lineHeight: 1,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: GREEN,
            }}
          >
            {props.eyebrow}
          </div>
        ) : null}
        <div
          style={{
            marginTop: props.eyebrow ? 22 : 0,
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: headlineFontSize,
            lineHeight: 1.0,
            letterSpacing: "-0.035em",
            color: INK,
            whiteSpace: "pre-wrap",
          }}
        >
          {props.headline}
        </div>
        <div
          style={{
            marginTop: 26,
            maxWidth: 540,
            fontFamily: "DM Sans",
            fontSize: 24,
            lineHeight: 1.45,
            color: MUTED,
          }}
        >
          {props.subtext}
        </div>
      </div>
    </div>
  );
}

/** Full-bleed dot-grid echoing the logo motif, quieted behind the content. */
function DotTexture() {
  return (
    <div
      style={{
        position: "absolute",
        top: -8,
        left: -8,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {Array.from({ length: 24 }, (_, rowIndex) => (
        <div key={rowIndex} style={{ display: "flex", gap: 24 }}>
          {Array.from({ length: 44 }, (_, colIndex) => (
            <div
              key={colIndex}
              style={{
                width: 3.5,
                height: 3.5,
                borderRadius: "50%",
                backgroundColor: "rgba(160, 122, 78, 0.32)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Oversized murph dot-glyph, anchoring the right side in place of the phone. */
function BrandMark() {
  const rows = [
    [4, 4, 5, 5, 4, 4],
    [4, 4, 7, 7, 4, 4],
    [4, 5, 8, 9, 5, 4],
    [4, 4, 5, 5, 4, 4],
  ];
  const scale = 6;
  const gap = 26;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 132,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap,
        opacity: 0.85,
      }}
    >
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          style={{ display: "flex", alignItems: "center", gap }}
        >
          {row.map((dotSize, colIndex) => {
            const color = dotColor(dotSize);
            return (
              <div
                key={colIndex}
                style={{
                  display: "flex",
                  width: dotSize * scale,
                  height: dotSize * scale,
                  borderRadius: "50%",
                  backgroundColor: color.bg,
                  opacity: color.opacity,
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

function dotColor(size: number): { bg: string; opacity: number } {
  if (size <= 4) return { bg: "#5C6B4F", opacity: 0.22 };
  if (size <= 5) return { bg: "#C4956A", opacity: 0.34 };
  if (size <= 7) return { bg: "#A07A4E", opacity: 0.5 };
  return { bg: "#C4956A", opacity: 0.6 };
}
