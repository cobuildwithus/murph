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
const packageManagerMatch = packageManager.match(
  /^pnpm@(\d+\.\d+\.\d+)\+sha512\.([A-Za-z0-9+/_=-]+)$/u,
);

if (!packageManagerMatch) {
  errors.push(
    `package.json must pin pnpm in packageManager with an exact version and sha512 integrity (found ${JSON.stringify(packageManager)}).`,
  );
}

const expectedPnpmVersion = packageManagerMatch?.[1] ?? null;
const configuredPnpmEngine = typeof rootPackageJson.engines?.pnpm === "string"
  ? rootPackageJson.engines.pnpm.trim()
  : "";

if (!expectedPnpmVersion) {
  // Package manager string validation already recorded the error above.
} else if (configuredPnpmEngine !== expectedPnpmVersion) {
  errors.push(
    `package.json engines.pnpm must exactly match packageManager (${JSON.stringify(expectedPnpmVersion)}); found ${JSON.stringify(configuredPnpmEngine)}.`,
  );
}

const workspaceConfigPath = path.join(repoRoot, "pnpm-workspace.yaml");
const workspaceConfig = existsSync(workspaceConfigPath)
  ? readFileSync(workspaceConfigPath, "utf8")
  : "";

if (!workspaceConfig) {
  errors.push("pnpm-workspace.yaml is required so repo-wide pnpm supply-chain policy stays committed.");
} else {
  requireBooleanSetting(workspaceConfig, "engineStrict", true);
  requireBooleanSetting(workspaceConfig, "packageManagerStrictVersion", true);
  requireBooleanSetting(workspaceConfig, "managePackageManagerVersions", true);
  requireBooleanSetting(workspaceConfig, "blockExoticSubdeps", true);
  requireStringSetting(workspaceConfig, "verifyDepsBeforeRun", "error");
  requireStringSetting(workspaceConfig, "trustPolicy", "no-downgrade");
  requireMinimumIntegerSetting(workspaceConfig, "minimumReleaseAge", 1440);
  requireMinimumIntegerSetting(workspaceConfig, "trustPolicyIgnoreAfter", 259200);

  if (!/^allowBuilds:\s*$/mu.test(workspaceConfig)) {
    errors.push("pnpm-workspace.yaml must keep a reviewed allowBuilds block for dependency install scripts.");
  }

  if (/^dangerouslyAllowAllBuilds:\s*true\s*$/mu.test(workspaceConfig)) {
    errors.push("pnpm-workspace.yaml must not enable dangerouslyAllowAllBuilds: true.");
  }
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

function requireBooleanSetting(configText, key, expectedValue) {
  const matched = configText.match(new RegExp(`^${escapeRegex(key)}:\\s*(true|false)\\s*$`, "mu"));

  if (!matched) {
    errors.push(`pnpm-workspace.yaml must set ${key}: ${String(expectedValue)}.`);
    return;
  }

  const actualValue = matched[1] === "true";
  if (actualValue !== expectedValue) {
    errors.push(`pnpm-workspace.yaml must set ${key}: ${String(expectedValue)}.`);
  }
}

function requireStringSetting(configText, key, expectedValue) {
  const matched = configText.match(new RegExp(`^${escapeRegex(key)}:\\s*([^\n#]+?)\\s*$`, "mu"));

  if (!matched) {
    errors.push(`pnpm-workspace.yaml must set ${key}: ${expectedValue}.`);
    return;
  }

  const actualValue = matched[1].trim().replace(/^['"]|['"]$/g, "");
  if (actualValue !== expectedValue) {
    errors.push(`pnpm-workspace.yaml must set ${key}: ${expectedValue}.`);
  }
}

function requireMinimumIntegerSetting(configText, key, minimumValue) {
  const matched = configText.match(new RegExp(`^${escapeRegex(key)}:\\s*(\\d+)\\s*$`, "mu"));

  if (!matched) {
    errors.push(`pnpm-workspace.yaml must set ${key} to an integer >= ${minimumValue}.`);
    return;
  }

  const actualValue = Number.parseInt(matched[1], 10);
  if (!Number.isInteger(actualValue) || actualValue < minimumValue) {
    errors.push(`pnpm-workspace.yaml must set ${key} to an integer >= ${minimumValue}.`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
