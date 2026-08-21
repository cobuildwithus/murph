import type { BeforeSendEvent as VercelAnalyticsBeforeSendEvent } from "@vercel/analytics/next";

export const VERCEL_TELEMETRY_PATHNAMES = [
  "/",
  "/about",
  "/biomarkers",
  "/changelog",
  "/clubs",
  "/connect",
  "/consumer-health-data-privacy-policy",
  "/contact",
  "/design",
  "/device-sync/connect/complete",
  "/environment",
  "/environment/print",
  "/experiments",
  "/family/setup",
  "/farewell",
  "/groups/start",
  "/growth",
  "/history",
  "/home",
  "/join",
  "/knowledge",
  "/labs",
  "/legal",
  "/legal/consumer-health-data-privacy-policy",
  "/legal/health-ai-safety-disclosure",
  "/legal/privacy",
  "/legal/terms",
  "/ops",
  "/ops/email",
  "/ops/growth",
  "/ops/runtime-latency",
  "/ops/runtime-maintenance",
  "/ops/usage",
  "/overview",
  "/patterns",
  "/pitch",
  "/records",
  "/records/connect",
  "/refer",
  "/search",
  "/security",
  "/settings",
  "/settings/data-privacy",
  "/subprocessors",
  "/training",
] as const;
const VERCEL_TELEMETRY_PATHNAME_SET = new Set<string>(
  VERCEL_TELEMETRY_PATHNAMES,
);
const PUBLIC_PATH_SEGMENT_PATTERN = String.raw`[a-z0-9][a-z0-9._~-]*`;
const VERCEL_TELEMETRY_DYNAMIC_PATHNAME_RULES = [
  {
    pattern: new RegExp(
      `^/biomarkers/(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[biomarkerId\\])$`,
      "iu",
    ),
    pathname: "/biomarkers/[biomarker]",
  },
  {
    pattern: new RegExp(
      `^/biomarkers/(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[biomarkerId\\])/research$`,
      "iu",
    ),
    pathname: "/biomarkers/[biomarker]/research",
  },
  {
    pattern: new RegExp(
      `^/biomarkers/results/(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[metricKey\\])$`,
      "iu",
    ),
    pathname: "/biomarkers/results/[metric]",
  },
  {
    pattern: new RegExp(
      `^/experiments/(?!runs(?:/|$))(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[experimentId\\])$`,
      "iu",
    ),
    pathname: "/experiments/[experiment]",
  },
  {
    pattern: new RegExp(
      `^/experiments/(?!runs(?:/|$))(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[experimentId\\])/research$`,
      "iu",
    ),
    pathname: "/experiments/[experiment]/research",
  },
  {
    pattern: new RegExp(
      `^/experiments/(?!runs(?:/|$))(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[experimentId\\])/results$`,
      "iu",
    ),
    pathname: "/experiments/[experiment]/results",
  },
  {
    pattern: new RegExp(
      `^/measurement-methods/(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[measurementMethodId\\])$`,
      "iu",
    ),
    pathname: "/measurement-methods/[method]",
  },
  {
    pattern: new RegExp(
      `^/search/products/(?:${PUBLIC_PATH_SEGMENT_PATTERN}|\\[productRef\\])$`,
      "iu",
    ),
    pathname: "/search/products/[product]",
  },
] as const;
const PRIVATE_COMPUTER_HANDOFF_PATH_PREFIXES = [
  {
    prefix: "/computer/handoff/",
    redactedPrefix: "/computer/handoff/[token]",
  },
  {
    prefix: "/api/computer/handoff/",
    redactedPrefix: "/api/computer/handoff/[token]",
  },
] as const;
const CLINICAL_RECORDS_CALLBACK_PATH = "/records";
const CLINICAL_RECORDS_CALLBACK_QUERY_KEY = "clinicalRecords";
const CLINICAL_RECORDS_CONNECT_PATH = "/records/connect";
const CLINICAL_RECORDS_CONNECT_FRAGMENT_KEY = "clinicalRecordsIntent";
const DEVICE_SYNC_CALLBACK_PATH_PATTERN =
  /^\/api\/device-sync\/(?:connect|oauth)\/[^/]+\/callback\/?$/u;
const URL_PARSE_BASE = "https://murph.invalid";

export type VercelSpeedInsightsBeforeSendEvent = {
  route?: string;
  type: "vital";
  url: string;
};

export function redactVercelAnalyticsEvent(
  event: VercelAnalyticsBeforeSendEvent,
): VercelAnalyticsBeforeSendEvent | null {
  if (shouldSuppressVercelTelemetryUrl(event.url)) {
    return null;
  }

  return redactEventUrl(event);
}

