/** What the Settings API returns for one tool on a connected service. */
export interface CustomConnectionTool {
  description: string;
  name: string;
  readOnly: boolean;
  /** `not_allowed`: the service doesn't say it only looks things up, so Murph can't use it yet. */
  state: "needs_look" | "not_allowed" | "off" | "on";
  title: string;
}

export interface CustomConnection {
  auth: "none" | "oauth";
  createdAt: string;
  host: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
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

/** Each way adding or signing in can fail, in the member's words. */
export const CUSTOM_CONNECTION_ERRORS: Record<string, { detail: string; title: string }> = {
  invalid_url: {
    title: "That link didn't work.",
    detail: "Paste the whole link, starting with https://.",
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
    title: "That isn't a service link.",
    detail: "It opens a regular web page. Check that you copied the whole link the service gave you.",
  },
  unreachable: {
    title: "Couldn't reach that service.",
    detail: "It didn't answer. Try again in a minute.",
  },
  provider_terms: {
    title: "That service doesn't allow this.",
    detail: "Its terms only let a few AI assistants connect to it, and Murph isn't one of them.",
  },
  sign_in_unsupported: {
    title: "This service needs its own setup.",
    detail: "It only lets apps it has approved in advance sign in, so Murph can't connect to it yet.",
  },
  limit: {
    title: "You've reached the limit.",
    detail: "Remove a service to add another.",
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

/** One short line under a service's name. */
export function describeCustomConnectionStatus(connection: CustomConnection): string {
  if (connection.status === "needs_sign_in") return "Needs you to sign in again";
  if (connection.status === "off") return "Off";
  const changed = connection.tools.filter((tool) => tool.state === "needs_look").length;
  if (changed > 0) return changed === 1 ? "1 action needs a look" : `${changed} actions need a look`;
  const on = connection.tools.filter((tool) => tool.state === "on").length;
  return on === 1 ? "On · 1 action" : `On · ${on} actions`;
}
