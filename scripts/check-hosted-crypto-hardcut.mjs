#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sourceRoots = ["apps", "packages"];

const ignoredDirectoryNames = new Set([
  ".git",
  ".next",
  ".next-dev",
  ".next-smoke",
  ".test-dist",
  ".turbo",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);

const ignoredDirectoryPrefixes = [
  ".next",
];

const allowedPathSegments = new Set([
  "__fixtures__",
  "__tests__",
  "agent-docs",
  "docs",
  "legacy-backfill",
  "legacy-v1-decrypt",
  "migrations",
  "test",
  "test-fixtures",
  "tests",
]);

const allowedFindingLabelsByFile = new Map([
  [
    "apps/web/src/lib/device-sync/env.ts",
    new Set([
      "legacy device-sync data-encryption env",
    ]),
  ],
  [
    "packages/assistant-runtime/src/hosted-device-sync-runtime.ts",
    new Set([
      "legacy packaged device-sync secret codec import",
    ]),
  ],
]);

const textFileExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const forbiddenTextPatterns = [
  {
    label: "legacy hosted web data-encryption env",
    pattern: /\bHOSTED_WEB_ENCRYPTION_KEY(?:_VERSION|RING_JSON)?\b/u,
  },
  {
    label: "legacy hosted wake/mailbox data-encryption env",
    pattern: /\bHOSTED_WAKE_ENCRYPTION_KEY(?:_VERSION|RING_JSON)?\b/u,
  },
  {
    label: "legacy device-sync data-encryption env",
    pattern: /\bDEVICE_SYNC_ENCRYPTION_KEY(?:_VERSION|RING_JSON)?\b/u,
  },
  {
    label: "legacy Cloudflare platform-envelope env",
    pattern: /\bHOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY(?:_ID|RING_JSON)?\b/u,
  },
  {
    label: "legacy hosted shared secret codec factory",
    pattern: /\bcreateHostedSecretCodec\b/u,
  },
  {
    label: "legacy hosted shared secret module",
    pattern: /hosted-encryption-shared/u,
  },
];

const forbiddenImportPatterns = [
  {
    label: "legacy hosted shared secret module import",
    pattern: /from\s+["'][^"']*hosted-encryption-shared(?:\.ts)?["']/u,
  },
  {
    label: "legacy device-sync secret codec import",
    pattern: /from\s+["'][^"']*device-sync\/crypto(?:\.ts)?["']/u,
  },
  {
    label: "legacy packaged device-sync secret codec import",
    pattern: /from\s+["']@murphai\/device-syncd\/crypto["']/u,
  },
];

const findings = [];

for (const root of sourceRoots) {
  walk(path.join(repoRoot, root));
}

if (findings.length > 0) {
  console.error("Hosted crypto hard-cut guard failed:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line}: ${finding.label}`);
    console.error(`  ${finding.text.trim()}`);
  }
  process.exitCode = 1;
}

function walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shouldIgnoreDirectory(entry.name)) {
        walk(absolutePath);
      }
      continue;
    }

    if (!entry.isFile() || !textFileExtensions.has(path.extname(entry.name))) {
      continue;
    }

    checkFile(absolutePath);
  }
}

function checkFile(absolutePath) {
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join("/");

  if (isAllowedPath(relativePath)) {
    return;
  }

  let contents;
  try {
    if (statSync(absolutePath).size > 2_000_000) {
      return;
    }
    contents = readFileSync(absolutePath, "utf8");
  } catch {
    return;
  }

  const lines = contents.split(/\r?\n/u);
  for (const { label, pattern } of [...forbiddenTextPatterns, ...forbiddenImportPatterns]) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!pattern.test(line)) {
        continue;
      }
      if (isAllowedFinding(relativePath, label)) {
        continue;
      }
      findings.push({
        file: relativePath,
        label,
        line: index + 1,
        text: line,
      });
    }
  }
}

function isAllowedFinding(relativePath, label) {
  return allowedFindingLabelsByFile.get(relativePath)?.has(label) === true;
}

function shouldIgnoreDirectory(name) {
  return ignoredDirectoryNames.has(name)
    || ignoredDirectoryPrefixes.some((prefix) => name.startsWith(prefix));
}

function isAllowedPath(relativePath) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => allowedPathSegments.has(segment))) {
    return true;
  }

  if (relativePath.endsWith(".test.ts") || relativePath.endsWith(".test.tsx")) {
    return true;
  }

  if (relativePath.endsWith(".spec.ts") || relativePath.endsWith(".spec.tsx")) {
    return true;
  }

  return false;
}