export function redactVercelSpeedInsightsEvent(
  event: VercelSpeedInsightsBeforeSendEvent,
): VercelSpeedInsightsBeforeSendEvent | null {
  if (
    shouldSuppressVercelTelemetryUrl(event.url)
    || (
      typeof event.route === "string"
      && shouldSuppressVercelTelemetryUrl(event.route)
    )
  ) {
    return null;
  }

  const redactedUrl = redactPrivateAnalyticsUrl(event.url);
  const redactedRoute = typeof event.route === "string"
    ? redactPrivateAnalyticsUrl(event.route)
    : event.route;

  if (
    typeof redactedRoute === "string"
    && readUrlPathname(redactedRoute) !== readUrlPathname(redactedUrl)
  ) {
    return null;
  }

  if (redactedUrl === event.url && redactedRoute === event.route) {
    return event;
  }

  return {
    ...event,
    route: redactedRoute,
    url: redactedUrl,
  };
}

export function shouldSuppressVercelTelemetryForPathname(
  pathname: string | null | undefined,
): boolean {
  return !resolveVercelTelemetryPathname(pathname);
}

export function shouldSuppressVercelTelemetryUrl(value: string): boolean {
  const parsed = parseVercelTelemetryUrl(value);

  return !parsed
    || shouldSuppressVercelTelemetryForPathname(parsed.pathname);
}

export function redactPrivateAnalyticsUrl(value: string): string {
  const parsed = parseVercelTelemetryUrl(value);

  if (!parsed) {
    return value;
  }

  try {
    const telemetryPathname = resolveVercelTelemetryPathname(parsed.pathname);

    if (telemetryPathname) {
      parsed.pathname = telemetryPathname;
      parsed.search = "";
      parsed.hash = "";

      return hasExplicitOrigin(value)
        ? `${parsed.origin}${parsed.pathname}`
        : parsed.pathname;
    }

    const redactedPathname = redactPrivateComputerHandoffPathname(parsed.pathname);

    if (redactedPathname) {
      if (hasExplicitOrigin(value)) {
        return `${parsed.origin}${redactedPathname}`;
      }

      return redactedPathname;
    }

    if (!redactClinicalRecordsUrl(parsed)) {
      return value;
    }

    return hasExplicitOrigin(value)
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

function redactEventUrl<TEvent extends { url: string }>(event: TEvent): TEvent {
  const redactedUrl = redactPrivateAnalyticsUrl(event.url);

  if (redactedUrl === event.url) {
    return event;
  }

  return {
    ...event,
    url: redactedUrl,
  };
}

function hasExplicitOrigin(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function parseVercelTelemetryUrl(value: string): URL | null {
  if (!value || /[\s\\]/u.test(value)) {
    return null;
  }

  const isRootRelative = value.startsWith("/") && !value.startsWith("//");
  const isHttpAbsolute = hasExplicitOrigin(value);

  if (!isRootRelative && !isHttpAbsolute) {
    return null;
  }

  try {
    const parsed = isRootRelative
      ? new URL(value, URL_PARSE_BASE)
      : new URL(value);

    return parsed.username || parsed.password
      ? null
      : parsed;
  } catch {
    return null;
  }
}

function redactClinicalRecordsUrl(url: URL): boolean {
  let changed = false;

  if (
    url.pathname === CLINICAL_RECORDS_CALLBACK_PATH
    && url.searchParams.has(CLINICAL_RECORDS_CALLBACK_QUERY_KEY)
  ) {
    url.searchParams.delete(CLINICAL_RECORDS_CALLBACK_QUERY_KEY);
    changed = true;
  }

  if (url.pathname === CLINICAL_RECORDS_CONNECT_PATH && url.hash) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (fragment.has(CLINICAL_RECORDS_CONNECT_FRAGMENT_KEY)) {
      fragment.delete(CLINICAL_RECORDS_CONNECT_FRAGMENT_KEY);
      url.hash = fragment.toString();
      changed = true;
    }
  }

  return changed;
}

function normalizeVercelTelemetryPathname(
  value: string | null | undefined,
): string | null {
  if (!value?.startsWith("/")) {
    return null;
  }

  return value.length > 1 && value.endsWith("/")
    ? value.slice(0, -1)
    : value;
}

function resolveVercelTelemetryPathname(
  value: string | null | undefined,
): string | null {
  const normalizedPathname = normalizeVercelTelemetryPathname(value);

  if (!normalizedPathname) {
    return null;
  }

  if (VERCEL_TELEMETRY_PATHNAME_SET.has(normalizedPathname)) {
    return normalizedPathname;
  }

  return VERCEL_TELEMETRY_DYNAMIC_PATHNAME_RULES.find(({ pattern }) =>
    pattern.test(normalizedPathname)
  )?.pathname ?? null;
}

function readUrlPathname(value: string): string | null {
  try {
    return normalizeVercelTelemetryPathname(
      new URL(value, URL_PARSE_BASE).pathname,
    );
  } catch {
    return null;
  }
}

function redactPrivateComputerHandoffPathname(pathname: string): string | null {
  for (const { prefix, redactedPrefix } of PRIVATE_COMPUTER_HANDOFF_PATH_PREFIXES) {
    if (!pathname.startsWith(prefix)) {
      continue;
    }

    if (pathname.length <= prefix.length) {
      return null;
    }

    const suffixStart = pathname.indexOf("/", prefix.length);

    return suffixStart === -1
      ? redactedPrefix
      : `${redactedPrefix}${pathname.slice(suffixStart)}`;
  }

  return null;
}
