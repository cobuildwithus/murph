import type { BeforeSendEvent as VercelAnalyticsBeforeSendEvent } from "@vercel/analytics/next";

const PRIVATE_COMPUTER_HANDOFF_PATH_PREFIX = "/computer/handoff/";
const REDACTED_PRIVATE_COMPUTER_HANDOFF_PATH = "/computer/handoff/[token]";
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
  if (!value.includes(PRIVATE_COMPUTER_HANDOFF_PATH_PREFIX)) {
    return value;
  }

  try {
    const parsed = new URL(value, URL_PARSE_BASE);

    if (!isPrivateComputerHandoffPath(parsed.pathname)) {
      return value;
    }

    if (hasExplicitOrigin(value)) {
      return `${parsed.origin}${REDACTED_PRIVATE_COMPUTER_HANDOFF_PATH}`;
    }

    return REDACTED_PRIVATE_COMPUTER_HANDOFF_PATH;
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

function isPrivateComputerHandoffPath(pathname: string): boolean {
  return (
    pathname.startsWith(PRIVATE_COMPUTER_HANDOFF_PATH_PREFIX)
    && pathname.length > PRIVATE_COMPUTER_HANDOFF_PATH_PREFIX.length
  );
}
