import "server-only";

import type {
  HostedConnectedAppsRequest,
} from "@murphai/hosted-execution/connected-apps";

import {
  executeHostedConnectedAppsRequest,
} from "../connected-apps/service";

export type CallCircleCalendarAvailability = "busy" | "free" | "unknown";

export interface CallCircleConnectedAppsRequester {
  request(input: {
    memberId: string;
    request: HostedConnectedAppsRequest;
  }): Promise<unknown>;
}

const CALL_CIRCLE_CALENDAR_TOOLKITS = ["googlecalendar", "outlook"] as const;
const CALL_CIRCLE_FREE_BUSY_TOOLS: Readonly<Record<string, readonly string[]>> = {
  googlecalendar: [
    "GOOGLECALENDAR_FREE_BUSY_QUERY",
    "GOOGLECALENDAR_FIND_FREE_SLOTS",
  ],
  outlook: [
    "OUTLOOK_CALENDAR_GET_SCHEDULE",
  ],
};

export async function readCallCircleCalendarAvailability(input: {
  endAt: Date;
  memberId: string;
  requester?: CallCircleConnectedAppsRequester;
  startAt: Date;
  timeZone: string;
}): Promise<CallCircleCalendarAvailability> {
  const requester = input.requester ?? DEFAULT_CONNECTED_APPS_REQUESTER;
  try {
    let observedFree = false;
    for (const toolkit of CALL_CIRCLE_CALENDAR_TOOLKITS) {
      const accounts = readConnectedCalendarAccounts(await requester.request({
        memberId: input.memberId,
        request: {
          input: { action: "list", toolkit },
          operation: "manage",
        },
      }), toolkit);
      for (const account of accounts) {
        for (const toolSlug of CALL_CIRCLE_FREE_BUSY_TOOLS[toolkit] ?? []) {
          const availability = parseAvailabilityResult(await requester.request({
            memberId: input.memberId,
            request: {
              input: {
                account: account.selector,
                arguments: {
                  end_datetime: input.endAt.toISOString(),
                  end_time: input.endAt.toISOString(),
                  start_datetime: input.startAt.toISOString(),
                  start_time: input.startAt.toISOString(),
                  time_zone: input.timeZone,
                  timezone: input.timeZone,
                },
                toolSlug,
              },
              operation: "execute",
            },
          }));
          if (availability === "busy") return "busy";
          if (availability === "free") observedFree = true;
        }
      }
    }
    return observedFree ? "free" : "unknown";
  } catch {
    return "unknown";
  }
}

const DEFAULT_CONNECTED_APPS_REQUESTER: CallCircleConnectedAppsRequester = {
  async request(input) {
    return executeHostedConnectedAppsRequest(input);
  },
};

interface ConnectedCalendarAccount {
  selector: string;
}

function readConnectedCalendarAccounts(
  value: unknown,
  toolkit: string,
): ConnectedCalendarAccount[] {
  if (!isRecord(value) || !Array.isArray(value.accounts)) return [];
  return value.accounts.flatMap((account) => {
    if (!isRecord(account)) return [];
    const selector = readString(account.id) ?? readString(account.alias);
    const accountToolkit = readAccountToolkitSlug(account);
    const status = readString(account.status);
    const isDisabled = account.isDisabled === true;
    if (!selector || accountToolkit !== toolkit || status !== "ACTIVE" || isDisabled) {
      return [];
    }
    return [{ selector }];
  });
}

function parseAvailabilityResult(value: unknown): CallCircleCalendarAvailability {
  const result = readAvailabilityHint(value, true);
  return result ?? "unknown";
}

function readAvailabilityHint(
  value: unknown,
  allowText: boolean,
): CallCircleCalendarAvailability | null {
  if (typeof value === "string") {
    return allowText ? readAvailabilityTextHint(value) : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = readAvailabilityHint(entry, false);
      if (nested === "busy") return "busy";
      if (nested === "free") return "free";
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, entry] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (isCalendarDetailKey(lowerKey)) {
      continue;
    }
    if ((lowerKey === "busy" || lowerKey.includes("busy")) && Array.isArray(entry)) {
      return entry.length > 0 ? "busy" : "free";
    }
    if (
      (lowerKey.includes("free") || lowerKey.includes("available"))
      && Array.isArray(entry)
    ) {
      return entry.length > 0 ? "free" : "busy";
    }
    if (typeof entry === "string" && isAvailabilityTextKey(lowerKey)) {
      const textHint = readAvailabilityTextHint(entry);
      if (textHint) return textHint;
    }
    const nested = readAvailabilityHint(entry, false);
    if (nested === "busy") return "busy";
    if (nested === "free") return "free";
  }
  return null;
}

function readAvailabilityTextHint(value: string): CallCircleCalendarAvailability | null {
  const lower = value.toLowerCase();
  if (/\b(no busy|available|free)\b/u.test(lower)) return "free";
  if (/\b(busy|unavailable|conflict)\b/u.test(lower)) return "busy";
  return null;
}

function isAvailabilityTextKey(lowerKey: string): boolean {
  return lowerKey.includes("availability") || lowerKey.includes("freebusy");
}

function isCalendarDetailKey(lowerKey: string): boolean {
  return lowerKey.includes("event")
    || lowerKey.includes("scheduleitem")
    || lowerKey === "items"
    || lowerKey.endsWith("items");
}

function readAccountToolkitSlug(account: Record<string, unknown>): string | null {
  const toolkit = account.toolkit;
  if (typeof toolkit === "string") return toolkit;
  if (isRecord(toolkit)) return readString(toolkit.slug);
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
