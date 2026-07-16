import type { BeforeSendEvent as VercelAnalyticsBeforeSendEvent } from "@vercel/analytics/next";

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
const URL_PARSE_BASE = "https://murph.invalid";

export type VercelSpeedInsightsBeforeSendEvent = {
  route?: string;
  type: "vital";
  url: string;
};

export function redactVercelAnalyticsEvent(
  event: VercelAnalyticsBeforeSendEvent,
): VercelAnalyticsBeforeSendEvent {
  return redactEventUrl(event);
}

export function redactVercelSpeedInsightsEvent(
  event: VercelSpeedInsightsBeforeSendEvent,
): VercelSpeedInsightsBeforeSendEvent {
  const redactedUrl = redactPrivateAnalyticsUrl(event.url);
  const redactedRoute = typeof event.route === "string"
    ? redactPrivateAnalyticsUrl(event.route)
    : event.route;

  if (redactedUrl === event.url && redactedRoute === event.route) {
    return event;
  }

  return {
    ...event,
    route: redactedRoute,
    url: redactedUrl,
  };
}

export function redactPrivateAnalyticsUrl(value: string): string {
  try {
    const parsed = new URL(value, URL_PARSE_BASE);
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
  return /^[a-z][a-z\d+.-]*:\/\//iu.test(value);
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
