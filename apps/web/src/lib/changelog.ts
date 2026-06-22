import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

export const CHANGELOG_FEED_SCHEMA = "murph.changelog-feed.v1";
export const CHANGELOG_CARD_VERSION = "v1";
export const CHANGELOG_CARD_MAX_ITEMS = 7;
export const CHANGELOG_FEATURE_LIMIT_MAX = 20;
export const CHANGELOG_IMPROVEMENT_LIMIT_MAX = 5;

const CHANGELOG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CHANGELOG_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CHANGELOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CHANGELOG_CARD_SEPARATOR = "~";

export type ChangelogItemKind = "feature" | "improvement";
export type ChangelogPriority = 1 | 2 | 3 | 4 | 5;

export interface ChangelogTryIt {
  href?: string;
  label: string;
  prompt?: string;
}

export interface ChangelogItem {
  details?: string;
  id: string;
  kind: ChangelogItemKind;
  priority: ChangelogPriority;
  relevanceTags: readonly string[];
  sourcePullRequests: readonly number[];
  summary: string;
  title: string;
  tryIt?: ChangelogTryIt;
}

export interface ChangelogEdition {
  id: string;
  items: readonly ChangelogItem[];
  publishedOn: string;
  summary: string;
  title: string;
}

export interface PublishedChangelogItem extends ChangelogItem {
  editionId: string;
  editionTitle: string;
  publishedOn: string;
}

export interface ChangelogQuery {
  featureLimit: number;
  from: string;
  improvementLimit: number;
  to: string;
}

const RAW_CHANGELOG_EDITIONS = [
  {
    id: "2026-06-22",
    publishedOn: "2026-06-22",
    title: "A more natural Murph",
    summary:
      "Better-looking conversations, lighter interactions, and a more polished place to manage your health work.",
    items: [
      {
        id: "native-message-formatting",
        kind: "feature",
        priority: 5,
        title: "Better-looking messages",
        summary:
          "Murph can now use natural emphasis in supported messaging channels without showing raw formatting markers.",
        details:
          "Important points, headings, and emphasis are easier to scan in everyday conversations.",
        relevanceTags: ["messaging", "telegram", "imessage", "summaries"],
        sourcePullRequests: [242],
        tryIt: {
          label: "Ask for a formatted summary",
          prompt:
            "Give me a clean weekly summary and emphasize the three things that matter most.",
        },
      },
      {
        id: "telegram-reactions",
        kind: "feature",
        priority: 4,
        title: "Murph can react on Telegram",
        summary:
          "On Telegram, Murph can respond with a lightweight reaction when a full message would be unnecessary.",
        relevanceTags: ["messaging", "telegram", "assistant"],
        sourcePullRequests: [227],
        tryIt: {
          label: "Try a lightweight acknowledgement",
          prompt: "React to this message instead of sending a full reply.",
        },
      },
      {
        id: "dashboard-polish",
        kind: "improvement",
        priority: 4,
        title: "A calmer dashboard",
        summary:
          "Authentication, biomarkers, experiments, connections, and settings received a focused visual polish pass.",
        relevanceTags: ["dashboard", "biomarkers", "experiments", "wearables"],
        sourcePullRequests: [248],
        tryIt: {
          href: "/",
          label: "Open Murph",
        },
      },
      {
        id: "reliable-live-replies",
        kind: "improvement",
        priority: 5,
        title: "More reliable live replies",
        summary:
          "Murph now recovers more reliably when a new message arrives while the hosted assistant is already active.",
        relevanceTags: ["messaging", "reliability", "telegram", "imessage"],
        sourcePullRequests: [232],
      },
    ],
  },
  {
    id: "2026-06-18",
    publishedOn: "2026-06-18",
    title: "Stronger browser help",
    summary:
      "Murph's browser automation became more capable while account recovery paths became easier to trust.",
    items: [
      {
        id: "browser-automation-upgrade",
        kind: "feature",
        priority: 5,
        title: "More capable browser automation",
        summary:
          "Murph can use a bounded Playwright action primitive for richer website tasks while keeping the existing hosted browser safety boundary.",
        relevanceTags: ["browser", "automation", "appointments", "forms"],
        sourcePullRequests: [228],
        tryIt: {
          label: "Delegate a browser task",
          prompt:
            "Help me complete this website task and pause before anything that needs my login, payment, or final confirmation.",
        },
      },
      {
        id: "pulse-trial-recovery",
        kind: "improvement",
        priority: 4,
        title: "Safer Pulse trial recovery",
        summary:
          "Trial redemption and billing recovery paths were tightened so interrupted signup flows are less likely to leave confusing account state.",
        relevanceTags: ["billing", "signup", "hosted"],
        sourcePullRequests: [219],
      },
    ],
  },
  {
    id: "2026-06-14",
    publishedOn: "2026-06-14",
    title: "A lighter, sturdier foundation",
    summary:
      "Health queries, workspace recovery, and runtime logs became smaller and more predictable.",
    items: [
      {
        id: "lighter-health-queries",
        kind: "improvement",
        priority: 4,
        title: "Lighter health queries",
        summary:
          "Metric projections now store compact supplemental data and reconstruct rich values only when needed.",
        relevanceTags: ["biomarkers", "wearables", "performance"],
        sourcePullRequests: [235],
      },
      {
        id: "sturdier-workspace-restore",
        kind: "improvement",
        priority: 5,
        title: "Sturdier workspace recovery",
        summary:
          "Hosted workspace restores now use a smaller authenticated path with stronger integrity checks and fewer redundant passes.",
        relevanceTags: ["reliability", "hosted", "data"],
        sourcePullRequests: [243, 244, 246],
      },
      {
        id: "bounded-runtime-logs",
        kind: "improvement",
        priority: 3,
        title: "Bounded runtime logs",
        summary:
          "Assistant runtime logs now keep one bounded tail instead of accumulating unbounded diagnostic history.",
        relevanceTags: ["reliability", "performance", "hosted"],
        sourcePullRequests: [238],
      },
    ],
  },
] satisfies readonly ChangelogEdition[];

