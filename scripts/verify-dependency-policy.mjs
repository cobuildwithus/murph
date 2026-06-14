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
const blockedLockfileEntries = [
  {
    name: "axios",
    reason: "malicious March 2026 npm supply-chain compromise release",
    version: "1.14.1",
  },
  {
    name: "axios",
    reason: "malicious March 2026 npm supply-chain compromise release",
    version: "0.30.4",
  },
  {
    name: "plain-crypto-js",
    reason: "malicious Axios compromise dropper package",
    version: null,
  },
];
const minimumLockfileVersions = [
  {
    name: "@grpc/grpc-js",
    minimumVersion: "1.14.4",
    reason: "Dependabot security patch floor",
  },
  {
    name: "axios",
    minimumVersion: "1.16.0",
    reason: "Dependabot security patch floor",
  },
  {
    name: "esbuild",
    minimumVersion: "0.28.1",
    reason: "Dependabot security patch floor",
  },
  {
    name: "hono",
    minimumVersion: "4.12.21",
    reason: "Dependabot security patch floor",
  },
  {
    name: "ip-address",
    minimumVersion: "10.1.1",
    reason: "Dependabot security patch floor",
  },
  {
    name: "js-cookie",
    minimumVersion: "3.0.7",
    reason: "Dependabot security patch floor",
  },
  {
    name: "postcss",
    minimumVersion: "8.5.10",
    reason: "Dependabot security patch floor",
  },
  {
    name: "qs",
    minimumVersion: "6.15.2",
    reason: "Dependabot security patch floor",
  },
  {
    name: "uuid",
    minimumVersion: "11.1.1",
    reason: "Dependabot security patch floor",
  },
];
const blockedLockfileVersionRanges = [
  {
    name: "brace-expansion",
    minimumInclusive: "5.0.0",
    maximumExclusive: "5.0.6",
    reason: "Dependabot security patch floor",
  },
  {
    name: "ws",
    minimumInclusive: "8.0.0",
    maximumExclusive: "8.20.1",
    reason: "Dependabot security patch floor",
  },
];

const lockfilePath = path.join(repoRoot, "pnpm-lock.yaml");

if (!existsSync(lockfilePath)) {
  errors.push(
    "Missing pnpm-lock.yaml. Commit the lockfile with every dependency change and install with --frozen-lockfile outside intentional dependency-edit flows.",
  );
} else {
  verifyLockfileSecurityVersions(readFileSync(lockfilePath, "utf8"));
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

      if (dependencyName.startsWith("@murphai/") && !spec.startsWith("workspace:")) {
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

function verifyLockfileSecurityVersions(lockfileText) {
  verifyBlockedLockfileEntries(lockfileText);
  const lockfileVersions = collectLockfilePackageVersions(lockfileText);

  for (const requirement of minimumLockfileVersions) {
    const versions = lockfileVersions.get(requirement.name);
    if (!versions) {
      continue;
    }

    for (const version of versions) {
      if (compareSemver(version, requirement.minimumVersion) >= 0) {
        continue;
      }

      errors.push(
        `pnpm-lock.yaml contains ${requirement.name}@${version}; ${requirement.reason} requires >= ${requirement.minimumVersion}.`,
      );
    }
  }

  for (const blockedRange of blockedLockfileVersionRanges) {
    const versions = lockfileVersions.get(blockedRange.name);
    if (!versions) {
      continue;
    }

    for (const version of versions) {
      const inRange = compareSemver(version, blockedRange.minimumInclusive) >= 0
        && compareSemver(version, blockedRange.maximumExclusive) < 0;
      if (!inRange) {
        continue;
      }

      errors.push(
        `pnpm-lock.yaml contains ${blockedRange.name}@${version}; ${blockedRange.reason} blocks >= ${blockedRange.minimumInclusive} < ${blockedRange.maximumExclusive}.`,
      );
    }
  }
}

function verifyBlockedLockfileEntries(lockfileText) {
  for (const blocked of blockedLockfileEntries) {
    const lockfileKeyPattern = blocked.version
      ? new RegExp(`^\\s{2}${escapeRegex(blocked.name)}@${escapeRegex(blocked.version)}:\\s*$`, "mu")
      : new RegExp(`^\\s{2}${escapeRegex(blocked.name)}@[^:\\n]+:\\s*$`, "mu");

    if (!lockfileKeyPattern.test(lockfileText)) {
      continue;
    }

    const entryLabel = blocked.version ? `${blocked.name}@${blocked.version}` : blocked.name;
    errors.push(
      `pnpm-lock.yaml must not contain ${entryLabel} (${blocked.reason}).`,
    );
  }
}

function collectLockfilePackageVersions(lockfileText) {
  const versionsByPackageName = new Map();

  for (const line of lockfileText.split("\n")) {
    const matched = line.match(/^ {2}(?:'([^']+)'|([^:\n]+)):\s*$/u);
    if (!matched) {
      continue;
    }

    const parsed = parseLockfilePackageKey(matched[1] ?? matched[2]);
    if (!parsed) {
      continue;
    }

    let versions = versionsByPackageName.get(parsed.name);
    if (!versions) {
      versions = new Set();
      versionsByPackageName.set(parsed.name, versions);
    }
    versions.add(parsed.version);
  }

  return versionsByPackageName;
}

function parseLockfilePackageKey(rawKey) {
  const key = rawKey.replace(/\(.+$/u, "");
  const versionSeparatorIndex = key.lastIndexOf("@");
  if (versionSeparatorIndex <= 0) {
    return null;
  }

  const name = key.slice(0, versionSeparatorIndex);
  const version = key.slice(versionSeparatorIndex + 1);
  if (!parseSemver(version)) {
    return null;
  }

  return { name, version };
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function parseSemver(version) {
  const matched = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  if (!matched) {
    return null;
  }

  return [
    Number.parseInt(matched[1], 10),
    Number.parseInt(matched[2], 10),
    Number.parseInt(matched[3], 10),
  ];
}
