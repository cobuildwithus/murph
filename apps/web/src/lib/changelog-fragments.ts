import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type {
  ChangelogEdition,
  ChangelogItem,
  ChangelogItemKind,
  ChangelogPriority,
  ChangelogTryIt,
} from "./changelog";

const CHANGELOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const JSON_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/u;
const MAX_FRAGMENT_ORDER = 1_000_000;

interface ChangelogEntryFragment {
  item: ChangelogItem;
  order: number;
  publishedOn: string;
}

interface ChangelogEditionMetadata {
  publishedOn: string;
  summary: string;
  title: string;
}

export function loadChangelogFragmentEditions(
  contentRoot: string,
): readonly ChangelogEdition[] {
  const entriesRoot = path.join(contentRoot, "entries");
  const editionsRoot = path.join(contentRoot, "editions");
  const entriesByDate = new Map<string, ChangelogEntryFragment[]>();
  const itemIds = new Set<string>();

  for (const dateEntry of readDirectory(entriesRoot, "entry root")) {
    if (!dateEntry.isDirectory() || !isChangelogDate(dateEntry.name)) {
      throw new TypeError(
        `Changelog entries contain an invalid date directory: ${dateEntry.name}`,
      );
    }

    const dateRoot = path.join(entriesRoot, dateEntry.name);
    const fragments: ChangelogEntryFragment[] = [];
    for (const fileEntry of readDirectory(dateRoot, `entry date ${dateEntry.name}`)) {
      const fileMatch = fileEntry.isFile()
        ? JSON_FILE_PATTERN.exec(fileEntry.name)
        : null;
      if (!fileMatch) {
        throw new TypeError(
          `Changelog entry ${dateEntry.name}/${fileEntry.name} must be a stable-ID JSON file.`,
        );
      }

      const expectedItemId = fileMatch[1];
      const fragment = parseEntryFragment(
        readJsonFile(
          path.join(dateRoot, fileEntry.name),
          `entry ${dateEntry.name}/${fileEntry.name}`,
        ),
        `entry ${dateEntry.name}/${fileEntry.name}`,
      );
      if (fragment.publishedOn !== dateEntry.name) {
        throw new TypeError(
          `Changelog entry ${dateEntry.name}/${fileEntry.name} must use its directory date.`,
        );
      }
      if (fragment.item.id !== expectedItemId) {
        throw new TypeError(
          `Changelog entry ${dateEntry.name}/${fileEntry.name} must use its item ID as the filename.`,
        );
      }
      if (itemIds.has(fragment.item.id)) {
        throw new TypeError(`Duplicate changelog fragment item ID: ${fragment.item.id}`);
      }
      itemIds.add(fragment.item.id);
      fragments.push(fragment);
    }

    if (fragments.length === 0) {
      throw new TypeError(`Changelog entry date ${dateEntry.name} must contain an item.`);
    }
    entriesByDate.set(dateEntry.name, fragments);
  }

  const metadataByDate = readEditionMetadata(editionsRoot);
  for (const date of metadataByDate.keys()) {
    if (!entriesByDate.has(date)) {
      throw new TypeError(`Changelog edition metadata ${date} has no entry fragments.`);
    }
  }

  return [...entriesByDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([publishedOn, fragments]) => {
      const metadata = metadataByDate.get(publishedOn)
        ?? defaultEditionMetadata(publishedOn, fragments.length);
      return {
        id: publishedOn,
        items: fragments
          .sort((left, right) =>
            right.order - left.order || left.item.id.localeCompare(right.item.id)
          )
          .map((fragment) => fragment.item),
        publishedOn,
        summary: metadata.summary,
        title: metadata.title,
      } satisfies ChangelogEdition;
    });
}

function readEditionMetadata(
  editionsRoot: string,
): ReadonlyMap<string, ChangelogEditionMetadata> {
  if (!existsSync(editionsRoot)) {
    return new Map();
  }

  const metadataByDate = new Map<string, ChangelogEditionMetadata>();
  for (const fileEntry of readDirectory(editionsRoot, "edition metadata root")) {
    const fileMatch = fileEntry.isFile()
      ? /^(\d{4}-\d{2}-\d{2})\.json$/u.exec(fileEntry.name)
      : null;
    if (!fileMatch || !isChangelogDate(fileMatch[1])) {
      throw new TypeError(
        `Changelog edition metadata contains an invalid file: ${fileEntry.name}`,
      );
    }
    const expectedDate = fileMatch[1];
    const metadata = parseEditionMetadata(
      readJsonFile(
        path.join(editionsRoot, fileEntry.name),
        `edition metadata ${fileEntry.name}`,
      ),
      `edition metadata ${fileEntry.name}`,
    );
    if (metadata.publishedOn !== expectedDate) {
      throw new TypeError(
        `Changelog edition metadata ${fileEntry.name} must use its date as the filename.`,
      );
    }
    metadataByDate.set(expectedDate, metadata);
  }
  return metadataByDate;
}