export const CHANGELOG_EDITIONS: readonly ChangelogEdition[] =
  validateChangelogEditions(RAW_CHANGELOG_EDITIONS);

export function listChangelogEditions(): readonly ChangelogEdition[] {
  return CHANGELOG_EDITIONS;
}

export function listPublishedChangelogItems(): readonly PublishedChangelogItem[] {
  return CHANGELOG_EDITIONS
    .flatMap((edition) =>
      edition.items.map((item) => ({
        ...item,
        editionId: edition.id,
        editionTitle: edition.title,
        publishedOn: edition.publishedOn,
      })),
    )
    .sort(comparePublishedChangelogItems);
}

export function queryChangelogItems(query: ChangelogQuery): readonly PublishedChangelogItem[] {
  assertChangelogDate(query.from, "from");
  assertChangelogDate(query.to, "to");
  if (query.from >= query.to) {
    throw new TypeError("Changelog query from must be before to.");
  }
  assertQueryLimit(query.featureLimit, CHANGELOG_FEATURE_LIMIT_MAX, "featureLimit");
  assertQueryLimit(
    query.improvementLimit,
    CHANGELOG_IMPROVEMENT_LIMIT_MAX,
    "improvementLimit",
  );

  const candidates = listPublishedChangelogItems().filter(
    (item) => item.publishedOn >= query.from && item.publishedOn < query.to,
  );
  const features = candidates
    .filter((item) => item.kind === "feature")
    .slice(0, query.featureLimit);
  const improvements = candidates
    .filter((item) => item.kind === "improvement")
    .slice(0, query.improvementLimit);

  return [...features, ...improvements].sort(comparePublishedChangelogItems);
}

export function resolveChangelogCardItems(
  ids: readonly string[],
): readonly PublishedChangelogItem[] | null {
  if (ids.length === 0 || ids.length > CHANGELOG_CARD_MAX_ITEMS) {
    return null;
  }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length || uniqueIds.some((id) => !isChangelogId(id))) {
    return null;
  }
  const byId = new Map(listPublishedChangelogItems().map((item) => [item.id, item]));
  const items = uniqueIds.map((id) => byId.get(id) ?? null);
  return items.some((item) => item === null)
    ? null
    : items as PublishedChangelogItem[];
}

export function parseChangelogCardItemSegment(
  segment: string | null | undefined,
): readonly string[] | null {
  if (!segment?.endsWith(".png")) {
    return null;
  }
  const raw = segment.slice(0, -".png".length);
  const ids = raw.split(CHANGELOG_CARD_SEPARATOR);
  return resolveChangelogCardItems(ids) ? ids : null;
}

