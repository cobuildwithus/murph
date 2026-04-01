#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestPaths = [
  path.join(repoRoot, "package.json"),
  ...listPackageManifests(path.join(repoRoot, "apps")),
  ...listPackageManifests(path.join(repoRoot, "packages")),
];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const errors = [];

if (!existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) {
  errors.push(
    "Missing pnpm-lock.yaml. Commit the lockfile with every dependency change and install with --frozen-lockfile outside intentional dependency-edit flows.",
  );
}

const rootPackageJson = readJson(path.join(repoRoot, "package.json"));
const packageManager = typeof rootPackageJson.packageManager === "string"
  ? rootPackageJson.packageManager
  : "";

if (!/^pnpm@\d+\.\d+\.\d+(\+sha512\.[A-Za-z0-9+/=.-]+)?$/u.test(packageManager)) {
  errors.push(
    `package.json must pin an exact pnpm packageManager string (found ${JSON.stringify(packageManager)}).`,
  );
}

for (const manifestPath of manifestPaths) {
  const manifest = readJson(manifestPath);
  const relPath = path.relative(repoRoot, manifestPath) || "package.json";
  const seen = new Map();

  for (const sectionName of dependencySections) {
    const dependencies = manifest[sectionName];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }

    for (const [dependencyName, rawSpec] of Object.entries(dependencies)) {
      if (typeof rawSpec !== "string") {
        errors.push(`${relPath} ${sectionName}.${dependencyName} must be a string.`);
        continue;
      }

      const spec = rawSpec.trim();
      if (spec !== rawSpec) {
        errors.push(`${relPath} ${sectionName}.${dependencyName} must not contain leading or trailing whitespace.`);
      }

      const previousSection = seen.get(dependencyName);
      if (previousSection) {
        errors.push(`${relPath} declares ${dependencyName} in both ${previousSection} and ${sectionName}.`);
      } else {
        seen.set(dependencyName, sectionName);
      }

      if (dependencyName.startsWith("@murph/") && !spec.startsWith("workspace:")) {
        errors.push(`${relPath} ${sectionName}.${dependencyName} must use the workspace: protocol.`);
      }

      const forbiddenReason = classifyForbiddenSpec(spec);
      if (forbiddenReason) {
        errors.push(`${relPath} ${sectionName}.${dependencyName} uses ${JSON.stringify(spec)} (${forbiddenReason}).`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Dependency policy verified for ${manifestPaths.length} package manifests.`);

function listPackageManifests(parentDir) {
  if (!existsSync(parentDir)) {
    return [];
  }

  return readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parentDir, entry.name, "package.json"))
    .filter((manifestPath) => existsSync(manifestPath));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function classifyForbiddenSpec(spec) {
  if (spec === "" || spec === "*" || spec === "latest") {
    return "an unpinned tag or wildcard instead of an intentional version range";
  }

  if (/^(?:alpha|beta|canary|next|rc)$/u.test(spec)) {
    return "a moving dist-tag instead of an intentional version range";
  }

  if (/^(?:file|link|portal|git\+ssh|git\+https|git\+http|git|github|http|https|npm):/u.test(spec)) {
    return "a non-registry dependency source or package alias";
  }

  return null;
}
