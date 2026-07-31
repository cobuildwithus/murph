export const AVAILABILITY_CONFLICT_POLICY_FIXED =
  "Availability conflict policy: fixed";
export const AVAILABILITY_CONFLICT_POLICY_SKIP_WHEN_BUSY =
  "Availability conflict policy: skip-when-busy";
export const AVAILABILITY_SOURCE_POLICY_CALENDAR_ONLY =
  "Availability source policy: calendar-only";
export const AVAILABILITY_CALENDAR_ACCOUNT_PREFIX =
  "Availability calendar account: ";
export const AVAILABILITY_CONFLICT_BLOCK_START =
  "<!-- murph:availability-conflicts:start -->";
export const AVAILABILITY_CONFLICT_BLOCK_END =
  "<!-- murph:availability-conflicts:end -->";
export const AVAILABILITY_CONFLICT_BLOCK_INSTRUCTION =
  "- If one interval satisfies `busyStart <= scheduledOccurrenceAt < busyEnd`, return `skip` and send nothing. Do not mention calendar, event labels, or provider details.";

const MAX_BUSY_INTERVALS = 256;
const MAX_SNAPSHOT_MS = 7 * 24 * 60 * 60 * 1_000;
const GENERATED_AT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const GENERATED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
const CALENDAR_ACCOUNT_PATTERN =
  /^Availability calendar account: (googlecalendar|outlook) \/ (\S+)$/u;

export interface AutomationAvailabilityCalendarAuthorization {
  account: string;
  toolkit: "googlecalendar" | "outlook";
}

export interface AutomationAvailabilityBusyInterval {
  end: string;
  start: string;
}

export interface AutomationAvailabilityConflictSnapshot {
  busyIntervals: readonly AutomationAvailabilityBusyInterval[];
  expiresAt: string;
  generatedAt: string;
}

export class AutomationAvailabilityConflictBlockError extends Error {
  constructor(message = "Availability conflict block is malformed or outside its seven-day bound.") {
    super(message);
    this.name = "AutomationAvailabilityConflictBlockError";
  }
}

export function readAutomationAvailabilityCalendarAuthorization(
  instructions: string,
): AutomationAvailabilityCalendarAuthorization | null {
  const lines = instructions.split(/\r?\n/gu);
  if (
    countExactLine(lines, AVAILABILITY_CONFLICT_POLICY_SKIP_WHEN_BUSY) !== 1
    || countExactLine(lines, AVAILABILITY_CONFLICT_POLICY_FIXED) !== 0
    || countExactLine(lines, AVAILABILITY_SOURCE_POLICY_CALENDAR_ONLY) !== 1
  ) {
    return null;
  }

  const accountLines = lines.filter((line) =>
    line.startsWith(AVAILABILITY_CALENDAR_ACCOUNT_PREFIX)
  );
  if (accountLines.length !== 1) {
    return null;
  }
  const match = CALENDAR_ACCOUNT_PATTERN.exec(accountLines[0] ?? "");
  if (!match || !match[2]) {
    return null;
  }
  return {
    account: match[2],
    toolkit: match[1] === "googlecalendar" ? "googlecalendar" : "outlook",
  };
}

export function splitAutomationAvailabilityConflictBlock(
  instructions: string,
): { base: string; block: string | null } {
  const startCount = countExactText(
    instructions,
    AVAILABILITY_CONFLICT_BLOCK_START,
  );
  const endCount = countExactText(
    instructions,
    AVAILABILITY_CONFLICT_BLOCK_END,
  );
  if (startCount === 0 && endCount === 0) {
    return { base: instructions, block: null };
  }
  const separator = `\n\n${AVAILABILITY_CONFLICT_BLOCK_START}`;
  const blockStart = instructions.lastIndexOf(separator);
  if (
    startCount !== 1
    || endCount !== 1
    || blockStart < 0
    || !instructions.endsWith(AVAILABILITY_CONFLICT_BLOCK_END)
  ) {
    throw new AutomationAvailabilityConflictBlockError(
      "Availability conflict block must be one complete owned suffix.",
    );
  }
  return {
    base: instructions.slice(0, blockStart),
    block: instructions.slice(blockStart + 2),
  };
}

export function stripAutomationAvailabilityConflictBlock(
  instructions: string,
): string {
  return splitAutomationAvailabilityConflictBlock(instructions).base;
}

export function replaceAutomationAvailabilityConflictSnapshot(input: {
  busyIntervals: readonly AutomationAvailabilityBusyInterval[];
  expiresAt: string;
  generatedAt: string;
  instructions: string;
  now?: Date;
}): string {
  const base = stripAutomationAvailabilityConflictBlock(input.instructions);
  if (input.busyIntervals.length === 0) {
    return base;
  }
  const block = [
    AVAILABILITY_CONFLICT_BLOCK_START,
    "Availability conflict snapshot:",
    `- generatedAt: ${input.generatedAt}`,
    `- expiresAt: ${input.expiresAt}`,
    AVAILABILITY_CONFLICT_BLOCK_INSTRUCTION,
    ...input.busyIntervals.map((interval) =>
      `- ${interval.start} / ${interval.end}`
    ),
    AVAILABILITY_CONFLICT_BLOCK_END,
  ].join("\n");
  parseAutomationAvailabilityConflictBlock(block, {
    enforceFreshGeneratedAt: true,
    now: input.now,
  });
  return `${base}\n\n${block}`;
}

