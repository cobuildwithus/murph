export const connectionMessages = {
  invalid_url: "Enter a valid server URL.",
  url_has_query: "Use the service's plain link, with nothing after a question mark.",
  not_https: "Use an HTTPS server URL.",
  unsafe_destination: "This server address isn't allowed.",
  not_mcp: "This server doesn't support this connection type.",
  unreachable: "We couldn't reach this server. Try again later.",
  provider_terms: "Strava's terms don't allow this connection.",
  sign_in_unsupported: "This server doesn't support sign-in with Murph.",
  limit: "The connection limit has been reached.",
  not_found: "Connection not found.",
  conflict: "The connection changed. Try again.",
  needs_sign_in: "This connection needs to be signed in again in Murph's settings.",
  refused_result: "The service's answer included Murph's sign-in token, so Murph didn't use it.",
  refused_by_service: "The service refused the request. Try again later.",
  request_closed: "This request was already answered or has expired.",
} as const;
export type ConnectionErrorCode = keyof typeof connectionMessages;
export class ConnectionError extends Error {
  constructor(readonly code: ConnectionErrorCode, readonly status = 400) {
    super(connectionMessages[code]);
  }
}
export function connectionErrorResponse(error: unknown): Response {
  const safe = error instanceof ConnectionError ? error : new ConnectionError("unreachable", 502);
  return Response.json({ error: { code: safe.code, message: safe.message } }, {
    status: safe.status, headers: { "Cache-Control": "no-store" },
  });
}
