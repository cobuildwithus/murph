import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import {
  IMESSAGE_NUTRITION_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
  IMESSAGE_NUTRITION_CARD_IMAGE_PATH_SUFFIX,
  dailyNutritionResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  type DailyNutritionResponseCard,
} from "@murphai/contracts";
import { ImageResponse } from "next/og";

import {
  dmSans400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "../../../../font-files";
import {
  IMESSAGE_NUTRITION_CARD_IMAGE_SIZE,
  NutritionCardImage,
} from "@/src/components/imessage/nutrition-card-image";

export const dynamic = "force-dynamic";

const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PRIVATE_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Disposition": 'inline; filename="murph-nutrition-card.png"',
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
  const card = parseNutritionCardPayload(segment);
  if (card === null) {
    return invalidPayloadResponse();
  }

  const [fraunces600, dmSans400, logoDataUri] = await Promise.all([
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
    readFile(logoSvgPath).then(
      (buffer) => `data:image/svg+xml;base64,${buffer.toString("base64")}`,
    ),
  ]);

  return new ImageResponse(
    <NutritionCardImage card={card} logoDataUri={logoDataUri} />,
    {
      ...IMESSAGE_NUTRITION_CARD_IMAGE_SIZE,
      fonts: [
        { name: "Fraunces", data: fraunces600, weight: 600 },
        { name: "DM Sans", data: dmSans400, weight: 400 },
      ],
      headers: PRIVATE_IMAGE_HEADERS,
    },
  );
}

export function parseNutritionCardPayload(
  segment: string,
): DailyNutritionResponseCard | null {
  if (!segment.endsWith(IMESSAGE_NUTRITION_CARD_IMAGE_PATH_SUFFIX)) {
    return null;
  }
  const encoded = segment.slice(
    0,
    -IMESSAGE_NUTRITION_CARD_IMAGE_PATH_SUFFIX.length,
  );
  if (
    encoded.length === 0
    || encoded.length > IMESSAGE_NUTRITION_CARD_IMAGE_PAYLOAD_MAX_LENGTH
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
  return null;
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
  return new Response("Nutrition card image not found.", {
    headers: PRIVATE_IMAGE_HEADERS,
    status: 404,
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}
