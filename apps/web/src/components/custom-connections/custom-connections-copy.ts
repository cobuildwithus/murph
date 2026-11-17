/** What the Settings API returns for one tool on an MCP server. */
export interface CustomConnectionTool {
  description: string;
  name: string;
  /** The server says it only looks things up. Anything else can change things, so Murph asks first. */
  readOnly: boolean;
  /** `not_allowed`: its description is too long for Murph to carry, so it can't be turned on. */
  state: "needs_look" | "not_allowed" | "off" | "on";
  title: string;
}

export interface CustomConnection {
  auth: "none" | "oauth";
  /** Whether this account can confirm changes; when it can't, its changing actions show off and locked. */
  changesAllowed: boolean;
  createdAt: string;
  host: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
  /** Changes with every edit; saves send it back so a change in between means "look again". */
  revision: number;
  slug: string;
  status: "needs_sign_in" | "off" | "on";
  tools: CustomConnectionTool[];
}

export type CustomConnectionAddResult =
  | { connection: CustomConnection; next: "choose" }
  | {
      authorizationHost: string;
      authorizationUrl: string;
      connectionId: string;
      next: "sign_in";
    };

export const CUSTOM_CONNECTIONS_API = "/api/settings/custom-connections";

/** Why an account first signed in to with email can't turn on actions that change things. */
export const CUSTOM_CONNECTION_CHANGES_LOCKED = "Changes need an account set up with your phone or Telegram.";

/** Each way adding or signing in can fail, in the member's words. */
export const CUSTOM_CONNECTION_ERRORS: Record<string, { detail: string; title: string }> = {
  invalid_url: {
    title: "That link didn't work.",
    detail: "Paste the whole link, starting with https://.",
  },
  url_has_query: {
    title: "Murph can't use that link.",
    detail: "It has extras after a question mark, often a key. Use the MCP server's plain link.",
  },
  not_https: {
    title: "That link didn't work.",
    detail: "Murph only connects to links that start with https://.",
  },
  unsafe_destination: {
    title: "Murph can't use that link.",
    detail: "It points somewhere Murph doesn't connect to.",
  },
  not_mcp: {
    title: "That isn't an MCP server link.",
    detail: "It opens a regular web page. Check that you copied the whole MCP link.",
  },
  unreachable: {
    title: "Couldn't reach that MCP server.",
    detail: "It didn't answer. Try again in a minute.",
  },
  provider_terms: {
    title: "That MCP server doesn't allow this.",
    detail: "Its terms only let a few AI assistants connect to it, and Murph isn't one of them.",
  },
  sign_in_unsupported: {
    title: "This MCP server needs its own setup.",
    detail: "It only lets apps it has approved in advance sign in, so Murph can't connect to it yet.",
  },
  limit: {
    title: "You've reached the limit.",
    detail: "Remove an MCP server to add another.",
  },
  sign_in_failed: {
    title: "Sign-in didn't finish.",
    detail: "Nothing was connected. Try again from the start.",
  },
};

export const CUSTOM_CONNECTION_UNKNOWN_ERROR = {
  title: "That didn't work.",
  detail: "Nothing was changed. Try again in a minute.",
};

export function readCustomConnectionError(code: string | null | undefined) {
  return (code && CUSTOM_CONNECTION_ERRORS[code]) || CUSTOM_CONNECTION_UNKNOWN_ERROR;
}

/** Why a change Murph asked for didn't go through. Each was found before anything was sent. */
export type CustomConnectionActionFailure = "changed" | "off" | "refused" | "signed_out" | "unreachable";

export type CustomConnectionActionOutcome =
  | { status: "declined" | "expired" | "waiting" }
  | { status: "done" | "unknown"; text?: string }
  | { reason: CustomConnectionActionFailure; status: "failed" };

/** One change Murph asked to make, as the member's confirm page shows it. */
export interface CustomConnectionActionRequest {
  askedAt: string;
  /** When the member last confirmed this same change, if it may already have happened. */
  confirmedBefore?: string;
  host: string;
  id: string;
  /** Exactly what Murph will send, in the action's declared order, present while the request waits. */
  inputs?: { name: string; value: unknown }[];
  outcome: CustomConnectionActionOutcome;
  server: string;
  title: string;
}

export function customConnectionActionUrl(id: string, suffix = ""): string {
  return `${CUSTOM_CONNECTIONS_API}/requests/${encodeURIComponent(id)}${suffix}`;
}

/** The line under "That didn't go through.": what stopped it and what to do next. */
export function describeCustomConnectionActionFailure(reason: CustomConnectionActionFailure, server: string): string {
  switch (reason) {
    case "off":
      return `${server} is turned off, so nothing changed. Turn it on in your MCP servers, then ask Murph again.`;
    case "signed_out":
      return `Murph is signed out of ${server}, so nothing changed. Sign in again in your MCP servers, then ask Murph again.`;
    case "changed":
      return "This action changed or was turned off since Murph asked, so nothing changed. Look it over in your MCP servers, then ask Murph again.";
    case "refused":
      return `${server} turned it down, so nothing changed. Ask Murph again if you still want this.`;
    case "unreachable":
      return `Murph couldn't reach ${server}, so nothing changed. Ask Murph again in a minute.`;
  }
}

/** One short line under a service's name. */
export function describeCustomConnectionStatus(connection: CustomConnection): string {
  if (connection.status === "needs_sign_in") return "Needs you to sign in again";
  if (connection.status === "off") return "Off";
  const changed = connection.tools.filter((tool) => tool.state === "needs_look").length;
  if (changed > 0) return changed === 1 ? "1 action needs a look" : `${changed} actions need a look`;
  const on = connection.tools.filter((tool) => tool.state === "on").length;
  return on === 1 ? "On · 1 action" : `On · ${on} actions`;
}
