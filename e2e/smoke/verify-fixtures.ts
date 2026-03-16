import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface FixtureCorpusEntry {
  id?: unknown;
  path?: unknown;
  requiredPaths?: unknown;
}

interface FixtureCorpus {
  vaultFixtures?: FixtureCorpusEntry[];
  sampleImports?: Array<Pick<FixtureCorpusEntry, "id" | "path">>;
  goldenOutputs?: Array<Pick<FixtureCorpusEntry, "id" | "path">>;
}

interface SmokeScenario {
  id?: unknown;
  command?: unknown;
  vaultFixture?: unknown;
  goldenOutput?: unknown;
  inputs?: unknown;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const coverageMode = process.argv.includes("--coverage");

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(relativePath: string): Promise<T> {
  const fullPath = path.join(repoRoot, relativePath);
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw) as T;
}

async function readUtf8(relativePath: string): Promise<string> {
  const fullPath = path.join(repoRoot, relativePath);
  return readFile(fullPath, "utf8");
}

function pushMissing(errors: string[], label: string, relativePath: string): void {
  errors.push(`Missing ${label}: ${relativePath}`);
}

function extractDocumentedCommands(commandSurface: string): string[] {
  const matches = [
    ...commandSurface.matchAll(
      /## (?:Baseline Commands|Command Groups|Health Noun Grammar)[\s\S]*?```text\s*([\s\S]*?)```/g,
    ),
  ];

  if (matches.length === 0) {
    throw new Error(
      "Could not find any documented command blocks in docs/contracts/03-command-surface.md",
    );
  }

  return matches
    .flatMap((match) => match[1]?.split("\n") ?? [])
    .map((line) => line.trim())
    .filter((line) => line.startsWith("vault-cli "));
}

