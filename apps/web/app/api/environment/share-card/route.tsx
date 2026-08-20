import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

import {
  EnvironmentShareCard,
  type EnvironmentShareCardData,
} from "@/app/(dashboard)/environment/environment-share-card";
import {
  dmSans400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "@/app/font-files";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await requireActiveHostedAppSessionFromRequest(request);
  const data = parseShareCardData(await request.json());
  const [frauncesData, dmSansData, logoData] = await Promise.all([
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
    readFile(logoSvgPath),
  ]);
  const logoDataUri = `data:image/svg+xml;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    <EnvironmentShareCard data={data} logoDataUri={logoDataUri} />,
    {
      fonts: [
        { data: frauncesData, name: "Fraunces", weight: 600 },
        { data: dmSansData, name: "DM Sans", weight: 400 },
      ],
      height: 630,
      width: 1200,
    },
  );
});

function parseShareCardData(value: unknown): EnvironmentShareCardData {
  if (!isRecord(value)) {
    throw new TypeError("Environment share data is invalid.");
  }
  const grade = value.grade;
  const score = readPercent(value.score, "score");
  const coverage = readPercent(value.coverage, "coverage");
  const known = readCount(value.known, "known");
  const total = readCount(value.total, "total");
  if (!isEnvironmentGrade(grade) || known > total) {
    throw new TypeError("Environment share data is invalid.");
  }
  return {
    coverage,
    grade,
    known,
    score,
    total,
  };
}

function readPercent(value: unknown, name: string): number {
  const result = readCount(value, name);
  if (result > 100) {
    throw new TypeError(`Environment share ${name} is invalid.`);
  }
  return result;
}

function readCount(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`Environment share ${name} is invalid.`);
  }
  return value;
}

function isEnvironmentGrade(
  value: unknown,
): value is EnvironmentShareCardData["grade"] {
  return (
    value === "A" ||
    value === "B" ||
    value === "C" ||
    value === "D" ||
    value === "E"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}