export function buildChangelogCardPath(ids: readonly string[]): string {
  if (!resolveChangelogCardItems(ids)) {
    throw new TypeError("Changelog card item ids are invalid.");
  }
  return `/changelog/card/${CHANGELOG_CARD_VERSION}/${ids.join(CHANGELOG_CARD_SEPARATOR)}.png`;
}

export function buildChangelogItemPath(id: string): string {
  if (!isChangelogId(id)) {
    throw new TypeError("Changelog item id is invalid.");
  }
  return `/changelog#${id}`;
}

export function buildAbsoluteChangelogUrl(
  pathname: string,
  origin: string = MURPH_PRODUCT_ORIGIN,
): string {
  const normalizedOrigin = origin.replace(/\/+$/u, "");
  return new URL(pathname, `${normalizedOrigin}/`).toString();
}

export function isChangelogDate(value: string): boolean {
  if (!CHANGELOG_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateChangelogEditions(
  editions: readonly ChangelogEdition[],
): readonly ChangelogEdition[] {
  const editionIds = new Set<string>();
  const itemIds = new Set<string>();
  let previousDate: string | null = null;

  for (const edition of editions) {
    assertChangelogDate(edition.publishedOn, "edition publishedOn");
    if (edition.id !== edition.publishedOn) {
      throw new TypeError("Changelog edition id must equal publishedOn.");
    }
    if (editionIds.has(edition.id)) {
      throw new TypeError(`Duplicate changelog edition id: ${edition.id}`);
    }
    if (previousDate !== null && edition.publishedOn >= previousDate) {
      throw new TypeError("Changelog editions must be newest first.");
    }
    assertText(edition.title, "edition title", 120);
    assertText(edition.summary, "edition summary", 400);
    if (edition.items.length === 0) {
      throw new TypeError(`Changelog edition ${edition.id} must contain an item.`);
    }
    editionIds.add(edition.id);
    previousDate = edition.publishedOn;

    for (const item of edition.items) {
      if (!isChangelogId(item.id) || itemIds.has(item.id)) {
        throw new TypeError(`Invalid or duplicate changelog item id: ${item.id}`);
      }
      if (item.kind !== "feature" && item.kind !== "improvement") {
        throw new TypeError(`Invalid changelog item kind: ${item.id}`);
      }
      if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 5) {
        throw new TypeError(`Invalid changelog item priority: ${item.id}`);
      }
      assertText(item.title, "item title", 120);
      assertText(item.summary, "item summary", 500);
      if (item.details !== undefined) {
        assertText(item.details, "item details", 1_000);
      }
      if (
        item.relevanceTags.length === 0 ||
        item.relevanceTags.some((tag) => !CHANGELOG_TAG_PATTERN.test(tag))
      ) {
        throw new TypeError(`Invalid changelog relevance tags: ${item.id}`);
      }
      if (
        item.sourcePullRequests.some(
          (pullRequest) => !Number.isInteger(pullRequest) || pullRequest <= 0,
        )
      ) {
        throw new TypeError(`Invalid changelog pull request reference: ${item.id}`);
      }
      if (item.tryIt) {
        assertText(item.tryIt.label, "try-it label", 120);
        if (item.tryIt.prompt !== undefined) {
          assertText(item.tryIt.prompt, "try-it prompt", 500);
        }
        if (item.tryIt.href !== undefined) {
          assertText(item.tryIt.href, "try-it href", 500);
        }
      }
      itemIds.add(item.id);
    }
  }

  return editions;
}

function comparePublishedChangelogItems(
  left: PublishedChangelogItem,
  right: PublishedChangelogItem,
): number {
  return right.publishedOn.localeCompare(left.publishedOn) ||
    right.priority - left.priority ||
    left.id.localeCompare(right.id);
}

function assertQueryLimit(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`Changelog query ${label} must be between 0 and ${maximum}.`);
  }
}

function assertChangelogDate(value: string, label: string): void {
  if (!isChangelogDate(value)) {
    throw new TypeError(`Changelog ${label} must be a strict YYYY-MM-DD date.`);
  }
}

function assertText(value: string, label: string, maximum: number): void {
  if (!value.trim() || value !== value.trim() || value.length > maximum) {
    throw new TypeError(`Changelog ${label} must be trimmed and at most ${maximum} characters.`);
  }
}

function isChangelogId(value: string): boolean {
  return value.length <= 120 && CHANGELOG_ID_PATTERN.test(value);
}
