import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOTS = ["packages", "apps"];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export async function loadWorkspacePackages(rootDir = repoRoot) {
  const packageJsonPaths = await findWorkspacePackageJsonPaths(rootDir);
  const packageEntries = await Promise.all(
    packageJsonPaths.map(async (packageJsonPath) => ({
      packageJson: JSON.parse(await readFile(packageJsonPath, "utf8")),
      packageJsonPath,
    })),
  );
  const workspacePackageNames = new Set(
    packageEntries
      .map(({ packageJson }) => packageJson.name)
      .filter((name) => typeof name === "string" && name.length > 0),
  );

  return packageEntries
    .filter(({ packageJson }) => workspacePackageNames.has(packageJson.name))
    .map(({ packageJson, packageJsonPath }) => ({
      internalDependencies: collectInternalWorkspaceDependencies(
        packageJson,
        workspacePackageNames,
      ),
      name: packageJson.name,
      packageJsonPath,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function collectInternalWorkspaceDependencies(packageJson, workspacePackageNames) {
  const dependenciesByName = new Map();

  for (const dependencyField of DEPENDENCY_FIELDS) {
    const dependencies = packageJson?.[dependencyField];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (!workspacePackageNames.has(dependencyName)) {
        continue;
      }

      const fields = dependenciesByName.get(dependencyName) ?? [];
      fields.push(dependencyField);
      dependenciesByName.set(dependencyName, fields);
    }
  }

  return [...dependenciesByName.entries()]
    .map(([name, fields]) => ({
      fields: [...new Set(fields)].sort(),
      name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function detectWorkspacePackageCycles(workspacePackages) {
  const packagesByName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const cycleKeys = new Set();
  const cycles = [];
  const visited = new Set();
  const visiting = new Set();
  const stack = [];

  function visit(packageName) {
    visiting.add(packageName);
    stack.push(packageName);

    const workspacePackage = packagesByName.get(packageName);
    for (const dependency of workspacePackage?.internalDependencies ?? []) {
      if (!packagesByName.has(dependency.name)) {
        continue;
      }

      if (visiting.has(dependency.name)) {
        const cycleStartIndex = stack.indexOf(dependency.name);
        const cyclePackageNames = normalizeCyclePackageNames([
          ...stack.slice(cycleStartIndex),
          dependency.name,
        ]);
        const cycleKey = cyclePackageNames.join(" -> ");

        if (!cycleKeys.has(cycleKey)) {
          cycleKeys.add(cycleKey);
          cycles.push({
            edges: buildCycleEdges(packagesByName, cyclePackageNames),
            packageNames: cyclePackageNames,
          });
        }

        continue;
      }

      if (!visited.has(dependency.name)) {
        visit(dependency.name);
      }
    }

    stack.pop();
    visiting.delete(packageName);
    visited.add(packageName);
  }

  for (const packageName of [...packagesByName.keys()].sort()) {
    if (!visited.has(packageName)) {
      visit(packageName);
    }
  }

  return cycles;
}

export function formatWorkspacePackageCycles(cycles, rootDir = repoRoot) {
  return cycles
    .map((cycle) => {
      const edges = cycle.edges
        .map(
          (edge) =>
            `${path.relative(rootDir, edge.packageJsonPath)} (${edge.fields.join(", ")}) -> ${edge.to}`,
        )
        .join(" | ");

      return `${cycle.packageNames.join(" -> ")} [${edges}]`;
    })
    .join("\n");
}

async function findWorkspacePackageJsonPaths(rootDir) {
  const packageJsonPaths = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const workspaceRootPath = path.join(rootDir, workspaceRoot);
    let entries = [];

    try {
      entries = await readdir(workspaceRootPath, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      packageJsonPaths.push(path.join(workspaceRootPath, entry.name, "package.json"));
    }
  }

  return packageJsonPaths.sort();
}

function buildCycleEdges(packagesByName, cyclePackageNames) {
  const edges = [];

  for (let index = 0; index < cyclePackageNames.length - 1; index += 1) {
    const from = cyclePackageNames[index];
    const to = cyclePackageNames[index + 1];
    const dependency = packagesByName
      .get(from)
      ?.internalDependencies.find((entry) => entry.name === to);

    if (!dependency) {
      throw new Error(`Missing cycle edge metadata for ${from} -> ${to}.`);
    }

    edges.push({
      fields: dependency.fields,
      from,
      packageJsonPath: packagesByName.get(from).packageJsonPath,
      to,
    });
  }

  return edges;
}

function normalizeCyclePackageNames(cyclePackageNames) {
  const uniquePackageNames = cyclePackageNames.slice(0, -1);
  const rotations = uniquePackageNames.map((_, startIndex) => {
    const rotated = [
      ...uniquePackageNames.slice(startIndex),
      ...uniquePackageNames.slice(0, startIndex),
    ];

    return [...rotated, rotated[0]];
  });

  return rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")))[0];
}

export async function main() {
  const workspacePackages = await loadWorkspacePackages();
  const cycles = detectWorkspacePackageCycles(workspacePackages);

  if (cycles.length > 0) {
    console.error("Workspace package dependency cycle check failed:");
    for (const line of formatWorkspacePackageCycles(cycles).split("\n")) {
      console.error(`- ${line}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Workspace package dependency cycle check passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
