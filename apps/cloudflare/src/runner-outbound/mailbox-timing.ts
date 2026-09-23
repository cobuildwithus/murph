const MAILBOX_WEB_TIMING_FIELDS: Readonly<Record<string, string>> = {
  total: "mailboxWebTotalMs",
  auth: "mailboxWebAuthMs",
  parse: "mailboxWebParseMs",
  transaction_start: "mailboxWebTransactionStartMs",
  fence: "mailboxWebFenceMs",
  member: "mailboxWebMemberMs",
  access: "mailboxWebAccessMs",
  projection: "mailboxWebProjectionMs",
  usage: "mailboxWebUsageMs",
  transaction_finish: "mailboxWebTransactionFinishMs",
  group: "mailboxWebGroupMs",
  crypto: "mailboxWebCryptoMs",
  serialize: "mailboxWebSerializeMs",
};

/** Read only our finite numeric metrics, never arbitrary upstream header text. */
export function readMailboxWebTiming(response: Response): Record<string, number> {
  const header = response.headers.get("server-timing");
  if (!header || header.length > 2048) return {};
  const timings: Record<string, number> = {};
  for (const metric of header.split(",")) {
    const match = /^\s*murph_mailbox_([a-z_]+);dur=(\d{1,6})\s*$/.exec(metric);
    if (!match) continue;
    const field = Object.hasOwn(MAILBOX_WEB_TIMING_FIELDS, match[1]!)
      ? MAILBOX_WEB_TIMING_FIELDS[match[1]!] : undefined;
    const duration = Number(match[2]);
    if (field && duration <= 600_000) timings[field] = duration;
  }
  return timings;
}

/** Keep only the platform region path, never the opaque request identifier. */
export function readMailboxVercelRegions(response: Response): { mailboxVercelRegions?: string } {
  const header = response.headers.get("x-vercel-id");
  if (!header || header.length > 256) return {};
  const match = /^([a-z]{3}[1-9](?:::[a-z]{3}[1-9]){0,3})::[A-Za-z0-9-]+$/.exec(header);
  return match ? { mailboxVercelRegions: match[1] } : {};
}
