import fs from "node:fs";
import path from "node:path";

type VitestBucketSeedBase = {
  name: string;
  includeRemaining?: boolean;
  patterns?: readonly string[];
};

export type VitestBucketSeed<TExtra extends object = object> =
  TExtra & VitestBucketSeedBase;

export type ResolvedVitestBucket<TExtra extends object = object> =
  TExtra & {
    fileNames: readonly string[];
    name: string;
  };

function normalizeVitestRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function resolveVitestBucketLabel(testDir: string, label?: string): string {
  if (label) {
    return label;
  }

  const relativePath = path.relative(process.cwd(), testDir);

  if (relativePath && !relativePath.startsWith("..")) {
    return normalizeVitestRelativePath(relativePath);
  }

  return path.basename(testDir);
}

function globToRegExp(glob: string): RegExp {
  let source = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];

    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index += 1;
        continue;
      }

      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += ".";
      continue;
    }

    if ("\\^$+?.()|{}[]".includes(char)) {
      source += `\\${char}`;
      continue;
    }

    source += char;
  }

  return new RegExp(`${source}$`);
}

function collectVitestFiles(testDir: string, currentDir = testDir): string[] {
  const entries = fs.readdirSync(currentDir, {
    withFileTypes: true,
  });
  const relativeFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      relativeFiles.push(...collectVitestFiles(testDir, fullPath));
      continue;
    }

    if (!/\.test\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }

    relativeFiles.push(
      normalizeVitestRelativePath(path.relative(testDir, fullPath)),
    );
  }

  return relativeFiles.sort();
}

export function discoverVitestTestFiles(testDir: string): readonly string[] {
  if (!fs.existsSync(testDir)) {
    return [];
  }

  return collectVitestFiles(testDir);
}

export function resolveVitestBucketFiles<TExtra extends object>(
  testDir: string,
  seeds: readonly VitestBucketSeed<TExtra>[],
  options?: {
    ignorePatterns?: readonly string[];
    label?: string;
  },
): ResolvedVitestBucket<TExtra>[] {
  const label = resolveVitestBucketLabel(testDir, options?.label);
  const ignoreMatchers = (options?.ignorePatterns ?? []).map(globToRegExp);
  const discoveredFiles = [...discoverVitestTestFiles(testDir)].filter(
    (fileName) => !ignoreMatchers.some((matcher) => matcher.test(fileName)),
  );

  if (discoveredFiles.length === 0) {
    throw new Error(`No Vitest test files discovered for ${label}.`);
  }

  const remainingFiles = new Set(discoveredFiles);
  const resolvedBuckets = seeds.map((seed) => ({
    ...seed,
    fileNames: [] as string[],
  }));

  for (const [index, bucket] of resolvedBuckets.entries()) {
    const matchers = (bucket.patterns ?? []).map(globToRegExp);

    if (matchers.length === 0) {
      continue;
    }

    for (const fileName of discoveredFiles) {
      if (!remainingFiles.has(fileName)) {
        continue;
      }

      if (!matchers.some((matcher) => matcher.test(fileName))) {
        continue;
      }

      resolvedBuckets[index].fileNames.push(fileName);
      remainingFiles.delete(fileName);
    }
  }

  const overflowBuckets = resolvedBuckets.filter((bucket) => bucket.includeRemaining);

  if (overflowBuckets.length > 0) {
    for (const [index, fileName] of [...remainingFiles].sort().entries()) {
      overflowBuckets[index % overflowBuckets.length]?.fileNames.push(fileName);
      remainingFiles.delete(fileName);
    }
  }

  if (remainingFiles.size > 0) {
    throw new Error(
      `Unassigned Vitest files for ${label}: ${[...remainingFiles].join(", ")}`,
    );
  }

  return resolvedBuckets;
}