export function parseAutomationAvailabilityConflictBlock(
  block: string,
  options: {
    enforceFreshGeneratedAt?: boolean;
    now?: Date;
  } = {},
): AutomationAvailabilityConflictSnapshot {
  const lines = block.split("\n");
  if (
    lines.length < 7
    || lines.length > MAX_BUSY_INTERVALS + 6
    || lines[0] !== AVAILABILITY_CONFLICT_BLOCK_START
    || lines[1] !== "Availability conflict snapshot:"
    || lines[4] !== AVAILABILITY_CONFLICT_BLOCK_INSTRUCTION
    || lines.at(-1) !== AVAILABILITY_CONFLICT_BLOCK_END
  ) {
    throw new AutomationAvailabilityConflictBlockError();
  }
  const generatedAt = parseTimestampLine(lines[2], "- generatedAt: ");
  const expiresAt = parseTimestampLine(lines[3], "- expiresAt: ");
  const nowMs = (options.now ?? new Date()).getTime();
  if (
    (
      options.enforceFreshGeneratedAt === true
      && (
        generatedAt.ms > nowMs + GENERATED_AT_FUTURE_TOLERANCE_MS
        || generatedAt.ms < nowMs - GENERATED_AT_MAX_AGE_MS
      )
    )
    || expiresAt.ms <= generatedAt.ms
    || expiresAt.ms - generatedAt.ms > MAX_SNAPSHOT_MS
  ) {
    throw new AutomationAvailabilityConflictBlockError();
  }

  const busyIntervals: AutomationAvailabilityBusyInterval[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const line of lines.slice(5, -1)) {
    const match = /^- (\S+) \/ (\S+)$/u.exec(line);
    if (!match) {
      throw new AutomationAvailabilityConflictBlockError();
    }
    const busyStart = parseCanonicalIsoTimestamp(match[1]);
    const busyEnd = parseCanonicalIsoTimestamp(match[2]);
    if (
      busyStart.ms >= busyEnd.ms
      || busyStart.ms < previousEnd
      || busyEnd.ms <= generatedAt.ms
      || busyStart.ms >= expiresAt.ms
      || busyEnd.ms > expiresAt.ms
    ) {
      throw new AutomationAvailabilityConflictBlockError();
    }
    busyIntervals.push({
      end: busyEnd.iso,
      start: busyStart.iso,
    });
    previousEnd = busyEnd.ms;
  }

  return {
    busyIntervals,
    expiresAt: expiresAt.iso,
    generatedAt: generatedAt.iso,
  };
}

export function shouldSkipAutomationOccurrenceForAvailability(input: {
  instructions: string;
  occurrenceAt: string | null | undefined;
}): boolean {
  if (!readAutomationAvailabilityCalendarAuthorization(input.instructions)) {
    return false;
  }
  const occurrenceAt = parseCanonicalIsoTimestampOrNull(input.occurrenceAt);
  if (!occurrenceAt) {
    return false;
  }

  try {
    const { block } = splitAutomationAvailabilityConflictBlock(input.instructions);
    if (!block) {
      return false;
    }
    const snapshot = parseAutomationAvailabilityConflictBlock(block);
    const generatedAt = Date.parse(snapshot.generatedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    if (
      occurrenceAt.ms < generatedAt
      || occurrenceAt.ms - generatedAt > GENERATED_AT_MAX_AGE_MS
      || occurrenceAt.ms >= expiresAt
    ) {
      return false;
    }
    return snapshot.busyIntervals.some((interval) =>
      Date.parse(interval.start) <= occurrenceAt.ms
      && occurrenceAt.ms < Date.parse(interval.end)
    );
  } catch {
    return false;
  }
}

function countExactLine(lines: readonly string[], expected: string): number {
  return lines.filter((line) => line === expected).length;
}

function countExactText(input: string, text: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = input.indexOf(text, offset);
    if (index < 0) {
      return count;
    }
    count += 1;
    offset = index + text.length;
  }
}

function parseTimestampLine(
  line: string | undefined,
  prefix: string,
): { iso: string; ms: number } {
  if (!line?.startsWith(prefix)) {
    throw new AutomationAvailabilityConflictBlockError();
  }
  return parseCanonicalIsoTimestamp(line.slice(prefix.length));
}

function parseCanonicalIsoTimestamp(
  input: string | undefined,
): { iso: string; ms: number } {
  if (!input) {
    throw new AutomationAvailabilityConflictBlockError();
  }
  const ms = Date.parse(input);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== input) {
    throw new AutomationAvailabilityConflictBlockError();
  }
  return { iso: input, ms };
}

function parseCanonicalIsoTimestampOrNull(
  input: string | null | undefined,
): { iso: string; ms: number } | null {
  try {
    return parseCanonicalIsoTimestamp(input ?? undefined);
  } catch {
    return null;
  }
}
