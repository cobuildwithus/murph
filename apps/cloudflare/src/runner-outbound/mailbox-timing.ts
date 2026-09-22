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