function normalizeDocumentedCommand(command: string): string {
  return command
    .replace(/\s+\[--format json\|md\]/g, "")
    .replace(/\s+\[--json\]/g, "")
    .replace(/\s+\[--verbose\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function expectString(
  errors: string[],
  value: unknown,
  fieldName: string,
  scenarioFile: string,
): value is string {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`Invalid ${fieldName} in ${scenarioFile}`);
    return false;
  }

  return true;
}

function expectStringArray(
  errors: string[],
  value: unknown,
  fieldName: string,
  scenarioFile: string,
): value is string[] {
  if (!Array.isArray(value)) {
    errors.push(`Invalid ${fieldName} in ${scenarioFile}`);
    return false;
  }

  return true;
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const corpusPath = "fixtures/fixture-corpus.json";

  if (!(await pathExists(corpusPath))) {
    pushMissing(errors, "fixture corpus manifest", corpusPath);
  }

  if (!(await pathExists("e2e/smoke/scenarios"))) {
    pushMissing(errors, "scenario directory", "e2e/smoke/scenarios");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const corpus = await readJson<FixtureCorpus>(corpusPath);
  const commandSurface = await readUtf8("docs/contracts/03-command-surface.md");
  const documentedCommands = extractDocumentedCommands(commandSurface);
  const scenarioDir = path.join(repoRoot, "e2e/smoke/scenarios");
  const scenarioFiles = (await readdir(scenarioDir))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  if (scenarioFiles.length === 0) {
    errors.push("No smoke scenario manifests found in e2e/smoke/scenarios");
  }

  const goldenOutputPaths = new Set<string>();
  const sampleImportPaths = new Set<string>();
  const vaultFixturePaths = new Set<string>();

  for (const fixture of corpus.vaultFixtures ?? []) {
    if (!expectString(errors, fixture.id, "vault fixture id", corpusPath)) {
      continue;
    }

    if (!expectString(errors, fixture.path, "vault fixture path", corpusPath)) {
      continue;
    }

    vaultFixturePaths.add(fixture.path);

    if (!(await pathExists(fixture.path))) {
      pushMissing(errors, "vault fixture directory", fixture.path);
      continue;
    }

    const requiredPaths = Array.isArray(fixture.requiredPaths) ? fixture.requiredPaths : [];
    for (const relativePath of requiredPaths) {
      if (typeof relativePath !== "string" || relativePath.length === 0) {
        errors.push(`Invalid vault fixture required path in ${corpusPath}`);
        continue;
      }

      const joinedPath = path.posix.join(fixture.path, relativePath);
      if (!(await pathExists(joinedPath))) {
        pushMissing(errors, "vault fixture artifact", joinedPath);
      }
    }
  }

  for (const sample of corpus.sampleImports ?? []) {
    if (!expectString(errors, sample.id, "sample import id", corpusPath)) {
      continue;
    }

    if (!expectString(errors, sample.path, "sample import path", corpusPath)) {
      continue;
    }

    sampleImportPaths.add(sample.path);

    if (!(await pathExists(sample.path))) {
      pushMissing(errors, "sample import fixture", sample.path);
    }
  }

  for (const golden of corpus.goldenOutputs ?? []) {
    if (!expectString(errors, golden.id, "golden output id", corpusPath)) {
      continue;
    }

    if (!expectString(errors, golden.path, "golden output path", corpusPath)) {
      continue;
    }

    goldenOutputPaths.add(golden.path);

    if (!(await pathExists(golden.path))) {
      pushMissing(errors, "golden output directory", golden.path);
      continue;
    }

    const readmePath = path.posix.join(golden.path, "README.md");
    if (!(await pathExists(readmePath))) {
      pushMissing(errors, "golden output README", readmePath);
    }
  }

  const seenScenarioIds = new Set<string>();
  const seenScenarioCommands = new Set<string>();
  const referencedSampleImports = new Set<string>();
  const referencedGoldenOutputs = new Set<string>();
  const referencedVaultFixtures = new Set<string>();

  for (const fileName of scenarioFiles) {
    const relativeScenarioPath = path.posix.join("e2e/smoke/scenarios", fileName);
    const scenario = await readJson<SmokeScenario>(relativeScenarioPath);

    if (!expectString(errors, scenario.id, "scenario id", relativeScenarioPath)) {
      continue;
    }

    if (!expectString(errors, scenario.command, "scenario command", relativeScenarioPath)) {
      continue;
    }

    if (
      !expectString(errors, scenario.vaultFixture, "scenario vault fixture", relativeScenarioPath)
    ) {
      continue;
    }

    if (
      !expectString(errors, scenario.goldenOutput, "scenario golden output", relativeScenarioPath)
    ) {
      continue;
    }

    if (!expectStringArray(errors, scenario.inputs, "scenario inputs", relativeScenarioPath)) {
      continue;
    }

    const expectedFileName = `${scenario.id}.json`;
    if (fileName !== expectedFileName) {
      errors.push(`Scenario file name mismatch: expected ${expectedFileName}, found ${fileName}`);
    }

    if (seenScenarioIds.has(scenario.id)) {
      errors.push(`Duplicate scenario id: ${scenario.id}`);
    }
    seenScenarioIds.add(scenario.id);

    if (seenScenarioCommands.has(scenario.command)) {
      errors.push(`Duplicate scenario command: ${scenario.command}`);
    }
    seenScenarioCommands.add(scenario.command);

    referencedVaultFixtures.add(scenario.vaultFixture);
    referencedGoldenOutputs.add(scenario.goldenOutput);

    if (!(await pathExists(scenario.vaultFixture))) {
      pushMissing(errors, "scenario vault fixture", scenario.vaultFixture);
    }

    if (!vaultFixturePaths.has(scenario.vaultFixture)) {
      errors.push(`Scenario references unindexed vault fixture: ${scenario.vaultFixture}`);
    }

    if (!(await pathExists(scenario.goldenOutput))) {
      pushMissing(errors, "scenario golden output", scenario.goldenOutput);
    }

    if (!goldenOutputPaths.has(scenario.goldenOutput)) {
      errors.push(`Scenario references unindexed golden output: ${scenario.goldenOutput}`);
    }

    for (const inputPath of scenario.inputs) {
      if (typeof inputPath !== "string" || inputPath.length === 0) {
        errors.push(`Invalid scenario input in ${relativeScenarioPath}`);
        continue;
      }

      if (!(await pathExists(inputPath))) {
        pushMissing(errors, "scenario input", inputPath);
      }

      if (sampleImportPaths.has(inputPath)) {
        referencedSampleImports.add(inputPath);
      }
    }
  }

  if (coverageMode) {
    const documentedCommandSet = new Set(documentedCommands.map(normalizeDocumentedCommand));
    const normalizedScenarioCommands = new Set(
      [...seenScenarioCommands].map(normalizeDocumentedCommand),
    );

    for (const command of documentedCommands) {
      if (!normalizedScenarioCommands.has(normalizeDocumentedCommand(command))) {
        errors.push(`Missing smoke scenario for documented command: ${command}`);
      }
    }

    for (const command of seenScenarioCommands) {
      if (!documentedCommandSet.has(normalizeDocumentedCommand(command))) {
        errors.push(`Smoke scenario command is not in the documented baseline surface: ${command}`);
      }
    }

    for (const inputPath of sampleImportPaths) {
      if (!referencedSampleImports.has(inputPath)) {
        errors.push(`Unreferenced sample import fixture: ${inputPath}`);
      }
    }

    for (const outputPath of goldenOutputPaths) {
      if (!referencedGoldenOutputs.has(outputPath)) {
        errors.push(`Unreferenced golden output directory: ${outputPath}`);
      }
    }

    for (const fixturePath of vaultFixturePaths) {
      if (!referencedVaultFixtures.has(fixturePath)) {
        errors.push(`Unreferenced vault fixture: ${fixturePath}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const modeLabel = coverageMode ? "coverage" : "integrity";
  console.log(
    `Smoke ${modeLabel} verification passed for ${scenarioFiles.length} scenarios, ` +
      `${sampleImportPaths.size} sample inputs, and ${goldenOutputPaths.size} golden-output directories.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
