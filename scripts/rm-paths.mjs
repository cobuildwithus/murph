#!/usr/bin/env node
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const patterns = process.argv.slice(2);

if (patterns.length === 0) {
  console.error("Usage: node scripts/rm-paths.mjs <path-or-glob> [...paths]");
  process.exitCode = 1;
} else {
  for (const pattern of patterns) {
    for (const target of await expandPattern(pattern)) {
      await rm(target, {
        force: true,
        maxRetries: 2,
        recursive: true,
      });
    }
  }
}

async function expandPattern(pattern) {
  if (!hasGlob(pattern)) {
    return [path.resolve(process.cwd(), pattern)];
  }

  const segments = normalizePattern(pattern)
    .split("/")
    .filter((segment) => segment.length > 0);
  const matches = [];

  await walk(process.cwd(), segments, 0, matches);
  return matches;
}

async function walk(currentDir, segments, index, matches) {
  if (index >= segments.length) {
    matches.push(currentDir);
    return;
  }

  const segment = segments[index];

  if (!hasGlob(segment)) {
    await walk(path.join(currentDir, segment), segments, index + 1, matches);
    return;
  }

  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw error;
  }

  const matcher = createSegmentMatcher(segment);
  for (const entry of entries) {
    if (!matcher.test(entry.name)) {
      continue;
    }

    await walk(path.join(currentDir, entry.name), segments, index + 1, matches);
  }
}

function hasGlob(value) {
  return value.includes("*") || value.includes("?") || value.includes("[");
}

function normalizePattern(pattern) {
  return pattern.replaceAll(path.sep, "/");
}

function createSegmentMatcher(segment) {
  let pattern = "";

  for (const character of segment) {
    if (character === "*") {
      pattern += ".*";
      continue;
    }

    if (character === "?") {
      pattern += ".";
      continue;
    }

    pattern += /[\\^$+?.()|{}\[\]]/u.test(character)
      ? `\\${character}`
      : character;
  }

  return new RegExp(`^${pattern}$`, "u");
}

function isMissingPathError(error) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}
