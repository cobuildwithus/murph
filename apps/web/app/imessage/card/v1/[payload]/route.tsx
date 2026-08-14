import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import {
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
  IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX,
  dailyNutritionResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  challengeStandingsResponseCardV1Schema,
  parseCompactTableAppCardEnvelope,
  type ChallengeStandingsResponseCardV1,
  type CompactTablePresentationCardV1,
  type DailyNutritionResponseCard,
} from "@murphai/contracts";
import { ImageResponse } from "next/og";

import {
  dmSans400FontPath,
  dmSans600FontPath,
  murphMarkSvgPath,
} from "../../../../font-files";
import {
  IMESSAGE_NUTRITION_CARD_IMAGE_SIZE,
  NutritionCardImage,
} from "@/src/components/imessage/nutrition-card-image";
import {
  CompactTableCardImage,
  getCompactTableCardImageSize,
} from "@/src/components/imessage/compact-table-card-image";
import {
  ChallengeStandingsCardImage,
  getChallengeStandingsCardImageSize,
} from "@/src/components/imessage/challenge-standings-card-image";

export const dynamic = "force-dynamic";

const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PRIVATE_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Disposition": 'inline; filename="murph-response-card.png"',
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

type ImageRouteContext = {
  params: Promise<{ payload: string }>;
};

export async function GET(
  request: Request,
  context: ImageRouteContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.search !== "") {
    return invalidPayloadResponse();
  }

  const { payload: segment } = await context.params;
  const card = parseResponseCardPayload(segment);
  if (card === null) {
    return invalidPayloadResponse();
  }

  const [dmSans400, dmSans600, murphMarkSvg] = await Promise.all([
    readFile(dmSans400FontPath).then(toArrayBuffer),
    readFile(dmSans600FontPath).then(toArrayBuffer),
    readFile(murphMarkSvgPath),
  ]);
  const logoSrc = `data:image/svg+xml;base64,${murphMarkSvg.toString("base64")}`;
  const size = card.kind === "daily_nutrition"
    ? IMESSAGE_NUTRITION_CARD_IMAGE_SIZE
    : card.kind === "compact_table"
      ? getCompactTableCardImageSize(card)
      : getChallengeStandingsCardImageSize(card);

  return new ImageResponse(
    card.kind === "daily_nutrition"
      ? <NutritionCardImage card={card} logoSrc={logoSrc} />
      : card.kind === "compact_table"
        ? <CompactTableCardImage card={card} logoSrc={logoSrc} />
        : <ChallengeStandingsCardImage card={card} logoSrc={logoSrc} />,
    {
      ...size,
      fonts: [
        { name: "DM Sans", data: dmSans400, weight: 400 },
        { name: "DM Sans", data: dmSans600, weight: 600 },
      ],
      headers: PRIVATE_IMAGE_HEADERS,
    },
  );
}

function parseResponseCardPayload(
  segment: string,
):
  | DailyNutritionResponseCard
  | CompactTablePresentationCardV1
  | ChallengeStandingsResponseCardV1
  | null {
  if (!segment.endsWith(IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX)) {
    return null;
  }
  const encoded = segment.slice(
    0,
    -IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX.length,
  );
  if (
    encoded.length === 0
    || encoded.length > IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH
    || !PAYLOAD_PATTERN.test(encoded)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) {
      return null;
    }
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }
  if (!isExactEnvelope(parsed)) {
    return null;
  }
  if (parsed.schemaVersion === 1) {
    const result = dailyNutritionResponseCardV1Schema.safeParse(parsed.card);
    return result.success ? result.data : null;
  }
  if (parsed.schemaVersion === 2) {
    const result = dailyNutritionResponseCardV2Schema.safeParse(parsed.card);
    return result.success ? result.data : null;
  }
  if (parsed.schemaVersion === 5) {
    const result = challengeStandingsResponseCardV1Schema.safeParse(parsed.card);
    return result.success ? result.data : null;
  }
  return parseCompactTableAppCardEnvelope(parsed);
}

function isExactEnvelope(
  value: unknown,
): value is { schemaVersion: unknown; card: unknown } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "schemaVersion")
    && Object.hasOwn(value, "card");
}

function invalidPayloadResponse(): Response {
  return new Response("Response card image not found.", {
    headers: PRIVATE_IMAGE_HEADERS,
    status: 404,
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}
