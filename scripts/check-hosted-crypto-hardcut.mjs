#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const codeTextFileExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".legacy",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const yamlTextFileExtensions = new Set([
  ".yaml",
  ".yml",
]);

const recursiveScanTargets = [
  {
    extensions: codeTextFileExtensions,
    honorAllowedPaths: true,
    root: "apps",
  },
  {
    extensions: codeTextFileExtensions,
    honorAllowedPaths: true,
    root: "packages",
  },
  {
    extensions: yamlTextFileExtensions,
    honorAllowedPaths: false,
    root: ".github/workflows",
  },
];

const explicitScanFiles = [
  "apps/cloudflare/DEPLOY.md",
  "apps/web/README.md",
  "scripts/hosted-local.ts",
];

const ignoredDirectoryNames = new Set([
  ".git",
  ".deploy",
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
  "migrations",
  "test",
  "test-fixtures",
  "tests",
]);

const forbiddenTextPatterns = [
  {
    label: "removed hosted shared secret codec factory",
    pattern: /\bcreateHostedSecretCodec\b/u,
  },
  {
    label: "removed hosted shared secret module",
    pattern: /hosted-encryption-shared/u,
  },
];

const forbiddenImportPatterns = [
  {
    label: "removed hosted shared secret module import",
    pattern: /from\s+["'][^"']*hosted-encryption-shared(?:\.ts)?["']/u,
  },
  {
    label: "removed app-local device-sync secret codec import",
    pattern: /from\s+["'][^"']*device-sync\/crypto(?:\.ts)?["']/u,
  },
  {
    label: "removed packaged device-sync secret codec import",
    pattern: /from\s+["']@murphai\/device-syncd\/crypto["']/u,
  },
];

const findings = [];

for (const target of recursiveScanTargets) {
  walk(path.join(repoRoot, target.root), target);
}

for (const file of explicitScanFiles) {
  checkFile(path.join(repoRoot, file), { honorAllowedPaths: false });
}

for (const file of discoverAppEnvExamples()) {
  checkFile(file, { honorAllowedPaths: false });
}

if (findings.length > 0) {
  console.error("Hosted crypto hard-cut guard failed:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line}: ${finding.label}`);
    console.error(`  ${finding.text.trim()}`);
  }
  process.exitCode = 1;
}

function walk(directory, target) {
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
        walk(absolutePath, target);
      }
      continue;
    }

    if (!entry.isFile() || !target.extensions.has(path.extname(entry.name))) {
      continue;
    }

    checkFile(absolutePath, target);
  }
}

function checkFile(absolutePath, options) {
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join("/");

  if (options.honorAllowedPaths && isAllowedPath(relativePath)) {
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
        text: formatFindingText(line, label),
      });
    }
  }
}

function formatFindingText(line, label) {
  return line;
}

function isAllowedFinding(relativePath, label) {
  return false;
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

function discoverAppEnvExamples() {
  const appsRoot = path.join(repoRoot, "apps");
  let entries;
  try {
    entries = readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsRoot, entry.name, ".env.example"));
}
