import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import {
  CHANGELOG_CARD_VERSION,
  CHANGELOG_FEATURE_LIMIT_MAX,
  CHANGELOG_FEED_SCHEMA,
  CHANGELOG_IMPROVEMENT_LIMIT_MAX,
  buildAbsoluteChangelogUrl,
  buildChangelogItemPath,
  isChangelogDate,
  queryChangelogItems,
} from "@/src/lib/changelog";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 155;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

class ChangelogQueryError extends TypeError {}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const window = readWindow(url.searchParams);
    const featureLimit = readBoundedInteger(
      url.searchParams.get("featureLimit"),
      CHANGELOG_FEATURE_LIMIT_MAX,
      0,
      CHANGELOG_FEATURE_LIMIT_MAX,
      "featureLimit",
    );
    const improvementLimit = readBoundedInteger(
      url.searchParams.get("improvementLimit"),
      CHANGELOG_IMPROVEMENT_LIMIT_MAX,
      0,
      CHANGELOG_IMPROVEMENT_LIMIT_MAX,
      "improvementLimit",
    );
    const origin = (
      resolveHostedPublicBaseUrl(process.env) ?? MURPH_PRODUCT_ORIGIN
    ).replace(/\/+$/u, "");
    const items = queryChangelogItems({
      featureLimit,
      from: window.from,
      improvementLimit,
      to: window.to,
    });

    return Response.json(
      {
        schema: CHANGELOG_FEED_SCHEMA,
        window,
        items: items.map((item) => ({
          ...item,
          url: buildAbsoluteChangelogUrl(buildChangelogItemPath(item.id), origin),
        })),
        links: {
          digestCardTemplate:
            `${origin}/changelog/card/${CHANGELOG_CARD_VERSION}/{ids}.png`,
          fullChangelog: `${origin}/changelog`,
        },
      },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
        },
      },
    );
  } catch (error) {
    if (error instanceof ChangelogQueryError || error instanceof TypeError) {
      return Response.json(
        {
          error: {
            code: "INVALID_CHANGELOG_QUERY",
            message: error.message,
          },
        },
        {
          headers: { "Cache-Control": "no-store" },
          status: 400,
        },
      );
    }
    throw error;
  }
}

function readWindow(searchParams: URLSearchParams): { from: string; to: string } {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if ((from === null) !== (to === null)) {
    throw new ChangelogQueryError("from and to must be supplied together.");
  }
  if (from !== null && to !== null) {
    if (!isChangelogDate(from) || !isChangelogDate(to) || from >= to) {
      throw new ChangelogQueryError(
        "from and to must be strict YYYY-MM-DD dates with from before to.",
      );
    }
    return { from, to };
  }

  const days = readBoundedInteger(
    searchParams.get("days"),
    DEFAULT_DAYS,
    1,
    MAX_DAYS,
    "days",
  );
  const today = toUtcDateKey(new Date());
  const exclusiveTo = addUtcDays(today, 1);
  return {
    from: addUtcDays(exclusiveTo, -days),
    to: exclusiveTo,
  };
}

function readBoundedInteger(
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (raw === null) {
    return fallback;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new ChangelogQueryError(`${label} must be an integer.`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) {
    throw new ChangelogQueryError(
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toUtcDateKey(date);
}