function readDirectory(directory: string, label: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    throw new TypeError(`Could not read the changelog ${label}.`);
  }
}

function readJsonFile(filePath: string, label: string): unknown {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed;
  } catch {
    throw new TypeError(`Changelog ${label} must contain valid JSON.`);
  }
}

function parseEntryFragment(value: unknown, label: string): ChangelogEntryFragment {
  assertObject(value, label);
  assertExactKeys(value, ["item", "order", "publishedOn"], label);
  return {
    item: parseItem(value.item, `${label} item`),
    order: readOrder(value.order, `${label} order`),
    publishedOn: readString(value.publishedOn, `${label} publishedOn`),
  };
}

function parseEditionMetadata(
  value: unknown,
  label: string,
): ChangelogEditionMetadata {
  assertObject(value, label);
  assertExactKeys(value, ["publishedOn", "summary", "title"], label);
  return {
    publishedOn: readString(value.publishedOn, `${label} publishedOn`),
    summary: readString(value.summary, `${label} summary`),
    title: readString(value.title, `${label} title`),
  };
}

function parseItem(value: unknown, label: string): ChangelogItem {
  assertObject(value, label);
  assertExactKeys(
    value,
    [
      "details",
      "id",
      "kind",
      "priority",
      "relevanceTags",
      "sourcePullRequests",
      "summary",
      "title",
      "tryIt",
    ],
    label,
  );
  const details = readOptionalString(value.details, `${label} details`);
  const tryIt = value.tryIt === undefined
    ? undefined
    : parseTryIt(value.tryIt, `${label} tryIt`);

  return {
    ...(details === undefined ? {} : { details }),
    id: readString(value.id, `${label} id`),
    kind: readItemKind(value.kind, `${label} kind`),
    priority: readPriority(value.priority, `${label} priority`),
    relevanceTags: readStringArray(value.relevanceTags, `${label} relevanceTags`),
    sourcePullRequests: readNumberArray(
      value.sourcePullRequests,
      `${label} sourcePullRequests`,
    ),
    summary: readString(value.summary, `${label} summary`),
    title: readString(value.title, `${label} title`),
    ...(tryIt === undefined ? {} : { tryIt }),
  };
}

function parseTryIt(value: unknown, label: string): ChangelogTryIt {
  assertObject(value, label);
  assertExactKeys(value, ["href", "label", "prompt"], label);
  const href = readOptionalString(value.href, `${label} href`);
  const prompt = readOptionalString(value.prompt, `${label} prompt`);
  return {
    ...(href === undefined ? {} : { href }),
    label: readString(value.label, `${label} label`),
    ...(prompt === undefined ? {} : { prompt }),
  };
}

function defaultEditionMetadata(
  publishedOn: string,
  itemCount: number,
): ChangelogEditionMetadata {
  return {
    publishedOn,
    summary: `${itemCount} ${itemCount === 1 ? "update" : "updates"} shipped in this edition.`,
    title: "What's new in Murph",
  };
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Changelog ${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new TypeError(`Changelog ${label} contains an unknown field: ${unknownKey}`);
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Changelog ${label} must be a string.`);
  }
  return value;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : readString(value, label);
}

function readStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Changelog ${label} must be an array.`);
  }
  return value.map((entry) => readString(entry, `${label} entry`));
}

function readNumberArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Changelog ${label} must be an array.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "number") {
      throw new TypeError(`Changelog ${label} entries must be numbers.`);
    }
    return entry;
  });
}

function readOrder(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_FRAGMENT_ORDER
  ) {
    throw new TypeError(
      `Changelog ${label} must be an integer between 0 and ${MAX_FRAGMENT_ORDER}.`,
    );
  }
  return value;
}

function readItemKind(value: unknown, label: string): ChangelogItemKind {
  if (value !== "feature" && value !== "improvement") {
    throw new TypeError(`Changelog ${label} must be feature or improvement.`);
  }
  return value;
}

function readPriority(value: unknown, label: string): ChangelogPriority {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) {
    throw new TypeError(`Changelog ${label} must be between 1 and 5.`);
  }
  return value;
}

function isChangelogDate(value: string): boolean {
  if (!CHANGELOG_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}
