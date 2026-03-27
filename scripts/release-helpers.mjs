import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_RELEASE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u;

export function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function parseReleaseArgs(argv, definition) {
  const options = { ...definition.defaults };
  const optionsByFlag = new Map(
    definition.options.map((option) => [option.flag, option]),
  );

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const option = optionsByFlag.get(argument);

    if (option) {
      if (option.type === 'value') {
        options[option.key] = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      options[option.key] = option.value;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      console.log(definition.usageText);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  for (const option of definition.options) {
    if (option.type !== 'value' || !option.missingValueMessage) {
      continue;
    }

    const shouldValidate =
      option.missingValueCheck === 'always' || argv.includes(option.flag);

    if (shouldValidate && String(options[option.key]).length === 0) {
      throw new Error(option.missingValueMessage);
    }
  }

  return options;
}

export function isSupportedReleaseVersion(value) {
  return SUPPORTED_RELEASE_VERSION_PATTERN.test(value);
}

export function assertSupportedReleaseVersion(value, context) {
  if (!isSupportedReleaseVersion(value)) {
    throw new Error(
      `${context} must match ${SUPPORTED_RELEASE_VERSION_PATTERN.source}. Received: ${value}`,
    );
  }
}

export function repositoryUrlFrom(repository) {
  if (typeof repository === 'string') {
    return repository;
  }

  if (repository && typeof repository.url === 'string') {
    return repository.url;
  }

  return '';
}

export function resolveNpmTag(version) {
  assertSupportedReleaseVersion(version, 'Release version');

  if (/^\d+\.\d+\.\d+$/u.test(version)) {
    return '';
  }

  const prereleaseMatch = version.match(
    /^\d+\.\d+\.\d+-(alpha|beta|rc)\.\d+$/u,
  );
  if (prereleaseMatch) {
    return prereleaseMatch[1];
  }

  throw new Error(
    `Unsupported prerelease channel for ${version}. Expected alpha, beta, or rc.`,
  );
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadReleaseManifest(repoRoot = resolveRepoRoot()) {
  const manifestPath = path.join(repoRoot, 'scripts', 'release-manifest.json');
  return readJson(manifestPath);
}

export async function loadReleaseContext(repoRoot = resolveRepoRoot()) {
  const manifest = await loadReleaseManifest(repoRoot);
  const rootPackageJsonPath = path.join(repoRoot, 'package.json');
  const rootPackageJson = await readJson(rootPackageJsonPath);

  const packages = [];
  const seenNames = new Set();
  const seenPaths = new Set();

  for (const entry of manifest.packages) {
    if (seenNames.has(entry.name)) {
      throw new Error(`Duplicate release package name in manifest: ${entry.name}`);
    }
    if (seenPaths.has(entry.path)) {
      throw new Error(`Duplicate release package path in manifest: ${entry.path}`);
    }

    seenNames.add(entry.name);
    seenPaths.add(entry.path);

    const dirPath = path.join(repoRoot, entry.path);
    const packageJsonPath = path.join(dirPath, 'package.json');
    const packageJson = await readJson(packageJsonPath);
    const workspaceDependencies = collectWorkspaceDependencies(packageJson);

    packages.push({
      ...entry,
      dirPath,
      isScoped: entry.name.startsWith('@'),
      packageJson,
      packageJsonPath,
      workspaceDependencies,
    });
  }

  const packageByName = new Map(packages.map((entry) => [entry.name, entry]));
  const orderedPackages = topologicallySortReleasePackages(packages);
  const primaryPackage = packageByName.get(manifest.primaryPackage) ?? null;

  return {
    manifest,
    orderedPackages,
    packageByName,
    packages,
    primaryPackage,
    repoRoot,
    rootPackageJson,
    rootPackageJsonPath,
  };
}

export function collectWorkspaceDependencies(packageJson) {
  const dependencySections = [
    packageJson.dependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];

  const workspaceDependencies = [];

  for (const section of dependencySections) {
    for (const [name, version] of Object.entries(section ?? {})) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        workspaceDependencies.push({ name, version });
      }
    }
  }

  return workspaceDependencies.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function topologicallySortReleasePackages(packages) {
  const packageNames = new Set(packages.map((entry) => entry.name));
  const remainingDependencies = new Map(
    packages.map((entry) => [
      entry.name,
      new Set(
        entry.workspaceDependencies
          .map((dependency) => dependency.name)
          .filter((dependencyName) => packageNames.has(dependencyName)),
      ),
    ]),
  );

  const sorted = [];
  const remaining = new Set(packages.map((entry) => entry.name));

  while (remaining.size > 0) {
    let progressed = false;

    for (const entry of packages) {
      if (!remaining.has(entry.name)) {
        continue;
      }

      const dependencies = remainingDependencies.get(entry.name);
      if ((dependencies?.size ?? 0) > 0) {
        continue;
      }

      sorted.push(entry);
      remaining.delete(entry.name);
      progressed = true;

      for (const dependencySet of remainingDependencies.values()) {
        dependencySet.delete(entry.name);
      }
    }

    if (!progressed) {
      throw new Error(
        `Release manifest contains a dependency cycle: ${Array.from(remaining).join(', ')}`,
      );
    }
  }

  return sorted;
}

export function validateReleaseContext(context, options = {}) {
  const errors = [];
  const { expectVersion } = options;
  const { manifest, orderedPackages, packageByName, packages, primaryPackage } =
    context;

  if (typeof manifest.repositoryUrl !== 'string' || manifest.repositoryUrl.length === 0) {
    errors.push('scripts/release-manifest.json must declare repositoryUrl.');
  }

  if (
    !manifest.releaseArtifacts ||
    typeof manifest.releaseArtifacts.changelogPath !== 'string' ||
    typeof manifest.releaseArtifacts.releaseNotesDir !== 'string'
  ) {
    errors.push(
      'scripts/release-manifest.json must declare releaseArtifacts.changelogPath and releaseArtifacts.releaseNotesDir.',
    );
  }

  if (!primaryPackage) {
    errors.push(
      `Primary package ${manifest.primaryPackage} is missing from scripts/release-manifest.json.`,
    );
  }

  if (context.rootPackageJson?.name === manifest.primaryPackage) {
    errors.push(
      `Root package name ${manifest.primaryPackage} conflicts with the published primary package name.`,
    );
  }

  const versions = new Set();

  for (const entry of packages) {
    const packageName = entry.packageJson?.name;
    const packageVersion = entry.packageJson?.version;
    const repositoryUrl = repositoryUrlFrom(entry.packageJson?.repository);
    const exportEntry = entry.packageJson?.exports?.['.'];

    if (packageName !== entry.name) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} name must be ${entry.name}, found ${packageName ?? '<missing>'}.`,
      );
    }

    if (entry.packageJson?.private !== false) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} must be publishable (private: false).`,
      );
    }

    if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} must declare a version string.`,
      );
    } else if (!isSupportedReleaseVersion(packageVersion)) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} version ${packageVersion} is not supported by the release flow.`,
      );
    } else {
      versions.add(packageVersion);
    }

    if (repositoryUrl !== manifest.repositoryUrl) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} repository must be ${manifest.repositoryUrl}.`,
      );
    }

    if (
      typeof entry.packageJson?.main !== 'string' ||
      typeof entry.packageJson?.types !== 'string'
    ) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} must declare main and types entrypoints.`,
      );
    }

    if (
      !exportEntry ||
      typeof exportEntry.types !== 'string' ||
      (typeof exportEntry.default !== 'string' &&
        typeof exportEntry.import !== 'string')
    ) {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} must expose a typed default export for '.'.`,
      );
    }

    if (entry.isScoped && entry.packageJson?.publishConfig?.access !== 'public') {
      errors.push(
        `${path.relative(context.repoRoot, entry.packageJsonPath)} must set publishConfig.access to public.`,
      );
    }

    for (const dependency of entry.workspaceDependencies) {
      if (!packageByName.has(dependency.name)) {
        errors.push(
          `${path.relative(context.repoRoot, entry.packageJsonPath)} depends on workspace package ${dependency.name}, but it is not in the release manifest publish set.`,
        );
      }
    }
  }

  if (versions.size !== 1) {
    errors.push(
      `Release packages must share one version, found: ${Array.from(versions).sort().join(', ') || '<missing>'}.`,
    );
  }

  const sharedVersion = versions.size === 1 ? Array.from(versions)[0] : null;

  if (expectVersion && sharedVersion && sharedVersion !== expectVersion) {
    errors.push(
      `Expected release version ${expectVersion}, but manifest packages are on ${sharedVersion}.`,
    );
  }

  if (primaryPackage) {
    if (primaryPackage.packageJson?.name !== manifest.primaryPackage) {
      errors.push(
        `${path.relative(context.repoRoot, primaryPackage.packageJsonPath)} must publish the primary package name ${manifest.primaryPackage}.`,
      );
    }

    if (primaryPackage.packageJson?.bin?.murph !== 'dist/bin.js') {
      errors.push(
        `${path.relative(context.repoRoot, primaryPackage.packageJsonPath)} must expose the murph bin from dist/bin.js.`,
      );
    }

    if (primaryPackage.packageJson?.bin?.['vault-cli'] !== 'dist/bin.js') {
      errors.push(
        `${path.relative(context.repoRoot, primaryPackage.packageJsonPath)} must expose the vault-cli bin from dist/bin.js.`,
      );
    }

    if (!primaryPackage.packageJson?.files?.includes('CHANGELOG.md')) {
      errors.push(
        `${path.relative(context.repoRoot, primaryPackage.packageJsonPath)} files must include CHANGELOG.md.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const version = sharedVersion ?? 'UNCONFIRMED';
  const npmTag = sharedVersion ? resolveNpmTag(sharedVersion) : '';
  const releaseNotesPath = path.join(
    manifest.releaseArtifacts.releaseNotesDir,
    `v${version}.md`,
  );

  return {
    changelogPath: manifest.releaseArtifacts.changelogPath,
    isPrerelease: version.includes('-'),
    npmTag,
    primaryPackage: primaryPackage
      ? {
          name: primaryPackage.name,
          packageJsonPath: path.relative(
            context.repoRoot,
            primaryPackage.packageJsonPath,
          ),
          path: primaryPackage.path,
        }
      : null,
    packages: orderedPackages.map((entry) => ({
      name: entry.name,
      packageJsonPath: path.relative(context.repoRoot, entry.packageJsonPath),
      path: entry.path,
      version: entry.packageJson.version,
      workspaceDependencies: entry.workspaceDependencies.map(
        (dependency) => dependency.name,
      ),
    })),
    releaseNotesPath,
    version,
  };
}

export async function updateReleasePackageVersions(context, version) {
  assertSupportedReleaseVersion(version, 'Release version');

  for (const entry of context.packages) {
    const nextPackageJson = {
      ...entry.packageJson,
      version,
    };

    await writeJson(entry.packageJsonPath, nextPackageJson);
    entry.packageJson = nextPackageJson;
  }
}
