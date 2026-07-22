import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "../font-files";
import {
  deriveCategoryNote,
  overallGrade,
} from "../(dashboard)/environment/category-notes";
import {
  MOCK_HABITAT_VALUES,
  resolveHabitatScene,
} from "../(dashboard)/environment/home-model";

export const alt = "My environment grade — Murph";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2d3436";
const GREEN = "#5a6e32";
const MUTED = "#736a58";
const BADGE_BG = "#e4e6d5";

const GRADE_VERDICTS: Record<string, string> = {
  A: "DREAM HABITAT",
  B: "SOLID SETUP",
  C: "GETTING THERE",
  D: "NEEDS SOME LOVE",
  E: "NEEDS SOME LOVE",
};

const publicDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
);

async function svgDataUri(path: string): Promise<string> {
  const buffer = await readFile(path);
  return `data:image/svg+xml;base64,${buffer.toString("base64")}`;
}

export default async function OGImage() {
  const scene = resolveHabitatScene(MOCK_HABITAT_VALUES);
  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, MOCK_HABITAT_VALUES),
  );
  const grade = overallGrade(notes);

  const [fraunces400Data, fraunces600Data, dmSans400Data, logoDataUri, icons] =
    await Promise.all([
      readFile(fraunces400FontPath).then(toArrayBuffer),
      readFile(fraunces600FontPath).then(toArrayBuffer),
      readFile(dmSans400FontPath).then(toArrayBuffer),
      svgDataUri(logoSvgPath),
      Promise.all(
        scene.categories.map(async (category) => ({
          id: category.id,
          src: await svgDataUri(join(publicDir, category.thumbnail.src)),
        })),
      ),
    ]);
  const iconById = new Map(icons.map((icon) => [icon.id, icon.src]));

  return new ImageResponse(
    (
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
                    backgroundColor: "rgba(160, 122, 78, 0.28)",
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "radial-gradient(circle at 35% 45%, rgba(245, 240, 232, 0.92) 0%, rgba(245, 240, 232, 0.6) 40%, rgba(245, 240, 232, 0) 70%)",
          }}
        />

        <img
          src={logoDataUri}
          alt=""
          width={152}
          height={34}
          style={{ position: "absolute", top: 56, left: 72, display: "flex" }}
        />

        <div
          style={{
            position: "absolute",
            top: 128,
            left: 72,
            width: 700,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontFamily: "Fraunces",
              fontWeight: 400,
              fontSize: 54,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: "#1f2422",
            }}
          >
            My environment, graded.
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: "DM Sans",
              fontSize: 21,
              color: MUTED,
            }}
          >
            How healthy is the place I live, work, and sleep? Murph checked.
          </div>
          <div
            style={{
              marginTop: 32,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              width: 430,
            }}
          >
            {notes.map((note) => (
              <div
                key={note.id}
                style={{ display: "flex", alignItems: "center", gap: 16 }}
              >
                <img
                  src={iconById.get(note.id)}
                  alt=""
                  width={44}
                  height={44}
                  style={{ display: "flex", objectFit: "contain" }}
                />
                <div
                  style={{
                    flexGrow: 1,
                    fontFamily: "DM Sans",
                    fontSize: 20,
                    color: INK,
                  }}
                >
                  {note.title}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: BADGE_BG,
                    fontFamily: "Fraunces",
                    fontWeight: 600,
                    fontSize: 19,
                    color: GREEN,
                  }}
                >
                  {note.grade.letter ?? "–"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 104,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 240,
              height: 240,
              borderRadius: 56,
              backgroundColor: BADGE_BG,
              boxShadow: "0 24px 60px -24px rgba(70, 75, 36, 0.45)",
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 164,
              letterSpacing: "-0.04em",
              color: GREEN,
            }}
          >
            {grade.letter ?? "–"}
          </div>
          {grade.pct === null ? null : (
            <div
              style={{
                marginTop: 20,
                fontFamily: "Fraunces",
                fontWeight: 600,
                fontSize: 44,
                letterSpacing: "-0.02em",
                color: INK,
              }}
            >
              {`${grade.pct}%`}
            </div>
          )}
          <div
            style={{
              marginTop: 4,
              fontFamily: "DM Sans",
              fontSize: 16,
              letterSpacing: "0.14em",
              color: MUTED,
            }}
          >
            {GRADE_VERDICTS[grade.letter ?? ""] ?? "NOT GRADED YET"}
          </div>
        </div>

        {/* Viewer hook — the viral loop */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 10,
            fontFamily: "DM Sans",
            fontSize: 19,
          }}
        >
          <div style={{ color: INK }}>What would yours score?</div>
          <div style={{ color: GREEN }}>withmurph.ai</div>
        </div>

      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: fraunces400Data, weight: 400 },
        { name: "Fraunces", data: fraunces600Data, weight: 600 },
        { name: "DM Sans", data: dmSans400Data, weight: 400 },
      ],
    },
  );
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}
